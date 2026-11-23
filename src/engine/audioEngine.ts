import type { AudioAnalysis, TrackItem } from "../types/lumverse";

const NUM_BANDS = 16;
const NUM_BANDS_48 = 48;
const WAVE_SAMPLES = 128;

export class LumverseAudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private audioEl: HTMLAudioElement | null = null;
  private mediaSrc: MediaElementAudioSourceNode | null = null;

  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private timeData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private prevSpectrum: Float32Array = new Float32Array(NUM_BANDS);
  private bands = new Array<number>(NUM_BANDS).fill(0);
  private bands48 = new Array<number>(NUM_BANDS_48).fill(0);
  private peaks = new Array<number>(NUM_BANDS).fill(0);
  private waveform = new Array<number>(WAVE_SAMPLES).fill(0);
  private peakHoldTimer = new Array<number>(NUM_BANDS).fill(0);

  private bassAvg = 0.08;
  private beatVal = 0;
  private fluxVal = 0;
  private subBass = 0;
  private midEnergy = 0;
  private trebleEnergy = 0;
  private lastBeatTime = 0;

  private playing = false;
  private currentTrack: TrackItem | null = null;
  private synthPosition = 0;
  private lastTickMs = 0;
  private nextStepTime = 0;
  private stepIndex = 0;
  private synthSchedulerId: number | null = null;
  private volume = 0.72;
  private muted = false;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 6;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.2;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.74;

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      const bins = this.analyser.frequencyBinCount;
      this.freqData = new Uint8Array(new ArrayBuffer(bins));
      this.timeData = new Uint8Array(new ArrayBuffer(bins));
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    }
    if (this.audioEl) {
      this.audioEl.volume = this.muted ? 0 : this.volume;
    }
  }

  public setMuted(m: boolean): void {
    this.muted = m;
    this.setVolume(this.volume);
  }

  public loadTrack(track: TrackItem, autoPlay = false): void {
    const wasPlaying = this.playing;
    this.stopScheduler();
    if (this.audioEl) {
      this.audioEl.pause();
    }

    this.currentTrack = track;
    this.synthPosition = 0;
    this.stepIndex = 0;
    this.playing = false;

    if (track.audioObjectUrl) {
      this.setupMediaElement(track.audioObjectUrl);
    }

    if (autoPlay || wasPlaying) {
      void this.play();
    }
  }

  private setupMediaElement(url: string): void {
    const ctx = this.ensureContext();
    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.crossOrigin = "anonymous";
      this.audioEl.preload = "auto";
      this.audioEl.addEventListener("ended", () => {
        this.playing = false;
      });
      this.mediaSrc = ctx.createMediaElementSource(this.audioEl);
      if (this.compressor) {
        this.mediaSrc.connect(this.compressor);
      }
    }
    this.audioEl.src = url;
    this.audioEl.currentTime = 0;
    this.audioEl.volume = this.muted ? 0 : this.volume;
  }

  public async play(): Promise<void> {
    if (!this.currentTrack) return;
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (this.currentTrack.audioObjectUrl && this.audioEl) {
      await this.audioEl.play();
      this.playing = true;
      return;
    }

    this.playing = true;
    this.lastTickMs = performance.now();
    this.nextStepTime = ctx.currentTime + 0.03;
    this.startScheduler();
  }

  public pause(): void {
    this.playing = false;
    this.stopScheduler();
    if (this.audioEl && !this.audioEl.paused) {
      this.audioEl.pause();
    }
  }

  public togglePlay(): void {
    if (this.playing) {
      this.pause();
    } else {
      void this.play();
    }
  }

  public seek(seconds: number): void {
    if (!this.currentTrack) return;
    const dur = this.getDuration();
    const clamped = Math.max(0, Math.min(dur, seconds));
    if (this.currentTrack.audioObjectUrl && this.audioEl) {
      this.audioEl.currentTime = clamped;
    } else {
      this.synthPosition = clamped;
      const stepDur = 60 / (this.currentTrack.bpm * 4);
      this.stepIndex = Math.floor(clamped / stepDur);
    }
  }

  public isPlaying(): boolean {
    return this.playing;
  }

  public getPosition(): number {
    if (!this.currentTrack) return 0;
    if (this.currentTrack.audioObjectUrl && this.audioEl) {
      return this.audioEl.currentTime || 0;
    }
    if (this.playing) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastTickMs) / 1000);
      this.lastTickMs = now;
      this.synthPosition += dt;
      if (this.synthPosition >= this.currentTrack.duration) {
        this.synthPosition = 0;
        this.stepIndex = 0;
      }
    } else {
      this.lastTickMs = performance.now();
    }
    return this.synthPosition;
  }

  public getDuration(): number {
    if (!this.currentTrack) return 0;
    if (
      this.currentTrack.audioObjectUrl &&
      this.audioEl &&
      Number.isFinite(this.audioEl.duration) &&
      this.audioEl.duration > 0
    ) {
      return this.audioEl.duration;
    }
    return this.currentTrack.duration;
  }

  private startScheduler(): void {
    this.stopScheduler();
    const tick = () => {
      if (!this.playing || !this.ctx || !this.currentTrack) return;
      const lookahead = 0.12;
      const stepDur = 60 / (this.currentTrack.bpm * 4);
      while (this.nextStepTime < this.ctx.currentTime + lookahead) {
        this.triggerSynthStep(this.stepIndex, this.nextStepTime, stepDur);
        this.nextStepTime += stepDur;
        this.stepIndex = (this.stepIndex + 1) % 64;
      }
      this.synthSchedulerId = window.setTimeout(tick, 25);
    };
    tick();
  }

  private stopScheduler(): void {
    if (this.synthSchedulerId !== null) {
      clearTimeout(this.synthSchedulerId);
      this.synthSchedulerId = null;
    }
  }

  private triggerSynthStep(step: number, time: number, stepDur: number): void {
    if (!this.ctx || !this.compressor || !this.currentTrack) return;
    const preset = this.currentTrack.synthPreset || "neon-dusk";
    const s16 = step % 16;

    if (preset === "neon-dusk") {
      if (s16 % 4 === 0) this.playKick(time, 125, 42, 0.36, 0.85);
      if (s16 === 4 || s16 === 12) this.playSnare(time, 0.22, 0.42);
      if (s16 % 2 === 1) this.playHat(time, 0.06, 0.14);

      const roots = [55, 55, 65.41, 48.99];
      const bar = Math.floor(step / 16) % roots.length;
      const root = roots[bar];
      if (s16 % 2 === 0) {
        this.playBass(time, root, stepDur * 1.6, "sawtooth", 480, 0.34);
      }
      const arpNotes = [root * 4, root * 5, root * 6, root * 8];
      if (s16 % 2 === 0) {
        this.playLead(time, arpNotes[(step / 2) % arpNotes.length], stepDur * 1.4, "triangle", 0.14);
      }
      if (s16 === 0) {
        this.playPad(time, [root * 2, root * 3, root * 4.5], stepDur * 14, 0.11);
      }
    } else if (preset === "concrete-theorem") {
      if (s16 === 0 || s16 === 3 || s16 === 8 || s16 === 10) {
        this.playKick(time, 150, 38, 0.32, 0.95);
      }
      if (s16 === 4 || s16 === 12) this.playSnare(time, 0.20, 0.55);
      this.playHat(time, s16 % 4 === 2 ? 0.10 : 0.04, s16 % 2 === 0 ? 0.18 : 0.08);

      const bassSeq = [41.2, 41.2, 46.25, 49.0];
      const bar = Math.floor(step / 16) % bassSeq.length;
      if (s16 === 0 || s16 === 6 || s16 === 10 || s16 === 14) {
        this.playBass(time, bassSeq[bar], stepDur * 2.2, "square", 360, 0.30);
      }
      if (s16 === 0 || s16 === 8) {
        this.playLead(time, bassSeq[bar] * 6, stepDur * 1.8, "sawtooth", 0.12);
      }
    } else {
      if (s16 % 4 === 0) this.playKick(time, 100, 44, 0.34, 0.68);
      if (s16 % 4 === 2) this.playHat(time, 0.07, 0.12);
      if (s16 === 12) this.playSnare(time, 0.16, 0.25);

      const chords = [
        [220, 261.63, 329.63, 392.0],
        [174.61, 220, 261.63, 329.63],
        [196.0, 246.94, 293.66, 349.23],
        [164.81, 196.0, 246.94, 293.66],
      ];
      const bar = Math.floor(step / 16) % chords.length;
      if (s16 === 0 || s16 === 6) {
        this.playPad(time, chords[bar], stepDur * 7, 0.13);
      }
      if (s16 === 0 || s16 === 10) {
        this.playBass(time, chords[bar][0] * 0.25, stepDur * 3.5, "sine", 240, 0.40);
      }
    }
  }

  private playKick(time: number, fStart: number, fEnd: number, dur: number, gainAmt: number): void {
    if (!this.ctx || !this.compressor) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fStart, time);
    osc.frequency.exponentialRampToValueAtTime(fEnd, time + 0.08);
    g.gain.setValueAtTime(gainAmt, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g);
    g.connect(this.compressor);
    osc.start(time);
    osc.stop(time + dur);
  }

  private playSnare(time: number, dur: number, gainAmt: number): void {
    if (!this.ctx || !this.compressor) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1600, time);
    filter.Q.value = 0.8;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainAmt, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    noise.connect(filter);
    filter.connect(g);
    g.connect(this.compressor);
    noise.start(time);
    noise.stop(time + dur);
  }

  private playHat(time: number, dur: number, gainAmt: number): void {
    if (!this.ctx || !this.compressor) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(7000, time);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainAmt, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    noise.connect(hp);
    hp.connect(g);
    g.connect(this.compressor);
    noise.start(time);
    noise.stop(time + dur);
  }

  private playBass(
    time: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    cutoff: number,
    gainAmt: number
  ): void {
    if (!this.ctx || !this.compressor) return;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(cutoff * 1.8, time);
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.5, time + dur);
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(gainAmt, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.compressor);
    osc.start(time);
    osc.stop(time + dur);
  }

  private playLead(time: number, freq: number, dur: number, type: OscillatorType, gainAmt: number): void {
    if (!this.ctx || !this.compressor) return;
    const osc = this.ctx.createOscillator();
    const lp = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2400, time);
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(gainAmt, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.compressor);
    osc.start(time);
    osc.stop(time + dur);
  }

  private playPad(time: number, freqs: number[], dur: number, gainAmt: number): void {
    if (!this.ctx || !this.compressor) return;
    for (const f of freqs) {
      const osc = this.ctx.createOscillator();
      const lp = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, time);
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1400, time);
      g.gain.setValueAtTime(0.001, time);
      g.gain.linearRampToValueAtTime(gainAmt / freqs.length, time + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(lp);
      lp.connect(g);
      g.connect(this.compressor);
      osc.start(time);
      osc.stop(time + dur);
    }
  }

  public sampleAnalysis(dt: number, sensitivity = 1.15): AudioAnalysis {
    const f = dt * 60;
    const decay = Math.pow(0.86, f);

    if (this.analyser && this.playing && this.ctx) {
      this.analyser.getByteFrequencyData(this.freqData);
      this.analyser.getByteTimeDomainData(this.timeData);
      const nyquist = this.ctx.sampleRate / 2;
      const binCount = this.freqData.length;

      const minHz = 28;
      const maxHz = 14000;
      let flux = 0;

      // 16 bands for card EQ & onset detection
      for (let i = 0; i < NUM_BANDS; i++) {
        const fLo = minHz * Math.pow(maxHz / minHz, i / NUM_BANDS);
        const fHi = minHz * Math.pow(maxHz / minHz, (i + 1) / NUM_BANDS);
        const bLo = Math.max(0, Math.floor((fLo / nyquist) * binCount));
        const bHi = Math.min(binCount - 1, Math.max(bLo, Math.ceil((fHi / nyquist) * binCount)));

        let sum = 0;
        for (let b = bLo; b <= bHi; b++) {
          sum += this.freqData[b] / 255;
        }
        const raw = Math.min(1, (sum / (bHi - bLo + 1)) * sensitivity);
        const prev = this.bands[i];
        const alpha = raw > prev ? 0.62 : 0.16;
        this.bands[i] = prev + (raw - prev) * alpha;

        const diff = raw - this.prevSpectrum[i];
        if (diff > 0) flux += diff * (i < 5 ? 1.5 : 0.7);
        this.prevSpectrum[i] = raw;

        if (this.bands[i] >= this.peaks[i]) {
          this.peaks[i] = this.bands[i];
          this.peakHoldTimer[i] = 0.35;
        } else {
          this.peakHoldTimer[i] -= dt;
          if (this.peakHoldTimer[i] <= 0) {
            this.peaks[i] = Math.max(this.bands[i], this.peaks[i] - dt * 0.85);
          }
        }
      }

      // 48 high-res log bands for center-stage visualizers
      for (let i = 0; i < NUM_BANDS_48; i++) {
        const fLo = minHz * Math.pow(maxHz / minHz, i / NUM_BANDS_48);
        const fHi = minHz * Math.pow(maxHz / minHz, (i + 1) / NUM_BANDS_48);
        const bLo = Math.max(0, Math.floor((fLo / nyquist) * binCount));
        const bHi = Math.min(binCount - 1, Math.max(bLo, Math.ceil((fHi / nyquist) * binCount)));
        let sum = 0;
        for (let b = bLo; b <= bHi; b++) {
          sum += this.freqData[b] / 255;
        }
        const raw = Math.min(1, (sum / (bHi - bLo + 1)) * sensitivity);
        const prev = this.bands48[i];
        this.bands48[i] = prev + (raw - prev) * (raw > prev ? 0.58 : 0.18);
      }

      // 128 time-domain waveform samples (-1..1)
      const stride = Math.max(1, Math.floor(this.timeData.length / WAVE_SAMPLES));
      for (let i = 0; i < WAVE_SAMPLES; i++) {
        const sample = (this.timeData[i * stride] - 128) / 128;
        this.waveform[i] = this.waveform[i] * 0.35 + sample * 0.65;
      }

      this.subBass = (this.bands[0] + this.bands[1] + this.bands[2]) / 3;
      this.midEnergy = (this.bands[5] + this.bands[6] + this.bands[7] + this.bands[8]) / 4;
      this.trebleEnergy = (this.bands[11] + this.bands[12] + this.bands[13] + this.bands[14]) / 4;
      this.fluxVal = Math.min(1, flux / 3.2);

      this.bassAvg += (this.subBass - this.bassAvg) * 0.045;
      const onset = this.subBass - this.bassAvg * 1.18 + this.fluxVal * 0.25;
      const nowMs = performance.now();
      if (onset > 0.085 && nowMs - this.lastBeatTime > 110) {
        this.beatVal = Math.max(this.beatVal, Math.min(1, onset * 3.2 * sensitivity));
        this.lastBeatTime = nowMs;
      } else {
        this.beatVal *= decay;
      }

      return {
        bands: [...this.bands],
        bands48: [...this.bands48],
        peaks: [...this.peaks],
        waveform: [...this.waveform],
        subBass: this.subBass,
        midEnergy: this.midEnergy,
        trebleEnergy: this.trebleEnergy,
        beat: this.beatVal,
        flux: this.fluxVal,
        isLiveAudio: true,
      };
    }

    // Idle gentle breathing waveform
    this.beatVal *= decay;
    this.subBass *= 0.92;
    this.midEnergy *= 0.92;
    this.trebleEnergy *= 0.92;
    this.fluxVal *= 0.9;
    const t = performance.now() / 1000;
    for (let i = 0; i < NUM_BANDS; i++) {
      const idleWave = 0.04 + 0.03 * Math.sin(t * 1.4 + i * 0.45);
      this.bands[i] += (idleWave - this.bands[i]) * 0.1;
      this.peaks[i] = Math.max(this.bands[i], this.peaks[i] * 0.94);
    }
    for (let i = 0; i < NUM_BANDS_48; i++) {
      const idle48 = 0.04 + 0.03 * Math.sin(t * 1.3 + i * 0.18);
      this.bands48[i] += (idle48 - this.bands48[i]) * 0.1;
    }
    for (let i = 0; i < WAVE_SAMPLES; i++) {
      const idleS = 0.03 * Math.sin((i / WAVE_SAMPLES) * Math.PI * 4 + t * 1.8);
      this.waveform[i] += (idleS - this.waveform[i]) * 0.12;
    }

    return {
      bands: [...this.bands],
      bands48: [...this.bands48],
      peaks: [...this.peaks],
      waveform: [...this.waveform],
      subBass: this.subBass,
      midEnergy: this.midEnergy,
      trebleEnergy: this.trebleEnergy,
      beat: this.beatVal,
      flux: this.fluxVal,
      isLiveAudio: false,
    };
  }
}

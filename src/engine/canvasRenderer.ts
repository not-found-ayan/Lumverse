import type {
  AudioAnalysis,
  LumverseConfig,
  LyricLine,
  LyricsData,
  PaletteColors,
  ResolvedGenre,
} from "../types/lumverse";
import type { GenreSceneAnimator } from "./genreAnimator";
import { findLineIndexAt } from "./lrcParser";
import { clamp01, darken, lighten, mixRgb, rgbCss, type RGB } from "./palette";
import { FONT_PRESETS } from "./presets";

export interface SceneRenderInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dt?: number;
  timeSec: number;
  positionSec: number;
  durationSec: number;
  playing: boolean;
  config: LumverseConfig;
  palette: PaletteColors;
  audio: AudioAnalysis;
  lyrics: LyricsData | null;
  title: string;
  artist: string;
  albumArt: HTMLImageElement | null;
  cardProgress: number; // 0..1
  cardDirection: number; // 1 or -1
  resolvedGenre?: ResolvedGenre;
  genreAnimator?: GenreSceneAnimator;
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - clamp01(x), 3);
}

function easeInCubic(x: number): number {
  const c = clamp01(x);
  return c * c * c;
}

function easeOutExpo(x: number): number {
  const c = clamp01(x);
  return c >= 1 ? 1 : 1 - Math.pow(2, -10 * c);
}

function easeOutBack(x: number, c1 = 1.70158): number {
  const c = clamp01(x);
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

function getFontFamily(presetId: LumverseConfig["fontPreset"]): string {
  return FONT_PRESETS.find((f) => f.id === presetId)?.family ?? FONT_PRESETS[0].family;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function edgeColor(c1: RGB, c2: RGB, u: number, tt: number, midEnergy: number, tint = 0): RGB {
  const speed = 0.055 + midEnergy * 0.045;
  const k = 0.5 + 0.5 * Math.sin(2 * Math.PI * (u * 2 + tt * speed));
  const mixed = mixRgb(c1, c2, k);
  return tint > 0 ? mixRgb(mixed, [1, 1, 1], tint) : mixed;
}

function drawEdgeGradientStrip(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  T: number,
  alpha: number,
  tt: number,
  c1: RGB,
  c2: RGB,
  midEnergy: number,
  tint = 0
): void {
  if (alpha <= 0.004 || T <= 0.5) return;
  const perimeter = 2 * (w + h);
  const ut = 0;
  const ur = w / perimeter;
  const ub = (w + h) / perimeter;
  const ul = (2 * w + h) / perimeter;

  const paintEdge = (
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    gx0: number,
    gy0: number,
    gx1: number,
    gy1: number,
    u0: number,
    u1: number,
    ax0: number,
    ay0: number,
    ax1: number,
    ay1: number
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, rw, rh);
    ctx.clip();

    // Cosine alpha falloff using multi-stop gradient into an offscreen mask effect via destination/lighter
    const colGrad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    const stops = 10;
    for (let i = 0; i <= stops; i++) {
      const f = i / stops;
      const col = edgeColor(c1, c2, u0 + (u1 - u0) * f, tt, midEnergy, tint);
      colGrad.addColorStop(f, rgbCss(col, alpha));
    }

    ctx.fillStyle = colGrad;
    ctx.fillRect(rx, ry, rw, rh);

    // Sculpt smooth cosine falloff inward using destination-in? Better: radial corner mask or multiply-alpha gradient.
    // Instead, draw overlapping directional strips with smooth stop alpha & 'lighter' blend.
    ctx.restore();

    // True smooth directional alpha + color gradient in one pass by sampling perpendicular stops?
    // Even cleaner: draw edge perpendicular strips with interpolated edge color at center/segments!
    void ax0;
    void ay0;
    void ax1;
    void ay1;
  };
  void paintEdge;

  // Seamless segmented edge strips: eliminates diagonal linear box seams completely
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const drawSegmentedEdge = (
    segments: number,
    getPoint: (f: number) => { x: number; y: number; nx: number; ny: number; len: number; u: number }
  ) => {
    for (let i = 0; i < segments; i++) {
      const f0 = i / segments;
      const f1 = (i + 1) / segments;
      const fm = (f0 + f1) * 0.5;
      const p0 = getPoint(f0);
      const p1 = getPoint(f1);
      const col = edgeColor(c1, c2, p0.u + (p1.u - p0.u) * 0.5, tt, midEnergy, tint);

      const gx0 = (p0.x + p1.x) * 0.5;
      const gy0 = (p0.y + p1.y) * 0.5;
      const gx1 = gx0 + p0.nx * T;
      const gy1 = gy0 + p0.ny * T;

      const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
      // Cosine-eased falloff eliminates banding and hard inner cutoffs
      grad.addColorStop(0, rgbCss(col, alpha));
      grad.addColorStop(0.28, rgbCss(col, alpha * 0.52));
      grad.addColorStop(0.62, rgbCss(col, alpha * 0.16));
      grad.addColorStop(1, rgbCss(col, 0));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p1.x + p1.nx * T, p1.y + p1.ny * T);
      ctx.lineTo(p0.x + p0.nx * T, p0.y + p0.ny * T);
      ctx.closePath();
      ctx.fill();
      void fm;
    }
  };

  drawSegmentedEdge(12, (f) => ({ x: f * w, y: 0, nx: 0, ny: 1, len: w, u: ut + (ur - ut) * f }));
  drawSegmentedEdge(8, (f) => ({ x: w, y: f * h, nx: -1, ny: 0, len: h, u: ur + (ub - ur) * f }));
  drawSegmentedEdge(12, (f) => ({ x: (1 - f) * w, y: h, nx: 0, ny: -1, len: w, u: ub + (ul - ub) * f }));
  drawSegmentedEdge(8, (f) => ({ x: 0, y: (1 - f) * h, nx: 1, ny: 0, len: h, u: ul + (1 - ul) * f }));

  ctx.restore();
}

export function drawGlow(input: SceneRenderInput, S: number): void {
  const { ctx, width: w, height: h, timeSec: tt, playing, config, palette, audio } = input;
  const c1 = palette.primary;
  const c2 = palette.secondary;

  const beat = config.beatReactive ? audio.beat : 0;
  const sub = config.beatReactive ? audio.subBass : 0;
  const mid = config.beatReactive ? audio.midEnergy : 0;
  const treble = config.beatReactive ? audio.trebleEnergy : 0;

  const baseLevel = playing ? 1.0 : 0.34;
  const breathe = 0.88 + 0.12 * Math.sin(tt * 1.5);
  const boost = 1.0 + 0.65 * beat + 0.35 * sub;
  const a = clamp01(baseLevel * config.maxAlpha * breathe * boost * 0.72);
  const T = config.thickness * S * (1 + 0.48 * beat + 0.28 * sub);

  if (config.glowMode === "hairline") {
    drawEdgeGradientStrip(ctx, w, h, Math.max(6, 12 * S), Math.min(1, a * 1.45), tt, c1, c2, mid, 0.22);
    if (beat > 0.08) {
      drawEdgeGradientStrip(ctx, w, h, 26 * S, Math.min(0.8, beat * 0.65), tt, c1, c2, mid, 0.65);
    }
    return;
  }

  if (config.glowMode === "vignette") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const cx = w * 0.5;
    const cy = h * 0.5;
    const outerR = Math.hypot(cx, cy);
    const innerR = outerR * clamp01(0.56 - 0.14 * sub - 0.08 * beat);
    const col = edgeColor(c1, c2, 0.25, tt, mid, 0);
    const col2 = edgeColor(c1, c2, 0.75, tt, mid, 0);

    const g = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    g.addColorStop(0, rgbCss(col, 0));
    g.addColorStop(0.55, rgbCss(col, a * 0.24));
    g.addColorStop(0.85, rgbCss(col2, a * 0.65));
    g.addColorStop(1, rgbCss(col2, a * 0.92));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } else {
    // Aurora or Prism base perimeter bloom
    drawEdgeGradientStrip(ctx, w, h, T, a * 0.72, tt, c1, c2, mid, 0);
    drawEdgeGradientStrip(ctx, w, h, T * 0.34, clamp01(a * 0.95), tt, c1, c2, mid, 0.12);
  }

  if (config.glowMode === "prism") {
    const shift = (8 + 22 * beat) * S;
    ctx.save();
    ctx.translate(-shift * 0.5, 0);
    drawEdgeGradientStrip(ctx, w, h, T * 0.45, clamp01(a * 0.55 + beat * 0.35), tt + 0.4, palette.accent, c1, mid, 0.2);
    ctx.restore();
    ctx.save();
    ctx.translate(shift * 0.5, 0);
    drawEdgeGradientStrip(ctx, w, h, T * 0.45, clamp01(a * 0.55 + beat * 0.35), tt - 0.4, c2, palette.accent, mid, 0.2);
    ctx.restore();
  }

  // Smooth corner bloom (matched to edge falloff)
  const cornerR = T * 2.1;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const corners: [number, number, number][] = [
    [0, 0, 0.0],
    [w, 0, 0.25],
    [w, h, 0.5],
    [0, h, 0.75],
  ];
  for (const [cx, cy, u] of corners) {
    const col = edgeColor(c1, c2, u, tt, mid, 0);
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cornerR);
    rg.addColorStop(0, rgbCss(col, 0.48 * a));
    rg.addColorStop(0.5, rgbCss(col, 0.16 * a));
    rg.addColorStop(1, rgbCss(col, 0));
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, cornerR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // White-hot bass hit flash
  if (beat > 0.06) {
    drawEdgeGradientStrip(ctx, w, h, T * 0.18, clamp01(beat * 0.78), tt, c1, c2, mid, 0.78);
  }

  // Specular rim modulated by treble energy
  if (config.rim) {
    const rimAlpha = clamp01(a * (1.15 + treble * 0.75));
    drawEdgeGradientStrip(ctx, w, h, Math.max(4, 8 * S), rimAlpha, tt, c1, c2, mid, 0.3);
  }
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawPosterText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fillRgba: string,
  shadowRgba: string,
  off: number,
  align: CanvasTextAlign = "center"
): void {
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = shadowRgba;
  ctx.fillText(text, x + off, y + off);
  ctx.fillStyle = fillRgba;
  ctx.fillText(text, x, y);
}

export function computeLyricAlpha(input: SceneRenderInput): number {
  const { positionSec, config, lyrics, playing } = input;
  if (!config.lyricsEnabled || !lyrics) return 0;

  const t = positionSec + config.lyricsOffset;
  const idx = findLineIndexAt(lyrics, t);
  if (idx < 0) return 0;

  const lines = lyrics.lines;
  const cur = lines[idx];
  const since = t - cur.t;
  let alpha = playing ? 1.0 : 0.65;

  if (!cur.text) {
    let j = idx - 1;
    while (j >= 0 && !lines[j].text) j--;
    if (j < 0) return 0;
    alpha *= 1 - clamp01(since / 0.5);
    return alpha <= 0.01 ? 0 : alpha;
  }

  const tail = t - cur.t1;
  if (tail > 1.3) {
    alpha *= 1 - clamp01((tail - 1.3) / 0.8);
    if (alpha <= 0.01) return 0;
  }
  return alpha;
}

export function drawLyrics(input: SceneRenderInput): number {
  const { ctx, width: w, height: h, positionSec, config, palette, audio, lyrics, playing } = input;
  if (!config.lyricsEnabled || !lyrics) return 0;

  const t = positionSec + config.lyricsOffset;
  const idx = findLineIndexAt(lyrics, t);
  if (idx < 0) return 0;

  const lines = lyrics.lines;
  let cur = lines[idx];
  let since = t - cur.t;
  let alpha = playing ? 1.0 : 0.65;
  let effTime = t;

  if (!cur.text) {
    let j = idx - 1;
    while (j >= 0 && !lines[j].text) j--;
    if (j < 0) return 0;
    alpha *= 1 - clamp01(since / 0.5);
    if (alpha <= 0.01) return 0;
    cur = lines[j];
    since = 99;
    effTime = cur.t1 + 99;
  } else {
    const tail = t - cur.t1;
    if (tail > 1.3) {
      alpha *= 1 - clamp01((tail - 1.3) / 0.8);
      if (alpha <= 0.01) return 0;
    }
  }

  let k = idx - 1;
  while (k >= 0 && !lines[k].text) k--;
  const prev = k >= 0 && lines[k] !== cur ? lines[k] : null;
  const nxt = idx + 1 < lines.length && lines[idx + 1].text && lines[idx + 1] !== cur ? lines[idx + 1] : null;
  const nxt2 = idx + 2 < lines.length && lines[idx + 2].text ? lines[idx + 2] : null;

  const beat = config.beatReactive ? audio.beat : 0;
  const accent = palette.primary;
  const shadow = palette.shadow;
  const fontFamily = getFontFamily(config.fontPreset);
  const up = (s: string) => (config.uppercase ? s.toUpperCase() : s);

  ctx.save();
  const shake = beat * h * 0.004;
  ctx.translate(Math.sin(t * 53) * shake, Math.cos(t * 47) * shake);
  const pulse = 1 + 0.032 * beat;
  ctx.translate(w / 2, h * 0.54);
  ctx.scale(pulse, pulse);
  ctx.translate(-w / 2, -h * 0.54);

  const style = config.style;
  if (style === "wipe") {
    drawStyleWipe(ctx, w, h, cur, prev, nxt, effTime, since, accent, shadow, alpha, fontFamily, up);
  } else if (style === "slam") {
    drawStyleSlam(ctx, w, h, cur, prev, effTime, since, accent, shadow, alpha, fontFamily, up);
  } else if (style === "burst") {
    drawStyleBurst(ctx, w, h, cur, effTime, accent, shadow, alpha, beat, fontFamily, up);
  } else if (style === "code") {
    drawStyleCode(ctx, w, h, cur, prev, effTime, since, accent, shadow, alpha);
  } else if (style === "cascade") {
    drawStyleCascade(ctx, w, h, cur, prev, nxt, nxt2, since, accent, shadow, alpha, fontFamily, up);
  } else if (style === "echo") {
    drawStyleEcho(ctx, w, h, cur, since, accent, palette.secondary, shadow, alpha, beat, fontFamily, up);
  } else if (style === "ribbon") {
    drawStyleRibbon(ctx, w, h, cur, effTime, since, accent, shadow, alpha, beat, fontFamily, up);
  }

  if (style !== "ribbon") {
    drawLyricLineProgressBar(ctx, w, h, cur, effTime, since, style, accent, palette.secondary, alpha, beat);
  }

  ctx.restore();
  return alpha;
}

function drawLyricLineProgressBar(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  effTime: number,
  since: number,
  style: LumverseConfig["style"],
  accent: RGB,
  secondary: RGB,
  alpha: number,
  beat: number
): void {
  const S = Math.max(0.55, h / 1080);
  const entryAlpha = easeOutCubic(clamp01(since / 0.25));
  const barAlpha = alpha * entryAlpha * 0.85;
  if (barAlpha <= 0.01) return;

  const lineFrac = clamp01((effTime - cur.t) / Math.max(0.15, cur.t1 - cur.t));
  const barW = Math.min(w * 0.3, 280 * S);
  const barH = Math.max(2, 2.5 * S);
  const barX = (w - barW) * 0.5;
  const barY =
    style === "cascade"
      ? h * 0.562
      : style === "burst"
      ? h * 0.742
      : h * 0.675;

  ctx.save();
  // Subtle recessed track
  ctx.beginPath();
  ctx.roundRect(barX, barY - barH * 0.5, barW, barH, barH * 0.5);
  ctx.fillStyle = `rgba(255, 255, 255, ${(0.14 * barAlpha).toFixed(3)})`;
  ctx.fill();

  // Animated luminous gradient fill
  const fillW = Math.max(barH, barW * lineFrac);
  const grad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
  grad.addColorStop(0, rgbCss(secondary, 0.75 * barAlpha));
  grad.addColorStop(0.65, rgbCss(lighten(accent, 0.32), 0.95 * barAlpha));
  grad.addColorStop(1, rgbCss([1, 1, 1], barAlpha));

  ctx.beginPath();
  ctx.roundRect(barX, barY - barH * 0.5, fillW, barH, barH * 0.5);
  ctx.fillStyle = grad;
  ctx.shadowColor = rgbCss(accent, 0.55 * barAlpha);
  ctx.shadowBlur = 10 * S;
  ctx.fill();

  // Gentle reactive playhead bead
  if (lineFrac > 0.01 && lineFrac < 0.995) {
    const tipX = barX + fillW;
    const tipR = barH * (1.15 + beat * 0.45);
    ctx.beginPath();
    ctx.arc(tipX, barY, tipR, 0, Math.PI * 2);
    ctx.fillStyle = rgbCss([1, 1, 1], barAlpha);
    ctx.fill();
  }
  ctx.restore();
}

function drawSmoothClosedRing(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[]
): void {
  const n = pts.length;
  if (n < 3) return;
  ctx.beginPath();
  const startX = (pts[n - 1].x + pts[0].x) * 0.5;
  const startY = (pts[n - 1].y + pts[0].y) * 0.5;
  ctx.moveTo(startX, startY);
  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % n];
    const mx = (p0.x + p1.x) * 0.5;
    const my = (p0.y + p1.y) * 0.5;
    ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
  }
  ctx.closePath();
}

export function drawVisualizer(input: SceneRenderInput, S: number, visAlpha: number): void {
  if (visAlpha <= 0.01) return;
  const { ctx, width: w, height: h, timeSec: tt, config, palette, audio } = input;
  const cx = w * 0.5;
  const cy = h * 0.47;
  const c1 = palette.primary;
  const c2 = palette.secondary;
  const acc = palette.accent;
  const beat = config.beatReactive ? audio.beat : 0;
  const sub = config.beatReactive ? audio.subBass : 0;
  const mid = config.beatReactive ? audio.midEnergy : 0;
  const treble = config.beatReactive ? audio.trebleEnergy : 0;
  const bands48 = audio.bands48;
  const wave = audio.waveform;

  ctx.save();
  ctx.globalAlpha = clamp01(visAlpha);

  if (config.vizMode === "orbital") {
    const baseR = Math.min(w, h) * 0.17 * (1 + 0.12 * sub + 0.08 * beat);
    const numPts = 64;

    // Expanding beat shockwave halo
    if (beat > 0.08) {
      const shockR = baseR * (1.28 + (1 - beat) * 0.85);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgbCss(acc, beat * 0.48 * visAlpha);
      ctx.lineWidth = Math.max(1.5, 3 * S);
      ctx.beginPath();
      ctx.arc(cx, cy, shockR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3 harmonic rings
    for (let layer = 2; layer >= 0; layer--) {
      const pts: { x: number; y: number }[] = [];
      const layerScale = 0.72 + layer * 0.28;
      const rot = tt * (layer % 2 === 0 ? 0.28 : -0.22) * (1 + mid * 0.6);

      for (let i = 0; i < numPts; i++) {
        const theta = (i / numPts) * Math.PI * 2 + rot;
        // Mirror 48 bands symmetrically around the circle so seam is C1 continuous
        const symIdx = Math.floor(((i % (numPts / 2)) / (numPts / 2)) * 28);
        const fftVal = bands48[Math.min(47, symIdx + layer * 4)] ?? 0;
        const wSample = wave[(i * 2) % wave.length] ?? 0;
        const disp =
          layer === 0
            ? wSample * 26 * S * (0.4 + sub * 1.4)
            : fftVal * (54 + layer * 24) * S + Math.sin(theta * 3 + tt * 2.2) * 5 * S;
        const r = baseR * layerScale + disp;
        pts.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
      }

      drawSmoothClosedRing(ctx, pts);

      if (layer === 1) {
        const rg = ctx.createRadialGradient(cx, cy, baseR * 0.22, cx, cy, baseR * 1.75);
        rg.addColorStop(0, rgbCss(c1, 0.24 * (0.45 + sub + beat * 0.35)));
        rg.addColorStop(0.65, rgbCss(c2, 0.10 * (0.45 + mid)));
        rg.addColorStop(1, rgbCss(c2, 0));
        ctx.fillStyle = rg;
        ctx.fill();
      } else if (layer === 0) {
        const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.05);
        coreGlow.addColorStop(0, rgbCss(lighten(c1, 0.3), 0.28 * (0.4 + sub + beat * 0.4)));
        coreGlow.addColorStop(1, rgbCss(c1, 0));
        ctx.fillStyle = coreGlow;
        ctx.fill();
      }

      const lg = ctx.createLinearGradient(cx - baseR, cy - baseR, cx + baseR, cy + baseR);
      lg.addColorStop(0, rgbCss(layer === 0 ? acc : c1, layer === 1 ? 0.95 : 0.62));
      lg.addColorStop(1, rgbCss(c2, layer === 1 ? 0.95 : 0.55));
      ctx.strokeStyle = lg;
      ctx.lineWidth = Math.max(1.5, (layer === 1 ? 4.2 : 2.2) * S);
      ctx.shadowColor = rgbCss(c1, 0.55);
      ctx.shadowBlur = layer === 1 ? 22 * S : 10 * S;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Subtle orbital phase ticks
    const tickCount = 24;
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2 - tt * 0.15;
      const b = bands48[(i * 2) % bands48.length] ?? 0;
      const r0 = baseR * 1.48;
      const r1 = r0 + (6 + b * 24) * S;
      ctx.strokeStyle = rgbCss(mixRgb(c1, c2, i / tickCount), 0.35 + b * 0.6);
      ctx.lineWidth = Math.max(1.2, 2 * S);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  } else if (config.vizMode === "terrain") {
    const layers = 7;
    const spanW = w * 0.72;
    const baseTop = h * 0.30;
    const stepY = h * 0.056;
    const ptsPerRow = 48;

    for (let l = 0; l < layers; l++) {
      const depth = l / (layers - 1); // 0 back -> 1 front
      const rowW = spanW * (0.62 + 0.38 * depth);
      const x0 = cx - rowW * 0.5;
      const yBase = baseTop + l * stepY;
      const ampScale = (44 + 86 * depth) * S * (0.85 + 0.4 * beat);

      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < ptsPerRow; i++) {
        const u = i / (ptsPerRow - 1);
        const mirrorU = 1 - Math.abs(u * 2 - 1); // center-peaked window
        const env = Math.pow(Math.sin(u * Math.PI), 0.75);
        const bandIdx = Math.min(47, Math.floor(mirrorU * 36 + l * 2));
        const val = bands48[bandIdx] ?? 0;
        const wRipple = (wave[(i * 2 + l * 7) % wave.length] ?? 0) * 14 * S;
        const y = yBase - val * ampScale * env - wRipple * env;
        pts.push({ x: x0 + u * rowW, y });
      }

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) * 0.5;
        const my = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

      // Occluding dark translucent fill behind crest
      ctx.save();
      ctx.lineTo(pts[pts.length - 1].x, yBase + 60 * S);
      ctx.lineTo(pts[0].x, yBase + 60 * S);
      ctx.closePath();
      ctx.fillStyle = `rgba(7, 8, 12, ${(0.58 + 0.25 * depth).toFixed(2)})`;
      ctx.fill();
      ctx.restore();

      // Re-stroke luminous crest
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) * 0.5;
        const my = (pts[i].y + pts[i + 1].y) * 0.5;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const lg = ctx.createLinearGradient(x0, yBase, x0 + rowW, yBase);
      lg.addColorStop(0, rgbCss(c2, 0.2 + 0.7 * depth));
      lg.addColorStop(0.5, rgbCss(lighten(c1, 0.25), 0.35 + 0.65 * depth));
      lg.addColorStop(1, rgbCss(c2, 0.2 + 0.7 * depth));
      ctx.strokeStyle = lg;
      ctx.lineWidth = Math.max(1.5, (1.5 + 2.5 * depth) * S);
      ctx.shadowColor = rgbCss(c1, 0.45 * depth);
      ctx.shadowBlur = 12 * S * depth;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  } else if (config.vizMode === "oscilloscope") {
    // 1. Center Lissajous harmonic knot
    const rx = Math.min(w, h) * 0.24 * (0.85 + 0.3 * sub + 0.18 * beat);
    const ry = Math.min(w, h) * 0.16 * (0.85 + 0.3 * mid + 0.18 * beat);
    const samples = 160;

    for (let pass = 0; pass < 2; pass++) {
      const split = pass === 0 ? -beat * 10 * S : beat * 10 * S;
      ctx.beginPath();
      for (let i = 0; i <= samples; i++) {
        const u = i / samples;
        const a = u * Math.PI * 2;
        const wv = wave[i % wave.length] ?? 0;
        const mod = 1 + wv * (0.35 + mid * 0.45);
        const px = cx + split + Math.sin(3 * a + tt * 0.9) * rx * mod;
        const py = cy + Math.sin(2 * a - tt * 1.15) * ry * mod;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = rgbCss(pass === 0 ? c1 : c2, 0.78);
      ctx.lineWidth = Math.max(1.6, 2.8 * S);
      ctx.shadowColor = rgbCss(pass === 0 ? c1 : c2, 0.55);
      ctx.shadowBlur = 16 * S;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 2. Wide stereo waveform ribbon across horizontal center
    const ribbonW = w * 0.76;
    const xStart = cx - ribbonW * 0.5;
    const ribbonY = cy + ry * 1.45;
    const amp = 74 * S * (0.7 + 0.7 * sub + 0.5 * beat);
    ctx.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const u = i / (wave.length - 1);
      const env = Math.sin(u * Math.PI);
      const px = xStart + u * ribbonW;
      const py = ribbonY + wave[i] * amp * env;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    const rg = ctx.createLinearGradient(xStart, ribbonY, xStart + ribbonW, ribbonY);
    rg.addColorStop(0, rgbCss(c2, 0));
    rg.addColorStop(0.2, rgbCss(c1, 0.95));
    rg.addColorStop(0.5, rgbCss([1, 1, 1], 0.95));
    rg.addColorStop(0.8, rgbCss(c2, 0.95));
    rg.addColorStop(1, rgbCss(c1, 0));
    ctx.strokeStyle = rg;
    ctx.lineWidth = Math.max(2, 3.2 * S);
    ctx.stroke();
  } else {
    // Turbine: 48-ray radial polar blades + inner core + treble sparks
    const blades = 48;
    const innerR = Math.min(w, h) * 0.11 * (1 + 0.22 * beat + 0.15 * sub);
    const maxLen = Math.min(w, h) * 0.22;
    const rot = tt * (0.24 + mid * 0.45);

    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < blades; i++) {
      const a = (i / blades) * Math.PI * 2 + rot;
      // Fold symmetrically so bass & highs balance visually around the dial
      const idx = i < blades / 2 ? i * 2 : (blades - i) * 2 - 1;
      const val = bands48[Math.min(47, idx)] ?? 0;
      const len = (10 + val * maxLen * (0.85 + 0.35 * beat)) * S;
      const x0 = cx + Math.cos(a) * innerR;
      const y0 = cy + Math.sin(a) * innerR;
      const x1 = cx + Math.cos(a) * (innerR + len);
      const y1 = cy + Math.sin(a) * (innerR + len);

      const col = mixRgb(c1, c2, Math.abs(Math.sin(a * 2 + tt * 0.5)));
      ctx.strokeStyle = rgbCss(col, 0.45 + 0.55 * val);
      ctx.lineWidth = Math.max(2, (3.2 + val * 3.5) * S);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      if (val > 0.45 || treble > 0.35) {
        ctx.fillStyle = rgbCss(acc, 0.8 * val);
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(a) * (innerR + len + 10 * S),
          cy + Math.sin(a) * (innerR + len + 10 * S),
          Math.max(1.5, 2.5 * S),
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
    }

    // Inner glowing bass core ring
    ctx.strokeStyle = rgbCss(lighten(c1, 0.35), 0.9);
    ctx.lineWidth = Math.max(2, 3.5 * S);
    ctx.shadowColor = rgbCss(c1, 0.7);
    ctx.shadowBlur = 20 * S;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR * 0.88, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

function drawStyleWipe(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  prev: LyricLine | null,
  nxt: LyricLine | null,
  t: number,
  since: number,
  accent: RGB,
  shadow: RGB,
  alpha: number,
  fontFamily: string,
  up: (s: string) => string
): void {
  const size = Math.max(26, h * 0.082);
  const maxw = w * 0.78;
  const off = Math.max(3, size * 0.06);
  const lineHeight = size * 1.06;

  const paintBlock = (
    line: LyricLine,
    dy: number,
    scale: number,
    a: number,
    filled: boolean,
    hint: LyricLine | null,
    hintA: number
  ) => {
    if (a <= 0.01) return;
    ctx.font = `800 ${size}px ${fontFamily}`;
    const wrapped = wrapLines(ctx, up(line.text), maxw);
    const totalH = wrapped.length * lineHeight;

    ctx.save();
    ctx.translate(w / 2, h * 0.52 + dy);
    ctx.scale(scale, scale);

    const frac = filled
      ? 1
      : clamp01((t - line.t) / Math.max(0.15, line.t1 - line.t));

    // Calculate total text width across wrapped rows for sequential wipe
    const rowWidths = wrapped.map((r) => ctx.measureText(r).width);
    const sumWidth = rowWidths.reduce((s, v) => s + v, 0) || 1;
    let consumed = 0;

    for (let ri = 0; ri < wrapped.length; ri++) {
      const rowText = wrapped[ri];
      const rw = rowWidths[ri];
      const ry = -totalH / 2 + (ri + 0.5) * lineHeight;

      // Hollow unsung outline
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1.8, size * 0.032);
      ctx.strokeStyle = rgbCss(lighten(accent, 0.35), 0.58 * a);
      ctx.strokeText(rowText, 0, ry);

      const rowStartFrac = consumed / sumWidth;
      const rowEndFrac = (consumed + rw) / sumWidth;
      consumed += rw;

      if (frac > rowStartFrac) {
        const localP = clamp01((frac - rowStartFrac) / Math.max(0.001, rowEndFrac - rowStartFrac));
        const clipX = -rw / 2 - off - 6;
        const clipW = (rw + off + 12) * localP;

        ctx.save();
        ctx.beginPath();
        ctx.rect(clipX, ry - lineHeight * 0.65, clipW, lineHeight * 1.3);
        ctx.clip();

        // Chromatic glow halo
        ctx.shadowColor = rgbCss(accent, 0.55 * a);
        ctx.shadowBlur = size * 0.28;
        drawPosterText(
          ctx,
          rowText,
          0,
          ry,
          rgbCss([1, 1, 1], a),
          rgbCss(shadow, a),
          off
        );
        ctx.restore();
      }
    }
    ctx.restore();

    if (hint && hintA > 0.01) {
      const hintSize = Math.max(14, size * 0.34);
      ctx.font = `700 ${hintSize}px ${fontFamily}`;
      const hintWrapped = wrapLines(ctx, up(hint.text), maxw);
      const hy = h * 0.52 + dy + (totalH * scale) / 2 + size * 0.42;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rgbCss(lighten(accent, 0.42), 0.52 * hintA);
      if (hintWrapped[0]) {
        ctx.fillText(hintWrapped[0], w / 2, hy);
      }
    }
  };

  const u = easeOutExpo(clamp01(since / 0.30));
  if (prev && since < 0.30) {
    const v = clamp01(since / 0.30);
    paintBlock(prev, -v * size * 0.72, 1 - 0.12 * v, alpha * (1 - v), true, null, 0);
  }
  paintBlock(
    cur,
    (1 - u) * size * 0.42,
    1.2 - 0.2 * u,
    alpha * Math.min(1, u * 1.6),
    false,
    nxt,
    alpha * u
  );
}

function drawStyleSlam(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  prev: LyricLine | null,
  t: number,
  since: number,
  accent: RGB,
  shadow: RGB,
  alpha: number,
  fontFamily: string,
  up: (s: string) => string
): void {
  const size = Math.max(24, h * 0.078);
  const maxw = w * 0.80;
  const off = Math.max(3, size * 0.06);
  const gap = size * 0.26;
  const hot = lighten(accent, 0.48);

  const paintSlamBlock = (line: LyricLine, dy: number, a: number, isStatic: boolean) => {
    if (a <= 0.01) return;
    ctx.font = `800 ${size}px ${fontFamily}`;
    const rows: { items: { text: string; width: number; t0: number; t1: number; spaceAfter: boolean }[]; rw: number }[] = [];
    let rowItems: { text: string; width: number; t0: number; t1: number; spaceAfter: boolean }[] = [];
    let rw = 0;

    for (const tk of line.tokens) {
      const txt = up(tk.text);
      const tw = ctx.measureText(txt).width;
      const g = rowItems.length > 0 && rowItems[rowItems.length - 1].spaceAfter ? gap : 0;
      if (rowItems.length > 0 && rw + g + tw > maxw) {
        rows.push({ items: rowItems, rw });
        rowItems = [];
        rw = 0;
      }
      const nextGap = rowItems.length > 0 && rowItems[rowItems.length - 1].spaceAfter ? gap : 0;
      rowItems.push({ text: txt, width: tw, t0: tk.t0, t1: tk.t1, spaceAfter: tk.spaceAfter });
      rw += nextGap + tw;
    }
    if (rowItems.length > 0) rows.push({ items: rowItems, rw });

    const lh = size * 1.1;
    const y0 = h * 0.52 - (rows.length * lh) / 2 + dy;

    rows.forEach((row, ri) => {
      let x = (w - row.rw) / 2;
      const cy = y0 + (ri + 0.5) * lh;
      row.items.forEach((it, ki) => {
        if (ki > 0 && row.items[ki - 1].spaceAfter) x += gap;
        const cx = x + it.width / 2;
        const u = isStatic ? 1 : clamp01((t - it.t0) / 0.22);

        // Ghost outline always present
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(1.8, size * 0.028);
        ctx.strokeStyle = rgbCss(lighten(accent, 0.35), 0.48 * a * (1 - u * 0.72));
        ctx.strokeText(it.text, cx, cy);

        if (u > 0) {
          const live = !isStatic && t >= it.t0 && t < it.t1;
          const sc = (1 + (1 - easeOutBack(u, 1.9)) * 0.85) * (live ? 1.07 : 1.0);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(sc, sc);
          const col = live ? hot : ([1, 1, 1] as RGB);
          drawPosterText(
            ctx,
            it.text,
            0,
            0,
            rgbCss(col, a * clamp01(u * 4)),
            rgbCss(shadow, a * clamp01(u * 4)),
            off
          );
          ctx.restore();
        }
        x += it.width;
      });
    });
  };

  if (prev && since < 0.28) {
    const v = clamp01(since / 0.28);
    paintSlamBlock(prev, -v * size * 0.72, alpha * (1 - v), true);
  }
  paintSlamBlock(cur, 0, alpha, false);
}

function drawStyleBurst(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  t: number,
  accent: RGB,
  shadow: RGB,
  alpha: number,
  beat: number,
  fontFamily: string,
  up: (s: string) => string
): void {
  const toks = cur.tokens;
  if (toks.length === 0) return;
  let k = 0;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t0 <= t) k = i;
  }
  const tk = toks[k];
  const base = Math.max(48, h * 0.22);
  const cx = w / 2;
  const cy = h * 0.42;
  const cols: RGB[] = [[1, 1, 1], lighten(accent, 0.45), lighten(shadow, 0.55)];

  // Expanding beat shockwave ring
  if (beat > 0.12) {
    ctx.save();
    ctx.strokeStyle = rgbCss(accent, beat * 0.36 * alpha);
    ctx.lineWidth = Math.max(2, h * 0.004);
    ctx.beginPath();
    ctx.arc(cx, cy, h * (0.14 + (1 - beat) * 0.16), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const paintWord = (idx: number, u: number, ghost: boolean) => {
    const txt = up(toks[idx].text);
    ctx.font = `800 ${base}px ${fontFamily}`;
    const tw = Math.max(1, ctx.measureText(txt).width);
    const fit = Math.min(1, (w * 0.84) / tw);
    const rot = ((((idx * 37 + Math.floor(cur.t * 13)) % 7) - 3) * 0.012);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    if (ghost) {
      const s = fit * (1 + 0.58 * u);
      ctx.scale(s, s);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, base * 0.02);
      ctx.strokeStyle = rgbCss(lighten(accent, 0.4), (1 - u) * 0.45 * alpha);
      ctx.strokeText(txt, 0, 0);
    } else {
      const s = fit * (0.42 + 0.58 * easeOutBack(clamp01(u), 2.3));
      const al = clamp01(u * 5) * alpha;
      ctx.scale(s, s);
      drawPosterText(
        ctx,
        txt,
        0,
        0,
        rgbCss(cols[idx % 3], al),
        rgbCss(shadow, al),
        Math.max(4, base * 0.045)
      );
    }
    ctx.restore();
  };

  const u = (t - tk.t0) / 0.2;
  if (k > 0 && u < 1) {
    paintWord(k - 1, clamp01(u), true);
  }
  if (t >= tk.t0) {
    paintWord(k, u, false);
  }

  // Bottom full-line live progress ribbon
  const subSize = Math.max(16, h * 0.038);
  const fullText = up(cur.text);
  ctx.font = `700 ${subSize}px ${fontFamily}`;
  const rw = Math.min(w * 0.78, ctx.measureText(fullText).width);
  const ry = h * 0.70;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = rgbCss([1, 1, 1], 0.28 * alpha);
  ctx.fillText(fullText, w / 2, ry);

  const frac = clamp01((t - cur.t) / Math.max(0.1, cur.t1 - cur.t));
  ctx.save();
  ctx.beginPath();
  ctx.rect(w / 2 - rw / 2 - 4, ry - subSize, (rw + 8) * frac, subSize * 2);
  ctx.clip();
  ctx.fillStyle = rgbCss([1, 1, 1], alpha);
  ctx.fillText(fullText, w / 2, ry);
  ctx.restore();
}

function drawStyleCode(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  prev: LyricLine | null,
  t: number,
  since: number,
  accent: RGB,
  shadow: RGB,
  alpha: number
): void {
  const size = Math.max(18, h * 0.038);
  const maxw = w * 0.64;
  const x0 = (w - maxw) / 2;
  const mono = '"JetBrains Mono", monospace';
  const e = easeOutExpo(clamp01(since / 0.28));

  ctx.font = `700 ${size}px ${mono}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const frac = clamp01((t - cur.t) / Math.max(0.2, (cur.t1 - cur.t) * 0.85));
  const charCount = Math.floor(frac * cur.text.length + 1e-4);
  const typed = cur.text.slice(0, charCount);
  const wrapped = wrapLines(ctx, typed, maxw - size * 1.6);
  if (wrapped.length === 0) wrapped.push("");

  const lh = size * 1.32;
  const totalH = wrapped.length * lh;
  const yTop = h * 0.54 - totalH / 2 + (1 - e) * size * 0.8;

  if (prev) {
    ctx.font = `600 ${size * 0.74}px ${mono}`;
    ctx.fillStyle = rgbCss([0.45, 0.92, 0.6], 0.55 * alpha);
    ctx.fillText(`// ${prev.text}`, x0, yTop - size * 0.95);
  }

  ctx.font = `700 ${size}px ${mono}`;
  const prompt = "> ";
  const pw = ctx.measureText(prompt).width;
  ctx.fillStyle = rgbCss(accent, alpha);
  ctx.fillText(prompt, x0, yTop);

  let lastRowEndX = x0 + pw;
  let lastRowY = yTop;

  wrapped.forEach((rowText, idx) => {
    const ry = yTop + idx * lh;
    drawPosterText(
      ctx,
      rowText,
      x0 + pw,
      ry,
      rgbCss([1, 1, 1], alpha * e),
      rgbCss(shadow, alpha * e),
      Math.max(2, size * 0.06),
      "left"
    );
    lastRowEndX = x0 + pw + ctx.measureText(rowText).width;
    lastRowY = ry;
  });

  const blink = charCount < cur.text.length || Math.floor(performance.now() / 420) % 2 === 0;
  if (blink) {
    const cw = size * 0.56;
    const ch = size * 1.1;
    ctx.fillStyle = `rgba(255, 58, 78, ${(0.28 * alpha).toFixed(3)})`;
    ctx.fillRect(lastRowEndX + 2, lastRowY - ch / 2 - 3, cw + 6, ch + 6);
    ctx.fillStyle = `rgba(255, 72, 92, ${alpha.toFixed(3)})`;
    ctx.fillRect(lastRowEndX + 5, lastRowY - ch / 2, cw, ch);
  }
}

function drawStyleCascade(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  prev: LyricLine | null,
  nxt: LyricLine | null,
  nxt2: LyricLine | null,
  since: number,
  accent: RGB,
  shadow: RGB,
  alpha: number,
  fontFamily: string,
  up: (s: string) => string
): void {
  const baseSize = Math.max(24, h * 0.068);
  const maxw = w * 0.74;
  const e = easeOutCubic(clamp01(since / 0.34));
  const slideUp = (1 - e) * baseSize * 1.15;

  const entries: { line: LyricLine | null; yOff: number; scale: number; op: number; active: boolean }[] = [
    { line: prev, yOff: -baseSize * 2.1, scale: 0.72, op: 0.28, active: false },
    { line: cur, yOff: 0, scale: 1.0, op: 1.0, active: true },
    { line: nxt, yOff: baseSize * 2.0, scale: 0.76, op: 0.38, active: false },
    { line: nxt2, yOff: baseSize * 3.55, scale: 0.64, op: 0.18, active: false },
  ];

  for (const item of entries) {
    if (!item.line || !item.line.text) continue;
    const fSize = baseSize * item.scale;
    ctx.font = `${item.active ? 800 : 600} ${fSize}px ${fontFamily}`;
    const rows = wrapLines(ctx, up(item.line.text), maxw).slice(0, 2);
    const lh = fSize * 1.12;
    const baseY = h * 0.49 + item.yOff + slideUp;

    rows.forEach((rowText, ri) => {
      const ry = baseY + (ri - (rows.length - 1) / 2) * lh;
      if (item.active) {
        ctx.save();
        ctx.shadowColor = rgbCss(accent, 0.38 * alpha);
        ctx.shadowBlur = fSize * 0.32;
        drawPosterText(
          ctx,
          rowText,
          w / 2,
          ry,
          rgbCss([1, 1, 1], alpha * item.op),
          rgbCss(shadow, alpha * item.op),
          Math.max(3, fSize * 0.055)
        );
        ctx.restore();
      } else {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = rgbCss([0.92, 0.94, 0.98], alpha * item.op);
        ctx.fillText(rowText, w / 2, ry);
      }
    });
  }
}

function drawStyleEcho(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  since: number,
  accent: RGB,
  secondary: RGB,
  shadow: RGB,
  alpha: number,
  beat: number,
  fontFamily: string,
  up: (s: string) => string
): void {
  const size = Math.max(26, h * 0.084);
  const maxw = w * 0.78;
  const e = easeOutExpo(clamp01(since / 0.32));
  ctx.font = `800 ${size}px ${fontFamily}`;
  const rows = wrapLines(ctx, up(cur.text), maxw);
  const lh = size * 1.08;
  const startY = h * 0.52 - ((rows.length - 1) * lh) / 2;

  const split = (4 + beat * 16) * (h / 1080);

  // Ghost expanding echo on line entry
  if (since < 0.45) {
    const gP = since / 0.45;
    ctx.save();
    ctx.translate(w / 2, h * 0.52);
    ctx.scale(1 + gP * 0.22, 1 + gP * 0.22);
    ctx.translate(-w / 2, -h * 0.52);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(1.5, size * 0.025);
    ctx.strokeStyle = rgbCss(accent, (1 - gP) * 0.5 * alpha);
    rows.forEach((r, idx) => ctx.strokeText(r, w / 2, startY + idx * lh));
    ctx.restore();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  rows.forEach((row, idx) => {
    const ry = startY + idx * lh;
    if (split > 2) {
      ctx.fillStyle = rgbCss(accent, 0.55 * alpha * e);
      ctx.fillText(row, w / 2 - split, ry - split * 0.25);
      ctx.fillStyle = rgbCss(secondary, 0.55 * alpha * e);
      ctx.fillText(row, w / 2 + split, ry + split * 0.25);
    }
    drawPosterText(
      ctx,
      row,
      w / 2,
      ry,
      rgbCss([1, 1, 1], alpha * e),
      rgbCss(shadow, alpha * e),
      Math.max(3, size * 0.055)
    );
  });
}

function drawStyleRibbon(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cur: LyricLine,
  t: number,
  since: number,
  accent: RGB,
  shadow: RGB,
  alpha: number,
  beat: number,
  fontFamily: string,
  up: (s: string) => string
): void {
  const size = Math.max(24, h * 0.072);
  const text = up(cur.text);
  const e = easeOutCubic(clamp01(since / 0.26));

  const barH = size * 1.68;
  const cy = h * 0.52;

  ctx.save();
  ctx.fillStyle = `rgba(8, 9, 12, ${(0.76 * alpha * e).toFixed(3)})`;
  ctx.fillRect(0, cy - barH / 2, w, barH);

  ctx.fillStyle = rgbCss(accent, alpha * e);
  ctx.fillRect(0, cy - barH / 2, w, Math.max(2, 3 * (h / 1080)));
  ctx.fillRect(0, cy + barH / 2 - Math.max(2, 3 * (h / 1080)), w, Math.max(2, 3 * (h / 1080)));

  ctx.font = `800 ${size}px ${fontFamily}`;
  const tw = ctx.measureText(text).width;
  const frac = clamp01((t - cur.t) / Math.max(0.2, cur.t1 - cur.t));
  const overflow = Math.max(0, tw - w * 0.8);
  const xPos = overflow > 0 ? w * 0.1 - overflow * frac : w / 2;

  drawPosterText(
    ctx,
    text,
    xPos,
    cy,
    rgbCss([1, 1, 1], alpha * e),
    rgbCss(shadow, alpha * e),
    Math.max(2.5, size * 0.05),
    overflow > 0 ? "left" : "center"
  );

  // Beat-reactive progress hairline along the bottom edge of ribbon
  ctx.fillStyle = rgbCss(lighten(accent, 0.35), alpha);
  ctx.fillRect(0, cy + barH / 2 - (4 + beat * 3), w * frac, 4 + beat * 3);
  ctx.restore();
}

export function drawCard(input: SceneRenderInput, S: number): void {
  const {
    ctx,
    width: w,
    height: h,
    positionSec,
    durationSec,
    config,
    palette,
    audio,
    title,
    artist,
    albumArt,
    cardProgress,
    cardDirection,
  } = input;

  if (cardProgress <= 0.01 || !title) return;
  const e = cardDirection > 0 ? easeOutBack(cardProgress, 1.45) : easeInCubic(cardProgress);

  if (config.cardStyle === "poster") {
    drawCardPoster(ctx, w, h, S, e, positionSec, durationSec, palette, audio, title, artist, albumArt);
  } else if (config.cardStyle === "glass") {
    drawCardGlass(ctx, w, h, S, e, positionSec, durationSec, palette, audio, title, artist, albumArt);
  } else {
    drawCardMinimal(ctx, w, h, S, e, positionSec, durationSec, palette, audio, title, artist, albumArt);
  }
}

function drawAlbumThumb(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  artSize: number,
  albumArt: HTMLImageElement | null,
  palette: PaletteColors
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(ax, ay, artSize, artSize);
  ctx.clip();
  if (albumArt && albumArt.complete && albumArt.naturalWidth > 0) {
    ctx.drawImage(albumArt, ax, ay, artSize, artSize);
  } else {
    const g = ctx.createLinearGradient(ax, ay, ax + artSize, ay + artSize);
    g.addColorStop(0, rgbCss(palette.primary));
    g.addColorStop(1, rgbCss(palette.secondary));
    ctx.fillStyle = g;
    ctx.fillRect(ax, ay, artSize, artSize);
  }
  ctx.restore();
}

function drawCardPoster(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  S: number,
  e: number,
  pos: number,
  dur: number,
  palette: PaletteColors,
  audio: AudioAnalysis,
  title: string,
  artist: string,
  albumArt: HTMLImageElement | null
): void {
  const cw = Math.min(w * 0.72, 510 * S);
  const ch = 176 * S;
  const pad = 15 * S;
  const margin = 44 * S;
  const off = 10 * S;
  const ink: RGB = palette.cardInk;
  const borderCol: RGB = [0.04, 0.045, 0.055];

  const x = margin - (1 - e) * (cw + margin + 40 * S);
  const y = h - margin - ch;
  const ang = -0.036 + (1 - e) * -0.2;

  ctx.save();
  ctx.translate(x, y + ch);
  ctx.rotate(ang);
  ctx.translate(0, -ch);

  // Hard brutalist offset shadow
  ctx.fillStyle = rgbCss(borderCol, 0.94);
  ctx.fillRect(off, off, cw, ch);

  // WCAG contrast-checked card surface
  ctx.fillStyle = rgbCss(palette.cardBg);
  ctx.fillRect(0, 0, cw, ch);
  ctx.lineWidth = Math.max(2.5, 4.5 * S);
  ctx.strokeStyle = rgbCss(borderCol);
  ctx.strokeRect(0, 0, cw, ch);

  // Album art frame
  const artSize = ch - 2 * pad;
  const ax = pad;
  const ay = pad;
  const aoff = 6 * S;
  ctx.fillStyle = rgbCss(borderCol);
  ctx.fillRect(ax + aoff, ay + aoff, artSize, artSize);
  drawAlbumThumb(ctx, ax, ay, artSize, albumArt, palette);
  ctx.lineWidth = Math.max(2, 3.5 * S);
  ctx.strokeStyle = rgbCss(borderCol);
  ctx.strokeRect(ax, ay, artSize, artSize);

  // Track text
  const tx = ax + artSize + aoff + pad;
  const tw = cw - tx - pad;
  const titleSize = Math.max(14, 24 * S);
  const artistSize = Math.max(11, 14 * S);

  ctx.save();
  ctx.beginPath();
  ctx.rect(tx, pad - 4 * S, tw, 64 * S);
  ctx.clip();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `800 ${titleSize}px "Bricolage Grotesque", sans-serif`;
  ctx.fillStyle = rgbCss(ink);
  ctx.fillText(title.toUpperCase(), tx, pad);

  ctx.font = `700 ${artistSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = rgbCss(ink, 0.78);
  ctx.fillText(artist.toUpperCase(), tx, pad + titleSize + 5 * S);
  ctx.restore();

  // 16-band spectrum + peak caps
  const by = ch - pad - 26 * S;
  const eqTop = pad + titleSize + artistSize + 14 * S;
  const eqBot = by - 9 * S;
  const n = 16;
  const gap = 3.5 * S;
  const bw = (tw - gap * (n - 1)) / n;

  for (let i = 0; i < n; i++) {
    const v = clamp01(audio.bands[i] * 1.15);
    const pk = clamp01(audio.peaks[i] * 1.15);
    const bh = Math.max(3 * S, v * (eqBot - eqTop));
    const bx = tx + i * (bw + gap);
    ctx.fillStyle = rgbCss(ink, 0.92);
    ctx.fillRect(bx, eqBot - bh, bw, bh);
    const py = eqBot - pk * (eqBot - eqTop);
    ctx.fillStyle = rgbCss(ink, 0.5);
    ctx.fillRect(bx, py - 2 * S, bw, Math.max(1.5, 2 * S));
  }

  // Progress bar
  const pbH = Math.max(6, 9 * S);
  const frac = dur > 0 ? clamp01(pos / dur) : 0;
  ctx.fillStyle = rgbCss(ink, 0.22);
  ctx.fillRect(tx, by, tw, pbH);
  ctx.fillStyle = rgbCss(ink);
  ctx.fillRect(tx, by, Math.max(pbH, tw * frac), pbH);

  // Timestamps
  const timeSize = Math.max(10, 12 * S);
  ctx.font = `700 ${timeSize}px "JetBrains Mono", monospace`;
  ctx.fillStyle = rgbCss(ink, 0.84);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(formatClock(pos), tx, by + pbH + 4 * S);
  ctx.textAlign = "right";
  ctx.fillText(formatClock(dur), tx + tw, by + pbH + 4 * S);

  ctx.restore();
}

function drawCardGlass(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  S: number,
  e: number,
  pos: number,
  dur: number,
  palette: PaletteColors,
  audio: AudioAnalysis,
  title: string,
  artist: string,
  albumArt: HTMLImageElement | null
): void {
  const cw = Math.min(w * 0.72, 460 * S);
  const ch = 128 * S;
  const pad = 14 * S;
  const margin = 40 * S;
  const r = 18 * S;
  const x = margin - (1 - e) * (cw + margin + 30 * S);
  const y = h - margin - ch;

  ctx.save();
  ctx.globalAlpha = clamp01(e);
  ctx.beginPath();
  ctx.roundRect(x, y, cw, ch, r);
  ctx.fillStyle = "rgba(12, 14, 19, 0.82)";
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.5 * S);
  ctx.strokeStyle = rgbCss(palette.primary, 0.42);
  ctx.stroke();

  const artSize = ch - pad * 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, artSize, artSize, r - 6 * S);
  ctx.clip();
  drawAlbumThumb(ctx, x + pad, y + pad, artSize, albumArt, palette);
  ctx.restore();

  const tx = x + pad * 2 + artSize;
  const tw = cw - (tx - x) - pad;
  const titleSize = Math.max(14, 20 * S);
  const artistSize = Math.max(11, 13 * S);

  ctx.save();
  ctx.beginPath();
  ctx.rect(tx, y + pad, tw, 52 * S);
  ctx.clip();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${titleSize}px "Bricolage Grotesque", sans-serif`;
  ctx.fillStyle = "rgba(248, 250, 252, 0.96)";
  ctx.fillText(title, tx, y + pad);
  ctx.font = `500 ${artistSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = "rgba(203, 213, 225, 0.76)";
  ctx.fillText(artist, tx, y + pad + titleSize + 4 * S);
  ctx.restore();

  // Slim 16-band spectrum
  const eqY = y + ch - pad - 24 * S;
  const eqH = 16 * S;
  const gap = 3 * S;
  const bw = (tw - gap * 15) / 16;
  for (let i = 0; i < 16; i++) {
    const bh = Math.max(2 * S, clamp01(audio.bands[i]) * eqH);
    ctx.fillStyle = rgbCss(mixRgb(palette.primary, palette.secondary, i / 15), 0.9);
    ctx.fillRect(tx + i * (bw + gap), eqY - bh, bw, bh);
  }

  // Progress
  const pbY = y + ch - pad - 14 * S;
  const pbH = Math.max(3, 4 * S);
  const frac = dur > 0 ? clamp01(pos / dur) : 0;
  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.fillRect(tx, pbY, tw, pbH);
  ctx.fillStyle = rgbCss(palette.primary);
  ctx.fillRect(tx, pbY, tw * frac, pbH);

  ctx.font = `500 ${Math.max(10, 11 * S)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = "rgba(203, 213, 225, 0.7)";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(formatClock(pos), tx, pbY + pbH + 4 * S);
  ctx.textAlign = "right";
  ctx.fillText(formatClock(dur), tx + tw, pbY + pbH + 4 * S);

  ctx.restore();
}

function drawCardMinimal(
  ctx: CanvasRenderingContext2D,
  _w: number,
  h: number,
  S: number,
  e: number,
  pos: number,
  dur: number,
  palette: PaletteColors,
  audio: AudioAnalysis,
  title: string,
  artist: string,
  albumArt: HTMLImageElement | null
): void {
  const cw = 340 * S;
  const ch = 64 * S;
  const margin = 32 * S;
  const x = margin - (1 - e) * (cw + margin + 20 * S);
  const y = h - margin - ch;

  ctx.save();
  ctx.globalAlpha = clamp01(e);
  ctx.fillStyle = "rgba(10, 11, 14, 0.88)";
  ctx.fillRect(x, y, cw, ch);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, cw, ch);

  const artSize = ch - 12 * S;
  drawAlbumThumb(ctx, x + 6 * S, y + 6 * S, artSize, albumArt, palette);

  const tx = x + artSize + 16 * S;
  const tw = cw - artSize - 28 * S;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `700 ${Math.max(12, 15 * S)}px "Bricolage Grotesque", sans-serif`;
  ctx.fillStyle = "#F8FAFC";
  ctx.fillText(title, tx, y + 12 * S, tw);
  ctx.font = `500 ${Math.max(10, 12 * S)}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = "rgba(203, 213, 225, 0.72)";
  ctx.fillText(`${artist} · ${formatClock(pos)}`, tx, y + 32 * S, tw);

  // Subtle reactive bottom hairline
  const frac = dur > 0 ? clamp01(pos / dur) : 0;
  ctx.fillStyle = rgbCss(palette.primary, 0.35);
  ctx.fillRect(x, y + ch - 3 * S, cw, 3 * S);
  ctx.fillStyle = rgbCss(lighten(palette.primary, audio.beat * 0.4));
  ctx.fillRect(x, y + ch - 3 * S, cw * frac, 3 * S);

  ctx.restore();
}

export function renderLumverseFrame(input: SceneRenderInput): void {
  const { ctx, width: w, height: h, config } = input;
  ctx.clearRect(0, 0, w, h);
  const S = Math.max(0.55, h / 1080);
  drawGlow(input, S);
  if (config.genreEffectsEnabled && input.genreAnimator && input.resolvedGenre) {
    input.genreAnimator.stepAndDraw(
      ctx,
      w,
      h,
      input.dt ?? 0.016,
      input.timeSec,
      input.resolvedGenre,
      input.palette,
      input.audio,
      input.playing
    );
  }
  const lyricAlpha = computeLyricAlpha(input);
  const allowVisualizer = !config.genreEffectsEnabled || config.vizAlways;
  const visAlpha = allowVisualizer
    ? config.vizAlways
      ? Math.max(0.38, 1 - lyricAlpha * 0.62)
      : clamp01(1 - lyricAlpha)
    : 0;
  if (visAlpha > 0.01) {
    drawVisualizer(input, S, visAlpha);
  }
  drawLyrics(input);
  drawCard(input, S);
}

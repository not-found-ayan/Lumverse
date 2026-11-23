import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Upload,
  Sparkles,
  Volume2,
  VolumeX,
  SlidersHorizontal,
  Layers,
  Minus,
  Plus,
  Activity,
  Heart,
  Zap,
  Leaf,
  Flame,
} from "lucide-react";
import type {
  AudioAnalysis,
  LumverseConfig,
  LyricsData,
  PaletteColors,
  ResolvedGenre,
  TrackItem,
} from "../types/lumverse";
import { renderLumverseFrame } from "../engine/canvasRenderer";
import { GenreSceneAnimator } from "../engine/genreAnimator";
import { resolveGenreTheme } from "../engine/genreDetector";
import { GENRE_THEMES, LYRIC_STYLES, VIZ_MODES, WALLPAPER_URL } from "../engine/presets";
import { ControlInspector } from "./ControlInspector";

interface StageCanvasProps {
  tracks: TrackItem[];
  activeTrack: TrackItem;
  onSelectTrack: (track: TrackItem) => void;
  onUploadAudio: (file: File) => void;
  onUploadLrc: (file: File) => void;
  config: LumverseConfig;
  onChangeConfig: (patch: Partial<LumverseConfig>) => void;
  onResetDefaults: () => void;
  palette: PaletteColors;
  lyricsData: LyricsData | null;
  lyricStatusNote: string | null;
  albumArtImg: HTMLImageElement | null;
  playing: boolean;
  onTogglePlay: () => void;
  positionSec: number;
  durationSec: number;
  getPosition: () => number;
  getDuration: () => number;
  onSeek: (sec: number) => void;
  sampleAnalysis: (dt: number) => AudioAnalysis;
  cardPeekToken: number;
  isFullscreen: boolean;
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function StageCanvas({
  tracks,
  activeTrack,
  onSelectTrack,
  onUploadAudio,
  onUploadLrc,
  config,
  onChangeConfig,
  onResetDefaults,
  palette,
  lyricsData,
  lyricStatusNote,
  albumArtImg,
  playing,
  onTogglePlay,
  positionSec,
  durationSec,
  getPosition,
  getDuration,
  onSeek,
  sampleAnalysis,
  cardPeekToken,
  isFullscreen,
}: StageCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const lrcInputRef = useRef<HTMLInputElement | null>(null);
  const genreAnimatorRef = useRef<GenreSceneAnimator | null>(null);
  if (!genreAnimatorRef.current) {
    genreAnimatorRef.current = new GenreSceneAnimator();
  }

  const [drawerOpen, setDrawerOpen] = useState(!isFullscreen);
  const [muted, setMuted] = useState(false);
  const [wallpaperFailed, setWallpaperFailed] = useState(false);
  const [detectedGenre, setDetectedGenre] = useState<ResolvedGenre>("electronic");
  const lastDetectedGenreRef = useRef<ResolvedGenre>("electronic");

  const stateRef = useRef({
    config,
    palette,
    lyricsData,
    albumArtImg,
    playing,
    getPosition,
    getDuration,
    activeTrack,
    cardProgress: 1,
    cardDirection: 1,
    cardUntilMs: 0,
  });

  useEffect(() => {
    stateRef.current.config = config;
    stateRef.current.palette = palette;
    stateRef.current.lyricsData = lyricsData;
    stateRef.current.albumArtImg = albumArtImg;
    stateRef.current.playing = playing;
    stateRef.current.getPosition = getPosition;
    stateRef.current.getDuration = getDuration;
    stateRef.current.activeTrack = activeTrack;
  }, [config, palette, lyricsData, albumArtImg, playing, getPosition, getDuration, activeTrack]);

  useEffect(() => {
    stateRef.current.cardUntilMs = performance.now() + config.cardSeconds * 1000;
  }, [cardPeekToken, activeTrack.id, config.cardSeconds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = containerRef.current;
    if (!canvas || !wrap) return;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let rafId = 0;
    let lastMs = performance.now();

    const loop = (nowMs: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (nowMs - lastMs) / 1000));
      lastMs = nowMs;

      const s = stateRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const audio = sampleAnalysis(dt);
        const vis = s.config.cardVisibility;
        const wantCard =
          vis === "always" || (vis === "onchange" && nowMs < s.cardUntilMs);
        const target = vis === "off" ? 0 : wantCard ? 1 : 0;

        if (target > s.cardProgress) {
          s.cardDirection = 1;
          s.cardProgress = Math.min(1, s.cardProgress + dt * 2.8);
        } else if (target < s.cardProgress) {
          s.cardDirection = -1;
          s.cardProgress = Math.max(0, s.cardProgress - dt * 3.4);
        }

        const resolvedGenre = resolveGenreTheme(
          s.config.genreMode,
          s.activeTrack.title,
          s.activeTrack.artist,
          s.activeTrack.album,
          s.activeTrack.genre,
          s.activeTrack.lrcText,
          audio
        );
        if (resolvedGenre !== lastDetectedGenreRef.current) {
          lastDetectedGenreRef.current = resolvedGenre;
          setDetectedGenre(resolvedGenre);
        }

        renderLumverseFrame({
          ctx,
          width: canvas.width,
          height: canvas.height,
          dt,
          timeSec: nowMs / 1000,
          positionSec: s.getPosition(),
          durationSec: s.getDuration(),
          playing: s.playing,
          config: s.config,
          palette: s.palette,
          audio,
          lyrics: s.lyricsData,
          title: s.activeTrack.title,
          artist: s.activeTrack.artist,
          albumArt: s.albumArtImg,
          cardProgress: s.cardProgress,
          cardDirection: s.cardDirection,
          resolvedGenre,
          genreAnimator: genreAnimatorRef.current ?? undefined,
        });
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [sampleAnalysis]);

  const cycleStyle = () => {
    const idx = LYRIC_STYLES.findIndex((s) => s.id === config.style);
    const next = LYRIC_STYLES[(idx + 1) % LYRIC_STYLES.length];
    onChangeConfig({ style: next.id });
  };

  const cycleViz = () => {
    if (!config.genreEffectsEnabled) {
      const idx = VIZ_MODES.findIndex((v) => v.id === config.vizMode);
      const next = VIZ_MODES[(idx + 1) % VIZ_MODES.length];
      onChangeConfig({ vizMode: next.id });
      return;
    }
    if (!config.vizAlways) {
      onChangeConfig({ vizAlways: true, vizMode: VIZ_MODES[0].id });
      return;
    }
    const idx = VIZ_MODES.findIndex((v) => v.id === config.vizMode);
    if (idx === VIZ_MODES.length - 1) {
      onChangeConfig({ vizAlways: false });
    } else {
      onChangeConfig({ vizMode: VIZ_MODES[idx + 1].id });
    }
  };

  const cycleGenre = () => {
    const idx = GENRE_THEMES.findIndex((g) => g.id === config.genreMode);
    const next = GENRE_THEMES[(idx + 1) % GENRE_THEMES.length];
    onChangeConfig({ genreMode: next.id, genreEffectsEnabled: true });
  };

  const triggerPeek = () => {
    if (config.cardVisibility === "off") {
      onChangeConfig({ cardVisibility: "onchange" });
    }
    stateRef.current.cardUntilMs = performance.now() + config.cardSeconds * 1000;
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    window.dispatchEvent(new CustomEvent("lumverse-mute", { detail: next }));
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#090A0D]">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div
          ref={containerRef}
          className="relative flex-1 min-h-[380px] overflow-hidden select-none bg-[#06070A]"
        >
          {config.backdropMode !== "obsidian" && !wallpaperFailed && (
            <img
              src={WALLPAPER_URL}
              alt="Nordic basalt desktop wallpaper"
              referrerPolicy="no-referrer"
              onError={() => setWallpaperFailed(true)}
              className="absolute inset-0 w-full h-full object-cover opacity-80"
            />
          )}

          {config.backdropMode === "hyprland" && (
            <div
              aria-hidden="true"
              className="absolute inset-6 md:inset-10 grid grid-cols-12 gap-4 pointer-events-none"
            >
              <div className="col-span-7 rounded-lg border border-white/12 bg-[#0D0F14]/78 backdrop-blur-md p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between text-[11px] font-mono-tabular text-zinc-400 border-b border-white/8 pb-2">
                  <span>kitty — zsh · ~/lumverse</span>
                  <span>1440×900</span>
                </div>
                <div className="my-auto space-y-1.5 font-mono-tabular text-xs text-zinc-400/80">
                  <div>$ python3 lumverse.py</div>
                  <div className="text-emerald-400/80">
                    [lumverse] wayland layer-shell attached (overlay)
                  </div>
                  <div>
                    [mpris] {activeTrack.artist} — {activeTrack.title}
                  </div>
                  <div>
                    [dsp] genre: {config.genreMode === "auto" ? `auto → ${detectedGenre}` : detectedGenre} ·{" "}
                    {lyricsData ? "synced lyrics" : config.genreEffectsEnabled && !config.vizAlways ? "ambient particles" : `viz: ${config.vizMode}`}
                  </div>
                </div>
                <div className="text-[11px] font-mono-tabular text-zinc-500">
                  workspace 1 · tile master
                </div>
              </div>

              <div className="col-span-5 hidden sm:flex flex-col gap-4">
                <div className="flex-1 rounded-lg border border-white/10 bg-[#0D0F14]/72 backdrop-blur-md p-4 flex flex-col justify-between">
                  <div className="text-[11px] font-mono-tabular text-zinc-400 border-b border-white/8 pb-2">
                    nvim scene.py
                  </div>
                  <div className="space-y-1 font-mono-tabular text-[11px] text-zinc-400/70">
                    <div>def detect_genre(): # → {detectedGenre}</div>
                    <div className="pl-4">genre_fx.draw(cr, w, h, S, tt, dt)</div>
                    <div className="pl-4">draw_glow(cr, w, h, S, tt)</div>
                  </div>
                </div>
                <div className="h-28 rounded-lg border border-white/10 bg-[#0D0F14]/72 backdrop-blur-md p-4 flex items-center justify-between font-mono-tabular text-xs text-zinc-400">
                  <span>hyprctl dispatch</span>
                  <span className="text-zinc-300">
                    {lyricsData ? `style → ${config.style}` : `ambience → ${detectedGenre}`}
                  </span>
                </div>
              </div>
            </div>
          )}

          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

          {/* Top-left subtle unboxed status note */}
          {lyricStatusNote && (
            <div className="absolute top-4 left-4 z-10 text-xs text-zinc-300/90 bg-black/55 backdrop-blur-md px-3 py-1.5 rounded border border-white/10">
              {lyricStatusNote}
            </div>
          )}

          {/* Top-right Quick Overlay Controls */}
          <div className="absolute top-4 right-4 flex flex-wrap items-center justify-end gap-2 z-10">
            <button
              type="button"
              onClick={cycleGenre}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-100 bg-black/65 hover:bg-black/85 border border-white/15 backdrop-blur-md rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {detectedGenre === "romantic" ? (
                <Heart className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
              ) : detectedGenre === "rock" || detectedGenre === "electronic" ? (
                <Zap className="w-3.5 h-3.5 text-sky-400" aria-hidden="true" />
              ) : detectedGenre === "folk" || detectedGenre === "lofi" ? (
                <Leaf className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              ) : detectedGenre === "hiphop" ? (
                <Flame className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-amber-200" aria-hidden="true" />
              )}
              <span>
                Genre:{" "}
                {config.genreMode === "auto"
                  ? `Auto · ${GENRE_THEMES.find((g) => g.id === detectedGenre)?.label ?? detectedGenre}`
                  : GENRE_THEMES.find((g) => g.id === config.genreMode)?.label}
              </span>
            </button>
            <button
              type="button"
              onClick={cycleViz}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-100 bg-black/65 hover:bg-black/85 border border-white/15 backdrop-blur-md rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span>
                Viz:{" "}
                {config.genreEffectsEnabled && !config.vizAlways
                  ? "Ambient Only"
                  : VIZ_MODES.find((v) => v.id === config.vizMode)?.label}
              </span>
            </button>
            <button
              type="button"
              onClick={cycleStyle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-100 bg-black/65 hover:bg-black/85 border border-white/15 backdrop-blur-md rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-zinc-300" aria-hidden="true" />
              <span>Lyrics: {LYRIC_STYLES.find((s) => s.id === config.style)?.label}</span>
            </button>
            <button
              type="button"
              onClick={triggerPeek}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-100 bg-black/65 hover:bg-black/85 border border-white/15 backdrop-blur-md rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-zinc-300" aria-hidden="true" />
              <span>Peek Card</span>
            </button>
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-100 bg-black/65 hover:bg-black/85 border border-white/15 backdrop-blur-md rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{drawerOpen ? "Hide Tuning" : "Tune"}</span>
            </button>
          </div>
        </div>

        {/* Bottom Transport & Track Switcher Dock */}
        <div className="border-t border-white/8 bg-[#0E1015] px-5 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={playing ? "Pause playback" : "Start playback"}
              className="w-10 h-10 rounded-md bg-emerald-400 hover:bg-emerald-300 text-zinc-950 flex items-center justify-center transition-colors shrink-0 cursor-pointer"
            >
              {playing ? (
                <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" aria-hidden="true" />
              )}
            </button>

            <div className="flex items-center gap-1.5 p-1 bg-black/40 rounded-md border border-white/8 overflow-x-auto">
              {tracks.map((tr) => {
                const active = tr.id === activeTrack.id;
                return (
                  <button
                    key={tr.id}
                    type="button"
                    onClick={() => onSelectTrack(tr)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {tr.title.replace(" (Instrumental)", "")}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 min-w-[200px] max-w-md flex items-center gap-3">
            <span className="text-xs font-mono-tabular text-zinc-400 w-10 text-right shrink-0">
              {fmtTime(positionSec)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(1, durationSec)}
              step={0.1}
              value={Math.min(durationSec, positionSec)}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Seek timeline"
              className="flex-1 accent-emerald-400"
            />
            <span className="text-xs font-mono-tabular text-zinc-400 w-10 shrink-0">
              {fmtTime(durationSec)}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center border border-white/10 rounded-md bg-black/35">
              <button
                type="button"
                onClick={() =>
                  onChangeConfig({ lyricsOffset: Number((config.lyricsOffset - 0.1).toFixed(2)) })
                }
                title="Delay lyrics by 0.1s"
                className="p-2 text-zinc-300 hover:text-white cursor-pointer"
              >
                <Minus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="px-2 text-[11px] font-mono-tabular text-zinc-300 whitespace-nowrap">
                Sync {config.lyricsOffset >= 0 ? "+" : ""}
                {config.lyricsOffset.toFixed(1)}s
              </span>
              <button
                type="button"
                onClick={() =>
                  onChangeConfig({ lyricsOffset: Number((config.lyricsOffset + 0.1).toFixed(2)) })
                }
                title="Show lyrics 0.1s earlier"
                className="p-2 text-zinc-300 hover:text-white cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadAudio(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-200 bg-white/6 hover:bg-white/12 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Audio</span>
            </button>

            <input
              ref={lrcInputRef}
              type="file"
              accept=".lrc,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadLrc(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => lrcInputRef.current?.click()}
              className="px-3 py-2 text-xs font-medium text-zinc-200 bg-white/6 hover:bg-white/12 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              .LRC
            </button>

            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute audio" : "Mute audio"}
              className="p-2 text-zinc-300 hover:text-white bg-white/6 hover:bg-white/12 border border-white/10 rounded-md transition-colors shrink-0 cursor-pointer"
            >
              {muted ? (
                <VolumeX className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Volume2 className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <aside className="hidden xl:block w-[380px] border-l border-white/8 bg-[#0C0D12] overflow-y-auto p-5 shrink-0">
          <ControlInspector
            config={config}
            palette={palette}
            onChange={onChangeConfig}
            onResetDefaults={onResetDefaults}
            onPeekCard={triggerPeek}
            compact
          />
        </aside>
      )}
    </div>
  );
}

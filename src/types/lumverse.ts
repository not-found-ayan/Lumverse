export type GlowMode = "aurora" | "prism" | "vignette" | "hairline";

export type VizMode = "orbital" | "terrain" | "oscilloscope" | "turbine";

export type ResolvedGenre =
  | "romantic"
  | "electronic"
  | "hiphop"
  | "lofi"
  | "folk"
  | "rock"
  | "classical";

export type GenreTheme = "auto" | ResolvedGenre;

export type LyricStyle =
  | "wipe"
  | "slam"
  | "burst"
  | "code"
  | "cascade"
  | "echo"
  | "ribbon";

export type CardStyle = "poster" | "glass" | "minimal";

export type CardVisibility = "always" | "onchange" | "off";

export type BackdropMode = "hyprland" | "wallpaper" | "obsidian";

export type FontPreset = "display" | "condensed" | "editorial" | "mono";

export interface LumverseConfig {
  thickness: number;
  maxAlpha: number;
  fps: number;
  rim: boolean;
  glowMode: GlowMode;
  vizMode: VizMode;
  vizAlways: boolean;
  genreMode: GenreTheme;
  genreEffectsEnabled: boolean;
  beatReactive: boolean;
  beatSensitivity: number;
  lyricsEnabled: boolean;
  style: LyricStyle;
  uppercase: boolean;
  fontPreset: FontPreset;
  lyricsOffset: number;
  cardVisibility: CardVisibility;
  cardStyle: CardStyle;
  cardSeconds: number;
  backdropMode: BackdropMode;
  idleColor1: [number, number, number];
  idleColor2: [number, number, number];
}

export interface PaletteColors {
  primary: [number, number, number];
  secondary: [number, number, number];
  accent: [number, number, number];
  cardBg: [number, number, number];
  cardInk: [number, number, number];
  shadow: [number, number, number];
  contrastRatio: number;
}

export interface LyricToken {
  text: string;
  spaceAfter: boolean;
  t0: number;
  t1: number;
  exactTimed: boolean;
}

export interface LyricLine {
  t: number;
  t1: number;
  text: string;
  tokens: LyricToken[];
  hasExactTokens: boolean;
}

export interface LyricsData {
  lines: LyricLine[];
  starts: number[];
  isEnhanced: boolean;
  isPlainFallback: boolean;
  rawLrc: string;
  source?: string;
}

export interface AudioAnalysis {
  bands: number[]; // 16 bands normalized 0..1
  bands48: number[]; // 48 high-res log bands 0..1
  peaks: number[]; // 16 peak-hold values 0..1
  waveform: number[]; // 128 time-domain samples -1..1
  subBass: number; // 0..1
  midEnergy: number; // 0..1
  trebleEnergy: number; // 0..1
  beat: number; // 0..1 impulse
  flux: number; // 0..1 spectral flux
  isLiveAudio: boolean;
}

export interface TrackItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre?: string;
  duration: number;
  bpm: number;
  coverUrl: string;
  synthPreset?: "neon-dusk" | "concrete-theorem" | "glass-meridian";
  audioObjectUrl?: string;
  lrcText: string;
  lyricSource?: "lrclib" | "netease" | "local" | "none";
}

export interface LrclibSearchResult {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  hasSynced: boolean;
  hasEnhanced: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  provider?: "lrclib" | "netease";
}

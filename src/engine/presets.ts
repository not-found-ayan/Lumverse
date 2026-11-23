import type {
  CardStyle,
  FontPreset,
  GenreTheme,
  GlowMode,
  LumverseConfig,
  LyricStyle,
  TrackItem,
  VizMode,
} from "../types/lumverse";

export const WALLPAPER_URL = "/src/assets/images/desktop_wallpaper_hypr_1795372530485.jpg";

export const DEFAULT_CONFIG: LumverseConfig = {
  thickness: 150,
  maxAlpha: 0.95,
  fps: 60,
  rim: true,
  glowMode: "aurora",
  vizMode: "orbital",
  vizAlways: true,
  genreMode: "auto",
  genreEffectsEnabled: true,
  beatReactive: true,
  beatSensitivity: 1.15,
  lyricsEnabled: true,
  style: "wipe",
  uppercase: true,
  fontPreset: "display",
  lyricsOffset: 0.0,
  cardVisibility: "always",
  cardStyle: "poster",
  cardSeconds: 8,
  backdropMode: "hyprland",
  idleColor1: [0.0, 1.0, 0.47],
  idleColor2: [0.0, 0.75, 1.0],
};

export const GLOW_MODES: { id: GlowMode; label: string; summary: string }[] = [
  { id: "aurora", label: "Aurora", summary: "Cosine-blended perimeter waves with zero corner seams" },
  { id: "prism", label: "Prism", summary: "Chromatic RGB edge dispersion on bass transients" },
  { id: "vignette", label: "Vignette", summary: "Deep radial peripheral bloom driven by sub-bass" },
  { id: "hairline", label: "Hairline", summary: "Precision 6px rim trace for distraction-free tiling" },
];

export const VIZ_MODES: { id: VizMode; label: string; summary: string }[] = [
  { id: "orbital", label: "Orbital Blob", summary: "Morphing organic spline blob + beat shockwaves" },
  { id: "terrain", label: "Horizon Terrain", summary: "Receding perspective spectrum ridges" },
  { id: "oscilloscope", label: "Phase Scope", summary: "Lissajous harmonic knot + stereo ribbon" },
  { id: "turbine", label: "Radial Turbine", summary: "48-ray logarithmic polar blades + sparks" },
];

export const GENRE_THEMES: { id: GenreTheme; label: string; summary: string }[] = [
  { id: "auto", label: "Auto Detect", summary: "Detects track genre from tags, lyrics & live audio DSP" },
  { id: "romantic", label: "Romantic", summary: "Blooming multi-petal flowers & rising pulsing hearts" },
  { id: "electronic", label: "Electronic", summary: "Prism diamond shards & perimeter laser beams" },
  { id: "hiphop", label: "Hip-Hop / Bass", summary: "Sub-bass shockwave rings & rising hot embers" },
  { id: "folk", label: "Folk / Acoustic", summary: "Drifting veined autumn leaves & warm golden motes" },
  { id: "lofi", label: "Lo-Fi / Chill", summary: "Warm firefly bokeh, soft mist & gentle rain streaks" },
  { id: "rock", label: "Rock / Metal", summary: "Crackling electric bolts & high-voltage sparks" },
  { id: "classical", label: "Classical", summary: "Golden harmonic ribbons & drifting stardust" },
];

export const LYRIC_STYLES: { id: LyricStyle; label: string; tag: string }[] = [
  { id: "wipe", label: "Wipe", tag: "Dual-pass sweep" },
  { id: "slam", label: "Slam", tag: "Spring word pop" },
  { id: "burst", label: "Burst", tag: "Colossal focal word" },
  { id: "code", label: "Code", tag: "Monospace stream" },
  { id: "cascade", label: "Cascade", tag: "Multi-line stack" },
  { id: "echo", label: "Echo", tag: "RGB ghost split" },
  { id: "ribbon", label: "Ribbon", tag: "Kinetic marquee" },
];

export const CARD_STYLES: { id: CardStyle; label: string }[] = [
  { id: "poster", label: "Neo-Poster" },
  { id: "glass", label: "Frosted Glass" },
  { id: "minimal", label: "Minimal Strip" },
];

export const FONT_PRESETS: { id: FontPreset; label: string; family: string; pythonFont: string }[] = [
  {
    id: "display",
    label: "Bricolage",
    family: '"Bricolage Grotesque", "Plus Jakarta Sans", sans-serif',
    pythonFont: "Bricolage Grotesque, Inter, Noto Sans, Sans",
  },
  {
    id: "condensed",
    label: "Antonio",
    family: '"Antonio", "Bricolage Grotesque", sans-serif',
    pythonFont: "Antonio, Anton, Inter, Sans",
  },
  {
    id: "editorial",
    label: "Fraunces",
    family: '"Fraunces", Georgia, serif',
    pythonFont: "Fraunces, Noto Serif, Serif",
  },
  {
    id: "mono",
    label: "JetBrains Mono",
    family: '"JetBrains Mono", monospace',
    pythonFont: "JetBrains Mono, monospace",
  },
];

export const DEMO_TRACKS: TrackItem[] = [
  {
    id: "horizon-pulse",
    title: "Horizon Pulse (Synthwave)",
    artist: "WebAudio Synth",
    album: "Nocturne Telemetry",
    genre: "Electronic / Synthwave",
    duration: 48,
    bpm: 118,
    coverUrl: "/src/assets/images/album_cover_neon_dusk_1795372530220.jpg",
    synthPreset: "neon-dusk",
    lrcText: "",
    lyricSource: "none",
  },
  {
    id: "concrete-theorem",
    title: "Concrete Theorem (Bass)",
    artist: "WebAudio Synth",
    album: "Monolith Study IV",
    genre: "Hip-Hop / Industrial Bass",
    duration: 44,
    bpm: 128,
    coverUrl: "/src/assets/images/album_cover_editorial_mono_1795372530230.jpg",
    synthPreset: "concrete-theorem",
    lrcText: "",
    lyricSource: "none",
  },
  {
    id: "glass-meridian",
    title: "Glass Meridian (Ambient)",
    artist: "WebAudio Synth",
    album: "Refraction / 雨夜",
    genre: "Lo-Fi / Ambient House",
    duration: 48,
    bpm: 96,
    coverUrl: "/src/assets/images/album_cover_botanical_glass_1795372530865.jpg",
    synthPreset: "glass-meridian",
    lrcText: "",
    lyricSource: "none",
  },
];

export const REAL_QUERY_EXAMPLES = [
  "Ed Sheeran Perfect",
  "Daft Punk Instant Crush",
  "The Weeknd Blinding Lights",
  "Nujabes Luv(sic) pt 3",
  "RADWIMPS Sparkle",
];

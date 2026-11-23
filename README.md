# Lumverse Studio

Ambient perimeter edge-glow, audio-reactive visualizers, genre-adaptive particle worlds, and kinetic synced lyrics for **Hyprland / Wayland** — paired with a live interactive **Web Studio Preview** and one-click Python overlay exporter.

Inspired by [trylumn](https://github.com/trylumn) and verci.

---

## Features

### Interactive Web Studio & Preview Stage
- **Live Stage Preview**: Test everything in the browser over a **Hyprland Tiles** desktop mockup, **Wallpaper**, or **Dark Stage** backdrop, with a Fullscreen Stage toggle and real-time tuning drawer.
- **Built-in WebAudio Synths & Local Audio Drop**: Play the bundled synthetic presets or upload local `.mp3` / `.flac` / `.wav` files (with client-side ID3 metadata + cover art extraction and automatic synced lyrics lookup).
- **Orbital Blob & 4 Audio-Reactive Visualizers**:
  - **Orbital Blob (`orbital`)**: Morphing multi-layer organic spline loops with radial core plasma glow and beat shockwaves layered behind lyrics.
  - **Horizon Terrain (`terrain`)**: Receding perspective 3D-style spectrum ridges.
  - **Phase Scope (`oscilloscope`)**: Lissajous harmonic knot paired with a stereo waveform ribbon.
  - **Radial Turbine (`turbine`)**: 48-ray logarithmic polar blades with treble sparks.
- **Genre-Adaptive Ambient Worlds**: Automatically detects genre from track tags, lyrics, and audio energy (or manually override):
  - **Romantic**: Blooming multi-petal flowers & rising pulsing hearts
  - **Electronic**: Prism diamond shards
  - **Hip-Hop / Bass**: Sub-bass shockwave rings & rising hot embers
  - **Folk / Acoustic**: Drifting veined leaves & golden motes
  - **Lo-Fi / Chill**: Soft rain streaks, firefly bokeh & drifting leaves
  - **Rock / Metal**: Forked high-voltage lightning bolts & sparks
  - **Classical**: Golden harmonic ribbons & twinkling stardust
- **Perimeter Edge Glow**: 4 cosine-blended shader-style edge modes (**Aurora**, **Prism**, **Vignette**, **Hairline**) with adjustable bloom depth, max opacity, specular rim, and spectral-flux beat reactivity.
- **Perceptual Adaptive Palette & Now-Playing Cards**: 24-hue × 2-lightness palette extraction from album artwork with automatic WCAG contrast verification, rendered in **Neo-Poster**, **Frosted Glass**, or **Minimal Strip** card styles.

### Kinetic Lyrics Engine, Search & Gemini Translation
- **7 Kinetic Lyric Styles**: `Wipe`, `Slam`, `Burst`, `Code`, `Cascade`, `Echo`, and `Ribbon`, complete with exact `<mm:ss.xx>` word-timing support, animated active-line progress indicator, interactive cue jump list, and live sync offset controls (`±0.1s`).
- **Real Synced Lyrics Lookup**: Queries **LRCLIB** with **NetEase Cloud Music** fallback via backend proxy routes (never fabricates fake lyrics).
- **Timestamp-Preserving Gemini Translation**: Select a preferred target language in **Lyrics Search** and click **Translate** to translate synced LRC lines via the Gemini API (`@google/genai`) on the server while keeping every `[mm:ss.xx]` timestamp and metadata header intact, with one-click **Original** restore.

### Hyprland / Wayland Python Overlay Export
- Click **Export Python** to download a synchronized bundle tailored to your current Studio configuration:
  - `lumverse.py` — GTK4 + `gtk4-layer-shell` overlay controller reading MPRIS (`D-Bus`) playback state & `cava` 32-band audio spectrum
  - `scene.py` — Cairo renderer for perimeter glow, genre worlds, 4-mode visualizers, and now-playing cards
  - `lyrics.py` — LRCLIB + NetEase lyric fetcher, LRC parser, and PangoCairo kinetic typography renderer
  - `config.json` — Exported preset configuration

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide Icons, HTML5 Canvas 2D + WebAudio API
- **Backend**: Express (`server.ts`), `@google/genai` (server-side lyric translation), LRCLIB & NetEase proxy endpoints
- **Desktop Overlay Target**: Python 3, GTK 4, `gtk4-layer-shell`, PyGObject, PyCairo, PangoCairo, Pillow, `cava`

---

## Running the Web Studio Locally

### 1. Prerequisites
- **Node.js** 20+ and **npm**

### 2. Environment Variables
Copy `.env.example` to `.env` (optional unless using Gemini lyric translation):

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | For translation | Server-side Gemini API key used by `POST /api/lyrics/translate` |
| `APP_URL` | Optional | Public URL of the hosted app |

### 3. Install & Start Development Server

```bash
npm install
npm run dev
```

The Express + Vite server listens on **`http://localhost:3000`**.

### 4. Type-Check & Production Build

```bash
npm run lint
npm run build
npm start
```

---

## Running the Exported Hyprland / Wayland Overlay

### 1. Install System Dependencies (Arch Linux)

```bash
sudo pacman -S gtk4-layer-shell python-gobject python-cairo python-pillow cava
```

### 2. Export & Place Files
1. Open the **Export Python** tab in Lumverse Studio and click **Download All 4 Files**.
2. Move the files into place:

```bash
mkdir -p ~/lumverse ~/.config/lumverse
mv ~/Downloads/lumverse.py ~/Downloads/scene.py ~/Downloads/lyrics.py ~/lumverse/
mv ~/Downloads/config.json ~/.config/lumverse/config.json
```

3. Launch the overlay:

```bash
/usr/bin/python3 ~/lumverse/lumverse.py
```

### 3. Live Runtime Controls (Keybind Commands)
You can bind these commands in `hyprland.conf` to cycle overlay modes on the fly:

```bash
/usr/bin/python3 ~/lumverse/lumverse.py style   # Cycle kinetic lyric style
/usr/bin/python3 ~/lumverse/lumverse.py card    # Peek the now-playing card
/usr/bin/python3 ~/lumverse/lumverse.py glow    # Cycle edge glow mode
/usr/bin/python3 ~/lumverse/lumverse.py viz     # Cycle audio visualizer mode
/usr/bin/python3 ~/lumverse/lumverse.py genre   # Cycle genre ambient theme
```

---

## API Endpoints

- `GET /api/lyrics/search?q=...` — Search synced lyrics across LRCLIB and NetEase.
- `GET /api/lyrics/get?track=...&artist=...&album=...&duration=...` — Best-match synced LRC lookup for a playing track.
- `POST /api/lyrics/translate` — Server-side Gemini lyric translation (`{ lrc, targetLanguage }`) returning timestamp-preserved LRC.

---

## Project Structure

```text
├── server.ts                  # Express backend, Vite dev middleware, LRCLIB/NetEase & Gemini translate API
├── index.html                 # App entry HTML & web fonts
├── package.json               # Scripts & dependencies
└── src/
    ├── App.tsx                # Root studio state, audio engine lifecycle, & tab router
    ├── components/
    │   ├── TopBar.tsx         # Primary navigation & Fullscreen Stage toggle
    │   ├── StageCanvas.tsx    # Interactive live preview stage, transport dock, & quick toggles
    │   ├── ControlInspector.tsx # Real-time glow, visualizer, genre, lyric, & card tuning UI
    │   ├── LyricsBrowser.tsx  # Lyrics search, LRC editor, Gemini translate bar, & cue jump list
    │   └── PythonExportView.tsx # Live-generated Hyprland Python source viewer & downloader
    ├── engine/
    │   ├── audioEngine.ts     # WebAudio synth + local file playback & 48-band FFT / beat DSP
    │   ├── canvasRenderer.ts  # Glow, Orbital Blob / visualizers, 7 lyric styles, & card renderer
    │   ├── genreAnimator.ts   # Procedural particle systems for each music genre
    │   ├── genreDetector.ts   # Multi-signal genre resolver (tags, lyrics, audio DSP)
    │   ├── id3Reader.ts       # Browser ID3 tag & embedded cover art parser
    │   ├── lrcParser.ts       # Enhanced & standard LRC parser
    │   ├── palette.ts         # Album cover color extraction & WCAG contrast verification
    │   ├── presets.ts         # Default config, demo synth tracks, & presets
    │   └── pythonGenerator.ts # Generates lumverse.py, scene.py, lyrics.py, & config.json
    └── types/
        └── lumverse.ts        # Shared TypeScript interfaces
```

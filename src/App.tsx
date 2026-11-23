/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TopBar, type StudioTab } from "./components/TopBar";
import { StageCanvas } from "./components/StageCanvas";
import { ControlInspector } from "./components/ControlInspector";
import { LyricsBrowser } from "./components/LyricsBrowser";
import { PythonExportView } from "./components/PythonExportView";
import { LumverseAudioEngine } from "./engine/audioEngine";
import { resolveGenreTheme } from "./engine/genreDetector";
import { readBasicId3 } from "./engine/id3Reader";
import { parseLrc } from "./engine/lrcParser";
import { buildContrastPalette, extractPaletteFromImage } from "./engine/palette";
import { DEFAULT_CONFIG, DEMO_TRACKS, GENRE_THEMES, VIZ_MODES } from "./engine/presets";
import type {
  AudioAnalysis,
  LumverseConfig,
  PaletteColors,
  TrackItem,
} from "./types/lumverse";

export default function App() {
  const engineRef = useRef<LumverseAudioEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new LumverseAudioEngine();
  }

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<StudioTab>("stage");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [tracks, setTracks] = useState<TrackItem[]>(DEMO_TRACKS);
  const [activeTrackId, setActiveTrackId] = useState<string>(DEMO_TRACKS[0].id);
  const [config, setConfig] = useState<LumverseConfig>(DEFAULT_CONFIG);

  const [playing, setPlaying] = useState(false);
  const [uiPosition, setUiPosition] = useState(0);
  const [uiDuration, setUiDuration] = useState(DEMO_TRACKS[0].duration);
  const [cardPeekToken, setCardPeekToken] = useState(1);
  const [fetchingLyrics, setFetchingLyrics] = useState(false);

  const [albumArtImg, setAlbumArtImg] = useState<HTMLImageElement | null>(null);
  const [palette, setPalette] = useState<PaletteColors>(() =>
    buildContrastPalette(DEFAULT_CONFIG.idleColor1, DEFAULT_CONFIG.idleColor2)
  );

  const activeTrack = useMemo(
    () => tracks.find((t) => t.id === activeTrackId) ?? tracks[0],
    [tracks, activeTrackId]
  );

  const lyricsData = useMemo(
    () => parseLrc(activeTrack.lrcText, uiDuration || activeTrack.duration),
    [activeTrack.lrcText, uiDuration, activeTrack.duration]
  );

  const lyricStatusNote = useMemo(() => {
    if (fetchingLyrics) return "Fetching synced lyrics from LRCLIB / NetEase...";
    const resolvedGenre = resolveGenreTheme(
      config.genreMode,
      activeTrack.title,
      activeTrack.artist,
      activeTrack.album,
      activeTrack.genre,
      activeTrack.lrcText,
      {
        bands: [],
        bands48: [],
        peaks: [],
        waveform: [],
        subBass: 0,
        midEnergy: 0,
        trebleEnergy: 0,
        beat: 0,
        flux: 0,
        isLiveAudio: false,
      }
    );
    const genreLabel = GENRE_THEMES.find((g) => g.id === resolvedGenre)?.label ?? resolvedGenre;
    if (lyricsData) {
      const src =
        activeTrack.lyricSource === "netease"
          ? "NetEase"
          : activeTrack.lyricSource === "local"
          ? "Local .LRC"
          : "LRCLIB";
      return `${src} · ${lyricsData.isEnhanced ? "Word-synced" : "Synced lyrics"} · ${genreLabel} ambience`;
    }
    if (config.genreEffectsEnabled && !config.vizAlways) {
      return `No lyrics · ${genreLabel} ambience active`;
    }
    const vizName = VIZ_MODES.find((v) => v.id === config.vizMode)?.label ?? "Visualizer";
    return config.genreEffectsEnabled
      ? `No lyrics · ${vizName} + ${genreLabel} ambience`
      : `No lyrics · ${vizName} visualizer active`;
  }, [
    fetchingLyrics,
    lyricsData,
    activeTrack.lyricSource,
    activeTrack.title,
    activeTrack.artist,
    activeTrack.album,
    activeTrack.genre,
    activeTrack.lrcText,
    config.genreMode,
    config.genreEffectsEnabled,
    config.vizAlways,
    config.vizMode,
  ]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.loadTrack(activeTrack, false);
    setUiPosition(0);
    setUiDuration(activeTrack.duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrack.id]);

  useEffect(() => {
    if (!activeTrack.coverUrl) {
      setAlbumArtImg(null);
      setPalette(buildContrastPalette(config.idleColor1, config.idleColor2));
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      setAlbumArtImg(img);
      setPalette(extractPaletteFromImage(img));
    };
    img.onerror = () => {
      if (cancelled) return;
      setAlbumArtImg(null);
      setPalette(buildContrastPalette(config.idleColor1, config.idleColor2));
    };
    img.src = activeTrack.coverUrl;
    return () => {
      cancelled = true;
    };
  }, [activeTrack.coverUrl, config.idleColor1, config.idleColor2]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setPlaying(engine.isPlaying());
      setUiPosition(engine.getPosition());
      const d = engine.getDuration();
      if (d > 0) setUiDuration(d);
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (ev: Event) => {
      const custom = ev as CustomEvent<boolean>;
      engineRef.current?.setMuted(Boolean(custom.detail));
    };
    window.addEventListener("lumverse-mute", handler);
    return () => window.removeEventListener("lumverse-mute", handler);
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && rootRef.current) {
        setActiveTab("stage");
        await rootRef.current.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      setIsFullscreen((v) => !v);
    }
  };

  const handleSelectTrack = (track: TrackItem) => {
    setActiveTrackId(track.id);
    setCardPeekToken((n) => n + 1);
  };

  const handleTogglePlay = () => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.togglePlay();
    setPlaying(engine.isPlaying());
  };

  const handleSeek = (sec: number) => {
    engineRef.current?.seek(sec);
    setUiPosition(sec);
  };

  const handleChangeConfig = (patch: Partial<LumverseConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const handleUploadAudio = async (file: File) => {
    const objectUrl = URL.createObjectURL(file);
    const id3 = await readBasicId3(file);

    const cleanName = file.name.replace(/\.[^/.]+$/, "");
    const parts = cleanName.split(/\s+-\s+/);
    const fallbackArtist = parts.length > 1 ? parts[0].trim() : "";
    const fallbackTitle = parts.length > 1 ? parts.slice(1).join(" - ").trim() : cleanName;

    const title = id3.title || fallbackTitle;
    const artist = id3.artist || fallbackArtist || "Local Audio";
    const album = id3.album || "Local Session";
    const trackId = `local-${Date.now()}`;

    const customTrack: TrackItem = {
      id: trackId,
      title,
      artist,
      album,
      genre: id3.genre || "",
      duration: 180,
      bpm: 120,
      coverUrl: id3.coverObjectUrl || activeTrack.coverUrl,
      audioObjectUrl: objectUrl,
      lrcText: "",
      lyricSource: "none",
    };

    setTracks((prev) => [...prev, customTrack]);
    setActiveTrackId(trackId);
    setCardPeekToken((n) => n + 1);
    setTimeout(() => {
      engineRef.current?.loadTrack(customTrack, true);
      setPlaying(true);
    }, 30);

    // Fetch real synced lyrics automatically from LRCLIB / NetEase (never generate fake ones)
    setFetchingLyrics(true);
    try {
      const qs = new URLSearchParams({ track: title });
      if (artist && artist !== "Local Audio") qs.set("artist", artist);
      if (album && album !== "Local Session") qs.set("album", album);
      const res = await fetch(`/api/lyrics/get?${qs.toString()}`);
      const data = await res.json();
      if (res.ok && data.found && data.syncedLyrics) {
        setTracks((prev) =>
          prev.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  lrcText: data.syncedLyrics,
                  lyricSource: data.provider === "netease" ? "netease" : "lrclib",
                }
              : t
          )
        );
      }
    } catch {
      // No lyrics fetched -> procedural visualizer remains active
    } finally {
      setFetchingLyrics(false);
    }
  };

  const handleUploadLrc = async (file: File) => {
    const text = await file.text();
    setTracks((prev) =>
      prev.map((t) =>
        t.id === activeTrack.id ? { ...t, lrcText: text, lyricSource: "local" } : t
      )
    );
  };

  const handleApplyLrc = (
    lrc: string,
    titleOverride?: string,
    artistOverride?: string,
    source: "lrclib" | "netease" | "local" | "none" = "lrclib"
  ) => {
    setTracks((prev) =>
      prev.map((t) =>
        t.id === activeTrack.id
          ? {
              ...t,
              lrcText: lrc,
              title: titleOverride ?? t.title,
              artist: artistOverride ?? t.artist,
              lyricSource: lrc.trim() ? source : "none",
            }
          : t
      )
    );
  };

  const sampleAnalysis = useCallback(
    (dt: number): AudioAnalysis => {
      return (
        engineRef.current?.sampleAnalysis(dt, config.beatSensitivity) ?? {
          bands: new Array(16).fill(0),
          bands48: new Array(48).fill(0),
          peaks: new Array(16).fill(0),
          waveform: new Array(128).fill(0),
          subBass: 0,
          midEnergy: 0,
          trebleEnergy: 0,
          beat: 0,
          flux: 0,
          isLiveAudio: false,
        }
      );
    },
    [config.beatSensitivity]
  );

  const getPosition = useCallback(() => engineRef.current?.getPosition() ?? 0, []);
  const getDuration = useCallback(
    () => engineRef.current?.getDuration() ?? activeTrack.duration,
    [activeTrack.duration]
  );

  return (
    <div
      ref={rootRef}
      className="h-screen w-screen flex flex-col bg-[#090A0D] text-zinc-100 overflow-hidden"
    >
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />

      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === "stage" && (
          <StageCanvas
            tracks={tracks}
            activeTrack={activeTrack}
            onSelectTrack={handleSelectTrack}
            onUploadAudio={handleUploadAudio}
            onUploadLrc={handleUploadLrc}
            config={config}
            onChangeConfig={handleChangeConfig}
            onResetDefaults={() => setConfig(DEFAULT_CONFIG)}
            palette={palette}
            lyricsData={lyricsData}
            lyricStatusNote={lyricStatusNote}
            albumArtImg={albumArtImg}
            playing={playing}
            onTogglePlay={handleTogglePlay}
            positionSec={uiPosition}
            durationSec={uiDuration}
            getPosition={getPosition}
            getDuration={getDuration}
            onSeek={handleSeek}
            sampleAnalysis={sampleAnalysis}
            cardPeekToken={cardPeekToken}
            isFullscreen={isFullscreen}
          />
        )}

        {activeTab === "lyrics" && (
          <div className="flex-1 overflow-y-auto">
            <LyricsBrowser
              trackTitle={activeTrack.title}
              trackArtist={activeTrack.artist}
              currentPosition={uiPosition}
              lyricsData={lyricsData}
              rawLrc={activeTrack.lrcText}
              onApplyLrc={handleApplyLrc}
              onSeekTo={(sec) => {
                handleSeek(sec);
                if (!playing) handleTogglePlay();
              }}
              onOpenStage={() => setActiveTab("stage")}
            />
          </div>
        )}

        {activeTab === "tuning" && (
          <div className="flex-1 overflow-y-auto">
            <ControlInspector
              config={config}
              palette={palette}
              onChange={handleChangeConfig}
              onResetDefaults={() => setConfig(DEFAULT_CONFIG)}
              onPeekCard={() => {
                setCardPeekToken((n) => n + 1);
                setActiveTab("stage");
              }}
            />
          </div>
        )}

        {activeTab === "export" && (
          <div className="flex-1 overflow-y-auto">
            <PythonExportView config={config} />
          </div>
        )}
      </main>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Search,
  Check,
  Loader2,
  ArrowUpRight,
  Trash2,
  Languages,
  RotateCcw,
} from "lucide-react";
import type { LrclibSearchResult, LyricsData } from "../types/lumverse";
import { REAL_QUERY_EXAMPLES } from "../engine/presets";

interface LyricsBrowserProps {
  trackTitle: string;
  trackArtist: string;
  currentPosition: number;
  lyricsData: LyricsData | null;
  rawLrc: string;
  onApplyLrc: (
    lrc: string,
    titleOverride?: string,
    artistOverride?: string,
    source?: "lrclib" | "netease" | "local" | "none"
  ) => void;
  onSeekTo: (seconds: number) => void;
  onOpenStage: () => void;
}

const TARGET_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "Japanese",
  "Korean",
  "Hindi",
  "Portuguese",
  "German",
  "Chinese (Simplified)",
  "Arabic",
  "Italian",
  "Indonesian",
];

function getInitialLanguage(): string {
  try {
    const saved = localStorage.getItem("lumverse_preferred_lang");
    if (saved) return saved;
  } catch {
    // Ignore storage access errors
  }
  return "English";
}

function formatSec(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function LyricsBrowser({
  trackTitle,
  trackArtist,
  currentPosition,
  lyricsData,
  rawLrc,
  onApplyLrc,
  onSeekTo,
  onOpenStage,
}: LyricsBrowserProps) {
  const initialQuery = trackTitle.includes("(Instrumental)")
    ? ""
    : `${trackTitle} ${trackArtist}`.trim();
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LrclibSearchResult[]>([]);
  const [draftLrc, setDraftLrc] = useState(rawLrc);
  const [appliedId, setAppliedId] = useState<number | null>(null);

  const [targetLanguage, setTargetLanguage] = useState<string>(getInitialLanguage);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [originalLrcSnapshot, setOriginalLrcSnapshot] = useState<string | null>(null);
  const [translatedToLabel, setTranslatedToLabel] = useState<string | null>(null);

  useEffect(() => {
    setDraftLrc(rawLrc);
  }, [rawLrc]);

  const handleLanguageChange = (lang: string) => {
    setTargetLanguage(lang);
    try {
      localStorage.setItem("lumverse_preferred_lang", lang);
    } catch {
      // Ignore storage access errors
    }
  };

  const runSearch = async (searchText: string) => {
    const q = searchText.trim();
    if (!q) return;
    setQuery(q);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/lyrics/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Lyrics search failed");
      }
      setResults(data.results || []);
      if ((data.results || []).length === 0) {
        setError("No synced lyrics found on LRCLIB or NetEase — visualizer will run instead.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error reaching lyric providers");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
  };

  const applyResult = (item: LrclibSearchResult) => {
    const lrc = item.syncedLyrics || "";
    if (!lrc) return;
    setDraftLrc(lrc);
    setAppliedId(item.id);
    setOriginalLrcSnapshot(null);
    setTranslatedToLabel(null);
    setTranslateError(null);
    onApplyLrc(lrc, item.title, item.artist, item.provider || "lrclib");
  };

  const clearLyrics = () => {
    setDraftLrc("");
    setAppliedId(null);
    setOriginalLrcSnapshot(null);
    setTranslatedToLabel(null);
    setTranslateError(null);
    onApplyLrc("", undefined, undefined, "none");
  };

  const handleTranslate = async () => {
    const sourceLrc = (draftLrc || rawLrc).trim();
    if (!sourceLrc) {
      setTranslateError("Load or paste synced lyrics before translating.");
      return;
    }

    const baseLrc = originalLrcSnapshot ?? sourceLrc;
    setTranslating(true);
    setTranslateError(null);

    try {
      const res = await fetch("/api/lyrics/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lrc: baseLrc,
          targetLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Translation failed");
      }
      if (!originalLrcSnapshot) {
        setOriginalLrcSnapshot(sourceLrc);
      }
      setDraftLrc(data.translatedLrc);
      setTranslatedToLabel(data.targetLanguage || targetLanguage);
      onApplyLrc(data.translatedLrc, undefined, undefined, "local");
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : "Unable to translate lyrics");
    } finally {
      setTranslating(false);
    }
  };

  const handleRestoreOriginal = () => {
    if (!originalLrcSnapshot) return;
    setDraftLrc(originalLrcSnapshot);
    onApplyLrc(originalLrcSnapshot, undefined, undefined, "local");
    setOriginalLrcSnapshot(null);
    setTranslatedToLabel(null);
    setTranslateError(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
            Live Synced Lyrics Fetcher (LRCLIB + NetEase)
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Real synced lyrics only—nothing is ever auto-generated. When no lyrics are loaded, genre particle ambience runs automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenStage}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-zinc-100 bg-white/8 hover:bg-white/14 border border-white/12 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <span>Preview on Stage</span>
          <ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Real Multi-Provider Search */}
        <section className="lg:col-span-6 border border-white/8 bg-[#111318] rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-100">Fetch Real Synced Lyrics</h2>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search song title and artist..."
              className="flex-1 min-w-0 px-3.5 py-2 text-sm bg-black/40 border border-white/12 rounded-md text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Search</span>
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>Try real tracks:</span>
            {REAL_QUERY_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => void runSearch(ex)}
                className="text-zinc-300 hover:text-emerald-300 underline underline-offset-4 cursor-pointer whitespace-nowrap"
              >
                {ex}
              </button>
            ))}
          </div>

          {error && (
            <div className="p-3 text-xs text-amber-300 bg-amber-500/10 border border-amber-400/25 rounded-md">
              {error}
            </div>
          )}

          {results.length === 0 && !loading && !error && (
            <div className="py-10 text-center space-y-2 border border-dashed border-white/10 rounded-md">
              <p className="text-sm text-zinc-300">Search LRCLIB &amp; NetEase for real synced LRC</p>
              <p className="text-xs text-zinc-500">
                Or drop an MP3/FLAC on the Stage — ID3 tags are auto-queried for lyrics
              </p>
            </div>
          )}

          {results.length > 0 && (
            <div className="divide-y divide-white/8 border border-white/8 rounded-md max-h-[420px] overflow-y-auto">
              {results
                .filter((r) => Boolean(r.syncedLyrics))
                .map((item) => {
                  const applied = appliedId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 p-3.5 hover:bg-white/[0.03] transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-100 truncate">
                          {item.title}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-400 truncate">
                          {item.artist}
                          {item.album ? ` · ${item.album}` : ""}
                          {item.duration ? ` · ${formatSec(item.duration)}` : ""}
                          {" · "}
                          {item.provider === "netease" ? "NetEase" : "LRCLIB"}
                          {" · "}
                          {item.hasEnhanced ? "Word-Synced" : "Line-Synced"}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => applyResult(item)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          applied
                            ? "bg-emerald-400/15 border-emerald-400/40 text-emerald-300"
                            : "bg-white/6 border-white/12 text-zinc-200 hover:bg-white/12"
                        }`}
                      >
                        {applied ? (
                          <>
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Loaded</span>
                          </>
                        ) : (
                          <span>Load Lyrics</span>
                        )}
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
        </section>

        {/* Right: Active LRC Buffer + Timestamp-Preserving Translation */}
        <section className="lg:col-span-6 border border-white/8 bg-[#111318] rounded-lg p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Active LRC Buffer</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {lyricsData
                  ? `${lyricsData.lines.length} cue lines · ${
                      lyricsData.isEnhanced ? "Exact word timestamps" : "Synced line cues"
                    }${translatedToLabel ? ` · Translated (${translatedToLabel})` : ""}`
                  : "No lyrics loaded · Genre ambience active on stage"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {lyricsData && (
                <button
                  type="button"
                  onClick={clearLyrics}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-white/6 hover:bg-white/12 border border-white/10 rounded-md transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onApplyLrc(draftLrc, undefined, undefined, "local")}
                className="px-3.5 py-1.5 text-xs font-semibold text-zinc-950 bg-zinc-100 hover:bg-white rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                Apply LRC
              </button>
            </div>
          </div>

          {/* Language Selector + Translate Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-md bg-black/30 border border-white/8">
            <div className="flex items-center gap-2 min-w-0">
              <Languages className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
              <label htmlFor="lyric-translate-lang" className="text-xs text-zinc-300 whitespace-nowrap">
                Language
              </label>
              <select
                id="lyric-translate-lang"
                value={targetLanguage}
                onChange={(e) => handleLanguageChange(e.target.value)}
                disabled={translating}
                className="px-2.5 py-1 text-xs bg-[#0B0C10] border border-white/12 rounded text-zinc-100 focus:outline-none focus:border-emerald-400 cursor-pointer"
              >
                {TARGET_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {originalLrcSnapshot && (
                <button
                  type="button"
                  onClick={handleRestoreOriginal}
                  disabled={translating}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-300 bg-white/6 hover:bg-white/12 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Original</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleTranslate}
                disabled={translating || !draftLrc.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 disabled:opacity-45 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {translating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Translating...</span>
                  </>
                ) : (
                  <>
                    <Languages className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Translate</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {translateError && (
            <div className="p-3 text-xs text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-md">
              {translateError}
            </div>
          )}

          <textarea
            value={draftLrc}
            onChange={(e) => setDraftLrc(e.target.value)}
            spellCheck={false}
            rows={10}
            className="w-full p-3 text-xs font-mono-tabular leading-relaxed bg-black/45 border border-white/10 rounded-md text-zinc-200 focus:outline-none focus:border-emerald-400"
            placeholder="No lyrics loaded. Search on the left or paste valid [mm:ss.xx] LRC lines here..."
          />

          {lyricsData && lyricsData.lines.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-zinc-400">
                Cue Jump List (click any line to seek playback)
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-white/6 border border-white/8 rounded-md bg-black/25">
                {lyricsData.lines
                  .filter((l) => l.text)
                  .map((line, idx) => {
                    const active = currentPosition >= line.t && currentPosition < line.t1;
                    const progress = active
                      ? Math.min(
                          1,
                          Math.max(
                            0,
                            (currentPosition - line.t) / Math.max(0.15, line.t1 - line.t)
                          )
                        )
                      : 0;
                    return (
                      <button
                        key={`${line.t}-${idx}`}
                        type="button"
                        onClick={() => onSeekTo(line.t)}
                        className={`w-full flex flex-col gap-1.5 px-3 py-2 text-left text-xs transition-colors cursor-pointer ${
                          active
                            ? "bg-emerald-400/12 text-emerald-200"
                            : "text-zinc-300 hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="w-full flex items-center gap-3 min-w-0">
                          <span className="font-mono-tabular text-zinc-500 shrink-0 w-12">
                            {formatSec(line.t)}
                          </span>
                          <span className="truncate">{line.text}</span>
                        </div>
                        {active && (
                          <div className="w-full pl-15 pr-1">
                            <div className="relative h-0.5 w-full rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400/70 via-emerald-300 to-teal-200 shadow-[0_0_8px_rgba(52,211,153,0.65)] transition-[width] duration-150 ease-linear"
                                style={{ width: `${(progress * 100).toFixed(1)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

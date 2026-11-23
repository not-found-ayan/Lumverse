import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const LRCLIB_API = "https://lrclib.net/api";
const NETEASE_SEARCH = "https://music.163.com/api/search/get/web";
const NETEASE_LYRIC = "https://music.163.com/api/song/lyric";
const USER_AGENT = "lumverse-studio/2.0 (https://lrclib.net)";

const app = express();
app.use(express.json({ limit: "1mb" }));

interface LrclibTrack {
  id: number;
  trackName?: string;
  name?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface NormalizedLyricResult {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  hasSynced: boolean;
  hasEnhanced: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  provider: "lrclib" | "netease";
}

function cleanTrackTitle(title: string): string {
  return title
    .replace(
      /\s*[([][^)\]]*(feat|ft\.|with|remaster|live|version|edit|from|official|lyric|audio)[^)\]]*[)\]]/gi,
      ""
    )
    .replace(/\s+-\s+(remaster|live|single|radio|from|\d{4}).*$/i, "")
    .trim();
}

async function fetchJsonWithTimeout<T>(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 7000
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 404 || !res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLrclibJson<T>(endpoint: string, params: Record<string, string>): Promise<T | null> {
  const qs = new URLSearchParams(params).toString();
  return fetchJsonWithTimeout<T>(`${LRCLIB_API}${endpoint}?${qs}`, {
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  });
}

async function searchNeteaseSynced(query: string, limit = 5): Promise<NormalizedLyricResult[]> {
  try {
    const body = new URLSearchParams({
      s: query,
      type: "1",
      offset: "0",
      total: "true",
      limit: String(limit),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    const searchRes = await fetch(NETEASE_SEARCH, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        Referer: "https://music.163.com/",
      },
      body: body.toString(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!searchRes.ok) return [];
    const searchData = (await searchRes.json()) as {
      result?: {
        songs?: {
          id: number;
          name: string;
          duration?: number;
          artists?: { name: string }[];
          album?: { name: string };
        }[];
      };
    };
    const songs = searchData?.result?.songs ?? [];
    const out: NormalizedLyricResult[] = [];

    for (const song of songs.slice(0, 3)) {
      const lyrData = await fetchJsonWithTimeout<{ lrc?: { lyric?: string } }>(
        `${NETEASE_LYRIC}?os=pc&id=${song.id}&lv=-1`,
        { "User-Agent": "Mozilla/5.0", Referer: "https://music.163.com/" },
        4000
      );
      const rawLrc = lyrData?.lrc?.lyric?.trim();
      if (rawLrc && /\[\d+:\d+/.test(rawLrc)) {
        out.push({
          id: song.id + 900_000_000,
          title: song.name,
          artist: (song.artists ?? []).map((a) => a.name).join(", ") || "Unknown Artist",
          album: song.album?.name ?? "",
          duration: song.duration ? Math.round(song.duration / 1000) : 0,
          hasSynced: true,
          hasEnhanced: /<\d+:\d+(?:\.\d+)?>/.test(rawLrc),
          syncedLyrics: rawLrc,
          plainLyrics: null,
          provider: "netease",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

app.get("/api/lyrics/search", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const track = typeof req.query.track === "string" ? req.query.track.trim() : "";
  const artist = typeof req.query.artist === "string" ? req.query.artist.trim() : "";

  if (!q && !track) {
    res.status(400).json({ error: "Provide a search query (q) or track name." });
    return;
  }

  try {
    const params: Record<string, string> = {};
    if (q) {
      params.q = q.slice(0, 140);
    } else {
      params.track_name = track.slice(0, 100);
      if (artist) {
        params.artist_name = artist.slice(0, 100);
      }
    }
    const lrclibRes = (await fetchLrclibJson<LrclibTrack[]>("/search", params)) ?? [];
    const normalized: NormalizedLyricResult[] = lrclibRes
      .filter((item) => Boolean(item.syncedLyrics || item.plainLyrics))
      .slice(0, 16)
      .map((item) => ({
        id: item.id,
        title: item.trackName || item.name || "Untitled",
        artist: item.artistName || "Unknown Artist",
        album: item.albumName || "",
        duration: typeof item.duration === "number" ? item.duration : 0,
        hasSynced: Boolean(item.syncedLyrics),
        hasEnhanced: Boolean(item.syncedLyrics && /<\d+:\d+(?:\.\d+)?>/.test(item.syncedLyrics)),
        syncedLyrics: item.syncedLyrics || null,
        plainLyrics: item.plainLyrics || null,
        provider: "lrclib",
      }));

    // If LRCLIB didn't return any synced results, also check NetEase for synced LRC
    const hasAnySynced = normalized.some((r) => r.hasSynced);
    if (!hasAnySynced) {
      const neQuery = q || `${track} ${artist}`.trim();
      const neResults = await searchNeteaseSynced(neQuery, 4);
      normalized.push(...neResults);
    }

    res.json({ results: normalized });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to query lyrics providers";
    res.status(502).json({ error: message, results: [] });
  }
});

app.get("/api/lyrics/get", async (req, res) => {
  const track = typeof req.query.track === "string" ? req.query.track.trim() : "";
  const artist = typeof req.query.artist === "string" ? req.query.artist.trim() : "";
  const album = typeof req.query.album === "string" ? req.query.album.trim() : "";
  const durRaw = typeof req.query.duration === "string" ? Number(req.query.duration) : 0;
  const duration = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : 0;

  if (!track) {
    res.status(400).json({ error: "Track parameter is required." });
    return;
  }

  try {
    // 1. Direct LRCLIB lookup if artist is known
    if (artist) {
      const directParams: Record<string, string> = {
        track_name: track.slice(0, 120),
        artist_name: artist.slice(0, 120),
      };
      if (album) directParams.album_name = album.slice(0, 120);
      if (duration > 0) directParams.duration = String(duration);

      const direct = await fetchLrclibJson<LrclibTrack>("/get", directParams);
      if (direct && direct.syncedLyrics) {
        res.json({
          found: true,
          provider: "lrclib",
          syncedLyrics: direct.syncedLyrics,
          plainLyrics: direct.plainLyrics || null,
          title: direct.trackName || track,
          artist: direct.artistName || artist,
          album: direct.albumName || album,
          duration: direct.duration || duration,
        });
        return;
      }
    }

    // 2. Fuzzy LRCLIB search with cleaned title
    const primaryArtist = artist ? artist.split(",")[0].trim() : "";
    const clean = cleanTrackTitle(track);
    const queries: Record<string, string>[] = [];
    if (primaryArtist) {
      queries.push({ track_name: clean, artist_name: primaryArtist });
      queries.push({ q: `${clean} ${primaryArtist}` });
    }
    queries.push({ q: clean });

    for (const qParams of queries) {
      const list = (await fetchLrclibJson<LrclibTrack[]>("/search", qParams)) ?? [];
      const synced = list.filter((r) => Boolean(r.syncedLyrics));
      if (synced.length > 0) {
        if (duration > 0) {
          synced.sort(
            (a, b) => Math.abs((a.duration || 0) - duration) - Math.abs((b.duration || 0) - duration)
          );
        }
        const pick = synced[0];
        if (!duration || Math.abs((pick.duration || 0) - duration) <= 12) {
          res.json({
            found: true,
            provider: "lrclib",
            syncedLyrics: pick.syncedLyrics || null,
            plainLyrics: pick.plainLyrics || null,
            title: pick.trackName || track,
            artist: pick.artistName || artist,
            album: pick.albumName || album,
            duration: pick.duration || duration,
          });
          return;
        }
      }
    }

    // 3. Fallback to NetEase synced LRC
    const neQuery = `${clean} ${primaryArtist}`.trim();
    const neHits = await searchNeteaseSynced(neQuery, 3);
    if (neHits.length > 0 && neHits[0].syncedLyrics) {
      res.json({
        found: true,
        provider: "netease",
        syncedLyrics: neHits[0].syncedLyrics,
        plainLyrics: null,
        title: neHits[0].title,
        artist: neHits[0].artist,
        album: neHits[0].album,
        duration: neHits[0].duration || duration,
      });
      return;
    }

    res.json({ found: false, provider: "none", syncedLyrics: null, plainLyrics: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch lyrics";
    res.status(502).json({ error: message, found: false });
  }
});

interface ParsedLrcEntry {
  rawLine: string;
  timestamps: string;
  cleanText: string;
  translatableIndex: number | null;
}

const LINE_TIMESTAMPS_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
const INLINE_WORD_TS_RE = /<\d+:\d+(?:\.\d+)?>/g;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function extractGeminiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "Translation failed";
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // raw is already plain text
  }
  return raw;
}

app.post("/api/lyrics/translate", async (req, res) => {
  const lrc = typeof req.body?.lrc === "string" ? req.body.lrc : "";
  const targetLanguage =
    typeof req.body?.targetLanguage === "string" ? req.body.targetLanguage.trim().slice(0, 60) : "";

  if (!lrc.trim() || lrc.length > 64_000) {
    res.status(400).json({ error: "Provide valid synced LRC lyrics to translate." });
    return;
  }
  if (!targetLanguage) {
    res.status(400).json({ error: "Select a preferred target language." });
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(500).json({
      error: "GEMINI_API_KEY is not configured. Add it in Settings > Secrets to enable translation.",
    });
    return;
  }

  const rawLines = lrc.split(/\r?\n/);
  const entries: ParsedLrcEntry[] = [];
  const itemsToTranslate: { index: number; text: string }[] = [];

  for (const rawLine of rawLines) {
    const match = rawLine.match(LINE_TIMESTAMPS_RE);
    if (match) {
      const timestamps = match[1];
      const body = match[2].replace(INLINE_WORD_TS_RE, "").replace(/\s+/g, " ").trim();
      if (body.length > 0) {
        const idx = itemsToTranslate.length;
        itemsToTranslate.push({ index: idx, text: body });
        entries.push({ rawLine, timestamps, cleanText: body, translatableIndex: idx });
      } else {
        entries.push({ rawLine, timestamps, cleanText: "", translatableIndex: null });
      }
    } else {
      entries.push({ rawLine, timestamps: "", cleanText: "", translatableIndex: null });
    }
  }

  if (itemsToTranslate.length === 0) {
    res.status(400).json({ error: "No timed lyric lines ([mm:ss.xx]) found to translate." });
    return;
  }

  try {
    let responseText = "";
    let lastError: unknown = null;
    const candidateModels = ["gemini-4-hydrogen", "gemini-4-hydrogen", "gemini-3.1-flash-lite"];
    for (let attempt = 0; attempt < candidateModels.length; attempt++) {
      try {
        const model = candidateModels[attempt];
        const response = await ai.models.generateContent({
          model,
          contents: JSON.stringify({
            targetLanguage,
            lines: itemsToTranslate,
          }),
          config: {
            systemInstruction:
              "You are a poetic song lyric translator. Translate each numbered lyric line naturally and singably into the requested targetLanguage while preserving the line's meaning, tone, and concise cadence. Return ONLY a JSON array matching the exact schema with every input index present once.",
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER, description: "Original zero-based line index." },
                  translation: { type: Type.STRING, description: "Translated lyric line text." },
                },
                required: ["index", "translation"],
              },
            },
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        responseText = (response.text ?? "").trim();
        if (responseText) break;
      } catch (err) {
        lastError = err;
        if (attempt < candidateModels.length - 1) {
          await new Promise((r) => setTimeout(r, 450 * Math.pow(2, attempt)));
        }
      }
    }

    if (!responseText) {
      throw lastError instanceof Error ? lastError : new Error("Empty translation response from Gemini");
    }

    const parsed = JSON.parse(responseText) as { index: number; translation: string }[];
    if (!Array.isArray(parsed)) {
      throw new Error("Invalid translation payload returned by Gemini");
    }

    const translatedByIndex = new Map<number, string>();
    for (const item of parsed) {
      if (typeof item?.index === "number" && typeof item?.translation === "string") {
        translatedByIndex.set(item.index, item.translation.replace(/\r?\n/g, " ").trim());
      }
    }

    const rebuiltLines = entries.map((entry) => {
      if (entry.translatableIndex === null) {
        return entry.rawLine;
      }
      const translated = translatedByIndex.get(entry.translatableIndex) || entry.cleanText;
      return `${entry.timestamps} ${translated}`;
    });

    res.json({
      translatedLrc: rebuiltLines.join("\n"),
      translatedCount: translatedByIndex.size,
      totalLines: itemsToTranslate.length,
      targetLanguage,
    });
  } catch (err) {
    res.status(502).json({ error: extractGeminiErrorMessage(err) });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      const indexFile = path.join(distDir, "index.html");
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send("Build not found");
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lumverse Studio server listening on http://localhost:${PORT}`);
  });
}

startServer();

import type { LyricLine, LyricToken, LyricsData } from "../types/lumverse";

const LINE_TS_RE = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
const WORD_TS_RE = /<(\d+):(\d+(?:\.\d+)?)>/g;
const CJK_RANGE = "\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef";
const TOKEN_RE = new RegExp(`[${CJK_RANGE}]|[^\\s${CJK_RANGE}]+`, "g");

function parseTimestamp(minStr: string, secStr: string): number {
  return parseInt(minStr, 10) * 60 + parseFloat(secStr);
}

function tokenWeight(text: string): number {
  // Base character weight + subtle pause bonus for punctuation
  let w = Math.max(1.2, text.length * 0.95);
  if (/[.,;:!?—–-]$/.test(text)) {
    w += 1.4;
  }
  if (/[\u2e80-\u9fff\uac00-\ud7af]/.test(text)) {
    w += 0.9;
  }
  return w;
}

function tokenizeLineSmart(
  rawBody: string,
  lineStart: number,
  lineEnd: number
): { cleanText: string; tokens: LyricToken[]; hasExactTokens: boolean } {
  // Check for Enhanced LRC word tags: <mm:ss.xx>word
  WORD_TS_RE.lastIndex = 0;
  const wordMatches = [...rawBody.matchAll(WORD_TS_RE)];

  if (wordMatches.length >= 2) {
    const segments: { time: number; chunk: string }[] = [];
    const firstIdx = wordMatches[0].index ?? 0;
    const prefix = rawBody.slice(0, firstIdx).trim();
    if (prefix) {
      segments.push({ time: lineStart, chunk: prefix });
    }
    for (let i = 0; i < wordMatches.length; i++) {
      const m = wordMatches[i];
      const t = parseTimestamp(m[1], m[2]);
      const start = (m.index ?? 0) + m[0].length;
      const end = i + 1 < wordMatches.length ? (wordMatches[i + 1].index ?? rawBody.length) : rawBody.length;
      const chunk = rawBody.slice(start, end);
      if (chunk.trim()) {
        segments.push({ time: t, chunk });
      }
    }

    const tokens: LyricToken[] = [];
    const cleanParts: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segStart = seg.time;
      const segEnd = i + 1 < segments.length ? Math.max(segStart + 0.08, segments[i + 1].time) : lineEnd;
      const trimmed = seg.chunk.trim();
      const hasTrailingSpace = /\s$/.test(seg.chunk) || i < segments.length - 1;
      cleanParts.push(trimmed + (hasTrailingSpace ? " " : ""));

      // Split segment in case multiple words sit under one <mm:ss.xx> tag
      const subTokens: { text: string; spaceAfter: boolean }[] = [];
      TOKEN_RE.lastIndex = 0;
      let tm: RegExpExecArray | null;
      while ((tm = TOKEN_RE.exec(trimmed)) !== null) {
        const nextChar = trimmed.slice(tm.index + tm[0].length, tm.index + tm[0].length + 1);
        subTokens.push({
          text: tm[0],
          spaceAfter: nextChar.trim() === "" && (tm.index + tm[0].length < trimmed.length || hasTrailingSpace),
        });
      }

      const weights = subTokens.map((s) => tokenWeight(s.text));
      const totalW = weights.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      const span = Math.max(0.08, segEnd - segStart);
      for (let j = 0; j < subTokens.length; j++) {
        const w = weights[j];
        const t0 = segStart + (span * acc) / totalW;
        const t1 = segStart + (span * (acc + w)) / totalW;
        acc += w;
        tokens.push({
          text: subTokens[j].text,
          spaceAfter: j < subTokens.length - 1 ? true : hasTrailingSpace,
          t0,
          t1,
          exactTimed: true,
        });
      }
    }

    return {
      cleanText: cleanParts.join("").trim(),
      tokens,
      hasExactTokens: true,
    };
  }

  // Standard LRC line: distribute timing using phonetic/punctuation weights
  const cleanText = rawBody.replace(WORD_TS_RE, "").replace(/\s+/g, " ").trim();
  if (!cleanText) {
    return { cleanText: "", tokens: [], hasExactTokens: false };
  }

  const rawTokens: { text: string; spaceAfter: boolean }[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(cleanText)) !== null) {
    const nextChar = cleanText.slice(m.index + m[0].length, m.index + m[0].length + 1);
    rawTokens.push({
      text: m[0],
      spaceAfter: nextChar === " " || nextChar === "\t",
    });
  }

  const weights = rawTokens.map((t) => tokenWeight(t.text));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const span = Math.max(0.25, lineEnd - lineStart);
  let acc = 0;
  const tokens: LyricToken[] = rawTokens.map((rt, idx) => {
    const w = weights[idx];
    const t0 = lineStart + (span * acc) / totalW;
    const t1 = lineStart + (span * (acc + w)) / totalW;
    acc += w;
    return {
      text: rt.text,
      spaceAfter: rt.spaceAfter,
      t0,
      t1,
      exactTimed: false,
    };
  });

  return { cleanText, tokens, hasExactTokens: false };
}

export function parseLrc(lrcText: string, trackDuration = 180): LyricsData | null {
  if (!lrcText || !lrcText.trim()) return null;

  const rows: { t: number; rawBody: string }[] = [];
  let offsetSec = 0;

  for (const rawLine of lrcText.split(/\r?\n/)) {
    const offsetMatch = rawLine.match(/^\[offset:\s*(-?\d+)\s*\]$/i);
    if (offsetMatch) {
      offsetSec = parseInt(offsetMatch[1], 10) / 1000;
      continue;
    }

    LINE_TS_RE.lastIndex = 0;
    const stamps = [...rawLine.matchAll(LINE_TS_RE)];
    if (stamps.length === 0) continue;

    const rawBody = rawLine.replace(LINE_TS_RE, "").trim();
    for (const s of stamps) {
      const t = Math.max(0, parseTimestamp(s[1], s[2]) + offsetSec);
      rows.push({ t, rawBody });
    }
  }

  if (rows.length === 0) {
    return null;
  }

  rows.sort((a, b) => a.t - b.t);

  let isEnhanced = false;
  const lines: LyricLine[] = rows.map((row, idx) => {
    const nextT = idx + 1 < rows.length ? rows[idx + 1].t : row.t + 5.5;
    const cleanLen = row.rawBody.replace(WORD_TS_RE, "").trim().length;
    const guess = row.t + Math.max(1.0, 0.13 * cleanLen + 0.75);
    const t1 = Math.max(row.t + 0.45, Math.min(nextT - 0.06, guess));
    const { cleanText, tokens, hasExactTokens } = tokenizeLineSmart(row.rawBody, row.t, t1);
    if (hasExactTokens) isEnhanced = true;

    return {
      t: row.t,
      t1,
      text: cleanText,
      tokens,
      hasExactTokens,
    };
  });

  return {
    lines,
    starts: lines.map((l) => l.t),
    isEnhanced,
    isPlainFallback: false,
    rawLrc: lrcText,
  };
}

export function parsePlainLyrics(plainText: string, trackDuration = 180): LyricsData | null {
  const rawLines = plainText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length === 0) return null;

  const usableSpan = Math.max(20, trackDuration - 6);
  const startLead = 3.0;
  const step = usableSpan / rawLines.length;

  const lines: LyricLine[] = rawLines.map((text, idx) => {
    const t = startLead + idx * step;
    const t1 = t + Math.max(0.9, step * 0.9);
    const { cleanText, tokens } = tokenizeLineSmart(text, t, t1);
    return {
      t,
      t1,
      text: cleanText,
      tokens,
      hasExactTokens: false,
    };
  });

  return {
    lines,
    starts: lines.map((l) => l.t),
    isEnhanced: false,
    isPlainFallback: true,
    rawLrc: lines
      .map((l) => {
        const mm = String(Math.floor(l.t / 60)).padStart(2, "0");
        const ss = (l.t % 60).toFixed(2).padStart(5, "0");
        return `[${mm}:${ss}] ${l.text}`;
      })
      .join("\n"),
  };
}

export function findLineIndexAt(lyrics: LyricsData | null, t: number): number {
  if (!lyrics || lyrics.starts.length === 0) return -1;
  const starts = lyrics.starts;
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo - 1;
}

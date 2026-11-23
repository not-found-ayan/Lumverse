import type { AudioAnalysis, GenreTheme, ResolvedGenre } from "../types/lumverse";

const ID3V1_GENRE_HINTS: Record<string, ResolvedGenre> = {
  "7": "hiphop", // Hip-Hop
  "8": "lofi", // Jazz
  "14": "romantic", // R&B
  "17": "rock", // Rock
  "18": "electronic", // Techno
  "20": "rock", // Alternative
  "22": "rock", // Death Metal
  "24": "classical", // Soundtrack
  "26": "lofi", // Ambient
  "31": "electronic", // Trance
  "32": "classical", // Classical
  "35": "electronic", // House
  "40": "rock", // AlternRock
  "52": "electronic", // Electronic
  "80": "folk", // Folk
  "81": "folk", // Folk-Rock
  "99": "folk", // Acoustic
};

const KEYWORD_RULES: { genre: ResolvedGenre; pattern: RegExp }[] = [
  {
    genre: "romantic",
    pattern:
      /\b(romance|romantic|r&b|soul|ballad|love|heart|hearts|kiss|forever|darling|lover|valentine|crush|affection|tenderness|embrace|pyaar|ishq|dil|mohabbat|tera|meri|jaan|tum|爱|恋|사랑)\b/i,
  },
  {
    genre: "folk",
    pattern:
      /\b(folk|indie[\s-]?folk|country|americana|bluegrass|celtic|singer[\s-]?songwriter|acoustic|banjo|mandolin|fiddle|campfire|meadow|forest|autumn|leaves|woods)\b/i,
  },
  {
    genre: "hiphop",
    pattern:
      /\b(hip[\s-]?hop|rap|trap|phonk|drill|boom[\s-]?bap|grime|bass|808|ft\.|feat\.|cypher|flex|drip)\b/i,
  },
  {
    genre: "electronic",
    pattern:
      /\b(electronic|edm|synthwave|synth|techno|house|trance|dubstep|dnb|drum\s*&?\s*bass|cyber|electro|club|remix|hyperpop|rave|neon)\b/i,
  },
  {
    genre: "lofi",
    pattern:
      /\b(lo[\s-]?fi|lofi|chill|jazz|ambient|study|rain|bossa|downtempo|sleep|midnight|coffee|rainy|calm|soft|dream)\b/i,
  },
  {
    genre: "rock",
    pattern:
      /\b(rock|metal|punk|grunge|alternative|indie\s*rock|hardcore|thrash|emo|guitar|distort|riot|scream|thunder|lightning|electric)\b/i,
  },
  {
    genre: "classical",
    pattern:
      /\b(classical|orchestra|symphony|concerto|sonata|piano|violin|cello|nocturne|waltz|baroque|cinematic|score|soundtrack)\b/i,
  },
];

export function resolveGenreTheme(
  mode: GenreTheme,
  title: string,
  artist: string,
  album: string,
  trackGenre: string | undefined,
  lrcText: string,
  audio: AudioAnalysis
): ResolvedGenre {
  if (mode !== "auto") return mode;

  // 1. Explicit track genre tag (ID3 TCON / MPRIS xesam:genre) takes priority
  if (trackGenre) {
    const id3Num = trackGenre.match(/^\(?(\d+)\)?$/)?.[1];
    if (id3Num && ID3V1_GENRE_HINTS[id3Num]) {
      return ID3V1_GENRE_HINTS[id3Num];
    }
    for (const rule of KEYWORD_RULES) {
      if (rule.pattern.test(trackGenre)) return rule.genre;
    }
  }

  // 2. Title, artist, album, and lyric content scan (sample first 1400 chars of LRC)
  const sampleText = `${title} ${artist} ${album} ${lrcText.slice(0, 1400)}`;
  let bestGenre: ResolvedGenre | null = null;
  let bestHits = 0;

  for (const rule of KEYWORD_RULES) {
    const globalRe = new RegExp(rule.pattern.source, "gi");
    const matches = sampleText.match(globalRe);
    if (matches && matches.length > bestHits) {
      bestHits = matches.length;
      bestGenre = rule.genre;
    }
  }
  if (bestGenre) return bestGenre;

  // 3. Live audio DSP heuristic fallback
  if (audio.isLiveAudio) {
    if (audio.subBass > 0.55 && audio.flux > 0.35) return "hiphop";
    if (audio.midEnergy > 0.52 && audio.trebleEnergy > 0.45 && audio.flux > 0.3) return "rock";
    if (audio.trebleEnergy > 0.48 && audio.flux > 0.25) return "electronic";
    if (audio.midEnergy > 0.38 && audio.subBass < 0.35) return "romantic";
  }

  return "lofi";
}

import type { PaletteColors } from "../types/lumverse";

export type RGB = [number, number, number]; // normalized 0..1

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const bright = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (bright + 0.05) / (dark + 0.05);
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, v];
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function lighten(c: RGB, k = 0.45): RGB {
  return [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k];
}

export function darken(c: RGB, k = 0.45): RGB {
  return [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)];
}

export function rgbCss(c: RGB, alpha = 1): string {
  const r = Math.round(clamp01(c[0]) * 255);
  const g = Math.round(clamp01(c[1]) * 255);
  const b = Math.round(clamp01(c[2]) * 255);
  return alpha >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2);
  return Math.min(d, 1 - d);
}

function ensureVibrant(rgb: RGB, minV = 0.65): RGB {
  const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  return hsvToRgb(h, Math.max(s, 0.35), Math.max(v, minV));
}

export function buildContrastPalette(c1: RGB, c2: RGB): PaletteColors {
  const primary = ensureVibrant(c1, 0.72);
  const secondary = ensureVibrant(c2, 0.66);
  const accent = lighten(mixRgb(primary, secondary, 0.35), 0.32);
  const shadow = darken(secondary, 0.52);

  const darkInk: RGB = [0.04, 0.045, 0.055];
  const lightInk: RGB = [0.97, 0.975, 0.99];

  // Try primary as card surface; boost luminance slightly if needed for crisp readability
  let cardBg: RGB = [...primary] as RGB;
  const darkCr = contrastRatio(cardBg, darkInk);
  const lightCr = contrastRatio(cardBg, lightInk);

  let cardInk: RGB = darkInk;
  let finalRatio = darkCr;

  if (darkCr >= 4.8) {
    cardInk = darkInk;
    finalRatio = darkCr;
  } else if (lightCr >= 4.8) {
    cardInk = lightInk;
    finalRatio = lightCr;
  } else {
    // Mid-luminance color: nudge brighter to guarantee crisp neo-brutalist dark ink contrast
    for (let step = 0.15; step <= 0.75; step += 0.15) {
      const candidate = lighten(primary, step);
      const cr = contrastRatio(candidate, darkInk);
      if (cr >= 5.2) {
        cardBg = candidate;
        cardInk = darkInk;
        finalRatio = cr;
        break;
      }
    }
  }

  return {
    primary,
    secondary,
    accent,
    cardBg,
    cardInk,
    shadow,
    contrastRatio: finalRatio,
  };
}

export function extractPaletteFromImage(img: HTMLImageElement): PaletteColors {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return buildContrastPalette([0.0, 0.96, 0.56], [0.0, 0.72, 1.0]);
  }

  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  interface Bucket {
    r: number;
    g: number;
    b: number;
    w: number;
    hue: number;
  }

  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const [h, s, v] = rgbToHsv(r, g, b);
    if (v < 0.18 || s < 0.18) continue;

    // 24 hue bins x 2 lightness tiers for finer separation than original 12-bin histogram
    const hueBin = Math.floor(h * 24) % 24;
    const lightTier = v > 0.58 ? 1 : 0;
    const key = hueBin * 2 + lightTier;

    const weight = Math.pow(s, 1.35) * Math.pow(v, 0.9);
    const existing = buckets.get(key);
    if (existing) {
      existing.r += r * weight;
      existing.g += g * weight;
      existing.b += b * weight;
      existing.w += weight;
    } else {
      buckets.set(key, {
        r: r * weight,
        g: g * weight,
        b: b * weight,
        w: weight,
        hue: h,
      });
    }
  }

  if (buckets.size === 0) {
    return buildContrastPalette([0.88, 0.9, 0.96], [0.42, 0.52, 0.72]);
  }

  const ranked = Array.from(buckets.values()).sort((a, b) => b.w - a.w);
  const toNorm = (b: Bucket): RGB => {
    const r = b.r / b.w;
    const g = b.g / b.w;
    const bl = b.b / b.w;
    const mx = Math.max(r, g, bl) || 1;
    return [r / mx, g / mx, bl / mx];
  };

  const c1 = toNorm(ranked[0]);
  const [h1] = rgbToHsv(c1[0], c1[1], c1[2]);

  // Pick a second color with meaningful hue separation (>= 0.10 on the color wheel)
  let c2: RGB | null = null;
  for (let i = 1; i < ranked.length; i++) {
    const cand = toNorm(ranked[i]);
    const [h2] = rgbToHsv(cand[0], cand[1], cand[2]);
    if (hueDistance(h1, h2) >= 0.1) {
      c2 = cand;
      break;
    }
  }

  if (!c2) {
    if (ranked.length > 1) {
      c2 = toNorm(ranked[1]);
    } else {
      const [hh, ss, vv] = rgbToHsv(c1[0], c1[1], c1[2]);
      c2 = hsvToRgb((hh + 0.11) % 1, ss, vv);
    }
  }

  return buildContrastPalette(c1, c2);
}

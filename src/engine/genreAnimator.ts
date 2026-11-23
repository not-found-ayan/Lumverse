import type { AudioAnalysis, PaletteColors, ResolvedGenre } from "../types/lumverse";
import { clamp01, lighten, mixRgb, rgbCss, type RGB } from "./palette";

interface GenreParticle {
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vRot: number;
  age: number;
  maxAge: number;
  seed: number;
  variant: number;
}

interface LightningArc {
  points: { x: number; y: number }[];
  branch?: { x: number; y: number }[];
  age: number;
  maxAge: number;
}

function easeOutBack(x: number): number {
  const c = clamp01(x);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

function drawHeartPath(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.35);
  ctx.bezierCurveTo(-r * 0.1, -r * 0.1, -r * 0.95, -r * 0.15, -r * 0.95, r * 0.42);
  ctx.bezierCurveTo(-r * 0.95, r * 0.85, -r * 0.35, r * 1.15, 0, r * 1.42);
  ctx.bezierCurveTo(r * 0.35, r * 1.15, r * 0.95, r * 0.85, r * 0.95, r * 0.42);
  ctx.bezierCurveTo(r * 0.95, -r * 0.15, r * 0.1, -r * 0.1, 0, r * 0.35);
  ctx.closePath();
}

function drawBloomingFlower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  bloom: number, // 0..1
  rot: number,
  petals: number,
  petalCol: RGB,
  coreCol: RGB,
  alpha: number
): void {
  const b = easeOutBack(bloom);
  if (b <= 0.02 || alpha <= 0.01) return;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.65 * b);
  halo.addColorStop(0, rgbCss(petalCol, 0.28 * alpha));
  halo.addColorStop(1, rgbCss(petalCol, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.65 * b, 0, Math.PI * 2);
  ctx.fill();

  const spread = 0.38 + 0.62 * b;
  const petalLen = radius * (0.45 + 0.65 * b);
  const petalW = radius * 0.42 * spread;

  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-petalW, -petalLen * 0.45, -petalW * 0.85, -petalLen, 0, -petalLen);
    ctx.bezierCurveTo(petalW * 0.85, -petalLen, petalW, -petalLen * 0.45, 0, 0);
    ctx.closePath();

    const pg = ctx.createLinearGradient(0, 0, 0, -petalLen);
    pg.addColorStop(0, rgbCss(lighten(petalCol, 0.35), 0.88 * alpha));
    pg.addColorStop(1, rgbCss(petalCol, 0.58 * alpha));
    ctx.fillStyle = pg;
    ctx.fill();

    ctx.lineWidth = Math.max(0.8, radius * 0.045);
    ctx.strokeStyle = rgbCss(lighten(petalCol, 0.55), 0.72 * alpha);
    ctx.stroke();
    ctx.restore();
  }

  const coreR = Math.max(2, radius * 0.22 * b);
  ctx.fillStyle = rgbCss(coreCol, 0.95 * alpha);
  ctx.beginPath();
  ctx.arc(0, 0, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawVeinedLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  rot: number,
  twist: number,
  color: RGB,
  alpha: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(0.45 + 0.55 * Math.abs(Math.cos(twist)), 1);

  ctx.beginPath();
  ctx.moveTo(0, -len);
  ctx.bezierCurveTo(len * 0.68, -len * 0.35, len * 0.62, len * 0.45, 0, len);
  ctx.bezierCurveTo(-len * 0.62, len * 0.45, -len * 0.68, -len * 0.35, 0, -len);
  ctx.closePath();

  const lg = ctx.createLinearGradient(0, -len, 0, len);
  lg.addColorStop(0, rgbCss(lighten(color, 0.25), 0.76 * alpha));
  lg.addColorStop(1, rgbCss(color, 0.54 * alpha));
  ctx.fillStyle = lg;
  ctx.fill();

  // Midrib + delicate lateral veins
  ctx.strokeStyle = rgbCss(lighten(color, 0.48), 0.68 * alpha);
  ctx.lineWidth = Math.max(0.8, len * 0.055);
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.88);
  ctx.lineTo(0, len * 1.15); // short stem tail
  for (const vy of [-0.35, 0.05, 0.42]) {
    ctx.moveTo(0, len * vy);
    ctx.lineTo(len * 0.3, len * (vy - 0.22));
    ctx.moveTo(0, len * vy);
    ctx.lineTo(-len * 0.3, len * (vy - 0.22));
  }
  ctx.stroke();

  ctx.restore();
}

function drawFourPointStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  color: RGB,
  alpha: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const ox = Math.cos(a) * r;
    const oy = Math.sin(a) * r;
    const ix = Math.cos(a + Math.PI / 4) * (r * 0.24);
    const iy = Math.sin(a + Math.PI / 4) * (r * 0.24);
    if (i === 0) ctx.moveTo(ox, oy);
    else ctx.lineTo(ox, oy);
    ctx.lineTo(ix, iy);
  }
  ctx.closePath();
  ctx.fillStyle = rgbCss(color, alpha);
  ctx.fill();
  ctx.restore();
}

export class GenreSceneAnimator {
  private particles: GenreParticle[] = [];
  private arcs: LightningArc[] = [];
  private activeGenre: ResolvedGenre = "lofi";
  private spawnAccum = 0;
  private lastBeatSpawn = 0;
  private lastBoltTime = 0;

  private resetForGenre(genre: ResolvedGenre): void {
    this.activeGenre = genre;
    this.particles = [];
    this.arcs = [];
    const initialCount =
      genre === "romantic" ? 22 : genre === "folk" || genre === "lofi" ? 28 : 22;
    for (let i = 0; i < initialCount; i++) {
      this.spawnParticle(genre, Math.random() * 0.7);
    }
  }

  private pickPeripheralX(): number {
    const r = Math.random();
    if (r < 0.35) return 0.04 + Math.random() * 0.24;
    if (r < 0.7) return 0.72 + Math.random() * 0.24;
    return 0.1 + Math.random() * 0.8;
  }

  private spawnParticle(genre: ResolvedGenre, ageFraction = 0): void {
    if (this.particles.length >= 54) return;
    const maxAge =
      genre === "romantic" || genre === "folk"
        ? 5.8 + Math.random() * 3.5
        : genre === "lofi" || genre === "classical"
        ? 5.8 + Math.random() * 3.5
        : 2.2 + Math.random() * 1.8;

    let x = this.pickPeripheralX();
    let y = 0.85 + Math.random() * 0.16;
    let vx = (Math.random() - 0.5) * 0.018;
    let vy = -(0.045 + Math.random() * 0.04);
    let size = 16 + Math.random() * 18;
    let variant = 0;

    if (genre === "romantic") {
      variant = Math.random() < 0.45 ? 0 : 1; // 0 = blooming flower, 1 = rising heart
      if (variant === 0) {
        x = Math.random() < 0.5 ? 0.06 + Math.random() * 0.24 : 0.7 + Math.random() * 0.24;
        y = 0.14 + Math.random() * 0.68;
        vx = (Math.random() - 0.5) * 0.008;
        vy = -(0.006 + Math.random() * 0.008);
        size = 20 + Math.random() * 20;
      } else {
        x = this.pickPeripheralX();
        y = 0.92 + Math.random() * 0.1;
        vy = -(0.055 + Math.random() * 0.045);
        size = 12 + Math.random() * 13;
      }
    } else if (genre === "folk") {
      variant = Math.random() < 0.74 ? 0 : 1; // 0 = drifting veined leaf, 1 = warm golden mote
      if (variant === 0) {
        x = Math.random() * 1.1 - 0.08;
        y = -0.06 - Math.random() * 0.12;
        vx = 0.022 + Math.random() * 0.032;
        vy = 0.05 + Math.random() * 0.04;
        size = 13 + Math.random() * 13;
      } else {
        x = Math.random();
        y = 0.2 + Math.random() * 0.75;
        vx = (Math.random() - 0.5) * 0.016;
        vy = -(0.015 + Math.random() * 0.02);
        size = 3 + Math.random() * 4;
      }
    } else if (genre === "electronic") {
      variant = Math.random() < 0.65 ? 0 : 1;
      x = Math.random();
      y = Math.random();
      const ang = Math.random() * Math.PI * 2;
      const spd = 0.05 + Math.random() * 0.07;
      vx = Math.cos(ang) * spd;
      vy = Math.sin(ang) * spd;
      size = 10 + Math.random() * 16;
    } else if (genre === "hiphop") {
      variant = Math.random() < 0.25 ? 0 : 1;
      x = variant === 0 ? (Math.random() < 0.5 ? 0.14 : 0.86) : Math.random();
      y = variant === 0 ? (Math.random() < 0.5 ? 0.22 : 0.78) : 0.96;
      vx = variant === 0 ? 0 : (Math.random() - 0.5) * 0.05;
      vy = variant === 0 ? 0 : -(0.14 + Math.random() * 0.16);
      size = variant === 0 ? 24 : 4 + Math.random() * 5;
    } else if (genre === "lofi") {
      variant = Math.random() < 0.45 ? 0 : Math.random() < 0.75 ? 1 : 2;
      if (variant === 2) {
        x = Math.random();
        y = -0.05;
        vx = -0.04;
        vy = 0.36 + Math.random() * 0.18;
        size = 18 + Math.random() * 16;
      } else if (variant === 1) {
        x = Math.random();
        y = -0.05;
        vx = 0.025 + Math.random() * 0.025;
        vy = 0.04 + Math.random() * 0.03;
        size = 10 + Math.random() * 8;
      } else {
        x = Math.random();
        y = Math.random();
        vx = (Math.random() - 0.5) * 0.015;
        vy = -0.012 + (Math.random() - 0.5) * 0.01;
        size = 5 + Math.random() * 7;
      }
    } else if (genre === "rock") {
      x = Math.random() < 0.5 ? 0.04 + Math.random() * 0.22 : 0.74 + Math.random() * 0.22;
      y = Math.random();
      vx = (x < 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.14);
      vy = (Math.random() - 0.5) * 0.15;
      size = 4 + Math.random() * 5;
    } else {
      x = Math.random();
      y = Math.random();
      vx = (Math.random() - 0.5) * 0.012;
      vy = -(0.015 + Math.random() * 0.02);
      size = 7 + Math.random() * 10;
    }

    this.particles.push({
      x,
      y,
      vx,
      vy,
      size,
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.9,
      age: ageFraction * maxAge,
      maxAge,
      seed: Math.random() * 100,
      variant,
    });
  }

  private spawnLightning(w: number, h: number): void {
    if (this.arcs.length >= 7) return;
    const fromLeft = Math.random() < 0.5;
    let x = fromLeft ? 0 : w;
    let y = h * (0.1 + Math.random() * 0.8);
    const pts = [{ x, y }];
    let branch: { x: number; y: number }[] | undefined;
    const steps = 6 + Math.floor(Math.random() * 4);
    const dirX = fromLeft ? 1 : -1;
    for (let i = 0; i < steps; i++) {
      x += dirX * (w * (0.03 + Math.random() * 0.04));
      y += (Math.random() - 0.5) * (h * 0.1);
      pts.push({ x, y });
      if (i === 2 && Math.random() < 0.75) {
        let bx = x;
        let by = y;
        branch = [{ x: bx, y: by }];
        for (let b = 0; b < 3; b++) {
          bx += dirX * (w * (0.02 + Math.random() * 0.025));
          by += (Math.random() > 0.5 ? 1 : -1) * (h * (0.04 + Math.random() * 0.05));
          branch.push({ x: bx, y: by });
        }
      }
    }
    this.arcs.push({ points: pts, branch, age: 0, maxAge: 0.28 });
  }

  public stepAndDraw(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dt: number,
    timeSec: number,
    genre: ResolvedGenre,
    palette: PaletteColors,
    audio: AudioAnalysis,
    playing: boolean
  ): void {
    if (genre !== this.activeGenre) {
      this.resetForGenre(genre);
    }

    const energyBoost = playing ? 0.65 + audio.midEnergy * 0.9 + audio.beat * 1.1 : 0.3;
    const spawnRate =
      genre === "romantic"
        ? 3.2 * energyBoost
        : genre === "folk" || genre === "lofi" || genre === "classical"
        ? 4.4 * energyBoost
        : 6.5 * energyBoost;

    this.spawnAccum += dt * spawnRate;
    while (this.spawnAccum >= 1) {
      this.spawnAccum -= 1;
      this.spawnParticle(genre, 0);
    }

    if (genre === "rock") {
      const boltCooldown = playing ? (audio.beat > 0.35 ? 0.18 : 0.75) : 1.6;
      if (timeSec - this.lastBoltTime > boltCooldown) {
        this.lastBoltTime = timeSec;
        this.spawnLightning(w, h);
      }
    }

    if (playing && audio.beat > 0.42 && timeSec - this.lastBeatSpawn > 0.18) {
      this.lastBeatSpawn = timeSec;
      if (genre === "romantic" || genre === "hiphop" || genre === "electronic" || genre === "folk") {
        this.spawnParticle(genre, 0);
        this.spawnParticle(genre, 0);
      }
    }

    const S = Math.max(0.55, h / 1080);

    ctx.save();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.particles.splice(i, 1);
        continue;
      }

      const life = p.age / p.maxAge;
      const fadeIn = clamp01(life / 0.16);
      const fadeOut = clamp01((1 - life) / 0.22);
      const alpha = fadeIn * fadeOut * (playing ? 0.88 : 0.48);

      const speedMult = 1 + (playing ? audio.beat * 0.9 + audio.subBass * 0.4 : 0);
      p.x += p.vx * dt * speedMult;
      p.y += p.vy * dt * speedMult;
      p.rot += p.vRot * dt;

      const px = p.x * w;
      const py = p.y * h;

      if (genre === "romantic") {
        const rose: RGB = [0.98, 0.34, 0.52];
        const blush: RGB = [1.0, 0.62, 0.72];
        const gold: RGB = [1.0, 0.84, 0.48];
        const flowerCol = mixRgb(palette.primary, p.seed > 50 ? rose : blush, 0.68);

        if (p.variant === 0) {
          const bloomPhase = clamp01(life / 0.42);
          const beatScale = 1 + audio.beat * 0.2 + audio.midEnergy * 0.12;
          const petals = p.seed > 50 ? 6 : 5;
          drawBloomingFlower(
            ctx,
            px,
            py,
            p.size * S * beatScale,
            bloomPhase,
            p.rot,
            petals,
            flowerCol,
            gold,
            alpha * 0.88
          );
        } else {
          const sway = Math.sin(timeSec * 2.1 + p.seed) * 14 * S;
          const hr = p.size * S * (0.88 + audio.beat * 0.28 + Math.sin(timeSec * 4 + p.seed) * 0.06);
          const heartCol = mixRgb(rose, palette.accent, 0.3);
          ctx.save();
          ctx.translate(px + sway, py - hr * 0.6);
          ctx.rotate(Math.sin(timeSec * 1.4 + p.seed) * 0.18);
          ctx.shadowColor = rgbCss(heartCol, 0.55 * alpha);
          ctx.shadowBlur = 14 * S;
          drawHeartPath(ctx, hr);
          ctx.fillStyle = rgbCss(heartCol, 0.72 * alpha);
          ctx.fill();
          ctx.lineWidth = Math.max(1, 1.5 * S);
          ctx.strokeStyle = rgbCss(lighten(heartCol, 0.45), 0.9 * alpha);
          ctx.stroke();
          ctx.restore();
        }
      } else if (genre === "folk") {
        if (p.variant === 0) {
          const amber: RGB = [0.92, 0.56, 0.24];
          const sage: RGB = [0.46, 0.78, 0.52];
          const rust: RGB = [0.85, 0.35, 0.26];
          const baseLeaf = p.seed < 33 ? amber : p.seed < 66 ? sage : rust;
          const leafCol = mixRgb(baseLeaf, palette.primary, 0.25);
          const windX = Math.sin(timeSec * 1.3 + p.seed) * 18 * S;
          drawVeinedLeaf(
            ctx,
            px + windX,
            py,
            p.size * S,
            p.rot,
            timeSec * 1.8 + p.seed,
            leafCol,
            alpha * 0.88
          );
        } else {
          const moteCol = mixRgb([1.0, 0.84, 0.48], palette.accent, 0.35);
          const glow = 0.5 + 0.5 * Math.sin(timeSec * 3.0 + p.seed);
          ctx.fillStyle = rgbCss(moteCol, alpha * glow);
          ctx.beginPath();
          ctx.arc(px, py, p.size * S, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (genre === "electronic") {
        const col = p.seed > 50 ? palette.primary : palette.secondary;
        const r = p.size * S * (1 + audio.beat * 0.3);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(p.rot);
        ctx.strokeStyle = rgbCss(lighten(col, 0.25), alpha * 0.85);
        ctx.lineWidth = Math.max(1.2, 2 * S);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.65, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.65, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      } else if (genre === "hiphop") {
        if (p.variant === 0) {
          const ringR = (p.size + life * 170) * S;
          ctx.strokeStyle = rgbCss(palette.primary, (1 - life) * 0.55 * alpha);
          ctx.lineWidth = Math.max(1.5, 3 * S * (1 - life));
          ctx.beginPath();
          ctx.arc(px, py, ringR, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const emberCol = mixRgb(palette.primary, [1.0, 0.48, 0.16], 0.55);
          ctx.fillStyle = rgbCss(emberCol, alpha);
          ctx.shadowColor = rgbCss(emberCol, 0.7);
          ctx.shadowBlur = 8 * S;
          ctx.beginPath();
          ctx.arc(px, py, p.size * S, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      } else if (genre === "lofi") {
        if (p.variant === 2) {
          ctx.strokeStyle = rgbCss(lighten(palette.secondary, 0.4), alpha * 0.35);
          ctx.lineWidth = Math.max(1, 1.3 * S);
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - 5 * S, py + p.size * S);
          ctx.stroke();
        } else if (p.variant === 1) {
          const leafCol = mixRgb(palette.primary, [0.45, 0.88, 0.62], 0.45);
          drawVeinedLeaf(
            ctx,
            px + Math.sin(timeSec * 1.5 + p.seed) * 12 * S,
            py,
            p.size * S,
            p.rot,
            timeSec + p.seed,
            leafCol,
            alpha * 0.68
          );
        } else {
          const glow = 0.5 + 0.5 * Math.sin(timeSec * 3.5 + p.seed);
          const fCol = mixRgb(palette.accent, [1.0, 0.86, 0.45], 0.5);
          const fr = p.size * S * (0.8 + glow * 0.4);
          const rg = ctx.createRadialGradient(px, py, 0, px, py, fr * 2.2);
          rg.addColorStop(0, rgbCss(fCol, alpha * glow));
          rg.addColorStop(1, rgbCss(fCol, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.arc(px, py, fr * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (genre === "rock") {
        const sparkCol = mixRgb(palette.primary, [1.0, 0.35, 0.25], 0.5);
        ctx.strokeStyle = rgbCss(lighten(sparkCol, 0.4), alpha);
        ctx.lineWidth = Math.max(1.5, 2 * S);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - p.vx * 35 * S, py - p.vy * 35 * S);
        ctx.stroke();
      } else {
        const twinkle = 0.45 + 0.55 * Math.sin(timeSec * 3.2 + p.seed);
        const starCol = mixRgb([1.0, 0.88, 0.55], palette.accent, 0.35);
        drawFourPointStar(ctx, px, py, p.size * S * twinkle, p.rot, starCol, alpha * 0.9);
      }
    }

    if (genre === "rock") {
      for (let i = this.arcs.length - 1; i >= 0; i--) {
        const arc = this.arcs[i];
        arc.age += dt;
        if (arc.age >= arc.maxAge) {
          this.arcs.splice(i, 1);
          continue;
        }
        const a = 1 - arc.age / arc.maxAge;
        const boltCol = mixRgb(palette.primary, [0.55, 0.85, 1.0], 0.45);
        ctx.beginPath();
        arc.points.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.strokeStyle = rgbCss(lighten(boltCol, 0.65), a * 0.95);
        ctx.lineWidth = Math.max(2, 3.2 * S);
        ctx.shadowColor = rgbCss(boltCol, a);
        ctx.shadowBlur = 18 * S;
        ctx.stroke();

        if (arc.branch) {
          ctx.beginPath();
          arc.branch.forEach((pt, idx) => {
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.lineWidth = Math.max(1.2, 2 * S);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      }
    }

    if (genre === "classical") {
      const gold: RGB = mixRgb([0.98, 0.84, 0.5], palette.accent, 0.4);
      for (let r = 0; r < 2; r++) {
        const baseY = r === 0 ? h * 0.16 : h * 0.84;
        ctx.beginPath();
        for (let i = 0; i <= 32; i++) {
          const u = i / 32;
          const x = u * w;
          const y =
            baseY +
            Math.sin(u * Math.PI * 3 + timeSec * (r === 0 ? 0.9 : -0.8)) *
              (22 + audio.midEnergy * 42) *
              S;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgbCss(gold, playing ? 0.32 : 0.14);
        ctx.lineWidth = Math.max(1.5, 2.2 * S);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

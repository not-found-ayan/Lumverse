import type { LumverseConfig } from "../types/lumverse";
import { FONT_PRESETS } from "./presets";

export interface GeneratedPythonBundle {
  configJson: string;
  scenePy: string;
  lyricsPy: string;
  lumversePy: string;
  upgrades: { title: string; before: string; after: string }[];
}

export function generatePythonBundle(config: LumverseConfig): GeneratedPythonBundle {
  const fontString =
    FONT_PRESETS.find((f) => f.id === config.fontPreset)?.pythonFont ??
    "Bricolage Grotesque, Inter, Noto Sans, Sans";

  const configObj = {
    thickness: config.thickness,
    max_alpha: Number(config.maxAlpha.toFixed(2)),
    fps: config.fps,
    rim: config.rim,
    glow_mode: config.glowMode,
    viz_mode: config.vizMode,
    viz_always: config.vizAlways,
    genre_mode: config.genreMode,
    genre_effects: config.genreEffectsEnabled,
    beat: config.beatReactive,
    beat_sensitivity: Number(config.beatSensitivity.toFixed(2)),
    lyrics: config.lyricsEnabled,
    style: config.style,
    uppercase: config.uppercase,
    font: fontString,
    lyrics_offset: Number(config.lyricsOffset.toFixed(2)),
    card: config.cardVisibility,
    card_style: config.cardStyle,
    card_seconds: config.cardSeconds,
    idle_color1: config.idleColor1,
    idle_color2: config.idleColor2,
  };

  const configJson = JSON.stringify(configObj, null, 2);

  const scenePy = `"""lumverse scene v2.2: perceptual palette, multi-band glow, genre worlds & 4-mode procedural visualizer."""
import colorsys
import io
import json
import math
import os
import random
import re
import time

import cairo
import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango  # noqa: E402

import lyrics as ly  # noqa: E402

try:
    from PIL import Image
except ImportError:
    Image = None

# ---------------------------------------------------------------- config ----
CFG = {
    "thickness": ${config.thickness},
    "max_alpha": ${config.maxAlpha.toFixed(2)},
    "fps": ${config.fps},
    "rim": ${config.rim ? "True" : "False"},
    "glow_mode": "${config.glowMode}",        # aurora | prism | vignette | hairline
    "viz_mode": "${config.vizMode}",          # orbital | terrain | oscilloscope | turbine
    "viz_always": ${config.vizAlways ? "True" : "False"},
    "genre_mode": "${config.genreMode}",      # auto | romantic | electronic | hiphop | lofi | rock | classical
    "genre_effects": ${config.genreEffectsEnabled ? "True" : "False"},
    "beat": ${config.beatReactive ? "True" : "False"},
    "beat_sensitivity": ${config.beatSensitivity.toFixed(2)},
    "lyrics": ${config.lyricsEnabled ? "True" : "False"},
    "style": "${config.style}",               # wipe | slam | burst | code | cascade | echo | ribbon
    "uppercase": ${config.uppercase ? "True" : "False"},
    "font": "${fontString}",
    "lyrics_offset": ${config.lyricsOffset.toFixed(2)},
    "card": "${config.cardVisibility}",       # always | onchange | off
    "card_style": "${config.cardStyle}",      # poster | glass | minimal
    "card_seconds": ${config.cardSeconds},
    "idle_color1": [${config.idleColor1.join(", ")}],
    "idle_color2": [${config.idleColor2.join(", ")}],
}


def load_config():
    path = os.path.join(os.path.expanduser("~/.config/lumverse"), "config.json")
    try:
        with open(path) as f:
            CFG.update(json.load(f))
    except (OSError, ValueError):
        pass


# ------------------------------------------------------- contrast & color ---
def _srgb_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _luminance(rgb):
    r, g, b = (_srgb_lin(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _contrast(a, b):
    la, lb = _luminance(a), _luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def _hue_dist(h1, h2):
    d = abs(h1 - h2)
    return min(d, 1.0 - d)


def _ensure_vibrant(rgb, min_v=0.68):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    return colorsys.hsv_to_rgb(h, max(s, 0.35), max(v, min_v))


def palette_and_thumb(data):
    """Perceptual 24-bin hue/lightness extractor with WCAG-safe card ink."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    thumb = img.resize((240, 240))
    raw = img.resize((64, 64)).tobytes()
    buckets = {}
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if v < 0.18 or s < 0.18:
            continue
        key = (int(hh * 24) % 24) * 2 + (1 if v > 0.58 else 0)
        wt = (s ** 1.35) * (v ** 0.9)
        acc = buckets.setdefault(key, [0.0, 0.0, 0.0, 0.0])
        acc[0] += r * wt
        acc[1] += g * wt
        acc[2] += b * wt
        acc[3] += wt

    def norm(a):
        r, g, b = a[0] / a[3], a[1] / a[3], a[2] / a[3]
        m = max(r, g, b) or 1.0
        return (r / m, g / m, b / m)

    if not buckets:
        c1, c2 = (0.88, 0.90, 0.96), (0.42, 0.52, 0.72)
    else:
        ranked = sorted(buckets.values(), key=lambda a: a[3], reverse=True)
        c1 = _ensure_vibrant(norm(ranked[0]), 0.72)
        h1 = colorsys.rgb_to_hsv(*c1)[0]
        c2 = None
        for b in ranked[1:]:
            cand = norm(b)
            if _hue_dist(h1, colorsys.rgb_to_hsv(*cand)[0]) >= 0.10:
                c2 = _ensure_vibrant(cand, 0.66)
                break
        if c2 is None:
            c2 = _ensure_vibrant(norm(ranked[1]), 0.66) if len(ranked) > 1 else colorsys.hsv_to_rgb((h1 + 0.11) % 1.0, 0.7, 0.85)

    dark_ink, light_ink = (0.04, 0.045, 0.055), (0.97, 0.975, 0.99)
    card_bg = c1
    card_ink = dark_ink if _contrast(card_bg, dark_ink) >= 4.8 else (
        light_ink if _contrast(card_bg, light_ink) >= 4.8 else dark_ink
    )
    if _contrast(card_bg, card_ink) < 4.8:
        for k in (0.2, 0.4, 0.6):
            cand = ly.lighten(c1, k)
            if _contrast(cand, dark_ink) >= 5.0:
                card_bg, card_ink = cand, dark_ink
                break
    return c1, c2, card_bg, card_ink, thumb


# ----------------------------------------------------------------- state ----
class State:
    def __init__(self):
        self.c1, self.c2 = list(CFG["idle_color1"]), list(CFG["idle_color2"])
        self.t1, self.t2 = list(self.c1), list(self.c2)
        self.card_bg = list(self.c1)
        self.t_card_bg = list(self.c1)
        self.card_ink = (0.04, 0.045, 0.055)
        self.level = self.t_level = 0.25
        self.beat = 0.0
        self.sub = 0.0
        self.mid = 0.0
        self.treble = 0.0
        self.bands = [0.0] * 32
        self.bands_t = 0.0
        self.bands_disp = [0.0] * 32
        self.peaks = [0.0] * 16
        self.title = self.artist = self.album = self.genre = ""
        self.length = 0.0
        self.track_key = None
        self.art_url = None
        self.art_surface = None
        self._art_buf = None
        self.lyrics = None
        self.raw_lrc = ""
        self.playing = False
        self.has_player = False
        self.pos_base = 0.0
        self.pos_wall = time.monotonic()
        self.card_until = 0.0
        self.card_p = 0.0
        self.card_dir = 1
        self.viz_p = 0.0
        self.style = CFG["style"]
        self.glow_mode = CFG["glow_mode"]
        self.viz_mode = CFG["viz_mode"]
        self.genre_mode = CFG.get("genre_mode", "auto")
        self.genre_effects = CFG.get("genre_effects", True)
        self.card_style = CFG["card_style"]
        self._scene_t = time.monotonic()

    def position(self):
        return self.pos_base + (time.monotonic() - self.pos_wall if self.playing else 0.0)

    def sync_position(self, reported, playing):
        est = self.position()
        now = time.monotonic()
        if playing and self.playing and abs(reported - est) < 0.28:
            self.pos_base = est + (reported - est) * 0.3
        else:
            self.pos_base = reported
        self.pos_wall = now
        self.playing = playing

    def set_art(self, thumb):
        im = thumb.convert("RGBA")
        buf = bytearray(im.tobytes("raw", "BGRa"))
        self.art_surface = cairo.ImageSurface.create_for_data(
            buf, cairo.FORMAT_ARGB32, im.width, im.height, im.width * 4)
        self._art_buf = buf

    def show_card(self):
        self.card_until = time.monotonic() + CFG["card_seconds"]

    def step(self, dt):
        f = dt * 60
        k = 1 - math.pow(0.92, f)
        for cur, tgt in ((self.c1, self.t1), (self.c2, self.t2), (self.card_bg, self.t_card_bg)):
            for i in range(3):
                cur[i] += (tgt[i] - cur[i]) * k
        self.level += (self.t_level - self.level) * (1 - math.pow(0.95, f))
        self.beat *= math.pow(0.86, f)

        live = time.monotonic() - self.bands_t < 1.0
        now = time.time()
        for i in range(32):
            tgt = self.bands[i] if live else (self.sub * 0.5 + self.beat * 0.4) * (0.5 + 0.5 * math.sin(now * (2.6 + i * 0.22) + i))
            d = self.bands_disp[i]
            self.bands_disp[i] += (tgt - d) * (0.60 if tgt > d else 0.16)
        for i in range(16):
            b16 = (self.bands_disp[i * 2] + self.bands_disp[i * 2 + 1]) * 0.5
            self.peaks[i] = max(b16, self.peaks[i] - dt * 0.7)

        mode = CFG["card"]
        want = 1.0 if (mode == "always" or (mode == "onchange" and time.monotonic() < self.card_until)) else 0.0
        if mode == "off":
            want = 0.0
        if want > self.card_p:
            self.card_dir = 1
            self.card_p = min(want, self.card_p + dt * 2.8)
        elif want < self.card_p:
            self.card_dir = -1
            self.card_p = max(want, self.card_p - dt * 3.4)


st = State()
renderer = ly.Renderer()


# ------------------------------------------------------------------ glow ----
def _mix(a, b, k):
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)


def _edge_color(u, tt, tint=0.0):
    speed = 0.055 + st.mid * 0.045
    k = 0.5 + 0.5 * math.sin(2 * math.pi * (u * 2 + tt * speed))
    c = _mix(st.c1, st.c2, k)
    return _mix(c, (1, 1, 1), tint) if tint else c


def _glow_layer(cr, w, h, T, a, tt, power=2.2, tint=0.0):
    P = 2.0 * (w + h)
    ut, ur, ub, ul = 0.0, w / P, (w + h) / P, (2 * w + h) / P
    cr.set_operator(cairo.OPERATOR_ADD)

    def strip(x0, y0, x1, y1, nx, ny, u0, u1, segs):
        for i in range(segs):
            f0, f1 = i / segs, (i + 1) / segs
            px0, py0 = x0 + (x1 - x0) * f0, y0 + (y1 - y0) * f0
            px1, py1 = x0 + (x1 - x0) * f1, y0 + (y1 - y0) * f1
            col = _edge_color(u0 + (u1 - u0) * (f0 + f1) * 0.5, tt, tint)
            mx, my = (px0 + px1) * 0.5, (py0 + py1) * 0.5
            g = cairo.LinearGradient(mx, my, mx + nx * T, my + ny * T)
            for s in range(7):
                sf = s / 6.0
                g.add_color_stop_rgba(sf, *col, a * ((1 - sf) ** power))
            cr.set_source(g)
            cr.move_to(px0, py0)
            cr.line_to(px1, py1)
            cr.line_to(px1 + nx * T, py1 + ny * T)
            cr.line_to(px0 + nx * T, py0 + ny * T)
            cr.close_path()
            cr.fill()

    strip(0, 0, w, 0, 0, 1, ut, ur, 10)
    strip(w, 0, w, h, -1, 0, ur, ub, 6)
    strip(w, h, 0, h, 0, -1, ub, ul, 10)
    strip(0, h, 0, 0, 1, 0, ul, 1.0, 6)
    cr.set_operator(cairo.OPERATOR_OVER)


def draw_glow(cr, w, h, S, tt):
    breathe = 0.88 + 0.12 * math.sin(tt * 1.5)
    boost = 1.0 + 0.65 * st.beat + 0.35 * st.sub
    a = min(1.0, st.level * CFG["max_alpha"] * breathe * boost * 0.76)
    T = CFG["thickness"] * S * (1 + 0.48 * st.beat + 0.28 * st.sub)

    if st.glow_mode == "hairline":
        _glow_layer(cr, w, h, max(6.0, 12 * S), min(1.0, a * 1.5), tt, 1.4, tint=0.22)
        return

    _glow_layer(cr, w, h, T, a * 0.78, tt, 2.2)
    _glow_layer(cr, w, h, T * 0.34, min(1.0, a * 0.98), tt, 1.7, tint=0.12)

    R = T * 2.1
    cr.set_operator(cairo.OPERATOR_ADD)
    for x, y, u in ((0, 0, 0.0), (w, 0, 0.25), (w, h, 0.5), (0, h, 0.75)):
        c = _edge_color(u, tt)
        g = cairo.RadialGradient(x, y, 0, x, y, R)
        g.add_color_stop_rgba(0, *c, 0.48 * a)
        g.add_color_stop_rgba(0.5, *c, 0.16 * a)
        g.add_color_stop_rgba(1, *c, 0)
        cr.set_source(g)
        cr.arc(x, y, R, 0, 2 * math.pi)
        cr.fill()
    cr.set_operator(cairo.OPERATOR_OVER)

    if st.beat > 0.06:
        _glow_layer(cr, w, h, T * 0.18, min(1.0, st.beat * 0.82), tt, 1.4, tint=0.78)
    if CFG["rim"]:
        _glow_layer(cr, w, h, max(4.0, 8 * S), min(1.0, a * (1.2 + st.treble * 0.7)), tt, 1.1, tint=0.30)


# --------------------------------------------------------- genre worlds -----
_GENRE_RULES = (
    ("romantic", re.compile(r"\\b(romance|romantic|r&b|soul|ballad|love|heart|hearts|kiss|forever|darling|lover|valentine|crush|affection|tenderness|embrace|pyaar|ishq|dil|mohabbat|tera|meri|jaan|tum|爱|恋|사랑)\\b", re.I)),
    ("folk", re.compile(r"\\b(folk|indie[\\s-]?folk|country|americana|bluegrass|celtic|singer[\\s-]?songwriter|acoustic|banjo|mandolin|fiddle|campfire|meadow|forest|autumn|leaves|woods)\\b", re.I)),
    ("hiphop", re.compile(r"\\b(hip[\\s-]?hop|rap|trap|phonk|drill|boom[\\s-]?bap|grime|bass|808|cypher|flex|drip)\\b", re.I)),
    ("electronic", re.compile(r"\\b(electronic|edm|synthwave|synth|techno|house|trance|dubstep|dnb|drum\\s*&?\\s*bass|cyber|electro|club|remix|hyperpop|rave|neon)\\b", re.I)),
    ("lofi", re.compile(r"\\b(lo[\\s-]?fi|lofi|chill|jazz|ambient|study|rain|bossa|downtempo|sleep|midnight|coffee|rainy|calm|soft|dream)\\b", re.I)),
    ("rock", re.compile(r"\\b(rock|metal|punk|grunge|alternative|indie\\s*rock|hardcore|thrash|emo|guitar|distort|riot|scream|thunder|lightning|electric)\\b", re.I)),
    ("classical", re.compile(r"\\b(classical|orchestra|symphony|concerto|sonata|piano|violin|cello|nocturne|waltz|baroque|cinematic|score|soundtrack)\\b", re.I)),
)


def detect_genre():
    mode = st.genre_mode
    if mode and mode != "auto":
        return mode
    if st.genre:
        for gname, pat in _GENRE_RULES:
            if pat.search(st.genre):
                return gname
    sample = f"{st.title} {st.artist} {st.album} {st.raw_lrc[:1400]}"
    best_g, best_n = None, 0
    for gname, pat in _GENRE_RULES:
        hits = len(pat.findall(sample))
        if hits > best_n:
            best_n, best_g = hits, gname
    if best_g:
        return best_g
    if st.sub > 0.55:
        return "hiphop"
    if st.mid > 0.52 and st.treble > 0.45:
        return "rock"
    if st.treble > 0.48:
        return "electronic"
    if st.mid > 0.38 and st.sub < 0.35:
        return "romantic"
    return "lofi"


class GenreParticles:
    def __init__(self):
        self.genre = "lofi"
        self.items = []
        self.arcs = []
        self.accum = 0.0
        self.last_beat_t = 0.0
        self.last_bolt_t = 0.0

    def _pick_x(self):
        r = random.random()
        if r < 0.35:
            return 0.04 + random.random() * 0.22
        if r < 0.70:
            return 0.74 + random.random() * 0.22
        return 0.12 + random.random() * 0.76

    def _spawn(self, genre, age_frac=0.0):
        if len(self.items) >= 44:
            return
        max_age = 6.0 + random.random() * 3.5 if genre in ("romantic", "lofi", "classical") else 2.2 + random.random() * 1.8
        x, y = self._pick_x(), 0.85 + random.random() * 0.16
        vx, vy = (random.random() - 0.5) * 0.018, -(0.045 + random.random() * 0.04)
        size, var = 16 + random.random() * 18, 0
        if genre == "romantic":
            var = 0 if random.random() < 0.48 else 1  # 0=blooming flower, 1=rising pulsing heart
            if var == 0:
                x = (0.06 + random.random() * 0.22) if random.random() < 0.5 else (0.72 + random.random() * 0.22)
                y = 0.14 + random.random() * 0.68
                vx, vy = (random.random() - 0.5) * 0.008, -(0.006 + random.random() * 0.008)
                size = 20 + random.random() * 20
            else:
                x, y = self._pick_x(), 0.92 + random.random() * 0.10
                vy = -(0.055 + random.random() * 0.045)
                size = 11 + random.random() * 12
        elif genre == "folk":
            var = 0 if random.random() < 0.74 else 1
            if var == 0:
                x, y, vx, vy, size = random.random() * 1.1 - 0.08, -0.06, 0.022 + random.random() * 0.032, 0.05 + random.random() * 0.04, 13 + random.random() * 13
            else:
                x, y, vx, vy, size = random.random(), 0.2 + random.random() * 0.75, (random.random() - 0.5) * 0.016, -(0.015 + random.random() * 0.02), 3 + random.random() * 4
        elif genre == "electronic":
            ang = random.random() * 2 * math.pi
            spd = 0.05 + random.random() * 0.07
            x, y = random.random(), random.random()
            vx, vy = math.cos(ang) * spd, math.sin(ang) * spd
            size = 10 + random.random() * 16
        elif genre == "hiphop":
            var = 0 if random.random() < 0.25 else 1
            x = (0.14 if random.random() < 0.5 else 0.86) if var == 0 else random.random()
            y = (0.22 if random.random() < 0.5 else 0.78) if var == 0 else 0.96
            vx, vy = (0.0, 0.0) if var == 0 else ((random.random() - 0.5) * 0.05, -(0.14 + random.random() * 0.16))
            size = 24 if var == 0 else 4 + random.random() * 5
        elif genre == "lofi":
            var = 0 if random.random() < 0.45 else (1 if random.random() < 0.75 else 2)
            if var == 2:
                x, y, vx, vy, size = random.random(), -0.05, -0.04, 0.36 + random.random() * 0.18, 18 + random.random() * 16
            elif var == 1:
                x, y, vx, vy, size = random.random(), -0.05, 0.025 + random.random() * 0.025, 0.04 + random.random() * 0.03, 10 + random.random() * 8
            else:
                x, y, vx, vy, size = random.random(), random.random(), (random.random() - 0.5) * 0.015, -0.012, 5 + random.random() * 7
        elif genre == "rock":
            x = (0.04 + random.random() * 0.22) if random.random() < 0.5 else (0.74 + random.random() * 0.22)
            y = random.random()
            vx = (1 if x < 0.5 else -1) * (0.08 + random.random() * 0.14)
            vy = (random.random() - 0.5) * 0.15
            size = 4 + random.random() * 5
        else:
            x, y, vx, vy, size = random.random(), random.random(), (random.random() - 0.5) * 0.012, -(0.015 + random.random() * 0.02), 7 + random.random() * 10
        self.items.append([x, y, vx, vy, size, random.random() * 2 * math.pi, (random.random() - 0.5) * 0.9, age_frac * max_age, max_age, random.random() * 100.0, var])

    def _spawn_lightning(self, w, h):
        if len(self.arcs) >= 7:
            return
        from_left = random.random() < 0.5
        x = 0.0 if from_left else float(w)
        y = h * (0.1 + random.random() * 0.8)
        pts, branch = [(x, y)], None
        d = 1 if from_left else -1
        for i in range(7):
            x += d * w * (0.03 + random.random() * 0.04)
            y += (random.random() - 0.5) * (h * 0.10)
            pts.append((x, y))
            if i == 2 and random.random() < 0.75:
                bx, by = x, y
                branch = [(bx, by)]
                for _ in range(3):
                    bx += d * w * (0.02 + random.random() * 0.025)
                    by += (1 if random.random() > 0.5 else -1) * (h * (0.04 + random.random() * 0.05))
                    branch.append((bx, by))
        self.arcs.append([pts, 0.0, 0.28, branch])

    def _draw_heart(self, cr, r):
        cr.new_path()
        cr.move_to(0, r * 0.35)
        cr.curve_to(-r * 0.1, -r * 0.1, -r * 0.95, -r * 0.15, -r * 0.95, r * 0.42)
        cr.curve_to(-r * 0.95, r * 0.85, -r * 0.35, r * 1.15, 0, r * 1.42)
        cr.curve_to(r * 0.35, r * 1.15, r * 0.95, r * 0.85, r * 0.95, r * 0.42)
        cr.curve_to(r * 0.95, -r * 0.15, r * 0.1, -r * 0.1, 0, r * 0.35)
        cr.close_path()

    def _draw_flower(self, cr, x, y, radius, bloom, rot, petals, pcol, ccol, alpha):
        b = ly.ease_out_back(bloom)
        if b <= 0.02 or alpha <= 0.01:
            return
        cr.save()
        cr.translate(x, y)
        cr.rotate(rot)
        halo = cairo.RadialGradient(0, 0, 0, 0, 0, radius * 1.65 * b)
        halo.add_color_stop_rgba(0, *pcol, 0.28 * alpha)
        halo.add_color_stop_rgba(1, *pcol, 0)
        cr.set_source(halo)
        cr.arc(0, 0, radius * 1.65 * b, 0, 2 * math.pi)
        cr.fill()
        spread = 0.38 + 0.62 * b
        plen = radius * (0.45 + 0.65 * b)
        pw = radius * 0.42 * spread
        for i in range(petals):
            cr.save()
            cr.rotate((i / petals) * 2 * math.pi)
            cr.new_path()
            cr.move_to(0, 0)
            cr.curve_to(-pw, -plen * 0.45, -pw * 0.85, -plen, 0, -plen)
            cr.curve_to(pw * 0.85, -plen, pw, -plen * 0.45, 0, 0)
            cr.close_path()
            pg = cairo.LinearGradient(0, 0, 0, -plen)
            pg.add_color_stop_rgba(0, *ly.lighten(pcol, 0.35), 0.88 * alpha)
            pg.add_color_stop_rgba(1, *pcol, 0.58 * alpha)
            cr.set_source(pg)
            cr.fill_preserve()
            cr.set_source_rgba(*ly.lighten(pcol, 0.55), 0.72 * alpha)
            cr.set_line_width(max(0.8, radius * 0.045))
            cr.stroke()
            cr.restore()
        cr.set_source_rgba(*ccol, 0.95 * alpha)
        cr.arc(0, 0, max(2.0, radius * 0.22 * b), 0, 2 * math.pi)
        cr.fill()
        cr.restore()

    def _draw_leaf(self, cr, x, y, ln, rot, twist, col, alpha):
        cr.save()
        cr.translate(x, y)
        cr.rotate(rot)
        cr.scale(0.45 + 0.55 * abs(math.cos(twist)), 1.0)
        cr.new_path()
        cr.move_to(0, -ln)
        cr.curve_to(ln * 0.68, -ln * 0.35, ln * 0.62, ln * 0.45, 0, ln)
        cr.curve_to(-ln * 0.62, ln * 0.45, -ln * 0.68, -ln * 0.35, 0, -ln)
        cr.close_path()
        lg = cairo.LinearGradient(0, -ln, 0, ln)
        lg.add_color_stop_rgba(0, *ly.lighten(col, 0.25), 0.76 * alpha)
        lg.add_color_stop_rgba(1, *col, 0.54 * alpha)
        cr.set_source(lg)
        cr.fill()
        cr.set_source_rgba(*ly.lighten(col, 0.48), 0.68 * alpha)
        cr.set_line_width(max(0.8, ln * 0.055))
        cr.move_to(0, -ln * 0.88)
        cr.line_to(0, ln * 1.15)
        for vy in (-0.35, 0.05, 0.42):
            cr.move_to(0, ln * vy)
            cr.line_to(ln * 0.30, ln * (vy - 0.22))
            cr.move_to(0, ln * vy)
            cr.line_to(-ln * 0.30, ln * (vy - 0.22))
        cr.stroke()
        cr.restore()

    def draw(self, cr, w, h, S, tt, dt):
        g = detect_genre()
        if g != self.genre or not self.items:
            self.genre = g
            self.items.clear()
            self.arcs.clear()
            for _ in range(22 if g in ("romantic", "folk") else 24):
                self._spawn(g, random.random() * 0.7)

        boost = (0.65 + st.mid * 0.9 + st.beat * 1.1) if st.playing else 0.30
        rate = (3.2 if g == "romantic" else 4.4 if g in ("folk", "lofi", "classical") else 6.5) * boost
        self.accum += dt * rate
        while self.accum >= 1.0:
            self.accum -= 1.0
            self._spawn(g, 0.0)

        if g == "rock":
            cd = (0.18 if st.beat > 0.35 else 0.75) if st.playing else 1.6
            if tt - self.last_bolt_t > cd:
                self.last_bolt_t = tt
                self._spawn_lightning(w, h)

        if st.playing and st.beat > 0.42 and tt - self.last_beat_t > 0.18:
            self.last_beat_t = tt
            if g in ("romantic", "hiphop", "electronic", "folk"):
                self._spawn(g, 0.0)
                self._spawn(g, 0.0)

        c1, c2 = tuple(st.c1), tuple(st.c2)
        cr.save()
        for i in range(len(self.items) - 1, -1, -1):
            p = self.items[i]
            p[7] += dt
            if p[7] >= p[8]:
                self.items.pop(i)
                continue
            life = p[7] / p[8]
            alpha = ly.clamp(life / 0.16) * ly.clamp((1 - life) / 0.22) * (0.85 if st.playing else 0.45)
            spd = 1.0 + (st.beat * 0.9 + st.sub * 0.4 if st.playing else 0.0)
            p[0] += p[2] * dt * spd
            p[1] += p[3] * dt * spd
            p[5] += p[6] * dt
            px, py, size, rot, seed, var = p[0] * w, p[1] * h, p[4], p[5], p[9], p[10]

            if g == "romantic":
                rose, blush, gold = (0.98, 0.34, 0.52), (1.0, 0.62, 0.72), (1.0, 0.84, 0.48)
                fcol = _mix(c1, rose if seed > 50 else blush, 0.68)
                if var == 0:
                    bloom = ly.clamp(life / 0.42)
                    bsc = 1.0 + st.beat * 0.2 + st.mid * 0.12
                    self._draw_flower(cr, px, py, size * S * bsc, bloom, rot, 6 if seed > 50 else 5, fcol, gold, alpha * 0.88)
                else:
                    sway = math.sin(tt * 2.1 + seed) * 14 * S
                    hr = size * S * (0.88 + st.beat * 0.28 + math.sin(tt * 4.0 + seed) * 0.06)
                    hcol = _mix(rose, c2, 0.25)
                    cr.save()
                    cr.translate(px + sway, py - hr * 0.6)
                    cr.rotate(math.sin(tt * 1.4 + seed) * 0.18)
                    self._draw_heart(cr, hr)
                    cr.set_source_rgba(*hcol, 0.72 * alpha)
                    cr.fill_preserve()
                    cr.set_source_rgba(*ly.lighten(hcol, 0.45), 0.9 * alpha)
                    cr.set_line_width(max(1.0, 1.5 * S))
                    cr.stroke()
                    cr.restore()
            elif g == "folk":
                if var == 0:
                    base_leaf = (0.92, 0.56, 0.24) if seed < 33 else ((0.46, 0.78, 0.52) if seed < 66 else (0.85, 0.35, 0.26))
                    lcol = _mix(base_leaf, c1, 0.25)
                    self._draw_leaf(cr, px + math.sin(tt * 1.3 + seed) * 18 * S, py, size * S, rot, tt * 1.8 + seed, lcol, alpha * 0.88)
                else:
                    glow = 0.5 + 0.5 * math.sin(tt * 3.0 + seed)
                    cr.set_source_rgba(*_mix((1.0, 0.84, 0.48), c2, 0.35), alpha * glow)
                    cr.arc(px, py, size * S, 0, 2 * math.pi)
                    cr.fill()
            elif g == "electronic":
                col = ly.lighten(c1 if seed > 50 else c2, 0.25)
                r = size * S * (1.0 + st.beat * 0.3)
                cr.save()
                cr.translate(px, py)
                cr.rotate(rot)
                cr.set_source_rgba(*col, alpha * 0.85)
                cr.set_line_width(max(1.2, 2.0 * S))
                cr.move_to(0, -r)
                cr.line_to(r * 0.65, 0)
                cr.line_to(0, r)
                cr.line_to(-r * 0.65, 0)
                cr.close_path()
                cr.stroke()
                cr.restore()
            elif g == "hiphop":
                if var == 0:
                    cr.set_source_rgba(*c1, (1 - life) * 0.55 * alpha)
                    cr.set_line_width(max(1.5, 3.0 * S * (1 - life)))
                    cr.arc(px, py, (size + life * 170) * S, 0, 2 * math.pi)
                    cr.stroke()
                else:
                    cr.set_source_rgba(*_mix(c1, (1.0, 0.48, 0.16), 0.55), alpha)
                    cr.arc(px, py, size * S, 0, 2 * math.pi)
                    cr.fill()
            elif g == "lofi":
                if var == 2:
                    cr.set_source_rgba(*ly.lighten(c2, 0.4), alpha * 0.35)
                    cr.set_line_width(max(1.0, 1.3 * S))
                    cr.move_to(px, py)
                    cr.line_to(px - 5 * S, py + size * S)
                    cr.stroke()
                elif var == 1:
                    lr = size * S
                    cr.save()
                    cr.translate(px + math.sin(tt * 1.5 + seed) * 12 * S, py)
                    cr.rotate(rot)
                    cr.set_source_rgba(*_mix(c1, (0.45, 0.88, 0.62), 0.45), alpha * 0.62)
                    cr.move_to(0, -lr)
                    cr.curve_to(lr * 0.7, -lr * 0.3, lr * 0.7, lr * 0.3, 0, lr)
                    cr.curve_to(-lr * 0.7, lr * 0.3, -lr * 0.7, -lr * 0.3, 0, -lr)
                    cr.fill()
                    cr.restore()
                else:
                    glow = 0.5 + 0.5 * math.sin(tt * 3.5 + seed)
                    fcol = _mix(c1, (1.0, 0.86, 0.45), 0.5)
                    fr = size * S * (0.8 + glow * 0.4) * 2.2
                    rg = cairo.RadialGradient(px, py, 0, px, py, fr)
                    rg.add_color_stop_rgba(0, *fcol, alpha * glow)
                    rg.add_color_stop_rgba(1, *fcol, 0)
                    cr.set_source(rg)
                    cr.arc(px, py, fr, 0, 2 * math.pi)
                    cr.fill()
            elif g == "rock":
                cr.set_source_rgba(*ly.lighten(_mix(c1, (1.0, 0.35, 0.25), 0.5), 0.4), alpha)
                cr.set_line_width(max(1.5, 2.0 * S))
                cr.move_to(px, py)
                cr.line_to(px - p[2] * 35 * S, py - p[3] * 35 * S)
                cr.stroke()
            else:
                tw = 0.45 + 0.55 * math.sin(tt * 3.2 + seed)
                scol = _mix((1.0, 0.88, 0.55), c2, 0.35)
                sr = size * S * tw
                cr.save()
                cr.translate(px, py)
                cr.rotate(rot)
                cr.new_path()
                for k in range(4):
                    a = k * math.pi / 2
                    ox, oy = math.cos(a) * sr, math.sin(a) * sr
                    ix, iy = math.cos(a + math.pi / 4) * sr * 0.24, math.sin(a + math.pi / 4) * sr * 0.24
                    cr.move_to(ox, oy) if k == 0 else cr.line_to(ox, oy)
                    cr.line_to(ix, iy)
                cr.close_path()
                cr.set_source_rgba(*scol, alpha * 0.9)
                cr.fill()
                cr.restore()

        if g == "rock":
            bcol = _mix(c1, (0.55, 0.85, 1.0), 0.45)
            for i in range(len(self.arcs) - 1, -1, -1):
                arc = self.arcs[i]
                arc[1] += dt
                if arc[1] >= arc[2]:
                    self.arcs.pop(i)
                    continue
                cr.set_source_rgba(*ly.lighten(bcol, 0.65), (1 - arc[1] / arc[2]) * 0.95)
                cr.set_line_width(max(2.0, 3.2 * S))
                cr.new_path()
                for idx, (ax, ay) in enumerate(arc[0]):
                    cr.move_to(ax, ay) if idx == 0 else cr.line_to(ax, ay)
                cr.stroke()
                if arc[3]:
                    cr.set_line_width(max(1.2, 2.0 * S))
                    cr.new_path()
                    for idx, (ax, ay) in enumerate(arc[3]):
                        cr.move_to(ax, ay) if idx == 0 else cr.line_to(ax, ay)
                    cr.stroke()
        elif g == "classical":
            gold = _mix((0.98, 0.84, 0.50), c2, 0.35)
            for r in (0, 1):
                by = h * (0.16 if r == 0 else 0.84)
                cr.new_path()
                for k in range(33):
                    u = k / 32.0
                    yy = by + math.sin(u * math.pi * 3 + tt * (0.9 if r == 0 else -0.8)) * (22 + st.mid * 42) * S
                    cr.move_to(u * w, yy) if k == 0 else cr.line_to(u * w, yy)
                cr.set_source_rgba(*gold, 0.32 if st.playing else 0.14)
                cr.set_line_width(max(1.5, 2.2 * S))
                cr.stroke()
        cr.restore()


genre_fx = GenreParticles()


# ----------------------------------------------------------- visualizer -----
def _smooth_closed_ring(cr, pts):
    n = len(pts)
    if n < 3:
        return
    cr.new_path()
    cr.move_to((pts[-1][0] + pts[0][0]) * 0.5, (pts[-1][1] + pts[0][1]) * 0.5)
    for i in range(n):
        p0, p1 = pts[i], pts[(i + 1) % n]
        mx, my = (p0[0] + p1[0]) * 0.5, (p0[1] + p1[1]) * 0.5
        cr.curve_to(p0[0], p0[1], p0[0], p0[1], mx, my)
    cr.close_path()


def draw_visualizer(cr, w, h, S, tt, alpha):
    if alpha <= 0.01:
        return
    cx, cy = w * 0.5, h * 0.47
    c1, c2 = tuple(st.c1), tuple(st.c2)
    acc = ly.lighten(_mix(c1, c2, 0.35), 0.32)
    bands = st.bands_disp
    mode = st.viz_mode

    cr.save()
    if mode == "terrain":
        layers, span_w, base_top, step_y = 7, w * 0.72, h * 0.30, h * 0.056
        for l in range(layers):
            depth = l / (layers - 1)
            row_w = span_w * (0.62 + 0.38 * depth)
            x0, y_base = cx - row_w * 0.5, base_top + l * step_y
            amp = (44 + 86 * depth) * S * (0.85 + 0.4 * st.beat)
            pts = []
            for i in range(32):
                u = i / 31.0
                env = math.sin(u * math.pi) ** 0.75
                b_idx = min(31, int((1.0 - abs(u * 2 - 1)) * 22 + l * 1.5))
                pts.append((x0 + u * row_w, y_base - bands[b_idx] * amp * env))
            cr.new_path()
            cr.move_to(pts[0][0], y_base + 50 * S)
            for px, py in pts:
                cr.line_to(px, py)
            cr.line_to(pts[-1][0], y_base + 50 * S)
            cr.close_path()
            cr.set_source_rgba(0.03, 0.035, 0.05, (0.58 + 0.25 * depth) * alpha)
            cr.fill()
            cr.new_path()
            cr.move_to(*pts[0])
            for px, py in pts[1:]:
                cr.line_to(px, py)
            lg = cairo.LinearGradient(x0, y_base, x0 + row_w, y_base)
            lg.add_color_stop_rgba(0, *c2, (0.2 + 0.7 * depth) * alpha)
            lg.add_color_stop_rgba(0.5, *ly.lighten(c1, 0.25), (0.35 + 0.65 * depth) * alpha)
            lg.add_color_stop_rgba(1, *c2, (0.2 + 0.7 * depth) * alpha)
            cr.set_source(lg)
            cr.set_line_width(max(1.5, (1.5 + 2.5 * depth) * S))
            cr.stroke()
    elif mode == "oscilloscope":
        rx = min(w, h) * 0.24 * (0.85 + 0.3 * st.sub + 0.18 * st.beat)
        ry = min(w, h) * 0.16 * (0.85 + 0.3 * st.mid + 0.18 * st.beat)
        for p in range(2):
            sp = (-1 if p == 0 else 1) * st.beat * 10 * S
            cr.new_path()
            for i in range(129):
                a = (i / 128.0) * 2 * math.pi
                b = bands[i % 32]
                mod = 1.0 + (b - 0.2) * (0.45 + st.mid * 0.4)
                px = cx + sp + math.sin(3 * a + tt * 0.9) * rx * mod
                py = cy + math.sin(2 * a - tt * 1.15) * ry * mod
                cr.move_to(px, py) if i == 0 else cr.line_to(px, py)
            cr.set_source_rgba(*(c1 if p == 0 else c2), 0.78 * alpha)
            cr.set_line_width(max(1.6, 2.8 * S))
            cr.stroke()
    elif mode == "turbine":
        blades = 48
        inner_r = min(w, h) * 0.11 * (1 + 0.22 * st.beat + 0.15 * st.sub)
        max_len = min(w, h) * 0.22
        rot = tt * (0.24 + st.mid * 0.45)
        cr.set_line_cap(cairo.LINE_CAP_ROUND)
        for i in range(blades):
            a = (i / blades) * 2 * math.pi + rot
            idx = i if i < 24 else (blades - i)
            val = bands[min(31, idx)]
            ln = (10 + val * max_len * (0.85 + 0.35 * st.beat)) * S
            col = _mix(c1, c2, abs(math.sin(a * 2 + tt * 0.5)))
            cr.set_source_rgba(*col, (0.45 + 0.55 * val) * alpha)
            cr.set_line_width(max(2.0, (3.2 + val * 3.5) * S))
            cr.move_to(cx + math.cos(a) * inner_r, cy + math.sin(a) * inner_r)
            cr.line_to(cx + math.cos(a) * (inner_r + ln), cy + math.sin(a) * (inner_r + ln))
            cr.stroke()
        cr.set_source_rgba(*ly.lighten(c1, 0.35), 0.9 * alpha)
        cr.set_line_width(max(2.0, 3.5 * S))
        cr.arc(cx, cy, inner_r * 0.88, 0, 2 * math.pi)
        cr.stroke()
    else:
        # orbital: 3 concentric harmonic spline rings + beat shockwave
        base_r = min(w, h) * 0.17 * (1 + 0.12 * st.sub + 0.08 * st.beat)
        if st.beat > 0.08:
            cr.set_operator(cairo.OPERATOR_ADD)
            cr.set_source_rgba(*acc, st.beat * 0.48 * alpha)
            cr.set_line_width(max(1.5, 3.0 * S))
            cr.arc(cx, cy, base_r * (1.28 + (1 - st.beat) * 0.85), 0, 2 * math.pi)
            cr.stroke()
            cr.set_operator(cairo.OPERATOR_OVER)
        for layer in (2, 1, 0):
            pts = []
            lscale = 0.72 + layer * 0.28
            rot = tt * (0.28 if layer % 2 == 0 else -0.22) * (1 + st.mid * 0.6)
            for i in range(64):
                theta = (i / 64.0) * 2 * math.pi + rot
                sym = int(((i % 32) / 32.0) * 24)
                val = bands[min(31, sym + layer * 2)]
                disp = val * (42 + layer * 22) * S + math.sin(theta * 3 + tt * 2.2) * 5 * S
                r = base_r * lscale + disp
                pts.append((cx + math.cos(theta) * r, cy + math.sin(theta) * r))
            _smooth_closed_ring(cr, pts)
            if layer == 1:
                rg = cairo.RadialGradient(cx, cy, base_r * 0.22, cx, cy, base_r * 1.75)
                rg.add_color_stop_rgba(0, *c1, 0.24 * (0.45 + st.sub + st.beat * 0.35) * alpha)
                rg.add_color_stop_rgba(0.65, *c2, 0.10 * (0.45 + st.mid) * alpha)
                rg.add_color_stop_rgba(1, *c2, 0.0)
                cr.set_source(rg)
                cr.fill_preserve()
            elif layer == 0:
                cg = cairo.RadialGradient(cx, cy, 0, cx, cy, base_r * 1.05)
                cg.add_color_stop_rgba(0, *ly.lighten(c1, 0.3), 0.28 * (0.4 + st.sub + st.beat * 0.4) * alpha)
                cg.add_color_stop_rgba(1, *c1, 0.0)
                cr.set_source(cg)
                cr.fill_preserve()
            lg = cairo.LinearGradient(cx - base_r, cy - base_r, cx + base_r, cy + base_r)
            lg.add_color_stop_rgba(0, *(acc if layer == 0 else c1), (0.95 if layer == 1 else 0.62) * alpha)
            lg.add_color_stop_rgba(1, *c2, (0.95 if layer == 1 else 0.55) * alpha)
            cr.set_source(lg)
            cr.set_line_width(max(1.5, (4.2 if layer == 1 else 2.2) * S))
            cr.stroke()
    cr.restore()


# ------------------------------------------------------------------ card ----
def _fmt(sec):
    sec = max(0, int(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def draw_card(cr, w, h, S):
    p = st.card_p
    if p <= 0.01 or not st.title:
        return
    e = ly.ease_out_back(p, 1.45) if st.card_dir > 0 else ly.ease_in_cubic(p)
    cw, ch = 520 * S, 178 * S
    pad = 15 * S
    margin = 48 * S
    off = 10 * S
    border = (0.04, 0.045, 0.055)
    ink = st.card_ink
    x = margin - (1 - e) * (cw + margin + 40 * S)
    y = h - margin - ch
    ang = -0.036 + (1 - e) * -0.20

    cr.save()
    cr.translate(x, y + ch)
    cr.rotate(ang)
    cr.translate(0, -ch)

    cr.set_source_rgba(*border, 0.95)
    cr.rectangle(off, off, cw, ch)
    cr.fill()
    cr.set_source_rgb(*st.card_bg)
    cr.rectangle(0, 0, cw, ch)
    cr.fill_preserve()
    cr.set_source_rgb(*border)
    cr.set_line_width(max(3.0, 4.5 * S))
    cr.stroke()

    art = ch - 2 * pad
    ax, ay, aoff = pad, pad, 6 * S
    cr.set_source_rgb(*border)
    cr.rectangle(ax + aoff, ay + aoff, art, art)
    cr.fill()
    cr.save()
    cr.rectangle(ax, ay, art, art)
    cr.clip()
    if st.art_surface is not None:
        cr.translate(ax, ay)
        k = art / st.art_surface.get_width()
        cr.scale(k, k)
        cr.set_source_surface(st.art_surface, 0, 0)
        cr.paint()
    else:
        g = cairo.LinearGradient(ax, ay, ax + art, ay + art)
        g.add_color_stop_rgb(0, *st.c2)
        g.add_color_stop_rgb(1, 1, 1, 1)
        cr.set_source(g)
        cr.paint()
    cr.restore()
    cr.set_source_rgb(*border)
    cr.set_line_width(max(2.5, 3.8 * S))
    cr.rectangle(ax, ay, art, art)
    cr.stroke()

    tx = ax + art + aoff + pad
    tw = cw - tx - pad
    r = renderer
    lt = r.layout(r.up(st.title), 26 * S, weight=Pango.Weight.HEAVY, width=tw, ellipsize=True, align=Pango.Alignment.LEFT)
    r.fill(cr, lt, tx, pad - 2 * S, (*ink, 1))
    la = r.layout(r.up(st.artist), 15 * S, weight=Pango.Weight.BOLD, width=tw, ellipsize=True, align=Pango.Alignment.LEFT)
    r.fill(cr, la, tx, pad + 36 * S, (*ink, 0.78))

    by = ch - pad - 28 * S
    top, bot = pad + 64 * S, by - 9 * S
    n, gap = 16, 3.5 * S
    bw = (tw - gap * (n - 1)) / n
    for i in range(n):
        v = ly.clamp(((st.bands_disp[i * 2] + st.bands_disp[i * 2 + 1]) * 0.5) * 1.2)
        bh = max(3 * S, v * (bot - top))
        cr.set_source_rgba(*ink, 0.92)
        cr.rectangle(tx + i * (bw + gap), bot - bh, bw, bh)
        cr.fill()
        py = bot - ly.clamp(st.peaks[i] * 1.2) * (bot - top)
        cr.set_source_rgba(*ink, 0.45)
        cr.rectangle(tx + i * (bw + gap), py - 2 * S, bw, max(1.5, 2 * S))
        cr.fill()

    bh = max(7.0, 10 * S)
    frac = ly.clamp(st.position() / st.length) if st.length > 0 else 0.0
    cr.set_source_rgba(*ink, 0.22)
    cr.rectangle(tx, by, tw, bh)
    cr.fill()
    cr.set_source_rgb(*ink)
    cr.rectangle(tx, by, max(bh, tw * frac), bh)
    cr.fill()
    for txt, align in ((_fmt(st.position()), Pango.Alignment.LEFT), (_fmt(st.length), Pango.Alignment.RIGHT)):
        lab = r.layout(txt, 12 * S, weight=Pango.Weight.BOLD, width=tw, align=align)
        r.fill(cr, lab, tx, by + bh + 3 * S, (*ink, 0.85))
    cr.restore()


# --------------------------------------------------------------- compose ----
def draw_scene(cr, w, h):
    cr.set_operator(cairo.OPERATOR_CLEAR)
    cr.paint()
    cr.set_operator(cairo.OPERATOR_OVER)
    S = h / 1080.0
    tt = time.time()
    now_m = time.monotonic()
    dt = min(0.05, max(0.001, now_m - st._scene_t))
    st._scene_t = now_m
    renderer.upper = CFG["uppercase"]
    renderer.font = CFG["font"]
    draw_glow(cr, w, h, S, tt)

    if CFG.get("genre_effects", True) and st.genre_effects:
        genre_fx.draw(cr, w, h, S, tt, dt)

    lyric_alpha = 0.0
    if CFG["lyrics"] and st.lyrics is not None and st.has_player:
        fade = 1.0 if st.playing else 0.65
        lyric_alpha = renderer.active_alpha(st.lyrics, st.position() + CFG["lyrics_offset"], fade)

    allow_vis = (not (CFG.get("genre_effects", True) and st.genre_effects)) or CFG.get("viz_always")
    vis_alpha = (max(0.38, 1.0 - lyric_alpha * 0.62) if CFG.get("viz_always") else max(0.0, 1.0 - lyric_alpha)) if allow_vis else 0.0
    if vis_alpha > 0.01 and (st.playing or not st.has_player):
        draw_visualizer(cr, w, h, S, tt, vis_alpha)

    if lyric_alpha > 0.01 and CFG["lyrics"] and st.lyrics is not None and st.has_player:
        accent = tuple(st.c1)
        shadow = ly.darken(tuple(st.c2), 0.48)
        fade = 1.0 if st.playing else 0.65
        renderer.draw(cr, w, h, st.lyrics, st.position() + CFG["lyrics_offset"], st.style, accent, shadow, fade, st.beat)

    draw_card(cr, w, h, S)
`;

  const lyricsPy = `"""
lumverse lyrics v2.1
  - Fetches real synced lyrics from LRCLIB + NetEase Cloud Music (never fabricates lyrics)
  - Enhanced LRC (<mm:ss.xx> exact word timing) + phonetic punctuation weighting
  - 7 kinetic PangoCairo styles: wipe, slam, burst, code, cascade, echo, ribbon
"""
import bisect
import collections
import hashlib
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import cairo
import gi

gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Pango, PangoCairo  # noqa: E402

SC = Pango.SCALE
API = "https://lrclib.net/api"
UA = "lumverse/2.1 (ambient kinetic lyrics overlay)"
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "lumverse", "lyrics")

FONT_UI = "${fontString}"
FONT_MONO = "JetBrainsMono Nerd Font, JetBrains Mono, monospace"
STYLES = ("wipe", "slam", "burst", "code", "cascade", "echo", "ribbon")
ALIASES = {"karaoke": "wipe", "kinetic": "slam"}


# ----------------------------------------------------------------- fetch ----
def _get_json(url, headers=None, data=None, timeout=7):
    hdrs = {"User-Agent": UA}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _clean_title(t):
    t = re.sub(r"\\s*[\\(\\[][^)\\]]*(feat|ft\\.|with|remaster|live|version|edit|from|official|lyric|audio)[^)\\]]*[\\)\\]]", "", t, flags=re.I)
    t = re.sub(r"\\s+-\\s+(remaster|live|single|radio|from|\\d{4}).*$", "", t, flags=re.I)
    return t.strip()


def _lookup_netease(query):
    try:
        body = urllib.parse.urlencode({"s": query, "type": "1", "offset": "0", "total": "true", "limit": "3"}).encode()
        res = _get_json("https://music.163.com/api/search/get/web",
                        headers={"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/"},
                        data=body, timeout=5)
        songs = (res.get("result") or {}).get("songs") or []
        for s in songs[:2]:
            lyr = _get_json(f"https://music.163.com/api/song/lyric?os=pc&id={s['id']}&lv=-1",
                            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://music.163.com/"},
                            timeout=4)
            txt = ((lyr.get("lrc") or {}).get("lyric") or "").strip()
            if txt and re.search(r"\\[\\d+:\\d+", txt):
                return txt
    except Exception:
        pass
    return None


def _lookup(title, artist, album, dur):
    q = {"track_name": title, "artist_name": artist}
    if album:
        q["album_name"] = album
    if dur:
        q["duration"] = int(round(dur))
    try:
        d = _get_json(f"{API}/get?{urllib.parse.urlencode(q)}")
        if d.get("syncedLyrics"):
            return d["syncedLyrics"]
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    primary = artist.split(",")[0].strip()
    clean = _clean_title(title)
    for params in ({"track_name": clean, "artist_name": primary}, {"q": f"{clean} {primary}"}, {"q": clean}):
        try:
            res = _get_json(f"{API}/search?{urllib.parse.urlencode(params)}")
        except urllib.error.HTTPError:
            continue
        synced = [r for r in res if r.get("syncedLyrics")]
        if synced:
            if dur:
                synced.sort(key=lambda r: abs((r.get("duration") or 0) - dur))
                if abs((synced[0].get("duration") or 0) - dur) <= 12:
                    return synced[0]["syncedLyrics"]
            else:
                return synced[0]["syncedLyrics"]

    return _lookup_netease(f"{clean} {primary}".strip())


def fetch_synced(title, artist, album, dur):
    key = hashlib.sha1(f"{title}|{artist}|{album}|{int(dur)}".encode()).hexdigest()
    path = os.path.join(CACHE, key + ".json")
    try:
        with open(path) as f:
            c = json.load(f)
        if c.get("synced") or time.time() - c.get("ts", 0) < 86400:
            return c.get("synced")
    except (OSError, ValueError):
        pass
    try:
        txt = _lookup(title, artist, album, dur)
    except Exception:
        return None
    try:
        os.makedirs(CACHE, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"synced": txt, "ts": time.time()}, f)
    except OSError:
        pass
    return txt


# ----------------------------------------------------------------- parse ----
_TS = re.compile(r"\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]")
_WORD_TS = re.compile(r"<(\\d+):(\\d+(?:\\.\\d+)?)>")
_OFFSET = re.compile(r"^\\[offset:\\s*(-?\\d+)\\s*\\]$", re.I)
_CJK = "\\u2e80-\\u9fff\\uac00-\\ud7af\\uff00-\\uffef"
_TOK = re.compile(rf"[{_CJK}]|[^\\s{_CJK}]+")
Token = collections.namedtuple("Token", "text space t0 t1")


def _wt(text):
    w = max(1.2, len(text) * 0.95)
    if re.search(r"[.,;:!?—–-]$", text):
        w += 1.4
    return w


class Line:
    __slots__ = ("t", "text", "raw", "t1", "_tok")

    def __init__(self, t, raw):
        self.t = t
        self.raw = raw
        self.text = _WORD_TS.sub("", raw).strip()
        self.t1 = t + 1.0
        self._tok = None


def tokens(line):
    if line._tok is not None:
        return line._tok
    wmatches = list(_WORD_TS.finditer(line.raw))
    if len(wmatches) >= 2:
        segs = []
        pre = line.raw[:wmatches[0].start()].strip()
        if pre:
            segs.append((line.t, pre))
        for i, m in enumerate(wmatches):
            t = int(m.group(1)) * 60 + float(m.group(2))
            end = wmatches[i + 1].start() if i + 1 < len(wmatches) else len(line.raw)
            chunk = line.raw[m.end():end]
            if chunk.strip():
                segs.append((t, chunk))
        out = []
        for i, (st_t, chunk) in enumerate(segs):
            ed_t = max(st_t + 0.08, segs[i + 1][0]) if i + 1 < len(segs) else line.t1
            clean = chunk.strip()
            has_sp = chunk.endswith(" ") or i < len(segs) - 1
            subs = [(m.group(), clean[m.end():m.end() + 1].isspace()) for m in _TOK.finditer(clean)]
            wts = [_wt(tx) for tx, _ in subs]
            tot = sum(wts) or 1.0
            acc, span = 0.0, max(0.08, ed_t - st_t)
            for j, ((tx, sp), w) in enumerate(zip(subs, wts)):
                out.append(Token(tx, sp or (j == len(subs) - 1 and has_sp),
                                 st_t + span * acc / tot, st_t + span * (acc + w) / tot))
                acc += w
        line._tok = out
        return out

    raw = [(m.group(), line.text[m.end():m.end() + 1].isspace()) for m in _TOK.finditer(line.text)]
    weights = [_wt(tx) for tx, _ in raw]
    total = sum(weights) or 1.0
    span = max(0.25, line.t1 - line.t)
    acc, out = 0.0, []
    for (tx, sp), wt in zip(raw, weights):
        out.append(Token(tx, sp, line.t + span * acc / total, line.t + span * (acc + wt) / total))
        acc += wt
    line._tok = out
    return out


class Lyrics:
    def __init__(self, lines):
        self.lines = lines
        self.starts = [ln.t for ln in lines]

    def index_at(self, t):
        return bisect.bisect_right(self.starts, t) - 1


def parse_lrc(text):
    rows, offset = [], 0.0
    for raw in text.splitlines():
        om = _OFFSET.match(raw.strip())
        if om:
            offset = int(om.group(1)) / 1000.0
            continue
        stamps = _TS.findall(raw)
        if not stamps:
            continue
        body = _TS.sub("", raw).strip()
        for m, s in stamps:
            rows.append((max(0.0, int(m) * 60 + float(s) + offset), body))
    rows.sort(key=lambda r: r[0])
    lines = [Line(t, b) for t, b in rows]
    for i, ln in enumerate(lines):
        nxt = lines[i + 1].t if i + 1 < len(lines) else ln.t + 5.5
        guess = ln.t + max(1.0, 0.13 * len(ln.text) + 0.75)
        ln.t1 = max(ln.t + 0.45, min(nxt - 0.06, guess))
    return Lyrics(lines) if lines else None


# ---------------------------------------------------------------- easing ----
def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def ease_out_cubic(x):
    return 1 - (1 - clamp(x)) ** 3


def ease_in_cubic(x):
    return clamp(x) ** 3


def ease_out_expo(x):
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * clamp(x))


def ease_out_back(x, c1=1.70158):
    c3 = c1 + 1
    c = clamp(x)
    return 1 + c3 * (c - 1) ** 3 + c1 * (c - 1) ** 2


def lighten(c, k=0.45):
    return tuple(v + (1 - v) * k for v in c)


def darken(c, k=0.4):
    return tuple(v * (1 - k) for v in c)


# -------------------------------------------------------------- renderer ----
class Renderer:
    def __init__(self):
        self.ctx = PangoCairo.font_map_get_default().create_context()
        self._lay, self._cl = {}, {}
        self.upper = True
        self.font = FONT_UI

    def up(self, s):
        return s.upper() if self.upper else s

    def layout(self, text, px, weight=Pango.Weight.HEAVY, family=None, width=None, align=Pango.Alignment.CENTER, ellipsize=False):
        key = (text, round(px), int(weight), family or self.font, width and round(width), align, ellipsize)
        lay = self._lay.get(key)
        if lay is None:
            if len(self._lay) > 600:
                self._lay.clear()
                self._cl.clear()
            lay = Pango.Layout.new(self.ctx)
            fd = Pango.FontDescription()
            fd.set_family(family or self.font)
            fd.set_weight(weight)
            fd.set_absolute_size(px * SC)
            lay.set_font_description(fd)
            lay.set_text(text, -1)
            if width:
                lay.set_width(int(width * SC))
                if ellipsize:
                    lay.set_height(-1)
                    lay.set_ellipsize(Pango.EllipsizeMode.END)
                else:
                    lay.set_wrap(Pango.WrapMode.WORD_CHAR)
            lay.set_alignment(align)
            self._lay[key] = lay
        return lay

    def fill(self, cr, lay, x, y, rgba):
        if rgba[3] <= 0.004:
            return
        cr.save()
        cr.translate(x, y)
        cr.new_path()
        PangoCairo.layout_path(cr, lay)
        cr.set_source_rgba(*rgba)
        cr.fill()
        cr.restore()

    def outline(self, cr, lay, x, y, rgba, lw):
        if rgba[3] <= 0.004:
            return
        cr.save()
        cr.translate(x, y)
        cr.new_path()
        PangoCairo.layout_path(cr, lay)
        cr.set_line_join(cairo.LINE_JOIN_ROUND)
        cr.set_line_width(lw)
        cr.set_source_rgba(*rgba)
        cr.stroke()
        cr.restore()

    def poster(self, cr, lay, x, y, color, shadow, off, a):
        self.fill(cr, lay, x + off, y + off, (*shadow, a))
        self.fill(cr, lay, x, y, (*color, a))

    def _clusters(self, lay, text):
        got = self._cl.get(id(lay))
        if got is not None:
            return got
        it = lay.get_iter()
        idxs, rects = [], []
        while True:
            r = it.get_cluster_extents()[1]
            idxs.append(it.get_index())
            rects.append((r.x / SC, r.y / SC, r.width / SC, r.height / SC))
            if not it.next_cluster():
                break
        raw = text.encode("utf-8")
        out = []
        for k, (x, y, w, h) in enumerate(rects):
            end = idxs[k + 1] if k + 1 < len(idxs) else len(raw)
            ch = raw[idxs[k]:end].decode("utf-8", "ignore")
            out.append((x, y, w, h, 0.35 if ch.isspace() else 1.0))
        self._cl[id(lay)] = out
        return out

    def _wipe_rects(self, lay, text, f, pad_y=0.0):
        cl = self._clusters(lay, text)
        total = sum(c[4] for c in cl) or 1
        acc, rects = 0.0, []
        for x, y, w, h, wt in cl:
            a, b = acc / total, (acc + wt) / total
            acc += wt
            if f <= a:
                break
            p = clamp((f - a) / (b - a))
            rects.append((x, y - pad_y, w * p, h + 2 * pad_y))
        return rects

    def active_alpha(self, lyr, t, alpha):
        if lyr is None or alpha <= 0.01:
            return 0.0
        i = lyr.index_at(t)
        if i < 0:
            return 0.0
        lines = lyr.lines
        cur = lines[i]
        since = t - cur.t
        a = alpha
        if not cur.text:
            j = i - 1
            while j >= 0 and not lines[j].text:
                j -= 1
            if j < 0:
                return 0.0
            a *= 1 - clamp(since / 0.5)
            return 0.0 if a <= 0.01 else a
        elif t - cur.t1 > 1.3:
            a *= 1 - clamp((t - cur.t1 - 1.3) / 0.8)
            return 0.0 if a <= 0.01 else a
        return a

    def draw(self, cr, w, h, lyr, t, style, accent, shadow, alpha, beat=0.0):
        if lyr is None or alpha <= 0.01:
            return 0.0
        i = lyr.index_at(t)
        if i < 0:
            return 0.0
        lines = lyr.lines
        cur = lines[i]
        since = t - cur.t
        a = alpha
        if not cur.text:
            j = i - 1
            while j >= 0 and not lines[j].text:
                j -= 1
            if j < 0:
                return 0.0
            a *= 1 - clamp(since / 0.5)
            if a <= 0.01:
                return 0.0
            cur, since, t = lines[j], 99.0, lines[j].t1 + 99
        elif t - cur.t1 > 1.3:
            a *= 1 - clamp((t - cur.t1 - 1.3) / 0.8)
            if a <= 0.01:
                return 0.0

        k = i - 1
        while k >= 0 and not lines[k].text:
            k -= 1
        prev = lines[k] if k >= 0 and lines[k] is not cur else None
        nxt = lines[i + 1] if i + 1 < len(lines) and lines[i + 1].text else None
        nxt2 = lines[i + 2] if i + 2 < len(lines) and lines[i + 2].text else None

        style = ALIASES.get(style, style)
        cr.save()
        sh = beat * h * 0.004
        cr.translate(math.sin(t * 53.0) * sh, math.cos(t * 47.0) * sh)
        pv = 1 + 0.032 * beat
        cr.translate(w / 2, h * 0.54)
        cr.scale(pv, pv)
        cr.translate(-w / 2, -h * 0.54)
        if style == "cascade":
            self._cascade(cr, w, h, cur, prev, nxt, nxt2, since, accent, shadow, a)
        elif style == "slam":
            self._slam(cr, w, h, cur, prev, t, since, accent, shadow, a)
        elif style == "burst":
            self._burst(cr, w, h, cur, t, accent, shadow, a, beat)
        elif style == "code":
            self._code(cr, w, h, cur, prev, t, since, accent, shadow, a)
        elif style == "echo":
            self._echo(cr, w, h, cur, since, accent, shadow, a, beat)
        elif style == "ribbon":
            self._ribbon(cr, w, h, cur, t, since, accent, shadow, a, beat)
        else:
            self._wipe(cr, w, h, cur, prev, nxt, t, since, accent, shadow, a)
        if style != "ribbon":
            self._draw_line_progress(cr, w, h, cur, t, since, style, accent, a, beat)
        cr.restore()
        return a

    def _draw_line_progress(self, cr, w, h, cur, t, since, style, accent, a, beat):
        s = max(0.55, h / 1080.0)
        bar_a = a * ease_out_cubic(clamp(since / 0.25)) * 0.85
        if bar_a <= 0.01:
            return
        frac = clamp((t - cur.t) / max(0.15, cur.t1 - cur.t))
        bar_w = min(w * 0.30, 280.0 * s)
        bar_h = max(2.0, 2.5 * s)
        bar_x = (w - bar_w) * 0.5
        bar_y = h * (0.562 if style == "cascade" else 0.742 if style == "burst" else 0.675)
        r = bar_h * 0.5

        def rrect(x, y, rw, rh):
            cr.new_sub_path()
            cr.arc(x + rw - r, y + r, r, -math.pi / 2, 0)
            cr.arc(x + rw - r, y + rh - r, r, 0, math.pi / 2)
            cr.arc(x + r, y + rh - r, r, math.pi / 2, math.pi)
            cr.arc(x + r, y + r, r, math.pi, 3 * math.pi / 2)
            cr.close_path()

        cr.save()
        rrect(bar_x, bar_y - r, bar_w, bar_h)
        cr.set_source_rgba(1, 1, 1, 0.14 * bar_a)
        cr.fill()
        fill_w = max(bar_h, bar_w * frac)
        lg = cairo.LinearGradient(bar_x, bar_y, bar_x + bar_w, bar_y)
        lg.add_color_stop_rgba(0, *accent, 0.75 * bar_a)
        lg.add_color_stop_rgba(0.65, *lighten(accent, 0.32), 0.95 * bar_a)
        lg.add_color_stop_rgba(1, 1, 1, 1, bar_a)
        rrect(bar_x, bar_y - r, fill_w, bar_h)
        cr.set_source(lg)
        cr.fill()
        if 0.01 < frac < 0.995:
            cr.set_source_rgba(1, 1, 1, bar_a)
            cr.arc(bar_x + fill_w, bar_y, bar_h * (1.15 + beat * 0.45), 0, 2 * math.pi)
            cr.fill()
        cr.restore()

    def _wipe(self, cr, w, h, cur, prev, nxt, t, since, accent, shadow, a):
        size, maxw = h * 0.084, w * 0.80
        off = max(3.0, size * 0.06)
        u = ease_out_expo(clamp(since / 0.30))

        def block(ln, dy, sc, al, filled, hint=None, ha=0.0):
            txt = self.up(ln.text)
            lay = self.layout(txt, size, width=maxw)
            lh = lay.get_pixel_size()[1]
            cr.save()
            cr.translate(w / 2, h * 0.54 + dy)
            cr.scale(sc, sc)
            cr.translate(-maxw / 2, -lh / 2)
            self.outline(cr, lay, 0, 0, (*lighten(accent, 0.35), 0.58 * al), max(2.0, size * 0.028))
            f = 1.0 if filled else clamp((t - ln.t) / max(0.12, ln.t1 - ln.t))
            rects = self._wipe_rects(lay, txt, f, pad_y=off + 2)
            if rects:
                cr.save()
                for r in rects:
                    cr.rectangle(*r)
                cr.clip()
                self.poster(cr, lay, 0, 0, (1, 1, 1), shadow, off, al)
                cr.restore()
            cr.restore()
            if hint and ha > 0.01:
                hl = self.layout(self.up(hint.text), size * 0.34, width=maxw)
                self.fill(cr, hl, (w - maxw) / 2, h * 0.54 + dy + lh * sc / 2 + size * 0.28, (*lighten(accent, 0.42), 0.52 * ha))

        if prev and since < 0.30:
            v = clamp(since / 0.30)
            block(prev, -v * size * 0.7, 1 - 0.1 * v, a * (1 - v), True)
        block(cur, (1 - u) * size * 0.42, 1.20 - 0.20 * u, a * min(1.0, u * 1.6), False, nxt, a * u)

    def _slam(self, cr, w, h, cur, prev, t, since, accent, shadow, a):
        size, maxw = h * 0.082, w * 0.80
        gapx, off = size * 0.26, max(3.0, size * 0.06)
        hot = lighten(accent, 0.48)

        def block(ln, dy, al, static):
            rows, row, rw = [], [], 0.0
            for tk in tokens(ln):
                lay = self.layout(self.up(tk.text), size)
                tw, th = lay.get_pixel_size()
                g = gapx if (row and row[-1][3].space) else 0
                if row and rw + g + tw > maxw:
                    rows.append((row, rw))
                    row, rw, g = [], 0.0, 0
                row.append((lay, tw, th, tk))
                rw += g + tw
            if row:
                rows.append((row, rw))
            lh = size * 1.08
            y0 = h * 0.54 - len(rows) * lh / 2 + dy
            for ri, (ritems, rw) in enumerate(rows):
                x, y = (w - rw) / 2, y0 + ri * lh
                for k, (lay, tw, th, tk) in enumerate(ritems):
                    if k > 0 and ritems[k - 1][3].space:
                        x += gapx
                    cx, cy = x + tw / 2, y + lh / 2
                    u = 1.0 if static else clamp((t - tk.t0) / 0.22)
                    self.outline(cr, lay, x, cy - th / 2, (*lighten(accent, 0.3), 0.48 * al * (1 - u * 0.72)), max(2.0, size * 0.026))
                    if u > 0:
                        live = (not static) and tk.t0 <= t < tk.t1
                        s = (1 + (1 - ease_out_back(u, 1.9)) * 0.85) * (1.07 if live else 1.0)
                        cr.save()
                        cr.translate(cx, cy)
                        cr.scale(s, s)
                        self.poster(cr, lay, -tw / 2, -th / 2, hot if live else (1, 1, 1), shadow, off, al * clamp(u * 4))
                        cr.restore()
                    x += tw

        if prev and since < 0.28:
            v = clamp(since / 0.28)
            block(prev, -v * size * 0.7, a * (1 - v), True)
        block(cur, 0, a, False)

    def _burst(self, cr, w, h, cur, t, accent, shadow, a, beat):
        toks = tokens(cur)
        if not toks:
            return
        k = max((i for i, tk in enumerate(toks) if tk.t0 <= t), default=0)
        tk = toks[k]
        base = h * 0.22
        cx, cy = w / 2, h * 0.42
        cols = ((1, 1, 1), lighten(accent, 0.45), lighten(shadow, 0.55))

        if beat > 0.12:
            cr.save()
            cr.set_source_rgba(*accent, beat * 0.36 * a)
            cr.set_line_width(max(2.0, h * 0.004))
            cr.arc(cx, cy, h * (0.14 + (1 - beat) * 0.16), 0, 2 * math.pi)
            cr.stroke()
            cr.restore()

        lay = self.layout(self.up(tk.text), base)
        tw, th = lay.get_pixel_size()
        fit = min(1.0, (w * 0.84) / max(tw, 1))
        u = clamp((t - tk.t0) / 0.20)
        s = fit * (0.42 + 0.58 * ease_out_back(u, 2.3))
        cr.save()
        cr.translate(cx, cy)
        cr.scale(s, s)
        self.poster(cr, lay, -tw / 2, -th / 2, cols[k % 3], shadow, max(4.0, base * 0.045), a * clamp(u * 5))
        cr.restore()

    def _cascade(self, cr, w, h, cur, prev, nxt, nxt2, since, accent, shadow, a):
        base, maxw = h * 0.068, w * 0.74
        e = ease_out_cubic(clamp(since / 0.34))
        slide = (1 - e) * base * 1.15
        for ln, y_off, sc, op, active in ((prev, -base * 2.1, 0.72, 0.28, False), (cur, 0, 1.0, 1.0, True),
                                          (nxt, base * 2.0, 0.76, 0.38, False), (nxt2, base * 3.5, 0.64, 0.18, False)):
            if not ln or not ln.text:
                continue
            lay = self.layout(self.up(ln.text), base * sc, width=maxw)
            lh = lay.get_pixel_size()[1]
            y = h * 0.50 + y_off + slide - lh / 2
            if active:
                self.poster(cr, lay, (w - maxw) / 2, y, (1, 1, 1), shadow, max(3.0, base * 0.055), a * op)
            else:
                self.fill(cr, lay, (w - maxw) / 2, y, (0.92, 0.94, 0.98, a * op))

    def _echo(self, cr, w, h, cur, since, accent, shadow, a, beat):
        size, maxw = h * 0.084, w * 0.78
        e = ease_out_expo(clamp(since / 0.32))
        lay = self.layout(self.up(cur.text), size, width=maxw)
        lh = lay.get_pixel_size()[1]
        x, y = (w - maxw) / 2, h * 0.52 - lh / 2
        split = (4 + beat * 16) * (h / 1080.0)
        if split > 2:
            self.fill(cr, lay, x - split, y - split * 0.25, (*accent, 0.55 * a * e))
            self.fill(cr, lay, x + split, y + split * 0.25, (*lighten(shadow, 0.4), 0.55 * a * e))
        self.poster(cr, lay, x, y, (1, 1, 1), shadow, max(3.0, size * 0.055), a * e)

    def _code(self, cr, w, h, cur, prev, t, since, accent, shadow, a):
        size, maxw = h * 0.040, w * 0.62
        x0, fam, wt = (w - maxw) / 2, FONT_MONO, Pango.Weight.BOLD
        e = ease_out_expo(clamp(since / 0.3))
        prompt = self.layout("> ", size, weight=wt, family=fam)
        pw = prompt.get_pixel_size()[0]
        f = clamp((t - cur.t) / max(0.2, (cur.t1 - cur.t) * 0.85))
        n = int(f * len(cur.text) + 1e-6)
        lt = self.layout(cur.text[:n], size, weight=wt, family=fam, width=maxw - pw, align=Pango.Alignment.LEFT)
        ytop = h * 0.58 - max(lt.get_pixel_size()[1], size * 1.3) / 2 + (1 - e) * size
        if prev:
            lp = self.layout("// " + prev.text, size * 0.75, weight=wt, family=fam, width=maxw, align=Pango.Alignment.LEFT)
            self.fill(cr, lp, x0, ytop - size * 0.6 - lp.get_pixel_size()[1], (0.45, 0.9, 0.55, 0.5 * a))
        self.fill(cr, prompt, x0, ytop, (*accent, a))
        self.poster(cr, lt, x0 + pw, ytop, (1, 1, 1), shadow, max(2.0, size * 0.06), a * e)

    def _ribbon(self, cr, w, h, cur, t, since, accent, shadow, a, beat):
        size = h * 0.072
        e = ease_out_cubic(clamp(since / 0.26))
        bar_h, cy = size * 1.68, h * 0.52
        cr.save()
        cr.set_source_rgba(0.03, 0.035, 0.045, 0.76 * a * e)
        cr.rectangle(0, cy - bar_h / 2, w, bar_h)
        cr.fill()
        cr.set_source_rgba(*accent, a * e)
        edge_h = max(2.0, 3.0 * (h / 1080.0))
        cr.rectangle(0, cy - bar_h / 2, w, edge_h)
        cr.rectangle(0, cy + bar_h / 2 - edge_h, w, edge_h)
        cr.fill()
        lay = self.layout(self.up(cur.text), size)
        tw, th = lay.get_pixel_size()
        f = clamp((t - cur.t) / max(0.2, cur.t1 - cur.t))
        overflow = max(0.0, tw - w * 0.80)
        x = (w * 0.10 - overflow * f) if overflow > 0 else (w - tw) / 2
        self.poster(cr, lay, x, cy - th / 2, (1, 1, 1), shadow, max(2.5, size * 0.05), a * e)
        cr.set_source_rgba(*lighten(accent, 0.35), a)
        cr.rectangle(0, cy + bar_h / 2 - (4 + beat * 3), w * f, 4 + beat * 3)
        cr.fill()
        cr.restore()
`;

  const lumversePy = `#!/usr/bin/env python3
"""
lumverse v2.2 - ambient glow + genre worlds + 4-mode procedural visualizer + synced lyrics (Hyprland/Wayland)
Control:  lumverse.py style | card | glow | viz | genre
"""
import ctypes.util
import os
import signal
import sys

RUNTIME = os.environ.get("XDG_RUNTIME_DIR", "/tmp")
PIDFILE = os.path.join(RUNTIME, "lumverse.pid")

if len(sys.argv) > 1 and sys.argv[1] in ("style", "card", "glow", "viz", "genre"):
    sig = {
        "style": signal.SIGUSR1,
        "card": signal.SIGUSR2,
        "glow": signal.SIGRTMIN,
        "viz": signal.SIGRTMIN + 1,
        "genre": signal.SIGRTMIN + 2,
    }[sys.argv[1]]
    try:
        with open(PIDFILE) as f:
            os.kill(int(f.read().strip()), sig)
    except (OSError, ValueError):
        sys.exit("lumverse is not running")
    sys.exit(0)

if "gtk4-layer-shell" not in os.environ.get("LD_PRELOAD", ""):
    _lib = ctypes.util.find_library("gtk4-layer-shell")
    if _lib:
        os.environ["LD_PRELOAD"] = _lib
        os.execv(sys.executable, [sys.executable] + sys.argv)

import atexit  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import urllib.parse  # noqa: E402
import urllib.request  # noqa: E402

import cairo  # noqa: E402
import gi  # noqa: E402

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("Gtk4LayerShell", "1.0")
from gi.repository import Gdk, Gio, GLib, Gtk  # noqa: E402
from gi.repository import Gtk4LayerShell as LayerShell  # noqa: E402

import lyrics as ly  # noqa: E402
import scene  # noqa: E402
from scene import CFG, st  # noqa: E402

MPRIS_PREFIX = "org.mpris.MediaPlayer2."
MPRIS_PATH = "/org/mpris/MediaPlayer2"
MPRIS_PLAYER = "org.mpris.MediaPlayer2.Player"
GLOW_MODES = ("aurora", "prism", "vignette", "hairline")
VIZ_MODES = ("orbital", "terrain", "oscilloscope", "turbine")
GENRE_THEMES = ("auto", "romantic", "electronic", "hiphop", "folk", "lofi", "rock", "classical")

bus = None
areas = []
_art_cache = {}


def _call(dest, path, iface, method, args, reply):
    return bus.call_sync(dest, path, iface, method, args, GLib.VariantType(reply), Gio.DBusCallFlags.NONE, 500, None).unpack()[0]


def read_player():
    try:
        names = _call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "ListNames", None, "(as)")
    except GLib.Error:
        return None
    best = None
    for n in names:
        if not n.startswith(MPRIS_PREFIX) or n.endswith("playerctld"):
            continue
        try:
            p = _call(n, MPRIS_PATH, "org.freedesktop.DBus.Properties", "GetAll", GLib.Variant("(s)", (MPRIS_PLAYER,)), "(a{sv})")
        except GLib.Error:
            continue
        md = p.get("Metadata", {})
        artists = md.get("xesam:artist") or []
        if isinstance(artists, str):
            artists = [artists]
        genres = md.get("xesam:genre") or []
        if isinstance(genres, str):
            genres = [genres]
        info = {
            "status": p.get("PlaybackStatus", "Stopped"),
            "title": md.get("xesam:title", "") or "",
            "artist": ", ".join(artists),
            "album": md.get("xesam:album", "") or "",
            "genre": ", ".join(genres),
            "length": (md.get("mpris:length", 0) or 0) / 1e6,
            "art": md.get("mpris:artUrl"),
            "pos": (p.get("Position", 0) or 0) / 1e6,
        }
        if info["status"] == "Playing":
            return info
        if best is None:
            best = info
    return best


def fetch_art_async(url):
    def work():
        try:
            if url not in _art_cache:
                data = open(urllib.parse.unquote(url[7:]), "rb").read() if url.startswith("file://") else urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "lumverse/2.1"}), timeout=6).read()
                _art_cache[url] = scene.palette_and_thumb(data)
            c1, c2, card_bg, card_ink, thumb = _art_cache[url]
        except Exception:
            return
        GLib.idle_add(lambda: (setattr(st, "card_ink", card_ink), st.t1.__setitem__(slice(None), c1), st.t2.__setitem__(slice(None), c2), st.t_card_bg.__setitem__(slice(None), card_bg), st.set_art(thumb)) if st.art_url == url else False)
    threading.Thread(target=work, daemon=True).start()


def fetch_lyrics_async(key, title, artist, album, length):
    def work():
        txt = ly.fetch_synced(title, artist, album, length)
        parsed = ly.parse_lrc(txt) if txt else None
        def _apply():
            if st.track_key == key:
                st.lyrics = parsed
                st.raw_lrc = txt or ""
            return False
        GLib.idle_add(_apply)
    threading.Thread(target=work, daemon=True).start()


def poll():
    info = read_player()
    if info is None:
        st.has_player = st.playing = False
        st.t_level = 0.22
        st.t1[:], st.t2[:] = CFG["idle_color1"], CFG["idle_color2"]
        st.t_card_bg[:] = CFG["idle_color1"]
        st.art_url = None
        return True

    st.has_player = True
    playing = info["status"] == "Playing"
    st.t_level = 1.0 if playing else 0.32
    st.length = info["length"]
    st.sync_position(info["pos"], playing)

    key = (info["title"], info["artist"], info["album"], round(info["length"]))
    if key != st.track_key:
        st.track_key = key
        st.title, st.artist, st.album, st.genre = info["title"], info["artist"], info["album"], info["genre"]
        st.lyrics = None
        st.raw_lrc = ""
        st.show_card()
        if CFG["lyrics"] and info["title"]:
            fetch_lyrics_async(key, info["title"], info["artist"], info["album"], info["length"])

    art = info["art"]
    if art and scene.Image is not None and art != st.art_url:
        st.art_url = art
        fetch_art_async(art)
    return True


def start_beat():
    if not CFG["beat"] or not shutil.which("cava"):
        return
    conf = os.path.join(RUNTIME, "lumverse-cava.conf")
    with open(conf, "w") as f:
        f.write("[general]\\nbars = 32\\nframerate = 60\\n[input]\\nmethod = pulse\\nsource = auto\\n[output]\\nmethod = raw\\nraw_target = /dev/stdout\\ndata_format = ascii\\nascii_max_range = 100\\nbar_delimiter = 59\\nframe_delimiter = 10\\n")
    proc = subprocess.Popen(["cava", "-p", conf], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    atexit.register(proc.terminate)

    def work():
        avg, prev_bars, last_beat = 0.08, [0.0] * 32, 0.0
        sens = CFG.get("beat_sensitivity", 1.15)
        for line in proc.stdout:
            try:
                bars = [min(1.0, (int(x) / 100.0) * sens) for x in line.strip().split(";") if x]
            except ValueError:
                continue
            if len(bars) < 8:
                continue
            bars = bars[:32] + [0.0] * max(0, 32 - len(bars))
            flux = sum(max(0.0, b - p) * (1.5 if i < 8 else 0.7) for i, (b, p) in enumerate(zip(bars, prev_bars))) / 5.0
            prev_bars = bars
            st.bands = bars
            st.bands_t = time.monotonic()
            st.sub = sum(bars[:5]) / 5.0
            st.mid = sum(bars[10:18]) / 8.0
            st.treble = sum(bars[22:30]) / 8.0
            avg += (st.sub - avg) * 0.045
            onset = st.sub - avg * 1.18 + flux * 0.25
            now = time.monotonic()
            if onset > 0.085 and now - last_beat > 0.11:
                st.beat = max(st.beat, min(1.0, onset * 3.2 * sens))
                last_beat = now

    threading.Thread(target=work, daemon=True).start()


def on_activate(app):
    scene.load_config()
    st.style = ly.ALIASES.get(CFG["style"], CFG["style"])
    st.glow_mode = CFG.get("glow_mode", "aurora")
    st.viz_mode = CFG.get("viz_mode", "orbital")
    st.genre_mode = CFG.get("genre_mode", "auto")
    st.genre_effects = CFG.get("genre_effects", True)
    css = Gtk.CssProvider()
    css.load_from_string("window.lumverse { background: transparent; }")
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    mons = Gdk.Display.get_default().get_monitors()
    for i in range(mons.get_n_items()):
        win = Gtk.Window(application=app)
        win.add_css_class("lumverse")
        LayerShell.init_for_window(win)
        LayerShell.set_layer(win, LayerShell.Layer.OVERLAY)
        for edge in (LayerShell.Edge.TOP, LayerShell.Edge.BOTTOM, LayerShell.Edge.LEFT, LayerShell.Edge.RIGHT):
            LayerShell.set_anchor(win, edge, True)
        LayerShell.set_exclusive_zone(win, -1)
        LayerShell.set_keyboard_mode(win, LayerShell.KeyboardMode.NONE)
        LayerShell.set_namespace(win, "lumverse")
        LayerShell.set_monitor(win, mons.get_item(i))
        area = Gtk.DrawingArea()
        area.set_draw_func(lambda _a, cr, w, h, *_: scene.draw_scene(cr, w, h))
        win.set_child(area)
        areas.append(area)
        win.connect("realize", lambda w: w.get_surface().set_input_region(cairo.Region()))
        win.present()

    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))
    atexit.register(lambda: os.path.exists(PIDFILE) and os.remove(PIDFILE))
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, lambda: (setattr(st, "style", ly.STYLES[(ly.STYLES.index(st.style) + 1) % len(ly.STYLES)]), True)[1])
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR2, lambda: (st.show_card(), True)[1])
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGRTMIN, lambda: (setattr(st, "glow_mode", GLOW_MODES[(GLOW_MODES.index(st.glow_mode) + 1) % len(GLOW_MODES)]), True)[1])
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGRTMIN + 1, lambda: (setattr(st, "viz_mode", VIZ_MODES[(VIZ_MODES.index(st.viz_mode) + 1) % len(VIZ_MODES)]), True)[1])
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGRTMIN + 2, lambda: (setattr(st, "genre_mode", GENRE_THEMES[(GENRE_THEMES.index(st.genre_mode) + 1) % len(GENRE_THEMES)]), True)[1])
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, app.quit)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, app.quit)

    start_beat()
    poll()
    GLib.timeout_add(1000, poll)
    last = [time.monotonic()]
    GLib.timeout_add(int(1000 / CFG["fps"]), lambda: (st.step(min(0.1, time.monotonic() - last[0])), last.__setitem__(0, time.monotonic()), [a.queue_draw() for a in areas], True)[-1])


if __name__ == "__main__":
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    app = Gtk.Application(application_id="dev.lumverse.glow")
    app.connect("activate", on_activate)
    app.hold()
    sys.exit(app.run(None))
`;

  const upgrades = [
    {
      title: "Genre-Adaptive Visual Worlds",
      before: "Same static perimeter glow across every music genre.",
      after: "Reads MPRIS/ID3 xesam:genre, title, & lyrics to render blooming flowers & hearts (Romantic), prism shards (Electronic), shockwaves (Bass), leaves & rain (Lo-Fi), lightning (Rock), and golden ribbons (Classical).",
    },
    {
      title: "Multi-Source Real Lyrics (LRCLIB + NetEase)",
      before: "Only checked LRCLIB and stripped <mm:ss.xx> inline word tags.",
      after: "Fetches real synced LRC from LRCLIB + NetEase fallback, preserves word timestamps, and never fabricates lyrics.",
    },
    {
      title: "4-Mode Procedural Visualizer on No-Lyrics / Gaps",
      before: "Blank screen if no synced lyrics existed, plus plain 10-bar cava rectangle.",
      after: "32-band Cairo Orbital Rings, Horizon Terrain, Lissajous Scope, and Radial Turbine activate smoothly when lyrics are absent.",
    },
    {
      title: "Perceptual Contrast-Safe Palette Engine",
      before: "12-hue buckets with hardcoded dark ink on card_bg — dark covers made card text unreadable.",
      after: "24-hue × 2-lightness clustering with hue-separation check and automatic WCAG >= 4.8:1 ink/surface adjustment.",
    },
    {
      title: "Seamless Multi-Band Edge Glow",
      before: "4 overlapping rectangular linear gradients causing diagonal corner seams.",
      after: "Cosine-eased segmented perimeter glow + sub-bass depth, mid-range wave velocity, and treble rim sparkle.",
    },
  ];

  return { configJson, scenePy, lyricsPy, lumversePy, upgrades };
}

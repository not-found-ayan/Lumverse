"""lumverse scene: state + everything that gets painted (no GTK needed)."""
import colorsys
import io
import json
import math
import os
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
    "thickness": 150,        # glow depth (px at 1080p)
    "max_alpha": 1.0,
    "fps": 45,
    "rim": True,             # hard light line on the very edge
    "beat": True,            # pulse to music via cava
    "lyrics": True,
    "style": "wipe",         # wipe | slam | burst | code
    "uppercase": True,       # SHOUT the lyrics (no effect on Hindi, CJK, ...)
    "font": "Inter, Noto Sans, Sans",   # try "Anton, Inter" for condensed
    "lyrics_offset": 0.0,    # seconds; + shows lyrics earlier
    "card": "onchange",      # always | onchange | off
    "card_seconds": 8,
    "idle_color1": [0.0, 1.0, 0.47],
    "idle_color2": [0.0, 0.75, 1.0],
}


def load_config():
    path = os.path.join(os.path.expanduser("~/.config/lumverse"), "config.json")
    try:
        with open(path) as f:
            CFG.update(json.load(f))
    except (OSError, ValueError):
        pass


# ----------------------------------------------------------------- state ----
class State:
    def __init__(self):
        self.c1, self.c2 = list(CFG["idle_color1"]), list(CFG["idle_color2"])
        self.t1, self.t2 = list(self.c1), list(self.c2)
        self.level = self.t_level = 0.25
        self.beat = 0.0
        self.energy = 0.0
        self.bands = [0.0] * 10          # raw, written by the cava thread
        self.bands_t = 0.0
        self.bands_disp = [0.0] * 10     # smoothed for drawing
        self.title = self.artist = self.album = ""
        self.length = 0.0
        self.track_key = None
        self.art_url = None
        self.art_surface = None
        self._art_buf = None
        self.lyrics = None
        self.playing = False
        self.has_player = False
        self.pos_base = 0.0
        self.pos_wall = time.monotonic()
        self.card_until = 0.0
        self.card_p = 0.0
        self.card_dir = 1
        self.style = CFG["style"]

    def position(self):
        if self.playing:
            return self.pos_base + time.monotonic() - self.pos_wall
        return self.pos_base

    def sync_position(self, reported, playing):
        est = self.position()
        now = time.monotonic()
        if playing and self.playing and abs(reported - est) < 0.3:
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
        k = 1 - math.pow(0.93, f)
        for cur, tgt in ((self.c1, self.t1), (self.c2, self.t2)):
            for i in range(3):
                cur[i] += (tgt[i] - cur[i]) * k
        self.level += (self.t_level - self.level) * (1 - math.pow(0.95, f))
        self.beat *= math.pow(0.88, f)

        live = time.monotonic() - self.bands_t < 1.0
        now = time.time()
        for i in range(10):
            if live:
                tgt = self.bands[i]
            else:   # no cava: fake a bouncy eq from the beat/energy
                tgt = (self.energy * 0.6 + self.beat * 0.5) * \
                    (0.55 + 0.45 * math.sin(now * (3 + i * 0.7) + i))
            d = self.bands_disp[i]
            self.bands_disp[i] += (tgt - d) * (0.55 if tgt > d else 0.14)

        mode = CFG["card"]
        want = 1.0 if (mode == "always" or (mode == "onchange" and
                                            time.monotonic() < self.card_until)) \
            else 0.0
        if mode == "off":
            want = 0.0
        if want > self.card_p:
            self.card_dir = 1
            self.card_p = min(want, self.card_p + dt * 2.6)
        elif want < self.card_p:
            self.card_dir = -1
            self.card_p = max(want, self.card_p - dt * 3.2)


st = State()
renderer = ly.Renderer()


# --------------------------------------------------------------- palette ----
def palette_and_thumb(data):
    """Two vivid RGB (0..1) colors + a small PIL thumbnail from art bytes."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    thumb = img.resize((220, 220))
    raw = img.resize((48, 48)).tobytes()
    buckets = {}
    for i in range(0, len(raw), 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if v < 0.25 or s < 0.25:
            continue
        acc = buckets.setdefault(int(hh * 12) % 12, [0.0, 0.0, 0.0, 0.0])
        wt = s * v
        acc[0] += r * wt
        acc[1] += g * wt
        acc[2] += b * wt
        acc[3] += wt

    def norm(a):
        r, g, b = a[0] / a[3], a[1] / a[3], a[2] / a[3]
        m = max(r, g, b) or 1
        return (r / m, g / m, b / m)

    if not buckets:
        return (0.9, 0.9, 1.0), (0.5, 0.55, 0.7), thumb
    ranked = sorted(buckets.values(), key=lambda a: a[3], reverse=True)
    c1 = norm(ranked[0])
    if len(ranked) > 1:
        c2 = norm(ranked[1])
    else:
        hh, s, v = colorsys.rgb_to_hsv(*c1)
        c2 = colorsys.hsv_to_rgb((hh + 0.08) % 1.0, s, v)
    return c1, c2, thumb


# ------------------------------------------------------------------ glow ----
def _mix(a, b, k):
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k,
            a[2] + (b[2] - a[2]) * k)


def _edge_color(u, tt, tint=0.0):
    k = 0.5 + 0.5 * math.sin(2 * math.pi * (u * 2 + tt * 0.06))
    c = _mix(st.c1, st.c2, k)
    return _mix(c, (1, 1, 1), tint) if tint else c


def _color_pat(x0, y0, x1, y1, u0, u1, tt, tint):
    p = cairo.LinearGradient(x0, y0, x1, y1)
    n = 14
    for i in range(n + 1):
        f = i / n
        p.add_color_stop_rgb(f, *_edge_color(u0 + (u1 - u0) * f, tt, tint))
    return p


def _alpha_pat(x0, y0, x1, y1, a, power):
    p = cairo.LinearGradient(x0, y0, x1, y1)
    n = 8
    for i in range(n + 1):
        f = i / n
        p.add_color_stop_rgba(f, 0, 0, 0, a * (1 - f) ** power)
    return p


def _glow_layer(cr, w, h, T, a, tt, power=2.0, tint=0.0):
    P = 2.0 * (w + h)
    ut, ur, ub, ul = 0.0, w / P, (w + h) / P, (2 * w + h) / P
    edges = (
        ((0, 0, w, T), (0, 0, w, 0, ut, ur), (0, 0, 0, T)),
        ((w - T, 0, T, h), (0, 0, 0, h, ur, ub), (w, 0, w - T, 0)),
        ((0, h - T, w, T), (w, 0, 0, 0, ub, ul), (0, h, 0, h - T)),
        ((0, 0, T, h), (0, h, 0, 0, ul, 1.0), (0, 0, T, 0)),
    )
    cr.set_operator(cairo.OPERATOR_ADD)
    for rect, (x0, y0, x1, y1, u0, u1), al in edges:
        cr.save()
        cr.rectangle(*rect)
        cr.clip()
        cr.set_source(_color_pat(x0, y0, x1, y1, u0, u1, tt, tint))
        cr.mask(_alpha_pat(*al, a, power))
        cr.restore()
    cr.set_operator(cairo.OPERATOR_OVER)


def draw_glow(cr, w, h, S, tt):
    breathe = 0.90 + 0.10 * math.sin(tt * 1.6)
    boost = 1.0 + 0.7 * st.beat + 0.35 * st.energy
    a = min(1.0, st.level * CFG["max_alpha"] * breathe * boost * 0.85)
    T = CFG["thickness"] * S * (1 + 0.45 * st.beat + 0.2 * st.energy)

    _glow_layer(cr, w, h, T, a, tt, 2.0)                       # wide bloom
    _glow_layer(cr, w, h, T * 0.32, min(1.0, a * 1.1), tt, 1.6)  # dense core

    # corner hot-spots
    R = T * 2.3
    cr.set_operator(cairo.OPERATOR_ADD)
    for x, y, u in ((0, 0, 0.0), (w, 0, 0.25), (w, h, 0.5), (0, h, 0.75)):
        c = _edge_color(u, tt)
        g = cairo.RadialGradient(x, y, 0, x, y, R)
        g.add_color_stop_rgba(0, *c, 0.55 * a)
        g.add_color_stop_rgba(1, *c, 0)
        cr.set_source(g)
        cr.arc(x, y, R, 0, 2 * math.pi)
        cr.fill()
    cr.set_operator(cairo.OPERATOR_OVER)

    if st.beat > 0.06:                                         # white-hot hit
        _glow_layer(cr, w, h, T * 0.16, min(1.0, st.beat * 0.9), tt, 1.4,
                    tint=0.75)
    if CFG["rim"]:
        _glow_layer(cr, w, h, max(5.0, 9 * S), min(1.0, a * 1.7), tt, 1.0,
                    tint=0.25)


# ------------------------------------------------------------------ card ----
def _fmt(sec):
    sec = max(0, int(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _col_from(c, k=0.0):
    return ly.lighten(tuple(c), k) if k else tuple(c)


def draw_card(cr, w, h, S):
    p = st.card_p
    if p <= 0.01 or not st.title:
        return
    e = ly.ease_out_back(p, 1.5) if st.card_dir > 0 else ly.ease_in_cubic(p)
    cw, ch = 540 * S, 185 * S
    pad = 16 * S
    margin = 56 * S
    off = 11 * S
    ink = (0.04, 0.04, 0.05)
    x = margin - (1 - e) * (cw + margin + 40 * S)
    y = h - margin - ch
    ang = -0.04 + (1 - e) * -0.22        # settles at about -2.3 degrees

    cr.save()
    cr.translate(x, y + ch)
    cr.rotate(ang)
    cr.translate(0, -ch)

    # slab with hard shadow
    cr.set_source_rgba(*ink, 0.95)
    cr.rectangle(off, off, cw, ch)
    cr.fill()
    cr.set_source_rgb(*st.c1)
    cr.rectangle(0, 0, cw, ch)
    cr.fill_preserve()
    cr.set_source_rgb(*ink)
    cr.set_line_width(max(3.0, 5 * S))
    cr.stroke()

    # album art
    art = ch - 2 * pad
    ax, ay = pad, pad
    aoff = 7 * S
    cr.set_source_rgba(*ink, 1)
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
    cr.set_source_rgb(*ink)
    cr.set_line_width(max(3.0, 4 * S))
    cr.rectangle(ax, ay, art, art)
    cr.stroke()

    # text
    tx = ax + art + aoff + pad
    tw = cw - tx - pad
    r = renderer
    title = r.up(st.title)
    lt = r.layout(title, 30 * S, weight=Pango.Weight.HEAVY, width=tw,
                  ellipsize=True, align=Pango.Alignment.LEFT)
    r.fill(cr, lt, tx, pad - 2 * S, (*ink, 1))
    la = r.layout(r.up(st.artist), 17 * S, weight=Pango.Weight.BOLD, width=tw,
                  ellipsize=True, align=Pango.Alignment.LEFT)
    r.fill(cr, la, tx, pad + 40 * S, (*ink, 0.78))

    # equalizer
    by = ch - pad - 30 * S                       # progress bar top
    top, bot = pad + 70 * S, by - 10 * S
    n = 10
    gap = 5 * S
    bw = (tw - gap * (n - 1)) / n
    for i in range(n):
        v = ly.clamp(st.bands_disp[i] * 1.25)
        bh = max(4 * S, v * (bot - top))
        cr.set_source_rgb(*ink)
        cr.rectangle(tx + i * (bw + gap), bot - bh, bw, bh)
        cr.fill()

    # progress
    bh = max(8.0, 11 * S)
    frac = ly.clamp(st.position() / st.length) if st.length > 0 else 0.0
    cr.set_source_rgba(*ink, 0.25)
    cr.rectangle(tx, by, tw, bh)
    cr.fill()
    cr.set_source_rgb(*ink)
    cr.rectangle(tx, by, max(bh, tw * frac), bh)
    cr.fill()
    for txt, align in ((_fmt(st.position()), Pango.Alignment.LEFT),
                       (_fmt(st.length), Pango.Alignment.RIGHT)):
        lab = r.layout(txt, 13 * S, weight=Pango.Weight.BOLD, width=tw,
                       align=align)
        r.fill(cr, lab, tx, by + bh + 3 * S, (*ink, 0.8))
    cr.restore()


# --------------------------------------------------------------- compose ----
def draw_scene(cr, w, h):
    cr.set_operator(cairo.OPERATOR_CLEAR)
    cr.paint()
    cr.set_operator(cairo.OPERATOR_OVER)
    S = h / 1080.0
    tt = time.time()
    renderer.upper = CFG["uppercase"]
    renderer.font = CFG["font"]
    draw_glow(cr, w, h, S, tt)
    if CFG["lyrics"] and st.lyrics is not None and st.has_player:
        accent = tuple(st.c1)
        shadow = ly.darken(tuple(st.c2), 0.45)
        fade = 1.0 if st.playing else 0.6
        renderer.draw(cr, w, h, st.lyrics,
                      st.position() + CFG["lyrics_offset"], st.style, accent,
                      shadow, fade, st.beat)
    draw_card(cr, w, h, S)

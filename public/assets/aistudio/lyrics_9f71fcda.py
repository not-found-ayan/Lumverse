"""
lumverse lyrics
  - fetch real, human-made synced lyrics from LRCLIB (any language)
  - parse LRC, spread timing across words inside each line
  - render with Pango (proper shaping for Hindi, Bengali, Arabic, CJK, ...)

Styles: karaoke (word wipe), kinetic (words pop in), code (typed, red cursor)
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
UA = "lumverse/0.2 (personal ambient lyrics overlay)"
CACHE = os.path.join(
    os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")),
    "lumverse", "lyrics")

FONT_UI = "Inter, Noto Sans, Sans"
FONT_MONO = "JetBrainsMono Nerd Font, JetBrains Mono, monospace"
STYLES = ("wipe", "slam", "burst", "code")
ALIASES = {"karaoke": "wipe", "kinetic": "slam"}


# ----------------------------------------------------------------- fetch ----
def _get_json(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _clean_title(t):
    t = re.sub(r"\s*[\(\[][^)\]]*(feat|ft\.|with|remaster|live|version|edit|"
               r"from|official|lyric|audio)[^)\]]*[\)\]]", "", t, flags=re.I)
    t = re.sub(r"\s+-\s+(remaster|live|single|radio|from|\d{4}).*$", "", t,
               flags=re.I)
    return t.strip()


def _lookup(title, artist, album, dur):
    """Return raw LRC text or None. Raises on network failure."""
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
    cands = []
    for params in ({"track_name": clean, "artist_name": primary},
                   {"q": f"{clean} {primary}"},
                   {"q": clean}):
        try:
            res = _get_json(f"{API}/search?{urllib.parse.urlencode(params)}")
        except urllib.error.HTTPError:
            continue
        cands = [r for r in res if r.get("syncedLyrics")]
        if cands:
            break
    if not cands:
        return None
    if dur:
        cands.sort(key=lambda r: abs((r.get("duration") or 0) - dur))
        if abs((cands[0].get("duration") or 0) - dur) > 8:
            return None
    return cands[0]["syncedLyrics"]


def fetch_synced(title, artist, album, dur):
    """Blocking. Returns LRC text or None. Cached on disk."""
    key = hashlib.sha1(
        f"{title}|{artist}|{album}|{int(dur)}".encode()).hexdigest()
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
        return None  # network trouble: don't cache
    try:
        os.makedirs(CACHE, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"synced": txt, "ts": time.time()}, f)
    except OSError:
        pass
    return txt


# ----------------------------------------------------------------- parse ----
_TS = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
_INLINE = re.compile(r"<\d+:\d+(?:\.\d+)?>")
_CJK = "\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef"
_TOK = re.compile(rf"[{_CJK}]|[^\s{_CJK}]+")
Token = collections.namedtuple("Token", "text space t0 t1")


class Line:
    __slots__ = ("t", "text", "t1", "_tok")

    def __init__(self, t, text):
        self.t, self.text, self.t1, self._tok = t, text, t + 1, None


def tokens(line):
    """Words (or single CJK chars) with timing spread across the line."""
    if line._tok is None:
        raw = []
        for m in _TOK.finditer(line.text):
            nxt = line.text[m.end():m.end() + 1]
            raw.append((m.group(), nxt.isspace()))
        weights = [len(tx) + 0.5 for tx, _ in raw]
        total = sum(weights) or 1
        span = line.t1 - line.t
        acc, out = 0.0, []
        for (tx, sp), wt in zip(raw, weights):
            out.append(Token(tx, sp, line.t + span * acc / total,
                             line.t + span * (acc + wt) / total))
            acc += wt
        line._tok = out
    return line._tok


class Lyrics:
    def __init__(self, lines):
        self.lines = lines
        self.starts = [ln.t for ln in lines]

    def index_at(self, t):
        return bisect.bisect_right(self.starts, t) - 1


def parse_lrc(text):
    rows = []
    for raw in text.splitlines():
        stamps = _TS.findall(raw)
        if not stamps:
            continue
        body = _INLINE.sub("", _TS.sub("", raw)).strip()
        for m, s in stamps:
            rows.append((int(m) * 60 + float(s), body))
    rows.sort(key=lambda r: r[0])
    lines = [Line(t, b) for t, b in rows]
    for i, ln in enumerate(lines):
        nxt = lines[i + 1].t if i + 1 < len(lines) else ln.t + 6
        guess = ln.t + max(0.9, 0.14 * len(ln.text) + 0.7)
        ln.t1 = max(ln.t + 0.5, min(nxt - 0.08, guess))
    return Lyrics(lines) if lines else None


# ---------------------------------------------------------------- easing ----
def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def ease_out_cubic(x):
    return 1 - (1 - x) ** 3


def ease_in_cubic(x):
    return x ** 3


def ease_out_expo(x):
    return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)


def ease_out_back(x, c1=1.70158):
    c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2


def lighten(c, k=0.45):
    return tuple(v + (1 - v) * k for v in c)


def darken(c, k=0.4):
    return tuple(v * (1 - k) for v in c)


# -------------------------------------------------------------- renderer ----
class Renderer:
    """Big, loud type. Everything is drawn as glyph paths so it can be
    outlined, filled, shadowed and scaled freely."""

    def __init__(self):
        self.ctx = PangoCairo.font_map_get_default().create_context()
        self._lay = {}
        self._cl = {}
        self.upper = True
        self.font = FONT_UI

    def up(self, s):
        return s.upper() if self.upper else s

    # layouts -----------------------------------------------------------
    def layout(self, text, px, weight=Pango.Weight.HEAVY, family=None,
               width=None, align=Pango.Alignment.CENTER, ellipsize=False):
        key = (text, round(px), int(weight), family or self.font,
               width and round(width), align, ellipsize)
        lay = self._lay.get(key)
        if lay is None:
            if len(self._lay) > 500:
                self._lay.clear()
                self._cl.clear()
            lay = Pango.Layout.new(self.ctx)
            fd = Pango.FontDescription()
            fd.set_family(family or self.font)
            fd.set_weight(weight)
            fd.set_absolute_size(px * SC)
            lay.set_font_description(fd)
            try:
                lay.set_line_spacing(0.92)
            except AttributeError:
                pass
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

    # drawing primitives (all path based) --------------------------------
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
        """Hard offset shadow + solid fill: the 'loud poster' look."""
        self.fill(cr, lay, x + off, y + off, (*shadow, a))
        self.fill(cr, lay, x, y, (*color, a))

    # clusters for the wipe ----------------------------------------------
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

    # entry point -------------------------------------------------------
    def draw(self, cr, w, h, lyr, t, style, accent, shadow, alpha, beat=0.0):
        if lyr is None or alpha <= 0.01:
            return
        i = lyr.index_at(t)
        if i < 0:
            return
        lines = lyr.lines
        cur = lines[i]
        since = t - cur.t
        a = alpha
        if not cur.text:                       # instrumental gap
            j = i - 1
            while j >= 0 and not lines[j].text:
                j -= 1
            if j < 0:
                return
            a *= 1 - clamp(since / 0.5)
            if a <= 0.01:
                return
            cur, since = lines[j], 99.0
            t = cur.t1 + 99
        else:
            tail = t - cur.t1
            if tail > 1.2:
                a *= 1 - clamp((tail - 1.2) / 0.8)
                if a <= 0.01:
                    return
        k = i - 1
        while k >= 0 and not lines[k].text:
            k -= 1
        prev = lines[k] if k >= 0 and lines[k] is not cur else None
        nxt = lines[i + 1] if i + 1 < len(lines) and lines[i + 1].text \
            and lines[i + 1] is not cur else None

        style = ALIASES.get(style, style)
        fn = {"wipe": self._wipe, "slam": self._slam, "burst": self._burst,
              "code": self._code}.get(style, self._wipe)

        cr.save()                              # beat shake + pulse
        sh = beat * h * 0.0045
        cr.translate(math.sin(t * 53.0) * sh, math.cos(t * 47.0) * sh)
        pv = 1 + 0.035 * beat
        cr.translate(w / 2, h * 0.56)
        cr.scale(pv, pv)
        cr.translate(-w / 2, -h * 0.56)
        fn(cr, w, h, cur, prev, nxt, t, since, accent, shadow, a)
        cr.restore()

    # style: wipe -------------------------------------------------------
    def _wipe_block(self, cr, w, h, line, t, accent, shadow, a, dy, scale,
                    filled, hint=None, hint_a=0.0):
        size = h * 0.088
        maxw = w * 0.80
        off = max(3.0, size * 0.06)
        text = self.up(line.text)
        lay = self.layout(text, size, width=maxw)
        lh = lay.get_pixel_size()[1]
        cr.save()
        cr.translate(w / 2, h * 0.56 + dy)
        cr.scale(scale, scale)
        cr.translate(-maxw / 2, -lh / 2)

        # unsung: hollow outline
        self.outline(cr, lay, 0, 0, (*lighten(accent, 0.35), 0.6 * a),
                     max(2.0, size * 0.028))

        f = 1.0 if filled else clamp((t - line.t) / max(0.1, line.t1 - line.t))
        rects = self._wipe_rects(lay, text, f, pad_y=off + 2)
        if rects:
            cr.save()
            cr.new_path()
            for r in rects:
                cr.rectangle(*r)
            cr.clip()
            cr.new_path()
            PangoCairo.layout_path(cr, lay)
            cr.set_line_join(cairo.LINE_JOIN_ROUND)
            cr.set_source_rgba(*accent, 0.20 * a)
            cr.set_line_width(size * 0.20)
            cr.stroke_preserve()
            cr.set_source_rgba(*accent, 0.35 * a)
            cr.set_line_width(size * 0.08)
            cr.stroke()
            cr.restore()
            cr.save()
            cr.new_path()
            for r in rects:
                cr.rectangle(*r)
            cr.clip()
            self.poster(cr, lay, 0, 0, (1, 1, 1), shadow, off, a)
            cr.restore()
        cr.restore()

        if hint is not None and hint_a > 0.01:      # next line teaser
            hl = self.layout(self.up(hint.text), size * 0.36, width=maxw)
            hh = hl.get_pixel_size()[1]
            y = h * 0.56 + dy + lh * scale / 2 + size * 0.28
            self.outline(cr, hl, (w - maxw) / 2, y,
                         (*lighten(accent, 0.3), 0.5 * hint_a),
                         max(1.2, size * 0.012))

    def _wipe(self, cr, w, h, cur, prev, nxt, t, since, accent, shadow, a):
        size = h * 0.088
        u = ease_out_expo(clamp(since / 0.30))
        if prev and since < 0.30:                   # old line punches out
            v = clamp(since / 0.30)
            self._wipe_block(cr, w, h, prev, prev.t1 + 99, accent, shadow,
                             a * (1 - v), -v * size * 0.7, 1 - 0.1 * v, True)
        self._wipe_block(cr, w, h, cur, t, accent, shadow, a * min(1.0, u * 1.6),
                         (1 - u) * size * 0.45, 1.22 - 0.22 * u, False,
                         hint=nxt, hint_a=a * u)

    # style: slam -------------------------------------------------------
    def _flow(self, line, size, maxw):
        gapx = size * 0.26
        items = []
        for tk in tokens(line):
            lay = self.layout(self.up(tk.text), size)
            tw, th = lay.get_pixel_size()
            items.append((lay, tw, th, tk))
        rows, row, rw = [], [], 0.0
        for it in items:
            g = gapx if (row and row[-1][3].space) else 0
            if row and rw + g + it[1] > maxw:
                rows.append((row, rw))
                row, rw, g = [], 0.0, 0
            row.append(it)
            rw += g + it[1]
        if row:
            rows.append((row, rw))
        return rows, gapx

    def _slam_block(self, cr, w, h, line, t, accent, shadow, a, dy, static):
        size = h * 0.085
        rows, gapx = self._flow(line, size, w * 0.82)
        lh = size * 1.08
        y0 = h * 0.56 - len(rows) * lh / 2 + dy
        off = max(3.0, size * 0.06)
        hot = lighten(accent, 0.45)
        for ri, (row, rw) in enumerate(rows):
            x = (w - rw) / 2
            y = y0 + ri * lh
            for k, (lay, tw, th, tk) in enumerate(row):
                if k > 0 and row[k - 1][3].space:
                    x += gapx
                cx, cy = x + tw / 2, y + lh / 2
                u = 1.0 if static else clamp((t - tk.t0) / 0.24)
                # ghost outline is always there
                self.outline(cr, lay, x, cy - th / 2,
                             (*lighten(accent, 0.3), 0.5 * a * (1 - u * 0.7)),
                             max(2.0, size * 0.026))
                if u > 0:
                    live = (not static) and tk.t0 <= t < tk.t1
                    s = 1 + (1 - ease_out_expo(u)) * 0.9
                    s *= 1.05 if live else 1.0
                    cr.save()
                    cr.translate(cx, cy)
                    cr.scale(s, s)
                    col = hot if live else (1, 1, 1)
                    self.poster(cr, lay, -tw / 2, -th / 2, col, shadow, off,
                                a * clamp(u * 4))
                    cr.restore()
                x += tw

    def _slam(self, cr, w, h, cur, prev, nxt, t, since, accent, shadow, a):
        size = h * 0.085
        if prev and since < 0.28:
            v = clamp(since / 0.28)
            self._slam_block(cr, w, h, prev, 0, accent, shadow, a * (1 - v),
                             -v * size * 0.7, True)
        self._slam_block(cr, w, h, cur, t, accent, shadow, a, 0, False)

    # style: burst (one giant word at a time) ------------------------------
    def _burst(self, cr, w, h, cur, prev, nxt, t, since, accent, shadow, a):
        toks = tokens(cur)
        k = 0
        for n, tk in enumerate(toks):
            if tk.t0 <= t:
                k = n
        tk = toks[k]
        base = h * 0.24
        cols = ((1, 1, 1), lighten(accent, 0.5), lighten(shadow, 0.55))
        cx, cy = w / 2, h * 0.40

        def word(token, idx, u, ghost):
            lay = self.layout(self.up(token.text), base)
            tw, th = lay.get_pixel_size()
            fit = min(1.0, (w * 0.86) / max(tw, 1))
            if ghost:
                s = fit * (1 + 0.6 * u)
                al = (1 - u) * 0.45
            else:
                s = fit * (0.4 + 0.6 * ease_out_back(clamp(u), 2.4))
                al = clamp(u * 5)
            rot = (((idx * 37 + int(cur.t * 13)) % 7) - 3) * 0.012
            cr.save()
            cr.translate(cx, cy)
            cr.rotate(rot)
            cr.scale(s, s)
            if ghost:
                self.outline(cr, lay, -tw / 2, -th / 2,
                             (*lighten(accent, 0.4), al), max(2.0, base * 0.02))
            else:
                self.poster(cr, lay, -tw / 2, -th / 2, cols[idx % 3], shadow,
                            max(4.0, base * 0.045), a * al)
            cr.restore()

        u = (t - tk.t0) / 0.20
        if k > 0 and u < 1:
            word(toks[k - 1], k - 1, clamp(u), True)
        if t >= tk.t0:
            word(tk, k, u, False)

        # the whole line, small, with a live wipe underneath
        size = h * 0.042
        maxw = w * 0.72
        text = self.up(cur.text)
        lay = self.layout(text, size, width=maxw)
        lh = lay.get_pixel_size()[1]
        ox, oy = (w - maxw) / 2, h * 0.72 - lh / 2
        self.fill(cr, lay, ox, oy, (1, 1, 1, 0.28 * a))
        f = clamp((t - cur.t) / max(0.1, cur.t1 - cur.t))
        rects = self._wipe_rects(lay, text, f, pad_y=2)
        if rects:
            cr.save()
            cr.translate(ox, oy)
            cr.new_path()
            for r in rects:
                cr.rectangle(*r)
            cr.clip()
            cr.new_path()
            PangoCairo.layout_path(cr, lay)
            cr.set_source_rgba(1, 1, 1, a)
            cr.fill()
            cr.restore()

    # style: code -------------------------------------------------------
    def _code(self, cr, w, h, cur, prev, nxt, t, since, accent, shadow, a):
        size = h * 0.040
        maxw = w * 0.62
        x0 = (w - maxw) / 2
        fam = FONT_MONO
        wt = Pango.Weight.BOLD
        e = ease_out_expo(clamp(since / 0.3))
        prompt = self.layout("> ", size, weight=wt, family=fam)
        pw = prompt.get_pixel_size()[0]
        f = clamp((t - cur.t) / max(0.2, (cur.t1 - cur.t) * 0.85))
        n = int(f * len(cur.text) + 1e-6)
        typed = cur.text[:n]
        lt = self.layout(typed, size, weight=wt, family=fam, width=maxw - pw,
                         align=Pango.Alignment.LEFT)
        th = max(lt.get_pixel_size()[1], size * 1.3)
        ytop = h * 0.60 - th / 2 + (1 - e) * size

        if prev:
            lp = self.layout("// " + prev.text, size * 0.75, weight=wt,
                             family=fam, width=maxw, align=Pango.Alignment.LEFT)
            hp = lp.get_pixel_size()[1]
            self.fill(cr, lp, x0, ytop - size * 0.6 - hp,
                      (0.45, 0.9, 0.55, 0.5 * a))
        self.fill(cr, prompt, x0, ytop, (*accent, a))
        self.poster(cr, lt, x0 + pw, ytop, (1, 1, 1), shadow, max(2.0, size * 0.06),
                    a * e)

        blink = n < len(cur.text) or int(time.time() * 2) % 2 == 0
        if blink:
            strong, _ = lt.get_cursor_pos(len(typed.encode("utf-8")))
            cx = x0 + pw + strong.x / SC
            cy = ytop + strong.y / SC
            ch = max(strong.height / SC, size * 1.2)
            cr.set_source_rgba(1.0, 0.2, 0.28, 0.30 * a)
            cr.rectangle(cx - 3, cy - 3, size * 0.6 + 6, ch + 6)
            cr.fill()
            cr.set_source_rgba(1.0, 0.25, 0.32, a)
            cr.rectangle(cx, cy, size * 0.6, ch)
            cr.fill()

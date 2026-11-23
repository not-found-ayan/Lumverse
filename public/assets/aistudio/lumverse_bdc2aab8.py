#!/usr/bin/env python3
"""
lumverse - ambient glow + now-playing card + synced lyrics for Hyprland/Wayland

Run:      /usr/bin/python3 lumverse.py
Control:  /usr/bin/python3 lumverse.py style   (cycle wipe/slam/burst/code)
          /usr/bin/python3 lumverse.py card    (peek the now-playing card)
Config:   ~/.config/lumverse/config.json  (see CFG in scene.py for keys)

Deps:     sudo pacman -S gtk4-layer-shell python-gobject python-cairo \
                         python-pillow cava
"""
import ctypes.util
import os
import signal
import sys

RUNTIME = os.environ.get("XDG_RUNTIME_DIR", "/tmp")
PIDFILE = os.path.join(RUNTIME, "lumverse.pid")

# --- tiny remote control (no GTK needed) ------------------------------------
if len(sys.argv) > 1 and sys.argv[1] in ("style", "card"):
    sig = {"style": signal.SIGUSR1, "card": signal.SIGUSR2}[sys.argv[1]]
    try:
        with open(PIDFILE) as f:
            os.kill(int(f.read().strip()), sig)
    except (OSError, ValueError):
        sys.exit("lumverse is not running")
    sys.exit(0)

# gtk4-layer-shell must be loaded before libwayland: re-exec with LD_PRELOAD.
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
POLL_MS = 1000
LEVEL_PLAYING, LEVEL_PAUSED, LEVEL_IDLE = 1.0, 0.30, 0.22

bus = None
areas = []


# ----------------------------------------------------------------- MPRIS ----
def _call(dest, path, iface, method, args, reply):
    return bus.call_sync(dest, path, iface, method, args,
                         GLib.VariantType(reply), Gio.DBusCallFlags.NONE,
                         500, None).unpack()[0]


def read_player():
    """Best MPRIS player as a dict, preferring one that is Playing."""
    try:
        names = _call("org.freedesktop.DBus", "/org/freedesktop/DBus",
                      "org.freedesktop.DBus", "ListNames", None, "(as)")
    except GLib.Error:
        return None
    best = None
    for n in names:
        if not n.startswith(MPRIS_PREFIX) or n.endswith("playerctld"):
            continue
        try:
            p = _call(n, MPRIS_PATH, "org.freedesktop.DBus.Properties",
                      "GetAll", GLib.Variant("(s)", (MPRIS_PLAYER,)),
                      "(a{sv})")
        except GLib.Error:
            continue
        md = p.get("Metadata", {})
        artists = md.get("xesam:artist") or []
        if isinstance(artists, str):
            artists = [artists]
        info = {
            "status": p.get("PlaybackStatus", "Stopped"),
            "title": md.get("xesam:title", "") or "",
            "artist": ", ".join(artists),
            "album": md.get("xesam:album", "") or "",
            "length": (md.get("mpris:length", 0) or 0) / 1e6,
            "art": md.get("mpris:artUrl"),
            "pos": (p.get("Position", 0) or 0) / 1e6,
        }
        if info["status"] == "Playing":
            return info
        if best is None:
            best = info
    return best


# ----------------------------------------------------- async art + lyrics ----
def _load_bytes(url):
    if url.startswith("file://"):
        with open(urllib.parse.unquote(url[7:]), "rb") as f:
            return f.read()
    req = urllib.request.Request(url, headers={"User-Agent": "lumverse/0.2"})
    with urllib.request.urlopen(req, timeout=6) as r:
        return r.read()


_art_cache = {}


def fetch_art_async(url):
    def work():
        try:
            if url not in _art_cache:
                _art_cache[url] = scene.palette_and_thumb(_load_bytes(url))
            c1, c2, thumb = _art_cache[url]
        except Exception as e:
            print(f"[lumverse] art error: {e}", file=sys.stderr)
            return

        def apply():
            if st.art_url == url:
                st.t1[:], st.t2[:] = c1, c2
                st.set_art(thumb)
            return False

        GLib.idle_add(apply)

    threading.Thread(target=work, daemon=True).start()


def fetch_lyrics_async(key, title, artist, album, length):
    def work():
        txt = ly.fetch_synced(title, artist, album, length)
        parsed = ly.parse_lrc(txt) if txt else None

        def apply():
            if st.track_key == key:
                st.lyrics = parsed
                print(f"[lumverse] lyrics for '{title}': "
                      f"{'found' if parsed else 'none'}", file=sys.stderr)
            return False

        GLib.idle_add(apply)

    threading.Thread(target=work, daemon=True).start()


# ------------------------------------------------------------------ poll ----
def poll():
    info = read_player()
    if info is None:
        st.has_player = False
        st.playing = False
        st.t_level = LEVEL_IDLE
        st.t1[:], st.t2[:] = CFG["idle_color1"], CFG["idle_color2"]
        st.art_url = None
        return True

    st.has_player = True
    playing = info["status"] == "Playing"
    st.t_level = LEVEL_PLAYING if playing else LEVEL_PAUSED
    st.length = info["length"]
    st.sync_position(info["pos"], playing)

    key = (info["title"], info["artist"], info["album"], round(info["length"]))
    if key != st.track_key:
        st.track_key = key
        st.title, st.artist, st.album = info["title"], info["artist"], info["album"]
        st.lyrics = None
        st.show_card()
        if CFG["lyrics"] and info["title"]:
            fetch_lyrics_async(key, info["title"], info["artist"],
                               info["album"], info["length"])

    art = info["art"]
    if art and scene.Image is not None and art != st.art_url:
        st.art_url = art
        fetch_art_async(art)
    elif not art and st.art_url:
        st.art_url = None
        st.art_surface = None
    return True


# ------------------------------------------------------------ beat (cava) ----
def start_beat():
    if not CFG["beat"]:
        return
    if not shutil.which("cava"):
        print("[lumverse] cava not found: no beat pulse "
              "(sudo pacman -S cava)", file=sys.stderr)
        return
    conf = os.path.join(RUNTIME, "lumverse-cava.conf")
    with open(conf, "w") as f:
        f.write("[general]\nbars = 10\nframerate = 60\n"
                "[input]\nmethod = pulse\nsource = auto\n"
                "[output]\nmethod = raw\nraw_target = /dev/stdout\n"
                "data_format = ascii\nascii_max_range = 100\n"
                "bar_delimiter = 59\nframe_delimiter = 10\n")
    proc = subprocess.Popen(["cava", "-p", conf], stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True)
    atexit.register(proc.terminate)

    def work():
        avg = 0.0
        for line in proc.stdout:
            try:
                bars = [int(x) for x in line.strip().split(";") if x]
            except ValueError:
                continue
            if len(bars) < 3:
                continue
            st.bands = [min(1.0, b / 100.0) for b in bars[:10]] + \
                [0.0] * max(0, 10 - len(bars))
            st.bands_t = time.monotonic()
            bass = sum(bars[:3]) / 300.0
            avg += (bass - avg) * 0.04
            st.energy += (bass - st.energy) * 0.3
            onset = bass - avg * 1.2
            if onset > 0.06:
                st.beat = max(st.beat, min(1.0, onset * 3.5))

    threading.Thread(target=work, daemon=True).start()


# ---------------------------------------------------------------- window ----
def draw(area, cr, w, h, *_):
    scene.draw_scene(cr, w, h)


def make_window(app, monitor):
    win = Gtk.Window(application=app)
    win.add_css_class("lumverse")
    LayerShell.init_for_window(win)
    LayerShell.set_layer(win, LayerShell.Layer.OVERLAY)
    for edge in (LayerShell.Edge.TOP, LayerShell.Edge.BOTTOM,
                 LayerShell.Edge.LEFT, LayerShell.Edge.RIGHT):
        LayerShell.set_anchor(win, edge, True)
    LayerShell.set_exclusive_zone(win, -1)
    LayerShell.set_keyboard_mode(win, LayerShell.KeyboardMode.NONE)
    LayerShell.set_namespace(win, "lumverse")
    LayerShell.set_monitor(win, monitor)
    area = Gtk.DrawingArea()
    area.set_draw_func(draw)
    win.set_child(area)
    areas.append(area)
    win.connect("realize",
                lambda w: w.get_surface().set_input_region(cairo.Region()))
    win.present()


def cycle_style():
    i = (ly.STYLES.index(st.style) + 1) % len(ly.STYLES) \
        if st.style in ly.STYLES else 0
    st.style = ly.STYLES[i]
    print(f"[lumverse] lyric style: {st.style}", file=sys.stderr)
    return True


def peek_card():
    if CFG["card"] == "off":
        CFG["card"] = "onchange"
    st.show_card()
    return True


def on_activate(app):
    scene.load_config()
    st.style = ly.ALIASES.get(CFG["style"], CFG["style"])
    css = Gtk.CssProvider()
    data = "window.lumverse { background: transparent; }"
    try:
        css.load_from_string(data)
    except AttributeError:
        css.load_from_data(data.encode())
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

    mons = Gdk.Display.get_default().get_monitors()
    for i in range(mons.get_n_items()):
        make_window(app, mons.get_item(i))

    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))
    atexit.register(lambda: os.path.exists(PIDFILE) and os.remove(PIDFILE))
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, cycle_style)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR2, peek_card)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, app.quit)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, app.quit)

    start_beat()
    poll()
    GLib.timeout_add(POLL_MS, poll)

    last = [time.monotonic()]

    def frame():
        now = time.monotonic()
        st.step(min(0.1, now - last[0]))
        last[0] = now
        for a in areas:
            a.queue_draw()
        return True

    GLib.timeout_add(int(1000 / CFG["fps"]), frame)


def main():
    global bus
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    if scene.Image is None:
        print("[lumverse] python-pillow missing: no album colors/art",
              file=sys.stderr)
    app = Gtk.Application(application_id="dev.lumverse.glow")
    app.connect("activate", on_activate)
    app.hold()
    return app.run(None)


if __name__ == "__main__":
    sys.exit(main())

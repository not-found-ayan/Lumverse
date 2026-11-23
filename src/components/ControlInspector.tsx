import type {
  BackdropMode,
  CardStyle,
  CardVisibility,
  LumverseConfig,
  PaletteColors,
} from "../types/lumverse";
import { rgbCss } from "../engine/palette";
import {
  CARD_STYLES,
  FONT_PRESETS,
  GENRE_THEMES,
  GLOW_MODES,
  LYRIC_STYLES,
  VIZ_MODES,
} from "../engine/presets";

interface ControlInspectorProps {
  config: LumverseConfig;
  palette: PaletteColors;
  onChange: (patch: Partial<LumverseConfig>) => void;
  onResetDefaults: () => void;
  onPeekCard: () => void;
  compact?: boolean;
}

export function ControlInspector({
  config,
  palette,
  onChange,
  onResetDefaults,
  onPeekCard,
  compact = false,
}: ControlInspectorProps) {
  return (
    <div className={compact ? "space-y-6" : "max-w-5xl mx-auto px-6 py-8 space-y-8"}>
      {!compact && (
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-5">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
              Glow, Visualizer &amp; DSP Calibration
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Changes apply live to the 60fps canvas and carry straight into the exported Python overlay.
            </p>
          </div>
          <button
            type="button"
            onClick={onResetDefaults}
            className="px-4 py-2 text-xs font-medium text-zinc-200 bg-white/6 hover:bg-white/10 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset Defaults
          </button>
        </div>
      )}

      {/* Extracted Contrast-Checked Palette Readout */}
      <section className="border border-white/8 bg-[#111318] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-100">
            Adaptive Album Palette
          </h2>
          <span className="text-xs text-zinc-400 font-mono-tabular">
            Card contrast {palette.contrastRatio.toFixed(1)}:1 · WCAG AA verified
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Primary", rgb: palette.primary },
            { label: "Secondary", rgb: palette.secondary },
            { label: "Card Surface", rgb: palette.cardBg },
            { label: "Card Ink", rgb: palette.cardInk },
          ].map((sw) => (
            <div key={sw.label} className="flex items-center gap-3 p-2.5 rounded-md bg-black/30 border border-white/6">
              <span
                className="w-6 h-6 rounded border border-white/15 shrink-0"
                style={{ backgroundColor: rgbCss(sw.rgb) }}
              />
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-200 truncate">{sw.label}</div>
                <div className="text-[11px] text-zinc-400 font-mono-tabular truncate">
                  {sw.rgb.map((v) => Math.round(v * 255)).join(", ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className={compact ? "space-y-6" : "grid grid-cols-1 lg:grid-cols-2 gap-6"}>
        {/* Genre-Adaptive Animations */}
        <section className="border border-white/8 bg-[#111318] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Genre Animations</h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Hearts for romantic, electric bolts for rock, veined leaves for folk &amp; more
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={config.genreEffectsEnabled}
                onChange={(e) => onChange({ genreEffectsEnabled: e.target.checked })}
                className="accent-emerald-400 w-4 h-4 rounded"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {GENRE_THEMES.map((gt) => {
              const active = config.genreMode === gt.id;
              return (
                <button
                  key={gt.id}
                  type="button"
                  onClick={() => onChange({ genreMode: gt.id })}
                  className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                    active
                      ? "bg-emerald-400/12 border-emerald-400/50 text-zinc-100"
                      : "bg-black/25 border-white/6 text-zinc-400 hover:text-zinc-200 hover:border-white/14"
                  }`}
                >
                  <div className="text-xs font-semibold">{gt.label}</div>
                  <div className="mt-1 text-[11px] text-zinc-400 line-clamp-2">{gt.summary}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Procedural Audio Visualizer */}
        <section className="border border-white/8 bg-[#111318] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Audio Visualizer</h2>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Central morphing blob &amp; audio-reactive visualizers layered behind lyrics and genre ambience
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={config.vizAlways}
                onChange={(e) => onChange({ vizAlways: e.target.checked })}
                className="accent-emerald-400 w-4 h-4 rounded"
              />
              <span>Show With Lyrics</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {VIZ_MODES.map((vm) => {
              const active = config.vizMode === vm.id;
              return (
                <button
                  key={vm.id}
                  type="button"
                  onClick={() => onChange({ vizMode: vm.id })}
                  className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                    active
                      ? "bg-emerald-400/12 border-emerald-400/50 text-zinc-100"
                      : "bg-black/25 border-white/6 text-zinc-400 hover:text-zinc-200 hover:border-white/14"
                  }`}
                >
                  <div className="text-xs font-semibold">{vm.label}</div>
                  <div className="mt-1 text-[11px] text-zinc-400 line-clamp-2">{vm.summary}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Edge Glow Architecture */}
        <section className="border border-white/8 bg-[#111318] rounded-lg p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Perimeter Glow</h2>
            <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.rim}
                onChange={(e) => onChange({ rim: e.target.checked })}
                className="accent-emerald-400 w-4 h-4 rounded"
              />
              <span>Specular Rim</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {GLOW_MODES.map((m) => {
              const active = config.glowMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onChange({ glowMode: m.id })}
                  className={`text-left p-3 rounded-md border transition-colors cursor-pointer ${
                    active
                      ? "bg-emerald-400/12 border-emerald-400/50 text-zinc-100"
                      : "bg-black/25 border-white/6 text-zinc-400 hover:text-zinc-200 hover:border-white/14"
                  }`}
                >
                  <div className="text-xs font-semibold">{m.label}</div>
                  <div className="mt-1 text-[11px] text-zinc-400 line-clamp-2">{m.summary}</div>
                </button>
              );
            })}
          </div>

          <div className="space-y-4 pt-1">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-zinc-300">Bloom Depth</span>
                <span className="font-mono-tabular text-zinc-400">{config.thickness}px</span>
              </div>
              <input
                type="range"
                min={40}
                max={280}
                step={5}
                value={config.thickness}
                onChange={(e) => onChange({ thickness: Number(e.target.value) })}
                className="w-full accent-emerald-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-zinc-300">Max Opacity</span>
                <span className="font-mono-tabular text-zinc-400">{Math.round(config.maxAlpha * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.2}
                max={1.0}
                step={0.05}
                value={config.maxAlpha}
                onChange={(e) => onChange({ maxAlpha: Number(e.target.value) })}
                className="w-full accent-emerald-400"
              />
            </div>

            <div className="pt-1 border-t border-white/6 space-y-3">
              <div className="flex items-center justify-between">
                <label className="inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.beatReactive}
                    onChange={(e) => onChange({ beatReactive: e.target.checked })}
                    className="accent-emerald-400 w-4 h-4 rounded"
                  />
                  <span>Spectral-Flux Beat Reactivity</span>
                </label>
                <span className="font-mono-tabular text-xs text-zinc-400">
                  {config.beatSensitivity.toFixed(2)}×
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2.2}
                step={0.05}
                disabled={!config.beatReactive}
                value={config.beatSensitivity}
                onChange={(e) => onChange({ beatSensitivity: Number(e.target.value) })}
                className="w-full accent-emerald-400 disabled:opacity-40"
              />
            </div>
          </div>
        </section>

        {/* Kinetic Lyrics Engine */}
        <section className="border border-white/8 bg-[#111318] rounded-lg p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Kinetic Lyrics</h2>
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.uppercase}
                  onChange={(e) => onChange({ uppercase: e.target.checked })}
                  className="accent-emerald-400 w-4 h-4 rounded"
                />
                <span>Uppercase</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.lyricsEnabled}
                  onChange={(e) => onChange({ lyricsEnabled: e.target.checked })}
                  className="accent-emerald-400 w-4 h-4 rounded"
                />
                <span>Enabled</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {LYRIC_STYLES.map((st) => {
              const active = config.style === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onChange({ style: st.id })}
                  className={`text-left p-2.5 rounded-md border transition-colors cursor-pointer ${
                    active
                      ? "bg-emerald-400/12 border-emerald-400/50 text-zinc-100"
                      : "bg-black/25 border-white/6 text-zinc-400 hover:text-zinc-200 hover:border-white/14"
                  }`}
                >
                  <div className="text-xs font-semibold whitespace-nowrap">{st.label}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400 truncate">{st.tag}</div>
                </button>
              );
            })}
          </div>

          <div>
            <div className="text-xs text-zinc-300 mb-2">Typeface</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-black/35 rounded-md border border-white/6">
              {FONT_PRESETS.map((fp) => {
                const active = config.fontPreset === fp.id;
                return (
                  <button
                    key={fp.id}
                    type="button"
                    onClick={() => onChange({ fontPreset: fp.id })}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap truncate cursor-pointer ${
                      active
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {fp.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-zinc-300">Sync Offset (+ shows earlier)</span>
              <span className="font-mono-tabular text-zinc-400">
                {config.lyricsOffset >= 0 ? "+" : ""}
                {config.lyricsOffset.toFixed(2)}s
              </span>
            </div>
            <input
              type="range"
              min={-2.5}
              max={2.5}
              step={0.05}
              value={config.lyricsOffset}
              onChange={(e) => onChange({ lyricsOffset: Number(e.target.value) })}
              className="w-full accent-emerald-400"
            />
          </div>
        </section>

        {/* Now-Playing Card & Simulator Backdrop */}
        <section className="border border-white/8 bg-[#111318] rounded-lg p-5 space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Now-Playing Card</h2>
              <button
                type="button"
                onClick={onPeekCard}
                className="px-3 py-1 text-xs font-medium text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/18 border border-emerald-400/30 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Peek Card
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/35 rounded-md border border-white/6">
              {CARD_STYLES.map((cs) => (
                <button
                  key={cs.id}
                  type="button"
                  onClick={() => onChange({ cardStyle: cs.id as CardStyle })}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap truncate cursor-pointer ${
                    config.cardStyle === cs.id
                      ? "bg-zinc-100 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {cs.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/35 rounded-md border border-white/6">
              {(
                [
                  { id: "always", label: "Always" },
                  { id: "onchange", label: "On Change" },
                  { id: "off", label: "Hidden" },
                ] as { id: CardVisibility; label: string }[]
              ).map((vis) => (
                <button
                  key={vis.id}
                  type="button"
                  onClick={() => onChange({ cardVisibility: vis.id })}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap truncate cursor-pointer ${
                    config.cardVisibility === vis.id
                      ? "bg-zinc-100 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {vis.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-white/6">
            <h2 className="text-sm font-semibold text-zinc-100">Desktop Environment Preview</h2>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-black/35 rounded-md border border-white/6">
              {(
                [
                  { id: "hyprland", label: "Hyprland Tiles" },
                  { id: "wallpaper", label: "Wallpaper" },
                  { id: "obsidian", label: "Dark Stage" },
                ] as { id: BackdropMode; label: string }[]
              ).map((bd) => (
                <button
                  key={bd.id}
                  type="button"
                  onClick={() => onChange({ backdropMode: bd.id })}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap truncate cursor-pointer ${
                    config.backdropMode === bd.id
                      ? "bg-zinc-100 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {bd.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

import { Maximize2, Minimize2 } from "lucide-react";

export type StudioTab = "stage" | "lyrics" | "tuning" | "export";

interface TopBarProps {
  activeTab: StudioTab;
  onSelectTab: (tab: StudioTab) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

const NAV_ITEMS: { id: StudioTab; label: string }[] = [
  { id: "stage", label: "Stage" },
  { id: "lyrics", label: "Lyrics Search" },
  { id: "tuning", label: "Glow & DSP" },
  { id: "export", label: "Export Python" },
];

export function TopBar({
  activeTab,
  onSelectTab,
  isFullscreen,
  onToggleFullscreen,
}: TopBarProps) {
  return (
    <header className="flex items-center justify-between gap-8 px-6 h-14 border-b border-white/8 bg-[#0B0C10]/95 backdrop-blur-sm shrink-0 z-30">
      <button
        type="button"
        onClick={() => onSelectTab("stage")}
        className="font-display text-lg font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 rounded"
      >
        Lumverse
      </button>

      <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-1.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 rounded ${
                active
                  ? "text-zinc-50"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {item.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -bottom-[15px] h-[2px] bg-emerald-400"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Exit Fullscreen</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Fullscreen Stage</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}

import { useMemo, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import type { LumverseConfig } from "../types/lumverse";
import { generatePythonBundle } from "../engine/pythonGenerator";

interface PythonExportViewProps {
  config: LumverseConfig;
}

type ExportFileKey = "scene.py" | "lyrics.py" | "lumverse.py" | "config.json";

const ALL_FILES: ExportFileKey[] = ["lumverse.py", "scene.py", "lyrics.py", "config.json"];

export function PythonExportView({ config }: PythonExportViewProps) {
  const bundle = useMemo(() => generatePythonBundle(config), [config]);
  const [activeFile, setActiveFile] = useState<ExportFileKey>("lumverse.py");
  const [copied, setCopied] = useState(false);

  const fileContents: Record<ExportFileKey, string> = {
    "scene.py": bundle.scenePy,
    "lyrics.py": bundle.lyricsPy,
    "lumverse.py": bundle.lumversePy,
    "config.json": bundle.configJson,
  };

  const currentCode = fileContents[activeFile];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = (filename: ExportFileKey) => {
    const blob = new Blob([fileContents[filename]], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    ALL_FILES.forEach((fname, idx) => {
      window.setTimeout(() => handleDownload(fname), idx * 140);
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/8 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-zinc-100">
            Upgraded Wayland / Hyprland Overlay Source
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Download all 4 files below, move the Python scripts to ~/lumverse, and run with /usr/bin/python3.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleDownload(activeFile)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-zinc-200 bg-white/8 hover:bg-white/14 border border-white/12 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download {activeFile}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadAll}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-zinc-950 bg-emerald-400 hover:bg-emerald-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download All 4 Files</span>
          </button>
        </div>
      </div>

      {/* Quick Install Commands */}
      <section className="border border-white/8 bg-[#111318] rounded-lg p-4 space-y-2">
        <div className="text-xs font-semibold text-zinc-200">
          After clicking Download All 4 Files, run this in your terminal:
        </div>
        <pre className="p-3 text-xs font-mono-tabular text-emerald-300 bg-black/50 border border-white/6 rounded overflow-x-auto">
{`mkdir -p ~/lumverse ~/.config/lumverse
mv ~/Downloads/lumverse.py ~/Downloads/scene.py ~/Downloads/lyrics.py ~/lumverse/
mv ~/Downloads/config.json ~/.config/lumverse/
/usr/bin/python3 ~/lumverse/lumverse.py`}
        </pre>
      </section>

      {/* Architectural Upgrade Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {bundle.upgrades.map((up) => (
          <div
            key={up.title}
            className="border border-white/8 bg-[#111318] rounded-lg p-4 space-y-2"
          >
            <h2 className="text-sm font-semibold text-zinc-100">{up.title}</h2>
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400 font-medium">Original:</span> {up.before}
            </p>
            <p className="text-xs text-emerald-300/90">
              <span className="font-medium text-emerald-300">Upgraded:</span> {up.after}
            </p>
          </div>
        ))}
      </div>

      {/* File Tabs & Code Viewer */}
      <section className="border border-white/8 bg-[#111318] rounded-lg overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-white/8 bg-black/30">
          <div className="flex items-center gap-1 p-1 bg-black/40 rounded-md border border-white/6">
            {ALL_FILES.map((fname) => (
              <button
                key={fname}
                type="button"
                onClick={() => setActiveFile(fname)}
                className={`px-3 py-1.5 text-xs font-mono-tabular font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeFile === fname
                    ? "bg-zinc-100 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {fname}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-200 bg-white/8 hover:bg-white/14 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Copy File</span>
              </>
            )}
          </button>
        </div>

        <pre className="p-5 text-xs font-mono-tabular leading-relaxed text-zinc-200 overflow-x-auto max-h-[540px] overflow-y-auto bg-[#08090C]">
          <code>{currentCode}</code>
        </pre>
      </section>
    </div>
  );
}

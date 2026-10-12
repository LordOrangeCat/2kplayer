import { MacWindow } from "./MacWindow";
import { PRESETS, type EnhancerParams } from "@/lib/enhancer";

const SLIDERS: [keyof Omit<EnhancerParams, "on">, string][] = [
  ["warmth", "Warmth"],
  ["punch", "Punch"],
  ["air", "Air"],
  ["width", "Width"],
];

export function EnhancerPanel({ p, set, onClose, embed }: { p: EnhancerParams; set: (x: Partial<EnhancerParams>) => void; onClose: () => void; embed: boolean }) {
  return (
    <div className="options-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MacWindow title="Sound Enhancer" onBox={onClose} boxLabel="Close" className="w-[320px]">
          <div className="flex flex-col gap-3 p-4">
            <label className="flex items-center gap-2 text-lg">
              <input type="checkbox" className="mac-check" checked={p.on} onChange={(e) => set({ on: e.target.checked })} />
              Enhancer {p.on ? "on" : "off (bypass)"}
            </label>
            {SLIDERS.map(([k, label]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="field-label w-16">{label}</span>
                <input type="range" className="seek" min={0} max={10} step={1} value={p[k]} disabled={!p.on}
                  style={{ ["--pct" as string]: `${p[k] * 10}%` }}
                  onChange={(e) => set({ [k]: Number(e.target.value) })} aria-label={label} />
                <span className="w-5 tabular-nums">{p[k]}</span>
              </div>
            ))}
            <select className="retro-select" value="" onChange={(e) => { const x = PRESETS[e.target.value]; if (x) set({ ...x, on: true }); }} aria-label="Presets">
              <option value="" disabled>Presets…</option>
              {Object.keys(PRESETS).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {embed && <p className="text-center text-xs">This song is playing through YouTube's own player, so the enhancer can't reach it.</p>}
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

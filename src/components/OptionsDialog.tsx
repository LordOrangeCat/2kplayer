import { MacWindow } from "./MacWindow";

interface Props {
  onClose: () => void;
  onAddFolder: () => void;
  onAddFiles: () => void;
  onReconnect: () => void;
  onClear: () => void;
  needsReconnect: boolean;
  fsa: boolean;
  matchRate: boolean;
  onMatchRate: (v: boolean) => void;
  count: number;
}

export function OptionsDialog(p: Props) {
  return (
    <div className="options-overlay" onClick={p.onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MacWindow title="Options" onBox={p.onClose} boxLabel="Close" className="w-[300px]">
          <div className="flex flex-col gap-3 p-4">
            <button className="bevel h-9 px-3 text-lg" onClick={p.onAddFolder}>Add folder...</button>
            <button className="bevel h-9 px-3 text-lg" onClick={p.onAddFiles}>Add files...</button>
            {p.needsReconnect && (
              <button className="bevel h-9 px-3 text-lg" onClick={p.onReconnect}>Reconnect library</button>
            )}
            <button className="bevel h-9 px-3 text-lg" onClick={p.onClear}>Clear library</button>
            <label className="flex items-center gap-2 text-lg">
              <input
                type="checkbox"
                className="mac-check"
                checked={p.matchRate}
                onChange={(e) => p.onMatchRate(e.target.checked)}
              />
              Match sample rate
            </label>
            <p className="text-center text-sm">{p.count} tracks in library</p>
            {!p.fsa && (
              <p className="text-center text-xs">
                This browser can't remember your library. Use Chrome, Edge or Brave for that.
              </p>
            )}
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

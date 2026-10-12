import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MacWindow } from "./MacWindow";
import { searchYouTube, type YtResult } from "@/lib/youtube.functions";

const fmt = (s: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

export function YouTubeSearch({ onClose, onPick }: { onClose: () => void; onPick: (r: YtResult, play: boolean) => void }) {
  const search = useServerFn(searchYouTube);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<YtResult[]>([]);
  const [msg, setMsg] = useState("Type a song or artist and press Return.");

  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setMsg("Searching…");
    try {
      const r = await search({ data: { q } });
      setItems(r.items);
      setMsg(r.error ?? (r.items.length ? "" : "No results."));
    } catch {
      setMsg("Search failed. Try again.");
    }
    setBusy(false);
  };

  return (
    <div className="options-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MacWindow title="YouTube Search" onBox={onClose} boxLabel="Close" className="w-[380px]">
          <div className="flex flex-col gap-3 p-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
              <input autoFocus className="inset-field retro-input flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search YouTube" aria-label="Search YouTube" />
              <button className="bevel h-9 px-3 text-lg" disabled={busy}>Find</button>
            </form>
            {msg && <p className="text-center text-sm">{msg}</p>}
            <ul className="inset-field yt-list">
              {items.map((r) => (
                <li key={r.id} className="yt-row">
                  <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onPick(r, true)} title="Play now">
                    {r.thumb && <img src={r.thumb} alt="" className="h-9 w-12 shrink-0 object-cover" loading="lazy" />}
                    <span className="min-w-0">
                      <span className="block truncate">{r.title}</span>
                      <span className="block truncate text-xs">{r.artist} {fmt(r.duration)}</span>
                    </span>
                  </button>
                  <button className="bevel h-8 w-8 shrink-0" onClick={() => onPick(r, false)} aria-label="Add to list" title="Add to list">+</button>
                </li>
              ))}
            </ul>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

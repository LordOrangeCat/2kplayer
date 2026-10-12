import { useRef, useState } from "react";
import { MacWindow } from "./MacWindow";
import { OptionsDialog } from "./OptionsDialog";
import * as I from "./icons";
import { ALL, FAVS, UNKNOWN, usePlayer } from "@/hooks/usePlayer";
import type { TrackMeta } from "@/lib/meta";

function formatLabel(m: TrackMeta | undefined, outRate?: number): string {
  if (!m) return "";
  const parts: string[] = [];
  if (m.codec) parts.push(m.codec);
  if (m.bits) parts.push(`${m.bits}-bit`);
  if (m.sampleRate) parts.push(`${+(m.sampleRate / 1000).toFixed(1)} kHz`);
  let s = parts.join(" ");
  if (outRate) {
    s += ` → out ${+(outRate / 1000).toFixed(1)} kHz`;
    if (m.sampleRate && m.sampleRate !== outRate) s += " (resampled)";
  }
  return s;
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

export function Player() {
  const p = usePlayer();
  const [opts, setOpts] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFolder = () => (p.fsa ? p.addSource("dir") : dirInput.current?.click());
  const addFiles = () => (p.fsa ? p.addSource("file") : fileInput.current?.click());

  const m = p.currentTrack?.meta;
  const hiRes = !!m && (m.sampleRate > 48000 || m.bits > 16);
  const isFav = !!p.currentTrack && p.favs.has(p.currentTrack.path);
  const pct = p.duration ? (p.time / p.duration) * 100 : 0;

  const status = !p.tracks.length
    ? "Click the CD to add a folder"
    : p.currentTrack
      ? formatLabel(m, p.outRate) || p.currentTrack.name
      : `${p.tracks.length} tracks`;

  return (
    <div className="relative mx-auto mt-[14px] w-full max-w-[420px]">
      <MacWindow
        title="Song"
        right={hiRes && <span className="hires-badge">HI-RES</span>}
        onBox={() => setOpts(true)}
        boxLabel="Options"
      >
        <div className="flex flex-col gap-3 px-4 py-4">
          {/* top row */}
          <div className="flex gap-3">
            <div className="inset-field art-frame">
              {p.cover ? (
                <img src={p.cover} alt="Album cover" className="h-full w-full object-cover" />
              ) : (
                <I.VinylArt />
              )}
            </div>
            <div className="flex flex-1 flex-col items-center justify-between">
              <button className="icon-btn" onClick={addFolder} aria-label="Add folder" title="Add folder">
                <I.CdIcon spinning={p.playing} />
              </button>
              <button className="icon-btn" onClick={addFiles} aria-label="Add files" title="Add files">
                <I.DeckIcon />
              </button>
              <div className="flex items-end gap-2">
                <div className="flex flex-col gap-1">
                  <button className="bevel h-[38px] w-[38px]" aria-label="Volume up" onClick={() => p.setVolume(p.volume + 1)}><I.PlusIcon /></button>
                  <button className="bevel h-[38px] w-[38px]" aria-label="Volume down" onClick={() => p.setVolume(p.volume - 1)}><I.MinusIcon /></button>
                </div>
                <div className="inset-field vol-bar" aria-label={`Volume ${p.volume}`}>
                  <div className="vol-fill" style={{ height: `${p.volume * 10}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* row 1 */}
          <div className="flex gap-2">
            <button className="bevel h-11 flex-1" onClick={p.togglePlay} aria-label={p.playing ? "Pause" : "Play"}>
              {p.playing ? <I.PauseIcon /> : <I.PlayIcon />}
            </button>
            <button className="bevel h-11 w-11" data-on={p.shuffle} onClick={() => p.setShuffle(!p.shuffle)} aria-label="Shuffle">
              <I.ShuffleIcon />
            </button>
            <button className="bevel relative h-11 w-11" data-on={p.repeat !== "off"} onClick={p.cycleRepeat} aria-label={`Repeat ${p.repeat}`}>
              <I.RepeatIcon />
              {p.repeat === "one" && <span className="repeat-one">1</span>}
            </button>
          </div>

          {/* row 2 */}
          <div className="grid grid-cols-5 gap-2">
            <button className="bevel h-11" onClick={() => p.step(-1)} aria-label="Previous"><I.PrevIcon /></button>
            <button className="bevel h-11" onClick={() => p.seekBy(-10)} aria-label="Back 10 seconds"><I.Back10Icon /></button>
            <button className="bevel h-11" onClick={() => p.seekBy(10)} aria-label="Forward 10 seconds"><I.Fwd10Icon /></button>
            <button className="bevel h-11" onClick={() => p.step(1)} aria-label="Next"><I.NextIcon /></button>
            <button className="bevel h-11" data-on={isFav} data-heart onClick={p.toggleFav} aria-label="Favorite"><I.HeartIcon /></button>
          </div>

          {/* artist */}
          <div className="flex items-center gap-2">
            <label className="field-label" htmlFor="artist">Artist:</label>
            <select id="artist" className="retro-select" value={p.filter} onChange={(e) => p.setFilter(e.target.value)}>
              <option value={ALL}>All artists</option>
              <option value={FAVS}>♥ Favorites</option>
              {p.artists.list.map((a) => <option key={a} value={a}>{a}</option>)}
              {p.artists.unknown && <option value={UNKNOWN}>Unknown artist</option>}
            </select>
          </div>

          {/* title */}
          <div className="flex items-center gap-2">
            <label className="field-label" htmlFor="title">Title:</label>
            <select
              id="title"
              className="retro-select"
              value={p.currentTrack && p.queue.includes(p.currentTrack) ? p.currentTrack.path : ""}
              onChange={(e) => {
                const t = p.queue.find((x) => x.path === e.target.value);
                if (t) p.playTrack(t);
              }}
            >
              <option value="" disabled>{p.queue.length ? "Choose a song" : "—"}</option>
              {p.queue.map((t) => {
                const title = t.meta?.title ?? t.name;
                const label = p.filter === ALL && t.meta?.artist ? `${t.meta.artist} – ${title}` : title;
                return <option key={t.path} value={t.path}>{label}</option>;
              })}
            </select>
          </div>

          {/* seek */}
          <div className="flex items-center gap-2 text-lg">
            <span className="w-11 text-right tabular-nums">{fmt(p.time)}</span>
            <input
              type="range"
              className="seek"
              min={0}
              max={p.duration || 0}
              step={0.1}
              value={p.time}
              onChange={(e) => p.seek(Number(e.target.value))}
              style={{ ["--pct" as string]: `${pct}%` }}
              aria-label="Seek"
            />
            <span className="w-11 tabular-nums">{fmt(p.duration)}</span>
          </div>

          <p className="text-center text-sm">{status}</p>
        </div>
      </MacWindow>

      <input ref={fileInput} type="file" multiple hidden accept="audio/*,.flac,.opus,.oga"
        onChange={(e) => { if (e.target.files) p.addFileList(e.target.files); e.target.value = ""; }} />
      <input ref={dirInput} type="file" multiple hidden
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(e) => { if (e.target.files) p.addFileList(e.target.files); e.target.value = ""; }} />

      {opts && (
        <OptionsDialog
          onClose={() => setOpts(false)}
          onAddFolder={addFolder}
          onAddFiles={addFiles}
          onReconnect={p.reconnect}
          onClear={p.clearLibrary}
          needsReconnect={p.needsReconnect}
          fsa={p.fsa}
          matchRate={p.matchRate}
          onMatchRate={p.toggleMatch}
          count={p.tracks.length}
        />
      )}
    </div>
  );
}

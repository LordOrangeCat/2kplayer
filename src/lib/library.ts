import type { TrackMeta } from "./meta";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const AUDIO_EXT = ["flac", "wav", "mp3", "m4a", "aac", "ogg", "oga", "opus", "webm"];
const COVER_NAMES = ["cover", "folder", "front", "album"];

export interface Track {
  path: string;
  name: string;
  file?: File;
  handle?: any; // FileSystemFileHandle
  dir?: any; // FileSystemDirectoryHandle
  siblings?: File[]; // fallback mode: files in same folder (for covers)
  meta?: TrackMeta;
}

export type Source = { kind: "dir" | "file"; handle: any };

// ---------- IndexedDB ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("twokplayer", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const q = db.transaction("kv").objectStore("kv").get(key);
    q.onsuccess = () => res(q.result as T);
    q.onerror = () => rej(q.error);
  });
}
export async function kvSet(key: string, val: unknown) {
  const db = await openDb();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export const hasFSA = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export const isAudio = (name: string) =>
  AUDIO_EXT.includes(name.split(".").pop()?.toLowerCase() ?? "");

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const sortTracks = (t: Track[]) => t.sort((a, b) => collator.compare(a.path, b.path));

export async function permissionOk(h: any, request = false) {
  const opts = { mode: "read" };
  if ((await h.queryPermission?.(opts)) === "granted") return true;
  if (request && (await h.requestPermission?.(opts)) === "granted") return true;
  return false;
}

async function scanDir(dir: any, prefix: string, out: Track[]) {
  for await (const entry of dir.values()) {
    const p = `${prefix}/${entry.name}`;
    if (entry.kind === "directory") await scanDir(entry, p, out);
    else if (isAudio(entry.name)) out.push({ path: p, name: entry.name, handle: entry, dir });
  }
}

export async function scanSources(sources: Source[]): Promise<Track[]> {
  const out: Track[] = [];
  for (const s of sources) {
    if (s.kind === "dir") await scanDir(s.handle, s.handle.name, out);
    else if (isAudio(s.handle.name))
      out.push({ path: s.handle.name, name: s.handle.name, handle: s.handle });
  }
  return sortTracks(out);
}

export function tracksFromFileList(files: FileList | File[]): Track[] {
  const all = Array.from(files);
  const byDir = new Map<string, File[]>();
  for (const f of all) {
    const rel = (f as any).webkitRelativePath || f.name;
    const d = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d)!.push(f);
  }
  return all
    .filter((f) => isAudio(f.name))
    .map((f) => {
      const rel = (f as any).webkitRelativePath || f.name;
      const d = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
      return { path: rel, name: f.name, file: f, siblings: d ? byDir.get(d) : undefined };
    });
}

export async function getFile(t: Track): Promise<File> {
  if (t.file) return t.file;
  return t.handle.getFile();
}

export async function findFolderCover(t: Track): Promise<Blob | null> {
  const ok = (n: string) => {
    const [b, e] = n.toLowerCase().split(/\.(?=[^.]+$)/);
    return COVER_NAMES.includes(b) && ["jpg", "jpeg", "png"].includes(e);
  };
  if (t.dir) {
    try {
      for await (const entry of t.dir.values())
        if (entry.kind === "file" && ok(entry.name)) return await entry.getFile();
    } catch {
      /* ignore */
    }
  }
  if (t.siblings) return t.siblings.find((f) => ok(f.name)) ?? null;
  return null;
}

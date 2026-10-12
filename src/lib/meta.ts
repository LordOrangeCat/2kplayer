// src/lib/meta.ts
// Reads FLAC (STREAMINFO, Vorbis comments, PICTURE), WAV (fmt) and MP3 (ID3v2 text + APIC, first frame).
// Dependency-free. Everything else falls back to the filename.

export interface TrackMeta {
  title: string;
  artist: string;
  album: string;
  sampleRate: number; // Hz, 0 = unknown
  bits: number;       // bit depth, 0 = unknown / lossy
  channels: number;
  duration: number;   // seconds, 0 = unknown
  codec: string;
}

export interface Picture {
  mime: string;
  blob: Blob;
}

const u32le = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const rd = async (file: Blob, start: number, len: number) =>
  new Uint8Array(await file.slice(start, start + len).arrayBuffer());
const str = (b: Uint8Array, o: number, n: number): string =>
  String.fromCharCode(...b.subarray(o, o + n));
const MAX_ART = 12 * 1024 * 1024;

export async function readMeta(file: File): Promise<TrackMeta> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const info: TrackMeta = {
    title: file.name.replace(/\.[^.]+$/, ""),
    artist: "",
    album: "",
    sampleRate: 0,
    bits: 0,
    channels: 0,
    duration: 0,
    codec: ext.toUpperCase(),
  };
  try {
    const head = await rd(file, 0, 12);
    if (str(head, 0, 4) === "fLaC") await readFlac(file, info);
    else if (str(head, 0, 4) === "RIFF" && str(head, 8, 4) === "WAVE") await readWav(file, info);
    else if (str(head, 0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0))
      await readMp3(file, info, head);
  } catch {
    /* keep filename fallback */
  }
  return info;
}

/** Embedded cover art, or null. */
export async function readPicture(file: Blob): Promise<Picture | null> {
  try {
    const head = await rd(file, 0, 10);
    if (str(head, 0, 4) === "fLaC") return await flacPicture(file);
    if (str(head, 0, 3) === "ID3") return await id3Picture(file);
  } catch {
    /* no art */
  }
  return null;
}

/* ---------------- FLAC ---------------- */
interface FlacBlock { type: number; len: number; off: number }

async function* flacBlocks(file: Blob): AsyncGenerator<FlacBlock> {
  let pos = 4;
  for (let n = 0; n < 64; n++) {
    const h = await rd(file, pos, 4);
    if (h.length < 4) return;
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = (h[1] << 16) | (h[2] << 8) | h[3];
    yield { type, len, off: pos + 4 };
    if (last) return;
    pos += 4 + len;
  }
}

async function readFlac(file: Blob, info: TrackMeta): Promise<void> {
  info.codec = "FLAC";
  for await (const blk of flacBlocks(file)) {
    if (blk.type === 0) {
      const b = await rd(file, blk.off, 18);
      info.sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      info.channels = ((b[12] >> 1) & 7) + 1;
      info.bits = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
      const total =
        (b[13] & 0x0f) * 2 ** 32 + (((b[14] << 24) | (b[15] << 16) | (b[16] << 8) | b[17]) >>> 0);
      if (info.sampleRate) info.duration = total / info.sampleRate;
    } else if (blk.type === 4 && blk.len < 1 << 20) {
      const b = await rd(file, blk.off, blk.len);
      let o = 4 + u32le(b, 0);
      const count = u32le(b, o);
      o += 4;
      for (let i = 0; i < count && o + 4 <= b.length; i++) {
        const l = u32le(b, o);
        o += 4;
        const kv = new TextDecoder().decode(b.subarray(o, o + l));
        o += l;
        const eq = kv.indexOf("=");
        if (eq < 0) continue;
        const k = kv.slice(0, eq).toUpperCase();
        const v = kv.slice(eq + 1);
        if (k === "TITLE") info.title = v;
        else if (k === "ARTIST") info.artist = v;
        else if (k === "ALBUM") info.album = v;
      }
    }
  }
}

async function flacPicture(file: Blob): Promise<Picture | null> {
  for await (const blk of flacBlocks(file)) {
    if (blk.type !== 6 || blk.len > MAX_ART) continue;
    const b = await rd(file, blk.off, blk.len);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let o = 4;
    const ml = dv.getUint32(o);
    o += 4;
    const mime = str(b, o, ml);
    o += ml;
    const dl = dv.getUint32(o);
    o += 4 + dl + 16;
    const n = dv.getUint32(o);
    o += 4;
    const type = mime.includes("/") ? mime : "image/jpeg";
    return { mime: type, blob: new Blob([b.slice(o, o + n) as BlobPart], { type }) };
  }
  return null;
}

/* ---------------- WAV ---------------- */
async function readWav(file: Blob, info: TrackMeta): Promise<void> {
  info.codec = "WAV";
  let pos = 12;
  let byteRate = 0;
  for (let n = 0; n < 32; n++) {
    const h = await rd(file, pos, 8);
    if (h.length < 8) break;
    const id = str(h, 0, 4);
    const size = u32le(h, 4);
    if (id === "fmt ") {
      const b = await rd(file, pos + 8, 16);
      info.channels = b[2] | (b[3] << 8);
      info.sampleRate = u32le(b, 4);
      byteRate = u32le(b, 8);
      info.bits = b[14] | (b[15] << 8);
    } else if (id === "data") {
      if (byteRate) info.duration = size / byteRate;
      break;
    }
    pos += 8 + size + (size & 1);
  }
}

/* ---------------- MP3 / ID3v2 ---------------- */
interface Id3Frame { id: string; off: number; size: number }

async function* id3Frames(file: Blob): AsyncGenerator<Id3Frame> {
  const h = await rd(file, 0, 10);
  if (str(h, 0, 3) !== "ID3") return;
  const ver = h[3];
  const end = 10 + ((h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9]);
  let o = 10;
  while (o + 10 <= end) {
    const f = await rd(file, o, 10);
    const id = str(f, 0, 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size =
      ver === 4
        ? (f[4] << 21) | (f[5] << 14) | (f[6] << 7) | f[7]
        : ((f[4] << 24) | (f[5] << 16) | (f[6] << 8) | f[7]) >>> 0;
    yield { id, off: o + 10, size };
    o += 10 + size;
  }
}

async function readMp3(file: Blob, info: TrackMeta, head: Uint8Array): Promise<void> {
  info.codec = "MP3";
  let audioStart = 0;
  if (str(head, 0, 3) === "ID3") {
    audioStart = 10 + ((head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]);
    for await (const fr of id3Frames(file)) {
      if (fr.id === "TIT2" || fr.id === "TPE1" || fr.id === "TALB") {
        const text = decodeId3(await rd(file, fr.off, Math.min(fr.size, 4096)));
        if (fr.id === "TIT2" && text) info.title = text;
        if (fr.id === "TPE1") info.artist = text;
        if (fr.id === "TALB") info.album = text;
      }
    }
  }
  const f = await rd(file, audioStart, 4096);
  for (let i = 0; i + 4 < f.length; i++) {
    if (f[i] === 0xff && (f[i + 1] & 0xe0) === 0xe0) {
      const v = (f[i + 1] >> 3) & 3;
      const idx = (f[i + 2] >> 2) & 3;
      const base = [44100, 48000, 32000][idx];
      if (base && v !== 1) info.sampleRate = v === 3 ? base : v === 2 ? base / 2 : base / 4;
      break;
    }
  }
}

async function id3Picture(file: Blob): Promise<Picture | null> {
  for await (const fr of id3Frames(file)) {
    if (fr.id !== "APIC" || fr.size > MAX_ART) continue;
    const d = await rd(file, fr.off, fr.size);
    const enc = d[0];
    let o = 1;
    while (o < d.length && d[o] !== 0) o++;
    const mime = str(d, 1, o - 1);
    o += 2; // null terminator + picture type
    if (enc === 1 || enc === 2) {
      while (o + 1 < d.length && !(d[o] === 0 && d[o + 1] === 0)) o += 2;
      o += 2;
    } else {
      while (o < d.length && d[o] !== 0) o++;
      o += 1;
    }
    const type = mime.includes("/") ? mime : "image/jpeg";
    return { mime: type, blob: new Blob([d.slice(o) as BlobPart], { type }) };
  }
  return null;
}

function decodeId3(d: Uint8Array): string {
  if (!d.length) return "";
  const enc = d[0];
  const body = d.subarray(1);
  const label = enc === 0 ? "latin1" : enc === 1 ? "utf-16" : enc === 2 ? "utf-16be" : "utf-8";
  return new TextDecoder(label).decode(body).replace(/\0+$/g, "").trim();
}

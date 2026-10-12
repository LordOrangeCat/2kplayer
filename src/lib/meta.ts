// Stub tag reader. The full implementation will replace this file.
export interface TrackMeta {
  title: string;
  artist?: string;
  album?: string;
  codec?: string;
  sampleRate?: number;
  bitDepth?: number;
  duration?: number;
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export async function readMeta(file: File): Promise<TrackMeta> {
  const ext = file.name.split(".").pop()?.toUpperCase();
  return { title: baseName(file.name), codec: ext };
}

export async function readPicture(_file: File): Promise<Blob | null> {
  return null;
}

export function formatLabel(m: TrackMeta | undefined, outRate?: number): string {
  if (!m) return "";
  const parts: string[] = [];
  if (m.codec) parts.push(m.codec);
  if (m.bitDepth) parts.push(`${m.bitDepth}-bit`);
  if (m.sampleRate) parts.push(`${+(m.sampleRate / 1000).toFixed(1)} kHz`);
  let s = parts.join(" ");
  if (outRate) {
    s += ` → out ${+(outRate / 1000).toFixed(1)} kHz`;
    if (m.sampleRate && m.sampleRate !== outRate) s += " (resampled)";
  }
  return s;
}

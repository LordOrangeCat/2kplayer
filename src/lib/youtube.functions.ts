import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/* eslint-disable @typescript-eslint/no-explicit-any */
const PIPED = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru",
  "https://piped-api.lunar.icu",
];
const INVIDIOUS = ["https://inv.nadeko.net", "https://invidious.nerdvpn.de", "https://yewtu.be"];

export interface YtResult {
  id: string;
  title: string;
  artist: string;
  thumb: string;
  duration: number;
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  if (j?.error) throw new Error("upstream error");
  return j;
}

export const searchYouTube = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ q: z.string().trim().min(1).max(120) }).parse(d))
  .handler(async ({ data }): Promise<{ items: YtResult[]; error?: string }> => {
    const q = encodeURIComponent(data.q);
    for (const base of PIPED) {
      for (const filter of ["music_songs", "videos"]) {
        try {
          const j = await getJson(`${base}/search?q=${q}&filter=${filter}`);
          const items: YtResult[] = (j.items ?? [])
            .filter((x: any) => x.type === "stream" && x.url)
            .map((x: any) => ({
              id: String(x.url).split("v=")[1] ?? "",
              title: x.title ?? "",
              artist: (x.uploaderName ?? "").replace(/ - Topic$/, ""),
              thumb: x.thumbnail ?? "",
              duration: Number(x.duration) || 0,
            }))
            .filter((x: YtResult) => /^[\w-]{11}$/.test(x.id));
          if (items.length) return { items: items.slice(0, 25) };
        } catch {
          /* next */
        }
      }
    }
    return { items: [], error: "YouTube search is unavailable right now. Try again in a moment." };
  });

export const resolveYouTube = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ id: z.string().regex(/^[\w-]{11}$/) }).parse(d))
  .handler(async ({ data }): Promise<{ url: string | null; codec?: string; bitrate?: number }> => {
    for (const base of PIPED) {
      try {
        const j = await getJson(`${base}/streams/${data.id}`);
        const a = (j.audioStreams ?? [])
          .filter((s: any) => s.url && !s.videoOnly)
          .sort((x: any, y: any) => (y.bitrate ?? 0) - (x.bitrate ?? 0))[0];
        if (a) return { url: a.url, codec: a.codec ?? a.mimeType, bitrate: a.bitrate };
      } catch {
        /* next */
      }
    }
    for (const base of INVIDIOUS) {
      try {
        const j = await getJson(`${base}/api/v1/videos/${data.id}?local=true`);
        const a = (j.adaptiveFormats ?? [])
          .filter((s: any) => String(s.type).startsWith("audio/"))
          .sort((x: any, y: any) => Number(y.bitrate) - Number(x.bitrate))[0];
        if (a?.url) {
          const u = a.url.startsWith("http") ? a.url : base + a.url;
          return { url: u, codec: a.type, bitrate: Number(a.bitrate) };
        }
      } catch {
        /* next */
      }
    }
    return { url: null };
  });

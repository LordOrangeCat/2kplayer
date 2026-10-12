import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readMeta, readPicture } from "@/lib/meta";
import {
  findFolderCover,
  getFile,
  hasFSA,
  kvGet,
  kvSet,
  permissionOk,
  scanSources,
  sortTracks,
  tracksFromFileList,
  type Source,
  type Track,
} from "@/lib/library";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const ALL = "__all__";
export const FAVS = "__favs__";
export const UNKNOWN = "__unknown__";
export type Repeat = "off" | "all" | "one";

export function usePlayer() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [metaTick, setMetaTick] = useState(0);
  const [filter, setFilter] = useState(ALL);
  const [current, setCurrent] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(7);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>("off");
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [cover, setCover] = useState<string | null>(null);
  const [outRate, setOutRate] = useState<number | undefined>();
  const [matchRate, setMatchRate] = useState(true);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [fsa, setFsa] = useState(true);

  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const sourcesRef = useRef<Source[]>([]);
  const metaJob = useRef(0);
  const stateRef = useRef<any>({});

  // ---------- init ----------
  useEffect(() => {
    setFsa(hasFSA());
    const v = Number(localStorage.getItem("2k.volume"));
    if (localStorage.getItem("2k.volume") !== null && !isNaN(v)) setVolumeState(v);
    setMatchRate(localStorage.getItem("2k.match") !== "0");
    (async () => {
      const f = await kvGet<string[]>("favs").catch(() => undefined);
      if (f) setFavs(new Set(f));
      const s = await kvGet<Source[]>("sources").catch(() => undefined);
      if (s?.length && hasFSA()) {
        sourcesRef.current = s;
        const ok = (await Promise.all(s.map((x) => permissionOk(x.handle)))).every(Boolean);
        if (ok) await rescan();
        else setNeedsReconnect(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMeta = useCallback(async (list: Track[]) => {
    const job = ++metaJob.current;
    let n = 0;
    for (const t of list) {
      if (job !== metaJob.current) return;
      if (t.meta) continue;
      try {
        t.meta = await readMeta(await getFile(t));
      } catch {
        t.meta = { title: t.name.replace(/\.[^.]+$/, "") };
      }
      if (++n % 25 === 0) setMetaTick((x) => x + 1);
    }
    setMetaTick((x) => x + 1);
  }, []);

  const setLibrary = useCallback(
    (list: Track[]) => {
      setTracks(list);
      loadMeta(list);
    },
    [loadMeta],
  );

  const rescan = useCallback(async () => {
    const list = await scanSources(sourcesRef.current);
    setLibrary(list);
  }, [setLibrary]);

  const addSource = useCallback(
    async (kind: "dir" | "file") => {
      try {
        if (kind === "dir") {
          const h = await (window as any).showDirectoryPicker({ mode: "read" });
          sourcesRef.current = [...sourcesRef.current, { kind: "dir", handle: h }];
        } else {
          const hs = await (window as any).showOpenFilePicker({ multiple: true });
          sourcesRef.current = [
            ...sourcesRef.current,
            ...hs.map((h: any) => ({ kind: "file" as const, handle: h })),
          ];
        }
        await kvSet("sources", sourcesRef.current);
        await rescan();
      } catch {
        /* cancelled */
      }
    },
    [rescan],
  );

  const addFileList = useCallback(
    (files: FileList) => {
      const known = new Set(tracks.map((t) => t.path));
      const add = tracksFromFileList(files).filter((t) => !known.has(t.path));
      setLibrary(sortTracks([...tracks, ...add]));
    },
    [tracks, setLibrary],
  );

  const reconnect = useCallback(async () => {
    const ok = (
      await Promise.all(sourcesRef.current.map((s) => permissionOk(s.handle, true)))
    ).every(Boolean);
    if (ok) {
      setNeedsReconnect(false);
      await rescan();
    }
  }, [rescan]);

  const clearLibrary = useCallback(async () => {
    stop();
    sourcesRef.current = [];
    await kvSet("sources", []);
    metaJob.current++;
    setTracks([]);
    setCurrent(null);
    setNeedsReconnect(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- derived ----------
  const artists = useMemo(() => {
    const s = new Set<string>();
    let unknown = false;
    for (const t of tracks) {
      if (t.meta?.artist) s.add(t.meta.artist);
      else unknown = true;
    }
    return { list: [...s].sort((a, b) => a.localeCompare(b)), unknown };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, metaTick]);

  const queue = useMemo(() => {
    if (filter === ALL) return tracks;
    if (filter === FAVS) return tracks.filter((t) => favs.has(t.path));
    if (filter === UNKNOWN) return tracks.filter((t) => !t.meta?.artist);
    return tracks.filter((t) => t.meta?.artist === filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, filter, favs, metaTick]);

  const currentTrack = useMemo(
    () => tracks.find((t) => t.path === current) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, current, metaTick],
  );

  // ---------- engine ----------
  function stop() {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.src = "";
    }
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlaying(false);
  }

  async function ensureCtx(rate?: number) {
    const want = matchRate && rate ? rate : undefined;
    const cur = ctxRef.current;
    if (cur && (!want || cur.sampleRate === want)) return cur;
    if (cur) await cur.close().catch(() => {});
    let ctx: AudioContext;
    try {
      ctx = want
        ? new AudioContext({ sampleRate: want, latencyHint: "playback" })
        : new AudioContext({ latencyHint: "playback" });
    } catch {
      ctx = new AudioContext();
    }
    const g = ctx.createGain();
    g.gain.value = (volume / 10) ** 2;
    g.connect(ctx.destination);
    ctxRef.current = ctx;
    gainRef.current = g;
    setOutRate(ctx.sampleRate);
    return ctx;
  }

  const playTrack = useCallback(
    async (t: Track) => {
      stop();
      setCurrent(t.path);
      setTime(0);
      setDuration(0);
      const file = await getFile(t);
      if (!t.meta) {
        t.meta = await readMeta(file).catch(() => ({ title: t.name }));
        setMetaTick((x) => x + 1);
      }
      const ctx = await ensureCtx(t.meta?.sampleRate);
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      const a = new Audio(url);
      audioRef.current = a;
      const src = ctx.createMediaElementSource(a);
      src.connect(gainRef.current!);
      a.ontimeupdate = () => setTime(a.currentTime);
      a.onloadedmetadata = () => setDuration(a.duration);
      a.onplay = () => setPlaying(true);
      a.onpause = () => setPlaying(false);
      a.onended = () => stateRef.current.onEnded?.();
      if (ctx.state === "suspended") await ctx.resume();
      await a.play().catch(() => {});
      // cover
      setCover((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      const pic = (await readPicture(file).catch(() => null)) ?? (await findFolderCover(t));
      if (pic && audioRef.current === a) setCover(URL.createObjectURL(pic));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [matchRate, volume],
  );

  const step = useCallback(
    (dir: 1 | -1, auto = false) => {
      if (!queue.length) return;
      let idx = queue.findIndex((t) => t.path === current);
      if (shuffle && queue.length > 1) {
        let n = idx;
        while (n === idx) n = Math.floor(Math.random() * queue.length);
        idx = n;
      } else {
        idx += dir;
        if (idx >= queue.length) {
          if (auto && repeat === "off") return stop();
          idx = 0;
        }
        if (idx < 0) idx = queue.length - 1;
      }
      playTrack(queue[idx]!);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, current, shuffle, repeat, playTrack],
  );

  stateRef.current.onEnded = () => {
    if (repeat === "one" && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
    } else step(1, true);
  };

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) {
      const t = queue.find((x) => x.path === current) ?? queue[0];
      if (t) playTrack(t);
      return;
    }
    if (a.paused) {
      ctxRef.current?.resume();
      a.play();
    } else a.pause();
  }, [queue, current, playTrack]);

  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (a) {
      a.currentTime = Math.max(0, Math.min(t, a.duration || t));
      setTime(a.currentTime);
    }
  }, []);
  const seekBy = useCallback((d: number) => {
    const a = audioRef.current;
    if (a) seek(a.currentTime + d);
  }, [seek]);

  const setVolume = useCallback((v: number) => {
    const n = Math.max(0, Math.min(10, v));
    setVolumeState(n);
    localStorage.setItem("2k.volume", String(n));
    if (gainRef.current) gainRef.current.gain.value = (n / 10) ** 2;
  }, []);

  const toggleMatch = useCallback((v: boolean) => {
    setMatchRate(v);
    localStorage.setItem("2k.match", v ? "1" : "0");
  }, []);

  const toggleFav = useCallback(() => {
    if (!current) return;
    setFavs((f) => {
      const n = new Set(f);
      if (n.has(current)) n.delete(current);
      else n.add(current);
      kvSet("favs", [...n]);
      return n;
    });
  }, [current]);

  const cycleRepeat = () => setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));

  // keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "SELECT" || tag === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") seekBy(-10);
      else if (e.key === "ArrowRight") seekBy(10);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [togglePlay, seekBy]);

  // media session + title
  useEffect(() => {
    const m = currentTrack?.meta;
    if (currentTrack && playing) document.title = `${m?.title ?? currentTrack.name} · 2kPlayer`;
    else document.title = "2kPlayer";
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m?.title ?? currentTrack.name,
      artist: m?.artist ?? "",
      album: m?.album ?? "",
      artwork: cover ? [{ src: cover }] : [],
    });
    navigator.mediaSession.setActionHandler("play", togglePlay);
    navigator.mediaSession.setActionHandler("pause", togglePlay);
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  }, [currentTrack, playing, cover, togglePlay, step]);

  return {
    tracks, queue, artists, filter, setFilter, currentTrack, playing, time, duration,
    volume, setVolume, shuffle, setShuffle, repeat, cycleRepeat, favs, toggleFav,
    cover, outRate, matchRate, toggleMatch, needsReconnect, fsa,
    addSource, addFileList, reconnect, clearLibrary, playTrack, step, togglePlay, seek, seekBy,
  };
}

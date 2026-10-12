/* eslint-disable @typescript-eslint/no-explicit-any */
// Fallback when a direct audio stream can't be resolved: official YouTube embed,
// wrapped to look like an HTMLAudioElement for the player engine.
let apiPromise: Promise<any> | null = null;
function loadApi(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!apiPromise)
    apiPromise = new Promise((res) => {
      w.onYouTubeIframeAPIReady = () => res(w.YT);
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
  return apiPromise;
}

export class YtAudio {
  paused = true;
  duration = NaN;
  ontimeupdate: (() => void) | null = null;
  onloadedmetadata: (() => void) | null = null;
  onplay: (() => void) | null = null;
  onpause: (() => void) | null = null;
  onended: (() => void) | null = null;
  private p: any = null;
  private timer: any = null;
  private ready: Promise<void>;
  private host: HTMLDivElement;

  constructor(id: string, volume: number) {
    this.host = document.createElement("div");
    this.host.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;bottom:0;opacity:0;pointer-events:none";
    const inner = document.createElement("div");
    this.host.appendChild(inner);
    document.body.appendChild(this.host);
    this.ready = loadApi().then(
      (YT) =>
        new Promise<void>((res) => {
          this.p = new YT.Player(inner, {
            videoId: id,
            width: 1,
            height: 1,
            playerVars: { autoplay: 1, playsinline: 1, controls: 0 },
            events: {
              onReady: () => {
                this.setVolume(volume);
                this.duration = this.p.getDuration();
                this.onloadedmetadata?.();
                res();
              },
              onStateChange: (e: any) => {
                if (e.data === 1) {
                  this.paused = false;
                  this.duration = this.p.getDuration();
                  this.onloadedmetadata?.();
                  this.onplay?.();
                } else if (e.data === 2) {
                  this.paused = true;
                  this.onpause?.();
                } else if (e.data === 0) {
                  this.paused = true;
                  this.onended?.();
                }
              },
            },
          });
        }),
    );
    this.timer = setInterval(() => this.p?.getCurrentTime && this.ontimeupdate?.(), 250);
  }
  get currentTime() {
    return this.p?.getCurrentTime?.() ?? 0;
  }
  set currentTime(t: number) {
    this.p?.seekTo?.(t, true);
  }
  setVolume(v: number) {
    this.p?.setVolume?.(Math.round(((v / 10) ** 2) * 100));
  }
  async play() {
    await this.ready;
    this.p.playVideo();
  }
  pause() {
    this.p?.pauseVideo?.();
  }
  set src(_v: string) {
    this.destroy();
  }
  destroy() {
    clearInterval(this.timer);
    try {
      this.p?.destroy?.();
    } catch {
      /* ignore */
    }
    this.host.remove();
  }
}

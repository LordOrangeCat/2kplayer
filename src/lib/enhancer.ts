// Real-time psychoacoustic enhancer built from Web Audio nodes.
export interface EnhancerParams {
  on: boolean;
  warmth: number; // 0..10
  punch: number; // 0..10
  air: number; // 0..10
  width: number; // 0..10 (5 = original)
}

export const DEFAULT_ENH: EnhancerParams = { on: false, warmth: 3, punch: 4, air: 4, width: 6 };

export const PRESETS: Record<string, Omit<EnhancerParams, "on">> = {
  "Hi-Res Emulation": { warmth: 3, punch: 4, air: 6, width: 6 },
  "Analog Tape": { warmth: 7, punch: 3, air: 2, width: 5 },
  "Deep Bass": { warmth: 4, punch: 9, air: 3, width: 5 },
  "Vocal Clarity": { warmth: 2, punch: 2, air: 7, width: 5 },
  Flat: { warmth: 0, punch: 0, air: 0, width: 5 },
};

function curve(drive: number) {
  const n = 2048;
  const c = new Float32Array(n);
  const k = 1 + drive * 6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

export function createEnhancer(ctx: AudioContext) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);

  // punch
  const lowShelf = ctx.createBiquadFilter();
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 90;
  const lowCut = ctx.createBiquadFilter(); // tame mud
  lowCut.type = "peaking";
  lowCut.frequency.value = 300;
  lowCut.Q.value = 1;
  input.connect(lowShelf).connect(lowCut);

  // warmth (parallel saturation)
  const satIn = ctx.createGain();
  const sat = ctx.createWaveShaper();
  sat.oversample = "4x";
  const satMix = ctx.createGain();
  const clean = ctx.createGain();
  lowCut.connect(clean);
  lowCut.connect(satIn).connect(sat).connect(satMix);
  const body = ctx.createGain();
  clean.connect(body);
  satMix.connect(body);

  // air exciter (parallel high harmonics)
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6500;
  const exc = ctx.createWaveShaper();
  exc.curve = curve(1.5);
  exc.oversample = "4x";
  const hp2 = ctx.createBiquadFilter();
  hp2.type = "highpass";
  hp2.frequency.value = 7000;
  const airGain = ctx.createGain();
  body.connect(hp).connect(exc).connect(hp2).connect(airGain);
  const sum = ctx.createGain();
  body.connect(sum);
  airGain.connect(sum);

  // stereo width
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  const ll = ctx.createGain(), rr = ctx.createGain(), lr = ctx.createGain(), rl = ctx.createGain();
  sum.connect(split);
  split.connect(ll, 0).connect(merge, 0, 0);
  split.connect(rl, 1).connect(merge, 0, 0);
  split.connect(rr, 1).connect(merge, 0, 1);
  split.connect(lr, 0).connect(merge, 0, 1);

  // glue + safety
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  comp.knee.value = 12;
  const makeup = ctx.createGain();
  const limit = ctx.createDynamicsCompressor();
  limit.threshold.value = -1;
  limit.ratio.value = 20;
  limit.attack.value = 0.002;
  limit.release.value = 0.1;
  merge.connect(comp).connect(makeup).connect(limit).connect(wet).connect(output);

  function set(p: EnhancerParams) {
    const t = ctx.currentTime;
    const ramp = (a: AudioParam, v: number) => a.setTargetAtTime(v, t, 0.05);
    ramp(dry.gain, p.on ? 0 : 1);
    ramp(wet.gain, p.on ? 1 : 0);
    ramp(lowShelf.gain, p.punch * 0.9);
    ramp(lowCut.gain, -p.punch * 0.3);
    sat.curve = curve(p.warmth / 10);
    ramp(satIn.gain, 1);
    ramp(satMix.gain, (p.warmth / 10) * 0.5);
    ramp(clean.gain, 1 - (p.warmth / 10) * 0.25);
    ramp(airGain.gain, (p.air / 10) * 0.6);
    const w = p.width / 5; // 0..2
    ramp(ll.gain, (1 + w) / 2);
    ramp(rr.gain, (1 + w) / 2);
    ramp(lr.gain, (1 - w) / 2);
    ramp(rl.gain, (1 - w) / 2);
    ramp(makeup.gain, 1 + p.punch * 0.02 + p.warmth * 0.01);
  }

  return { input, output, set };
}
export type Enhancer = ReturnType<typeof createEnhancer>;

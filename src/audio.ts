// ============================== audio.ts ==============================
// procedural WebAudio: overcast wind, birds, footsteps, pick pops, gong, chimes
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let windGain: GainNode | null = null;
let birdTimer: number | null = null;
let muted = false;
let birdLevel = 1;
export function setBirdLevel(v: number): void { birdLevel = v; }

function ensure(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    // pinkish noise
    const w = Math.random() * 2 - 1;
    last = 0.98 * last + 0.02 * w;
    d[i] = (last * 3.2 + w * 0.12) * 0.5;
  }
  return buf;
}

export function startAmbient(): void {
  const c = ensure();
  if (!c || !master) return;
  if (windGain) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 4);
  src.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  lp.Q.value = 0.4;
  windGain = c.createGain();
  windGain.gain.value = 0.16;
  // slow gusts
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.06;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 160;
  lfo.connect(lfoGain);
  lfoGain.connect(lp.frequency);
  lfo.start();
  src.connect(lp);
  lp.connect(windGain);
  windGain.connect(master);
  src.start();
  scheduleBird();
}

function chirp(c: AudioContext): void {
  if (!master || muted) return;
  if (Math.random() > birdLevel) return; // the forest is going quiet
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  const f0 = 2600 + Math.random() * 2200;
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.5), t + 0.05);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + 0.12);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.04, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.2);
  // occasional second note
  if (Math.random() < 0.5) {
    const t2 = t + 0.18 + Math.random() * 0.1;
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(f0 * 1.2, t2);
    o2.frequency.exponentialRampToValueAtTime(f0, t2 + 0.1);
    g2.gain.setValueAtTime(0, t2);
    g2.gain.linearRampToValueAtTime(0.04, t2 + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.14);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t2);
    o2.stop(t2 + 0.18);
  }
}

function scheduleBird(): void {
  if (birdTimer !== null) return;
  const tick = (): void => {
    birdTimer = null;
    const c = ensure();
    if (c) chirp(c);
    birdTimer = window.setTimeout(tick, 3500 + Math.random() * 8000);
  };
  birdTimer = window.setTimeout(tick, 1500 + Math.random() * 4000);
}

export function footstep(intensity: number): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.12);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 280 + Math.random() * 260;
  bp.Q.value = 1.1;
  const g = c.createGain();
  const v = 0.1 * intensity * (0.7 + Math.random() * 0.5);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t);
}

export function creak(): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  const f = 90 + Math.random() * 70;
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * 0.7, t + 0.25);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0, t);
  g.gain.linearRampToValueAtTime(0.025, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 500;
  o.connect(lp);
  lp.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.32);
}

export function pickSfx(kind: 'good' | 'gold' | 'bad'): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  // brush
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.15);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 0.8;
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.08, t);
  bg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  src.connect(bp);
  bp.connect(bg);
  bg.connect(master);
  src.start(t);
  // pop
  const o = c.createOscillator();
  o.type = 'sine';
  const base = kind === 'gold' ? 660 : kind === 'bad' ? 220 : 440;
  o.frequency.setValueAtTime(base, t + 0.02);
  o.frequency.exponentialRampToValueAtTime(base * (kind === 'bad' ? 0.6 : 0.7), t + 0.1);
  const g = c.createGain();
  g.gain.setValueAtTime(0.12, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g);
  g.connect(master);
  o.start(t + 0.02);
  o.stop(t + 0.16);
  if (kind === 'gold') {
    const o2 = c.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(base * 1.5, t + 0.06);
    o2.frequency.exponentialRampToValueAtTime(base * 2, t + 0.18);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.09, t + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t + 0.06);
    o2.stop(t + 0.27);
  }
}

export function thud(): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  // low wooden drop
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 0.14);
  // dull body of the sound
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, 0.08);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.1, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  src.connect(lp);
  lp.connect(ng);
  ng.connect(master);
  src.start(t);
}

export function gong(): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  for (const [f, v, d] of [[110, 0.16, 1.4], [164.8, 0.08, 1.1], [233, 0.04, 0.8]] as const) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.97, t + d);
    const g = c.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + d + 0.05);
  }
}

export function chime(n: number): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  for (let i = 0; i < Math.min(n, 5); i++) {
    const t = c.currentTime + i * 0.12;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = scale[Math.floor(Math.random() * scale.length)];
    const g = c.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.55);
  }
}

export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

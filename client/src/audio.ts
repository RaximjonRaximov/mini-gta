let ctx: AudioContext | null = null;
let muted = false;
let noiseBuffer: AudioBuffer | null = null;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctx = (window as typeof window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  const size = ctx.sampleRate * 0.3;
  const buf = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return ctx;
}

export function setMuted(v: boolean): void {
  muted = v;
  if (muted && ctx) { ctx.suspend(); }
  else if (ctx) { ctx.resume(); }
}

export function isMuted(): boolean { return muted; }

export function playShoot(): void {
  const c = ensureCtx(); if (!c || muted) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(600, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(100, c.currentTime + 0.08);
  g.gain.setValueAtTime(0.08, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.1);
}

export function playExplosion(): void {
  const c = ensureCtx(); if (!c || muted || !noiseBuffer) return;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const g = c.createGain();
  g.gain.setValueAtTime(0.2, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
  src.connect(g); g.connect(c.destination);
  src.start(); src.stop(c.currentTime + 0.4);
}

export function playChicken(): void {
  const c = ensureCtx(); if (!c || muted) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(800, c.currentTime);
  o.frequency.linearRampToValueAtTime(1200, c.currentTime + 0.08);
  g.gain.setValueAtTime(0.05, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + 0.12);
}

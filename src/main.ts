// ============================== cap-hunt main.ts ==============================
// first-person mushroom foraging in an overcast late-summer forest floor:
// boardwalk, moss, leaf litter, low thicket, a camo-sleeved hand that reaches in.
import * as THREE from 'three';
import * as SFX from './audio';

// ---------- debug hook (tests) ----------
const G = {
  mode: 'title' as 'title' | 'play' | 'pause' | 'end',
  weight: 0,
  goal: 100,
  timeLeft: 150,
  picks: 0,
  badPicks: 0,
  basket: {} as Record<string, number>,
  goldenFound: 0,
  started: false,
  targetName: '',
};
(window as any).__cap = {
  state: () => ({
    mode: G.mode, weight: G.weight, timeLeft: Math.max(0, Math.round(G.timeLeft)),
    picks: G.picks, badPicks: G.badPicks, goldenFound: G.goldenFound,
    basket: { ...G.basket }, target: G.targetName, x: player.x, z: player.z,
    y: player.y, yaw: player.yaw, pitch: player.pitch,
  }),
  keys: (k: string, down: boolean) => {
    if (down) keys.add(k); else keys.delete(k);
  },
  click: () => doPickAction(),
  teleport: (x: number, z: number) => {
    player.x = x; player.z = z;
  },
  aim: (yaw: number, pitch: number) => {
    player.yaw = yaw; player.pitch = pitch;
    syncCameraAndTarget(); // synchronous — tests must not race the rAF raycast
  },
  aimAt: (x: number, z: number) => {
    const px = player.x, pz = player.z, eyeY = player.y + 1.5;
    const dx = x - px, dz = z - pz;
    player.yaw = Math.atan2(-dx, -dz);
    const hd = Math.max(0.2, Math.hypot(dx, dz));
    const dy = groundH(x, z) + 0.06 - eyeY;
    player.pitch = Math.max(-1.35, Math.min(1.35, Math.atan2(dy, hd)));
    syncCameraAndTarget();
  },
  nearestShroom: () => {
    let best: THREE.Vector3 | null = null, bd = 1e9;
    for (const g of shrooms) {
      const d = Math.hypot(g.position.x - player.x, g.position.z - player.z);
      if (d < bd) { bd = d; best = g.position; }
    }
    return best ? { x: best.x, z: best.z, d: bd } : null;
  },
  refShot: () => {
    // deterministic reference framing: stand between the mossy log (left) and the
    // boardwalk (right), facing -z down the corridor, at the nearest mushroom ahead
    player.x = 0.4; player.z = 21.2;
    player.y = groundH(0.4, 21.2);
    let best: THREE.Vector3 | null = null, bd = 1e9;
    for (const g of shrooms) {
      const dz = g.position.z - player.z;
      if (dz < 0 && dz > -4.5 && Math.abs(g.position.x - 0.4) < 4 && -dz < bd) {
        bd = -dz; best = g.position;
      }
    }
    if (best) {
      player.yaw = Math.atan2(-(best.x - player.x), -(best.z - player.z));
      const hd = Math.max(0.3, Math.hypot(best.x - player.x, best.z - player.z));
      player.pitch = Math.max(-1.35, Math.min(1.35, Math.atan2(groundH(best.x, best.z) + 0.05 - (player.y + 1.4), hd)));
      return { x: best.x, z: best.z, d: hd };
    }
    player.yaw = 0; player.pitch = -0.4;
    return null;
  },
  mute: () => SFX.setMuted(!SFX.isMuted()),
  muted: () => SFX.isMuted(),
  skipTime: (s: number) => { G.timeLeft = Math.max(0, G.timeLeft - s); },
  info: () => {
    const byKind: Record<string, number> = {};
    for (const t of trees) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
    const bySp: Record<string, { x: number; z: number }[]> = {};
    for (const g of shrooms) {
      const sp = g.userData.sp as string;
      (bySp[sp] ??= []).push({ x: g.position.x, z: g.position.z });
    }
    let mn = 1e9, mx = -1e9;
    for (let x = -44; x <= 44; x += 4) for (let z = -44; z <= 44; z += 4) {
      const h = groundH(x, z);
      if (h < mn) mn = h; if (h > mx) mx = h;
    }
    return {
      trees: { total: trees.length, byKind },
      treeList: trees.map((t) => ({ x: t.x, z: t.z, kind: t.kind, r: t.r })),
      shrooms: { total: shrooms.length, bySp },
      elevation: { min: mn, max: mx, span: mx - mn, spawn: groundH(0, 22), north: groundH(0, -22) },
    };
  },
  nearestTree: (x: number, z: number) => {
    let bd = 1e9, kind = '';
    for (const t of trees) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; kind = t.kind; } }
    return { kind, d: bd };
  },
  save: () => ({ bestWeight: saved.bestWeight, seen: { ...saved.seen }, deadlyMistakes: saved.deadlyMistakes, bestPerSeed: { ...saved.bestPerSeed } }),
  clearSave: () => { saved = { bestWeight: 0, seen: { champ: false, fly: false, chant: false, trump: false, deadly: false, gold: false }, deadlyMistakes: 0, bestPerSeed: {} }; saveSave(); renderCodex(); },
  seed: () => forestSeed,
  newWoods: () => newWoods(),
  texDataUrl: () => (window as any).__capCamo.toDataURL('image/png'),
};

// ---------- three setup ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fa8ad);
const fog = new THREE.Fog(0x9fa8ad, 12, 56);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.05, 100);

// scene-level overcast: keep flat diffuse (no directional shadows)
renderer.shadowMap.enabled = false;
const hemi = new THREE.HemisphereLight(0xc9d4d8, 0x4a5240, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xf2ede2, 0.75);
sun.position.set(6, 14, 4);
scene.add(sun);

// the light is the timer: as timeLeft drains, the forest closes — fog tightens,
// the sky cools, the sun warms and falls, and (audio) the birds go quiet
const skyDay = new THREE.Color(0x9fa8ad);
const skyDusk = new THREE.Color(0x5f6771);
const sky = new THREE.Color(0x9fa8ad);
const sunDay = new THREE.Color(0xf2ede2);
const sunDusk = new THREE.Color(0xd99a62);
const sunCol = new THREE.Color(0xf2ede2);
let lightApplied = -1;
function applyLight(t: number): void {
  // t: 0 at run start, 1 at the end. Hold the day for the first 55%, then close in.
  const k = THREE.MathUtils.smoothstep(t, 0.45, 1);
  fog.near = 12 - k * 6;
  fog.far = 56 - k * 36;
  sky.copy(skyDay).lerp(skyDusk, k);
  scene.background = sky;
  fog.color.copy(sky);
  hemi.intensity = 1.05 - k * 0.38;
  sun.intensity = 0.75 - k * 0.45;
  sunCol.copy(sunDay).lerp(sunDusk, k);
  sun.color = sunCol;
  renderer.toneMappingExposure = 1.05 - k * 0.2;
  // birds fall silent in the last stretch
  const birds = THREE.MathUtils.clamp(1 - THREE.MathUtils.smoothstep(t, 0.72, 0.95) * 0.85, 0.15, 1);
  SFX.setBirdLevel(birds);
  if (Math.abs(k - lightApplied) < 0.004 && lightApplied >= 0) return;
  lightApplied = k;
}

// ---------- canvas texture helpers ----------
function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// ---------- a personal forest: one seed per player, persisted ----------
// the woods are yours: same trees, same caps, every run. "new woods" re-rolls.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED_KEY = 'caphunt_seed_v1';
function loadSeed(): number {
  try {
    const raw = localStorage.getItem(SEED_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n > 0) return n;
  } catch { /* private mode */ }
  const s = 1 + ((Math.random() * 0x7fffffff) | 0);
  try { localStorage.setItem(SEED_KEY, String(s)); } catch { /* fine */ }
  return s;
}
const forestSeed = loadSeed();
// world construction draws from srnd (deterministic per seed); runtime noise keeps Math.random
const srnd = mulberry32(forestSeed);
function newWoods(): void {
  const s = 1 + ((Math.random() * 0x7fffffff) | 0);
  try { localStorage.setItem(SEED_KEY, String(s)); } catch { /* fine */ }
  location.reload();
}
function rnd(a: number, b: number): number { return a + srnd() * (b - a); }

// mossy ground: green-brown base, soft moss patches, leaf litter flecks, twigs
const groundTex = canvasTex(512, 512, (x, w, h) => {
  x.fillStyle = '#5f6247';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) {
    x.fillStyle = `rgba(${rnd(58, 110) | 0},${rnd(82, 122) | 0},${rnd(40, 66) | 0},${rnd(0.05, 0.28)})`;
    const r = rnd(2, 16);
    x.beginPath(); x.arc(rnd(0, w), rnd(0, h), r, 0, 7); x.fill();
  }
  // bright moss patches
  for (let i = 0; i < 44; i++) {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, rnd(14, 40));
    g.addColorStop(0, `rgba(${rnd(88, 110) | 0},${rnd(130, 150) | 0},58,0.5)`);
    g.addColorStop(1, 'rgba(90,130,60,0)');
    x.save(); x.translate(rnd(0, w), rnd(0, h)); x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, 44, 0, 7); x.fill(); x.restore();
  }
  // leaf litter flecks
  for (let i = 0; i < 420; i++) {
    const cols = ['#8a6a3c', '#9c7a44', '#7a5a32', '#a8894e', '#6e7a3a'];
    x.fillStyle = cols[(srnd() * cols.length) | 0];
    x.globalAlpha = rnd(0.25, 0.7);
    x.save(); x.translate(rnd(0, w), rnd(0, h)); x.rotate(rnd(0, 6.3));
    x.beginPath(); x.ellipse(0, 0, rnd(2, 5), rnd(1, 2.4), 0, 0, 7); x.fill();
    x.restore();
  }
  x.globalAlpha = 1;
  // twigs
  for (let i = 0; i < 70; i++) {
    x.strokeStyle = `rgba(${rnd(70, 100) | 0},${rnd(55, 75) | 0},38,${rnd(0.2, 0.5)})`;
    x.lineWidth = rnd(0.5, 1.4);
    const tx = rnd(0, w), ty = rnd(0, h), a = rnd(0, 6.3), l = rnd(4, 14);
    x.beginPath(); x.moveTo(tx, ty);
    x.quadraticCurveTo(tx + Math.cos(a) * l * 0.5 + rnd(-3, 3), ty + Math.sin(a) * l * 0.5, tx + Math.cos(a) * l, ty + Math.sin(a) * l);
    x.stroke();
  }
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.repeat.set(14, 14);

// weathered plank: silvery grey boards, grain, gaps, moss in seams
const plankTex = canvasTex(512, 512, (x, w, h) => {
  x.fillStyle = '#9a948a';
  x.fillRect(0, 0, w, h);
  const plankH = h / 5;
  for (let p = 0; p < 5; p++) {
    const y0 = p * plankH;
    const base = rnd(150, 178) | 0;
    x.fillStyle = `rgb(${base},${base - 4},${base - 12})`;
    x.fillRect(0, y0, w, plankH - 3);
    // grain streaks
    for (let i = 0; i < 26; i++) {
      x.strokeStyle = `rgba(${rnd(90, 130) | 0},${rnd(85, 120) | 0},${rnd(70, 100) | 0},${rnd(0.08, 0.3)})`;
      x.lineWidth = rnd(0.6, 2.2);
      const gy = y0 + rnd(2, plankH - 5);
      x.beginPath(); x.moveTo(0, gy);
      x.bezierCurveTo(w * 0.3, gy + rnd(-4, 4), w * 0.6, gy + rnd(-4, 4), w, gy + rnd(-2, 2));
      x.stroke();
    }
    // end grain / knots
    if (srnd() < 0.7) {
      const kx = rnd(30, w - 30), ky = y0 + plankH * 0.5;
      const g = x.createRadialGradient(kx, ky, 0, kx, ky, rnd(4, 9));
      g.addColorStop(0, 'rgba(70,62,50,0.8)');
      g.addColorStop(1, 'rgba(70,62,50,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(kx, ky, 10, 0, 7); x.fill();
    }
    // gap + moss
    x.fillStyle = '#3a382f';
    x.fillRect(0, y0 + plankH - 3, w, 3);
    x.fillStyle = `rgba(${rnd(80, 105) | 0},${rnd(120, 145) | 0},55,0.6)`;
    for (let i = 0; i < 30; i++) {
      x.beginPath(); x.arc(rnd(0, w), y0 + plankH - 3 + rnd(-1, 1), rnd(0.6, 2), 0, 7); x.fill();
    }
  }
});
plankTex.wrapS = plankTex.wrapT = THREE.RepeatWrapping;

// bark: grey-brown, vertical cracks, moss patches
const barkTex = canvasTex(256, 512, (x, w, h) => {
  x.fillStyle = '#7c7266';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 130; i++) {
    x.strokeStyle = `rgba(${rnd(60, 95) | 0},${rnd(55, 85) | 0},${rnd(45, 70) | 0},${rnd(0.1, 0.4)})`;
    x.lineWidth = rnd(1, 4);
    const gx = rnd(0, w);
    x.beginPath(); x.moveTo(gx, 0);
    x.lineTo(gx + rnd(-14, 14), h);
    x.stroke();
  }
  for (let i = 0; i < 22; i++) {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, rnd(8, 26));
    g.addColorStop(0, `rgba(${rnd(85, 105) | 0},${rnd(125, 150) | 0},58,0.55)`);
    g.addColorStop(1, 'rgba(90,130,60,0)');
    x.save(); x.translate(rnd(0, w), rnd(0, h)); x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, 28, 0, 7); x.fill(); x.restore();
  }
});
barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping;

// birch bark: white with dark horizontal lenticel dashes and charcoal scars
const birchTex = canvasTex(256, 512, (x, w, h) => {
  x.fillStyle = '#d8d4c8';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 240; i++) {
    x.strokeStyle = `rgba(${rnd(50, 80) | 0},${rnd(45, 70) | 0},${rnd(40, 60) | 0},${rnd(0.3, 0.85)})`;
    x.lineWidth = rnd(1, 3);
    const lx = rnd(0, w), ly = rnd(0, h), l = rnd(4, 22);
    x.beginPath(); x.moveTo(lx, ly); x.lineTo(lx + l, ly + rnd(-2, 2)); x.stroke();
  }
  // dark vertical scars
  for (let i = 0; i < 14; i++) {
    x.fillStyle = `rgba(40,38,34,${rnd(0.25, 0.6)})`;
    x.fillRect(rnd(0, w), rnd(0, h), rnd(1.5, 4), rnd(10, 46));
  }
  // faint vertical wash for tone variation
  for (let i = 0; i < 10; i++) {
    x.fillStyle = `rgba(150,145,130,${rnd(0.04, 0.1)})`;
    x.fillRect(rnd(0, w), 0, rnd(10, 30), h);
  }
});
birchTex.wrapS = birchTex.wrapT = THREE.RepeatWrapping;

// aspen bark: pale grey-green with small dark eye scars
const aspenTex = canvasTex(256, 512, (x, w, h) => {
  x.fillStyle = '#a8ab98';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) {
    x.strokeStyle = `rgba(${rnd(95, 120) | 0},${rnd(98, 122) | 0},${rnd(80, 100) | 0},${rnd(0.08, 0.3)})`;
    x.lineWidth = rnd(1, 3);
    const gx = rnd(0, w);
    x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx + rnd(-10, 10), h); x.stroke();
  }
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(55,58,50,${rnd(0.35, 0.8)})`;
    x.beginPath(); x.ellipse(rnd(0, w), rnd(0, h), rnd(1.5, 4), rnd(1, 2.5), 0, 0, 7); x.fill();
  }
});
aspenTex.wrapS = aspenTex.wrapT = THREE.RepeatWrapping;

// chamois camo sleeve: cream / khaki / warm-brown organic blotches + tiger streaks + stipple
const camoTex = canvasTex(512, 512, (x, w, h) => {
  x.fillStyle = '#b7a684';
  x.fillRect(0, 0, w, h);
  // soft organic amoeba blob: many anchor points, per-vertex radius jitter,
  // drawn as a radial-gradient circle so edges fade (no faceting, no glow)
  const blob = (color: string, n: number, rMin: number, rMax: number, alpha: number) => {
    for (let i = 0; i < n; i++) {
      const cx = rnd(0, w), cy = rnd(0, h);
      const r = rnd(rMin, rMax);
      x.save();
      x.translate(cx, cy);
      x.rotate(rnd(0, 6.3));
      // jittered radius profile
      const pts: [number, number][] = [];
      const N = 16;
      for (let a = 0; a < N; a++) {
        const ang = (a / N) * Math.PI * 2;
        pts.push([Math.cos(ang), Math.sin(ang)]);
      }
      const radii = pts.map(() => r * rnd(0.55, 1.4));
      const g = x.createRadialGradient(0, 0, r * 0.15, 0, 0, r * 1.5);
      g.addColorStop(0, color.replace('ALPHA', String(alpha)));
      g.addColorStop(0.72, color.replace('ALPHA', String(alpha * 0.9)));
      g.addColorStop(1, color.replace('ALPHA', '0'));
      x.fillStyle = g;
      x.beginPath();
      for (let a = 0; a <= N; a++) {
        const i2 = a % N;
        const i3 = (a + 1) % N;
        const px = pts[i2][0] * radii[i2];
        const py = pts[i2][1] * radii[i2];
        const qx = pts[i3][0] * radii[i3];
        const qy = pts[i3][1] * radii[i3];
        const mx = (px + qx) / 2, my = (py + qy) / 2;
        if (a === 0) x.moveTo(mx, my);
        else {
          // quadratic through midpoints with the anchor as control -> smooth amoeba
          const prevI = (i2 - 1 + N) % N;
          x.quadraticCurveTo(px, py, mx, my);
        }
      }
      x.closePath();
      x.fill();
      x.restore();
    }
  };
  // base field tint (slightly lighter center, like sun-bleached fabric)
  const vg = x.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.7);
  vg.addColorStop(0, 'rgba(233,226,206,0.35)');
  vg.addColorStop(1, 'rgba(150,128,96,0.28)');
  x.fillStyle = vg;
  x.fillRect(0, 0, w, h);
  // directional tiger streaks first (under the blobs)
  for (let i = 0; i < 90; i++) {
    const sx = rnd(0, w), sy = rnd(0, h);
    const ang = 0.35 + rnd(-0.18, 0.18); // mostly diagonal, consistent flow
    const len = rnd(18, 70);
    x.strokeStyle = srnd() < 0.5 ? 'rgba(107,76,52,0.32)' : 'rgba(240,234,216,0.3)';
    x.lineWidth = rnd(2, 7);
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(sx, sy);
    x.quadraticCurveTo(sx + Math.cos(ang) * len * 0.5 + rnd(-6, 6), sy + Math.sin(ang) * len * 0.5, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len);
    x.stroke();
  }
  blob('rgba(96,66,42,ALPHA)', 10, 26, 58, 0.85);
  blob('rgba(238,232,214,ALPHA)', 13, 18, 46, 0.9);
  blob('rgba(178,156,116,ALPHA)', 15, 14, 40, 0.8);
  // stipple dots on top (subtle fabric grain)
  for (let i = 0; i < 1100; i++) {
    x.fillStyle = srnd() < 0.5 ? 'rgba(240,236,222,0.16)' : 'rgba(96,78,54,0.14)';
    x.beginPath(); x.arc(rnd(0, w), rnd(0, h), rnd(0.3, 0.9), 0, 7); x.fill();
  }
});
camoTex.wrapS = camoTex.wrapT = THREE.RepeatWrapping;
camoTex.repeat.set(1.1, 0.6);
(window as any).__capCamo = camoTex.image as HTMLCanvasElement;

// sleeve cuff: solid pale tan with seam
const cuffTex = canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#cbb99a';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 200; i++) {
    x.fillStyle = `rgba(${rnd(180, 210) | 0},${rnd(165, 190) | 0},${rnd(130, 160) | 0},0.25)`;
    x.beginPath(); x.arc(rnd(0, w), rnd(0, h), rnd(1, 4), 0, 7); x.fill();
  }
  x.strokeStyle = 'rgba(140,120,90,0.55)';
  x.lineWidth = 3;
  x.setLineDash([6, 5]);
  x.beginPath(); x.moveTo(0, h * 0.18); x.lineTo(w, h * 0.18); x.stroke();
  x.beginPath(); x.moveTo(0, h * 0.82); x.lineTo(w, h * 0.82); x.stroke();
  x.setLineDash([]);
  // snap button
  x.fillStyle = '#9a8a6c';
  x.beginPath(); x.arc(w * 0.78, h * 0.5, 7, 0, 7); x.fill();
  x.fillStyle = '#7a6a4e';
  x.beginPath(); x.arc(w * 0.78, h * 0.5, 3, 0, 7); x.fill();
});
cuffTex.wrapS = cuffTex.wrapT = THREE.RepeatWrapping;

// skin
const skinTex = canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#e5c3a1';
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 300; i++) {
    x.fillStyle = `rgba(${rnd(210, 235) | 0},${rnd(175, 200) | 0},${rnd(145, 170) | 0},0.2)`;
    x.beginPath(); x.arc(rnd(0, w), rnd(0, h), rnd(1, 5), 0, 7); x.fill();
  }
});

// ---------- world ----------
const world = new THREE.Group();
scene.add(world);

// ground: rolling swell, gentle undulation, and a mossy ridge rising to the north
const groundH = (x: number, z: number): number => {
  const swell = 0.5 * Math.sin(x * 0.085 + 1.3) * Math.cos(z * 0.07 - 0.6);
  const gentle = Math.sin(x * 0.35) * Math.cos(z * 0.3) * 0.07 + Math.sin(x * 0.11 + z * 0.13) * 0.05;
  const ridge = 1.4 * Math.exp(-((z + 22) * (z + 22)) / 300) * (1 - 0.3 * Math.exp(-(x * x) / 160));
  const flat = 1 - 0.65 * Math.exp(-((z - 22) * (z - 22)) / 40); // keep the spawn clearing flatter
  return (ridge + swell + gentle) * flat;
};
{
  const geo = new THREE.PlaneGeometry(96, 96, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vz = pos.getZ(i);
    pos.setY(i, groundH(vx, vz));
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  world.add(m);
}

// scattered moss patches + leaf litter (instanced)
{
  const mossTex = canvasTex(128, 128, (x) => {
    const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, 'rgba(110,150,62,0.9)');
    g.addColorStop(0.6, 'rgba(95,135,55,0.55)');
    g.addColorStop(1, 'rgba(95,135,55,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  });
  for (let i = 0; i < 44; i++) {
    const s = rnd(0.5, 1.8);
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s),
      new THREE.MeshStandardMaterial({ map: mossTex, transparent: true, opacity: 0.55, roughness: 1, depthWrite: false }),
    );
    p.rotation.x = -Math.PI / 2;
    const mx = rnd(-44, 44), mz = rnd(-44, 44);
    p.position.set(mx, 0, mz);
    p.position.y = groundH(p.position.x, p.position.z) + rnd(0.012, 0.025);
    world.add(p);
  }
  const leafCols = ['#8a6a3c', '#9c7a44', '#b08d4e', '#6e7a3a', '#7a5a32'].map((c) => new THREE.Color(c));
  const leafGeo = new THREE.PlaneGeometry(0.07, 0.045);
  leafGeo.rotateX(-Math.PI / 2);
  const im = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ roughness: 1 }), 3400);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const scl = new THREE.Vector3();
  const pv = new THREE.Vector3();
  for (let i = 0; i < 3400; i++) {
    const x = rnd(-46, 46), z = rnd(-46, 46);
    e.set(0, rnd(0, 6.3), rnd(-0.2, 0.2));
    q.setFromEuler(e);
    pv.set(x, groundH(x, z) + rnd(0.01, 0.02), z);
    scl.setScalar(rnd(0.6, 1.8));
    mtx.compose(pv, q, scl);
    im.setMatrixAt(i, mtx);
    im.setColorAt(i, leafCols[(srnd() * leafCols.length) | 0]);
  }
  world.add(im);
}

// ---------- obstacles (collision circles) ----------
interface Ob { x: number; z: number; r: number; }
const obstacles: Ob[] = [];

// ---------- trees: five species, zone-aware, each a habitat ----------
type TreeKind = 'oak' | 'pine' | 'birch' | 'aspen' | 'giant';
interface TreeRec { x: number; z: number; kind: TreeKind; r: number; }
const trees: TreeRec[] = [];
{
  const oakMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1 });
  const birchMat = new THREE.MeshStandardMaterial({ map: birchTex, roughness: 0.9 });
  const aspenMat = new THREE.MeshStandardMaterial({ map: aspenTex, roughness: 0.9 });
  const pineMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1, color: 0x9a8d7c });
  const canopyCols: Record<TreeKind, number[]> = {
    oak: [0x4a6741, 0x527046, 0x44603c, 0x5a7a4a],
    birch: [0x7d9a52, 0x8aa85e, 0x6f8f48, 0x94ad66],
    aspen: [0xa8b04e, 0xb4bc58, 0x98a348],
    pine: [0x3d5a3a, 0x35502f, 0x46603c],
    giant: [0x3f5a38, 0x46613e, 0x38522f],
  };
  const canopyMats = {} as Record<TreeKind, THREE.MeshStandardMaterial[]>;
  (Object.keys(canopyCols) as TreeKind[]).forEach((k) => {
    canopyMats[k] = canopyCols[k].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  });
  // zone bias: south clearing is open deciduous, the north ridge goes conifer,
  // old-growth giants cluster on the ridge itself
  const rollKind = (x: number, z: number): TreeKind => {
    const north = Math.max(0, Math.min(1, (-z - 8) / 32));
    const r = srnd();
    if (z < -14 && r < 0.16) return 'giant';
    if (r < 0.2 + north * 0.32) return 'pine';
    if (r < 0.48) return 'birch';
    if (r < 0.66) return 'aspen';
    return 'oak';
  };
  const placed: [number, number][] = [];
  for (let i = 0; i < 160; i++) {
    const x = rnd(-46, 46), z = rnd(-46, 46);
    if (Math.hypot(x, z - 22) < 3.6) continue; // spawn clear
    if (Math.abs(x - 3.4) < 1.8 && z < 27.5 && z > -8.5) continue; // boardwalk corridor
    const kind = rollKind(x, z);
    const minD = kind === 'giant' ? 3.4 : 2.6;
    for (const p of placed) if (Math.hypot(p[0] - x, p[1] - z) < minD) { continue; }
    placed.push([x, z]);
    const conifer = kind === 'pine' || kind === 'giant';
    const h = kind === 'giant' ? rnd(9, 12) : conifer ? rnd(6, 10) : rnd(5, 8);
    const r = kind === 'giant' ? rnd(0.55, 0.8) : conifer ? rnd(0.16, 0.3) : rnd(0.24, 0.45);
    const mat = kind === 'birch' ? birchMat : kind === 'aspen' ? aspenMat : conifer ? pineMat : oakMat;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, h, 8), mat);
    trunk.position.set(x, h / 2 + groundH(x, z), z);
    trunk.rotation.z = rnd(-0.05, 0.05);
    world.add(trunk);
    obstacles.push({ x, z, r: r + 0.32 });
    trees.push({ x, z, kind, r });
    const by = groundH(x, z);
    if (conifer) {
      // conical crown: stacked tapering cones + a top spire
      const tiers = kind === 'giant' ? 4 : 3;
      for (let c = 0; c < tiers; c++) {
        const cw = Math.max(0.7, r * (5.4 - c * 1.0) * rnd(0.92, 1.1));
        const ch = h * (0.36 - c * 0.02);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(cw, ch, 7),
          canopyMats[kind][(c + i) % canopyMats[kind].length]);
        cone.position.set(x + rnd(-0.15, 0.15), by + h * (0.52 + c * 0.155), z + rnd(-0.15, 0.15));
        world.add(cone);
      }
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 6), canopyMats[kind][0]);
      top.position.set(x, by + h + 0.35, z);
      world.add(top);
    } else {
      // rounded crown blobs (giants are conifers, so deciduous only here)
      const blobs = 2 + ((srnd() * 2) | 0);
      for (let b = 0; b < blobs; b++) {
        const br = rnd(1.4, 2.6);
        const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(br, 1),
          canopyMats[kind][(b + i) % canopyMats[kind].length]);
        canopy.position.set(x + rnd(-1.2, 1.2), h + by + rnd(-0.5, 1.4), z + rnd(-1.2, 1.2));
        canopy.scale.y = rnd(0.5, 0.75);
        world.add(canopy);
      }
    }
  }
}

// rocks
{
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b8b80, roughness: 1, flatShading: true });
  for (let i = 0; i < 34; i++) {
    const x = rnd(-44, 44), z = rnd(-44, 44);
    if (Math.hypot(x, z - 22) < 2.8) continue;
    const r = rnd(0.3, 0.85);
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), rockMat);
    rock.position.set(x, groundH(x, z) + r * 0.35, z);
    rock.scale.y = 0.6;
    rock.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    world.add(rock);
    obstacles.push({ x, z, r: r * 1.05 });
  }
}

// mossy fallen log by the spawn (left of the reference shot), following terrain
{
  const lx = -2.6, lz = 21.5, len = 6.5, rad = 0.38;
  const log = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.05, len, 10),
    new THREE.MeshStandardMaterial({ map: barkTex, roughness: 1 }));
  log.rotation.z = Math.PI / 2;
  log.rotation.y = 0.5;
  const ya = groundH(lx + Math.cos(0.5) * len * 0.5, lz - Math.sin(0.5) * len * 0.5);
  const yb = groundH(lx - Math.cos(0.5) * len * 0.5, lz + Math.sin(0.5) * len * 0.5);
  log.position.set(lx, groundH(lx, lz) + rad * 0.55, lz);
  log.rotation.x = Math.atan2(ya - yb, len);
  world.add(log);
  // moss coating on the log's top
  for (let s = 0; s < 14; s++) {
    const t = (s / 13 - 0.5) * len * 0.9;
    const px = lx + Math.cos(0.5) * t, pz = lz - Math.sin(0.5) * t;
    const moss = new THREE.Mesh(
      new THREE.SphereGeometry(rnd(0.14, 0.3), 6, 4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.27, 0.4, rnd(0.3, 0.45)), roughness: 1 }),
    );
    moss.scale.y = 0.35;
    moss.position.set(px + rnd(-0.1, 0.1), groundH(px, pz) + rad * 0.95, pz + rnd(-0.1, 0.1));
    world.add(moss);
  }
  for (let s = 0; s < 5; s++) {
    const t = (s / 4 - 0.5) * len * 0.8;
    const px = lx + Math.cos(0.5) * t, pz = lz - Math.sin(0.5) * t;
    obstacles.push({ x: px, z: pz, r: rad + 0.25 });
  }
}

// boardwalk on the right: weathered planks on rails
const BOARD_X = 3.4;
const boardTop = 0.34;
{
  const plankMat = new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.95 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6e675c, roughness: 1 });
  for (let i = 0; i < 16; i++) {
    const z = 27 - i * 1.85;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.11, 1.72), plankMat);
    plank.position.set(BOARD_X, boardTop - 0.055 + groundH(BOARD_X, z) * 0.4, z);
    plank.rotation.y = rnd(-0.012, 0.012);
    world.add(plank);
    const under = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.16), railMat);
    under.position.set(BOARD_X - 0.8, boardTop - 0.2 + groundH(BOARD_X, z) * 0.4, z);
    world.add(under);
    const under2 = under.clone();
    under2.position.x = BOARD_X + 0.8;
    world.add(under2);
  }
  // rails
  for (const dx of [-1.02, 1.02]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 32), railMat);
    rail.position.set(BOARD_X + dx, boardTop + 0.2, 9);
    rail.rotation.y = 0;
    world.add(rail);
  }
}
const onBoard = (x: number, z: number): boolean => Math.abs(x - BOARD_X) < 0.95 && z < 27.5 && z > -8.5;

// ---------- bushes + mushrooms ----------
type Species = 'champ' | 'fly' | 'chant' | 'trump' | 'deadly' | 'gold';
interface SpeciesDef {
  name: string; val: number; capR: number; capCol: string; stemCol: string;
  bad?: boolean; gold?: boolean; host: string;
}
const SPECIES: Record<Species, SpeciesDef> = {
  champ: { name: 'Champignon', val: 5, capR: 0.1, capCol: '#b08968', stemCol: '#ddd2c0', host: 'open ground' },
  fly: { name: 'Fly Agaric', val: 4, capR: 0.12, capCol: '#bf3a2b', stemCol: '#e6e0d6', host: 'under birch & aspen' },
  chant: { name: 'Chanterelle', val: 4, capR: 0.085, capCol: '#e0b23c', stemCol: '#d3a83e', host: 'under pine & giants' },
  trump: { name: 'Black Trumpet', val: 8, capR: 0.1, capCol: '#453c33', stemCol: '#4a4038', host: 'under pine & birch' },
  deadly: { name: 'Deadly White', val: 8, capR: 0.11, capCol: '#e9e5dc', stemCol: '#ece8e0', bad: true, host: 'under birch & aspen' },
  gold: { name: 'The Golden Cap', val: 25, capR: 0.12, capCol: '#ffcf3d', stemCol: '#e8c86a', gold: true, host: 'in the shade of old growth' },
};

function capTexture(s: SpeciesDef, sp: Species): THREE.CanvasTexture | null {
  if (sp === 'fly') {
    return canvasTex(128, 128, (x) => {
      x.fillStyle = s.capCol;
      x.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 14; i++) {
        x.fillStyle = 'rgba(245,240,230,0.95)';
        x.beginPath();
        x.ellipse(rnd(6, 122), rnd(6, 122), rnd(3, 8), rnd(3, 8), rnd(0, 3), 0, 7);
        x.fill();
      }
      const g = x.createRadialGradient(64, 64, 30, 64, 64, 90);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(60,10,5,0.45)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    });
  }
  if (sp === 'chant') {
    return canvasTex(128, 128, (x) => {
      x.fillStyle = s.capCol;
      x.fillRect(0, 0, 128, 128);
      // ridges
      x.strokeStyle = 'rgba(150,105,25,0.35)';
      for (let i = 0; i < 14; i++) {
        x.lineWidth = rnd(1, 2.5);
        x.beginPath();
        x.moveTo(64, 64);
        x.lineTo(64 + Math.cos((i / 14) * 6.28) * 90, 64 + Math.sin((i / 14) * 6.28) * 90);
        x.stroke();
      }
      const g = x.createRadialGradient(64, 64, 10, 64, 64, 70);
      g.addColorStop(0, 'rgba(255,230,140,0.5)');
      g.addColorStop(1, 'rgba(140,95,20,0.4)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    });
  }
  return null;
}

// leaf card: alpha-mapped leaf silhouette; near-white so the material color sets the hue
const leafAlphaTex = canvasTex(64, 64, (x) => {
  const g = x.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#f2f4e8');
  g.addColorStop(1, '#c8cfb4');
  x.fillStyle = g;
  x.beginPath(); x.ellipse(32, 32, 29, 15, 0, 0, 7); x.fill();
  x.strokeStyle = 'rgba(60,80,50,0.5)';
  x.lineWidth = 1.6;
  x.beginPath(); x.moveTo(4, 32); x.lineTo(60, 32); x.stroke();
  x.strokeStyle = 'rgba(60,80,50,0.3)';
  x.lineWidth = 1;
  for (const dx of [10, 20, 44, 54]) {
    x.beginPath(); x.moveTo(dx, 32);
    x.lineTo(dx + (dx < 32 ? 4 : -4), dx < 32 ? 22 : 42);
    x.stroke();
  }
});
const leafCardGeo = new THREE.PlaneGeometry(0.13, 0.075);
const bushMats: THREE.MeshStandardMaterial[] = [];
for (let i = 0; i < 5; i++) bushMats.push(new THREE.MeshStandardMaterial({
  map: leafAlphaTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide,
  color: new THREE.Color().setHSL(0.26 + rnd(-0.035, 0.035), 0.32, rnd(0.55, 0.85)),
  roughness: 1,
}));
// a few yellowing leaves (late summer)
const yellowMat = new THREE.MeshStandardMaterial({
  map: leafAlphaTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide,
  color: new THREE.Color('#c9b455'), roughness: 1,
});

const shrooms: THREE.Group[] = [];
const pickMeshes: THREE.Object3D[] = [];
const goldCaps: THREE.Group[] = [];

function makeMushroom(sp: Species, x: number, y: number, z: number): THREE.Group {
  const def = SPECIES[sp];
  const g = new THREE.Group();
  const s = rnd(0.8, 1.3);
  const stemH = sp === 'trump' ? 0.2 : 0.14;
  const stemGeo = sp === 'trump'
    ? new THREE.CylinderGeometry(0.028, 0.055, stemH, 8)
    : new THREE.CylinderGeometry(0.032 * s, 0.045 * s, stemH, 8);
  const stem = new THREE.Mesh(stemGeo, new THREE.MeshStandardMaterial({ color: def.stemCol, roughness: 1 }));
  stem.position.y = stemH / 2;
  g.add(stem);
  let cap: THREE.Mesh;
  const tex = capTexture(def, sp);
  const capMatOpts: THREE.MeshStandardMaterialParameters = {
    color: def.capCol, roughness: 0.65, map: tex ?? undefined,
  };
  if (sp === 'trump') {
    cap = new THREE.Mesh(new THREE.CylinderGeometry(0.065 * s, 0.02 * s, 0.11, 9, 1, true),
      new THREE.MeshStandardMaterial({ color: def.capCol, roughness: 0.8, side: THREE.DoubleSide }));
    cap.position.y = stemH + 0.03;
  } else {
    const dome = new THREE.SphereGeometry(def.capR * s, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    cap = new THREE.Mesh(dome, new THREE.MeshStandardMaterial(capMatOpts));
    cap.scale.y = 0.8;
    cap.position.y = stemH - 0.005;
    if (sp === 'chant') cap.scale.set(1.2, 1.1, 1.2);
    if (sp === 'deadly') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 5, 10),
        new THREE.MeshStandardMaterial({ color: '#ddd8ce', roughness: 1 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = stemH * 0.55;
      g.add(ring);
    }
  }
  if (def.gold) {
    (cap.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#ffbf2e');
    (cap.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.75;
    const light = new THREE.PointLight(0xffcf5a, 0.7, 2.2, 2);
    light.position.y = stemH + 0.08;
    g.add(light);
    g.userData.light = light;
    goldCaps.push(g);
  }
  g.add(cap);
  g.position.set(x, y, z);
  g.rotation.y = rnd(0, 6.3);
  g.rotation.z = rnd(-0.08, 0.08);
  g.userData.sp = sp;
  g.userData.phase = rnd(0, 6.3);
  shrooms.push(g);
  for (const m of g.children) pickMeshes.push(m);
  return g;
}

// bushes: leafy card clusters with berries, scattered across the forest floor
const bushSpots: { x: number; z: number }[] = [];
{
  // seeded thicket in the spawn corridor (the title dolly frames this)
  for (const [sx, sz] of [[-3.2, 17.5], [-1.2, 13.2], [1.8, 15.6], [-4.0, 11.8]] as [number, number][]) {
    bushSpots.push({ x: sx, z: sz });
  }
  for (let i = 0; i < 120 && bushSpots.length < 46; i++) {
    const z = rnd(-45, 45);
    const x = rnd(-45, 45);
    if (Math.hypot(x, z - 22) < 1.8) continue;
    if (Math.abs(x - BOARD_X) < 1.4) continue;
    let ok = true;
    for (const b of bushSpots) if (Math.hypot(b.x - x, b.z - z) < 2.6) { ok = false; break; }
    if (ok) bushSpots.push({ x, z });
  }
}
const berryGeo = new THREE.SphereGeometry(0.016, 6, 5);
const berryMat = new THREE.MeshStandardMaterial({ color: 0x2e3450, roughness: 0.35 });
for (let bi = 0; bi < bushSpots.length; bi++) {
  const bs = bushSpots[bi];
  const seeded = bi < 4; // the spawn-corridor thicket
  const bush = new THREE.Group();
  const baseY = groundH(bs.x, bs.z);
  // dark foliage core: keeps the leaf cards from reading as floating sprites
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({ color: 0x41603a, roughness: 1, flatShading: true }),
  );
  core.scale.set(1.0, 0.55, 1.0);
  core.position.y = 0.22;
  bush.add(core);
  const cards = (rnd(46, 66)) | 0;
  for (let i = 0; i < cards; i++) {
    const leaf = new THREE.Mesh(leafCardGeo, srnd() < 0.1 ? yellowMat : bushMats[(srnd() * bushMats.length) | 0]);
    const ang = rnd(0, 6.3);
    const rad = rnd(0.3, 0.9);
    leaf.position.set(Math.cos(ang) * rad, rnd(0.06, 0.85), Math.sin(ang) * rad);
    leaf.rotation.set(rnd(-0.9, 0.3), rnd(0, 6.3), rnd(-0.4, 0.6));
    const ls = rnd(1.5, 2.8);
    leaf.scale.set(ls, ls, ls);
    bush.add(leaf);
  }
  // bilberry berries tucked in the foliage
  const bn = (rnd(3, 7)) | 0;
  for (let i = 0; i < bn; i++) {
    const b = new THREE.Mesh(berryGeo, berryMat);
    const ang = rnd(0, 6.3), rad = rnd(0.1, 0.45);
    b.position.set(Math.cos(ang) * rad, rnd(0.08, 0.4), Math.sin(ang) * rad);
    bush.add(b);
  }
  bush.position.set(bs.x, baseY, bs.z);
  world.add(bush);
  // litter around the bush: field mushrooms in the open ground (host-bound
  // species grow strictly at their trees, so the bush floor stays field-only).
  // seeded thicket by the spawn keeps its fuller litter — it's the title shot.
  const count = seeded ? 1 + ((srnd() * 3) | 0) : 1 + ((srnd() * 2) | 0);
  for (let i = 0; i < count; i++) {
    const ang = rnd(0, 6.3), rad = rnd(0.25, 1.1);
    const mx = bs.x + Math.cos(ang) * rad, mz = bs.z + Math.sin(ang) * rad;
    world.add(makeMushroom('champ', mx, groundH(mx, mz), mz));
  }
}

// ---------- habitat-bound mushrooms: every species has its host trees ----------
// field notes can hint where a cap likes to grow; the forest actually follows it
const HOST_W: Record<TreeKind, [Species, number][]> = {
  oak: [['champ', 6]],
  birch: [['fly', 5], ['deadly', 3], ['trump', 2]],
  aspen: [['fly', 5], ['deadly', 3]],
  pine: [['chant', 6], ['trump', 2.5], ['champ', 1]],
  giant: [['chant', 5], ['champ', 2]],
};
function pickHost(kind: TreeKind): Species {
  const w = HOST_W[kind];
  let tot = 0;
  for (const [, n] of w) tot += n;
  let r = srnd() * tot;
  for (const [sp, n] of w) { r -= n; if (r <= 0) return sp; }
  return w[0][0];
}
for (const tr of trees) {
  const roll = srnd();
  const clusters = roll < 0.15 ? 0 : roll < 0.4 ? 2 : 1;
  for (let c = 0; c < clusters; c++) {
    const sp = pickHost(tr.kind);
    const n = 1 + ((srnd() * 1.8) | 0); // 1..2 caps per cluster
    for (let i = 0; i < n; i++) {
      const ang = rnd(0, 6.3), rad = tr.r + rnd(0.25, 0.85); // close enough that the host is the nearest trunk
      const mx = tr.x + Math.cos(ang) * rad, mz = tr.z + Math.sin(ang) * rad;
      world.add(makeMushroom(sp, mx, groundH(mx, mz), mz));
    }
  }
}
// open-ground champignons in the grass, clear of every trunk
// (28, not 40: the field must tempt, never carry — 100g has to be earned)
for (let i = 0; i < 28; i++) {
  const x = rnd(-45, 45), z = rnd(-45, 45);
  let clear = true;
  for (const t of trees) if (Math.hypot(t.x - x, t.z - z) < 2.2) { clear = false; break; }
  if (clear) world.add(makeMushroom('champ', x, groundH(x, z), z));
}
// guarantee a discoverable population of every species (field notes wants them all)
{
  const plantAt = (sp: Species, x: number, z: number) => world.add(makeMushroom(sp, x, groundH(x, z), z));
  const underKind = (kinds: TreeKind[]): [number, number] => {
    const pool = trees.filter((t) => kinds.includes(t.kind));
    const t = pool[(srnd() * pool.length) | 0];
    const ang = rnd(0, 6.3), rad = t.r + rnd(0.25, 0.85);
    return [t.x + Math.cos(ang) * rad, t.z + Math.sin(ang) * rad];
  };
  const ensure = (sp: Species, min: number, kinds: TreeKind[]) => {
    let have = 0;
    for (const g of shrooms) if (g.userData.sp === sp) have++;
    for (let i = have; i < min; i++) {
      if (!kinds.length) plantAt(sp, rnd(-45, 45), rnd(-45, 45));
      else { const [px, pz] = underKind(kinds); plantAt(sp, px, pz); }
    }
  };
  ensure('champ', 10, []);
  ensure('fly', 8, ['birch', 'aspen']);
  ensure('chant', 8, ['pine', 'giant']);
  ensure('trump', 6, ['pine', 'birch']);
  ensure('deadly', 6, ['birch', 'aspen']);
}
// exactly four golden caps, tucked into the shade of the old growth
{
  const giants = trees.filter((t) => t.kind === 'giant');
  let golds = 0;
  for (const g of shrooms) if (g.userData.sp === 'gold') golds++;
  if (golds < 4) {
    for (const g of shrooms) {
      if (golds >= 4) break;
      if (g.userData.sp !== 'champ') continue;
      world.remove(g);
      const idx = pickMeshes.findIndex((m) => m.parent === g);
      if (idx >= 0) pickMeshes.splice(idx, 1);
      const ni = shrooms.indexOf(g);
      if (ni >= 0) shrooms.splice(ni, 1);
      let mx: number, mz: number;
      if (giants.length) {
        const host = giants[(srnd() * giants.length) | 0];
        const ang = rnd(0, 6.3), rad = host.r + rnd(0.3, 0.9);
        mx = host.x + Math.cos(ang) * rad; mz = host.z + Math.sin(ang) * rad;
      } else { mx = rnd(-38, 38); mz = rnd(-38, 38); }
      world.add(makeMushroom('gold', mx, groundH(mx, mz), mz));
      golds++;
    }
  }
}

// pluck juice: cap flights into the fist, drifting spore motes, ground ring,
// a fist that clenches, a HUD weight that ticks, and a half-heartbeat freeze on gold
const moteGeo = new THREE.SphereGeometry(0.014, 5, 4);
const flights: { g: THREE.Group; from: THREE.Vector3; t: number; dur: number }[] = [];
const motes: { m: THREE.Mesh; v: THREE.Vector3; t: number; dur: number }[] = [];
let fistT = 0;
let freezeS = 0;
let shownWeight = 0;
const pickRing = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1, 24),
  new THREE.MeshBasicMaterial({ color: 0xe8f0d8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
);
pickRing.rotation.x = -Math.PI / 2;
scene.add(pickRing);
let ringT = 1;
function spawnMotes(pos: THREE.Vector3, color: number, n = 8): void {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(moteGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.copy(pos);
    m.position.x += rnd(-0.05, 0.05);
    m.position.y += rnd(0.02, 0.1);
    m.position.z += rnd(-0.05, 0.05);
    world.add(m);
    motes.push({
      m, v: new THREE.Vector3(rnd(-0.25, 0.25), rnd(-0.05, 0.18), rnd(-0.25, 0.25)),
      t: 0, dur: rnd(0.4, 0.75),
    });
  }
}

// target ring
const targetRing = new THREE.Mesh(
  new THREE.RingGeometry(0.11, 0.16, 20),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
);
targetRing.rotation.x = -Math.PI / 2;
targetRing.visible = false;
scene.add(targetRing);

// ---------- the arm ----------
// group origin = elbow; +Y runs toward the hand. camo forearm, solid tan cuff, bare hand.
const armGroup = new THREE.Group();
camera.add(armGroup);
scene.add(camera);

const forearm = new THREE.Mesh(
  new THREE.CylinderGeometry(0.055, 0.075, 0.42, 10),
  new THREE.MeshStandardMaterial({ map: camoTex, roughness: 0.9 }),
);
forearm.position.y = 0.21;
const cuff = new THREE.Mesh(
  new THREE.CylinderGeometry(0.072, 0.072, 0.16, 10),
  new THREE.MeshStandardMaterial({ map: cuffTex, roughness: 0.9 }),
);
cuff.position.y = 0.5;
const fist = new THREE.Mesh(
  new THREE.SphereGeometry(0.066, 10, 8),
  new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.8 }),
);
fist.scale.set(1.1, 0.8, 1.2);
fist.position.y = 0.68;
// four fingers: short capsules curving down (a plucking grip) — sized to read at arm's length
const fingerMat = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.8 });
for (let i = 0; i < 4; i++) {
  const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.062, 3, 6), fingerMat);
  f.position.set(-0.045 + i * 0.03, 0.75, -0.055);
  f.rotation.x = 0.85;
  f.rotation.z = (i - 1.5) * 0.14;
  fist.add(f);
}
// thumb
const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.054, 3, 6), fingerMat);
thumb.position.set(-0.072, 0.725, -0.014);
thumb.rotation.z = 1.15;
thumb.rotation.x = 0.5;
fist.add(thumb);
armGroup.add(forearm, cuff, fist);
const ARM_LEN = 0.72;

// elbow near the lower-left frame edge, close to the lens (foreshortened like the reference)
const elbowCam = new THREE.Vector3(-0.46, -0.44, -0.08);
const handRest = new THREE.Vector3(-0.2, -0.22, -0.55);
const handWorld = new THREE.Vector3();
let punchT = 0;
let armPunchTarget: THREE.Vector3 | null = null;

function updateArm(dt: number, t: number): void {
  // target: nearest shroom if any, else rest
  let target: THREE.Vector3 | null = null;
  if (targetShroom) {
    target = new THREE.Vector3(
      targetShroom.position.x,
      targetShroom.position.y + 0.07,
      targetShroom.position.z,
    );
  }
  const bobY = Math.sin(walkPhase * 2) * 0.018 * moveAmount;
  const rest = handRest.clone();
  rest.y += bobY;
  rest.x += Math.cos(t * 0.5) * 0.006;
  const desired = target ? target : rest;
  // convert to camera space, clamp reach so the arm keeps its shape (no staff-like stretch)
  const camSpaceTarget = desired.clone();
  camera.worldToLocal(camSpaceTarget);
  const fromElbow = camSpaceTarget.clone().sub(elbowCam);
  const MAX_REACH = 1.15;
  if (fromElbow.length() > MAX_REACH) fromElbow.setLength(MAX_REACH);
  const clamped = elbowCam.clone().add(fromElbow);
  if (punchT > 0 && armPunchTarget) {
    punchT = Math.max(0, punchT - dt * 3.5);
    const dir = armPunchTarget.clone().sub(elbowCam).normalize();
    clamped.add(dir.multiplyScalar(Math.sin(punchT * Math.PI) * 0.12));
  }
  handWorld.lerp(clamped, 1 - Math.pow(0.0001, dt));
  // place armGroup: elbow fixed in camera space, orient elbow->hand, mild stretch only
  const dir = handWorld.clone().sub(elbowCam);
  const len = Math.max(dir.length(), 0.05);
  armGroup.position.copy(elbowCam);
  const s = THREE.MathUtils.clamp(len / ARM_LEN, 0.7, 1.4);
  armGroup.scale.set(1, s, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  armGroup.quaternion.copy(q);
  // the fist clenches on every pick — a squeeze, not a punch
  if (fistT > 0) {
    fistT = Math.max(0, fistT - dt * 4);
    const sq = Math.sin(fistT * Math.PI);
    fist.scale.set(1.1 * (1 - 0.12 * sq), 0.8 * (1 + 0.18 * sq), 1.2 * (1 - 0.12 * sq));
  } else {
    fist.scale.set(1.1, 0.8, 1.2);
  }
}

// ---------- player ----------
const player = { x: 0, y: 0, z: 22, yaw: Math.PI, pitch: -0.08 };
player.y = groundH(player.x, player.z);
const keys = new Set<string>();
let walkPhase = 0;
let stepAcc = 0;
let moveAmount = 0;
let targetShroom: THREE.Group | null = null;

const raycaster = new THREE.Raycaster();
raycaster.far = 2.7;

// test/debug helper: apply the player pose to the camera immediately and recompute
// the aim target in the same tick, so a test that aims then reads state() never
// races the next requestAnimationFrame.
function syncCameraAndTarget(): void {
  camera.position.set(player.x, player.y + 1.5, player.z);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(player.yaw);
  camera.rotateX(player.pitch);
  camera.updateMatrixWorld(); // setFromCamera reads matrixWorld — must not be one frame stale
  updateTarget();
}

function updateTarget(): void {
  if (G.mode !== 'play') { targetShroom = null; targetRing.visible = false; G.targetName = ''; return; }
  // two rays: crosshair, plus a lower one so "looking at the ground beside it" still counts
  let best: THREE.Group | null = null;
  for (const ndc of [new THREE.Vector2(0, 0), new THREE.Vector2(0, -0.075)]) {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickMeshes, false);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !shrooms.includes(o as THREE.Group)) o = o.parent;
      if (o) { best = o as THREE.Group; break; }
    }
    if (best) break;
  }
  targetShroom = best;
  G.targetName = best ? (SPECIES[best.userData.sp as Species].name) : '';
  hudTarget.textContent = G.targetName;
  hudTarget.classList.toggle('show', !!best);
  if (best) {
    targetRing.visible = true;
    targetRing.position.set(best.position.x, best.position.y + 0.015, best.position.z);
  } else targetRing.visible = false;
}

// ---------- field notes + persistence ----------
interface SaveData { bestWeight: number; seen: Record<Species, boolean>; deadlyMistakes: number; bestPerSeed: Record<string, number>; }
const SAVE_KEY = 'caphunt_save_v1';
function loadSave(): SaveData {
  const empty: SaveData = { bestWeight: 0, seen: { champ: false, fly: false, chant: false, trump: false, deadly: false, gold: false }, deadlyMistakes: 0, bestPerSeed: {} };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Partial<SaveData>;
    return {
      bestWeight: typeof p.bestWeight === 'number' ? p.bestWeight : 0,
      seen: { ...empty.seen, ...(p.seen ?? {}) },
      deadlyMistakes: typeof p.deadlyMistakes === 'number' ? p.deadlyMistakes : 0,
      bestPerSeed: (p.bestPerSeed ?? {}) as Record<string, number>,
    };
  } catch { return empty; }
}
let saved = loadSave();
function saveSave(): void {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch { /* private mode */ }
}

// ---------- picking ----------
const floatsEl = document.getElementById('floats')!;
function floatText(txt: string, cls: string): void {
  const d = document.createElement('div');
  d.className = 'float ' + cls;
  d.textContent = txt;
  floatsEl.appendChild(d);
  setTimeout(() => d.remove(), 1100);
}
// what the field notes say when a species first joins them — the discovery
// is not the mushroom, it's the forest quietly making room for you to know it
const NOTE_LINES: Record<Species, string> = {
  champ: 'Champignon. Honest. It grows where it wants and it wants everywhere.',
  fly: 'Fly Agaric. Red and rude. The birches keep it for some reason.',
  chant: 'Chanterelle. The forest says it likes pines. The forest is rarely wrong.',
  trump: 'Black Trumpet. Worth the dig. It pays you back in deep, quiet notes.',
  deadly: 'Deadly White. Your field notes are learning. So is this one.',
  gold: 'The Golden Cap. You were supposed to find it by walking, not by luck.',
};
function doPickAction(): void {
  if (G.mode !== 'play' || !targetShroom) return;
  punchT = 1;
  armPunchTarget = targetShroom.position;
  fistT = 1;
  const g = targetShroom;
  targetShroom = null;
  const sp = g.userData.sp as Species;
  const def = SPECIES[sp];
  // the cap flies into the fist (no pop-in-vanish)
  world.remove(g);
  const idx = pickMeshes.findIndex((m) => m.parent === g);
  if (idx >= 0) pickMeshes.splice(idx, 1);
  const si = shrooms.indexOf(g);
  if (si >= 0) shrooms.splice(si, 1);
  flights.push({ g, from: g.position.clone(), t: 0, dur: 0.22 });
  // ground ring + spore motes where the cap was
  ringT = 0;
  pickRing.position.set(g.position.x, g.position.y + 0.02, g.position.z);
  const moteCol = def.gold ? 0xffd23f : def.bad ? 0xd8d2c0 : 0xc9d8a8;
  spawnMotes(g.position, moteCol, def.gold ? 12 : 7);
  SFX.thud();
  if (def.gold) freezeS = 0.06; // half a heartbeat
  G.picks++;
  G.basket[def.name] = (G.basket[def.name] ?? 0) + 1;
  G.weight = Math.max(0, G.weight + def.val);
  if (def.gold) G.goldenFound++;
  if (def.bad) {
    G.badPicks++;
    // the forest remembers your mistakes — three and the codex learns to warn you
    if (sp === 'deadly' && saved.deadlyMistakes < 3) {
      saved.deadlyMistakes++;
      saveSave();
      if (saved.deadlyMistakes >= 3) renderCodex();
    }
  }
  SFX.pickSfx(def.gold ? 'gold' : def.bad ? 'bad' : 'good');
  if (def.gold) { SFX.chime(3); floatText('✦ THE GOLDEN CAP  +25g', 'gold'); }
  else if (def.bad) floatText(`${def.name}  +${def.val}g (it's a bit slimy…)`, 'bad');
  else floatText(`${def.name}  +${def.val}g`, 'good');
  if (!saved.seen[sp]) {
    saved.seen[sp] = true;
    saveSave();
    SFX.duckAmbient(1500);
    floatText(`◆ ${def.name} added to your field notes`, 'gold');
    floatText(NOTE_LINES[sp], 'note');
    if (def.gold) SFX.chime(5); else SFX.chime(2);
  }
  updateHud();
  if (G.weight >= G.goal) endGame();
}

// ---------- HUD / screens ----------
const hudWeight = document.getElementById('weight')!;
const hudTime = document.getElementById('time')!;
const hudPicks = document.getElementById('picks')!;
const hudTarget = document.getElementById('hudTarget')!;
const titleEl = document.getElementById('titleScreen')!;
const pauseEl = document.getElementById('pauseScreen')!;
const endEl = document.getElementById('endScreen')!;

function updateHud(): void {
  // weight ticks up on its own in the render loop; only reset it here
  hudPicks.textContent = `${G.picks} caps`;
}
setInterval(() => {
  hudTime.textContent = formatTime(G.timeLeft);
}, 250);
function formatTime(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60);
  const ss = Math.floor(Math.max(0, s) % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}

function endGame(): void {
  if (G.mode === 'end') return;
  G.mode = 'end';
  SFX.gong();
  SFX.endRise(Object.keys(G.basket).length); // the screen reads the basket, note by note
  document.body.classList.add('menu');
  if (document.pointerLockElement) document.exitPointerLock();
  const timeUsed = 150 - Math.max(0, G.timeLeft);
  const newBest = G.weight > saved.bestWeight;
  if (newBest) { saved.bestWeight = G.weight; saveSave(); }
  // the forest is yours: these woods keep their own record of your best basket here
  const forestBest = saved.bestPerSeed[String(forestSeed)] ?? 0;
  const newForestBest = G.weight > forestBest;
  if (newForestBest) { saved.bestPerSeed[String(forestSeed)] = G.weight; saveSave(); }
  let rating: string;
  let sub: string;
  if (G.weight >= G.goal && G.badPicks === 0) { rating = 'FORAGER OF GODS'; sub = 'a full basket, not one slimy surprise. the forest bows.'; }
  else if (G.weight >= G.goal) { rating = 'BASKET FULL'; sub = G.badPicks === 1 ? 'full — but one dead white got through. good luck out there.' : `full — ${G.badPicks} deadlies in the basket. they're in there.`; }
  else if (G.weight >= 60) { rating = 'A GOOD HAUL'; sub = 'the market will be pleased. barely.'; }
  else { rating = 'THE FOREST STAYED HUNGRY'; sub = 'the basket is lighter than your ambition.'; }
  const rows = Object.entries(G.basket)
    .map(([n, c]) => `<div class="erow"><span>${n}</span><b>×${c}</b></div>`)
    .join('');
  document.getElementById('endRating')!.textContent = rating;
  document.getElementById('endSub')!.textContent = sub;
  document.getElementById('endWeight')!.textContent = `${G.weight}g`;
  document.getElementById('endStats')!.innerHTML = `
    <div class="endStat"><div class="v">${Math.floor(timeUsed)}s</div><div class="l">time in the woods</div></div>
    <div class="endStat"><div class="v">${G.picks}</div><div class="l">caps picked</div></div>
    <div class="endStat"><div class="v">${G.badPicks}</div><div class="l">deadlies</div></div>
    <div class="endStat"><div class="v">${G.goldenFound}/4</div><div class="l">golden caps</div></div>
    <div class="endStat"><div class="v">${saved.bestWeight}g</div><div class="l">${newBest ? '★ new best basket' : 'best basket'}</div></div>` +
    (rows ? `<div class="endStat basketRows">${rows}</div>` : '');
  // ghost bar: where your best-in-these-woods stands, vs this run
  const top = Math.max(G.goal, forestBest, G.weight, 1) * 1.06;
  const ghost = document.getElementById('endGhost')!;
  ghost.innerHTML = `<div class="gtrack"><div class="gfill"></div>` +
    (forestBest > 0 ? `<div class="gghost" style="left:${(forestBest / top) * 100}%"></div>` : '') + `</div>
    <div class="glabel">${newForestBest ? '★ best basket in these woods' : forestBest > 0 ? `best in these woods  ${forestBest}g` : 'your first basket in these woods'}</div>`;
  requestAnimationFrame(() => {
    const f = ghost.querySelector('.gfill') as HTMLElement;
    requestAnimationFrame(() => { f.style.width = `${(G.weight / top) * 100}%`; });
  });
  endEl.style.display = 'flex';
  updateHud();
}

// ---------- title: field notes + best ----------
function renderCodex(): void {
  const el = document.getElementById('codex');
  if (!el) return;
  el.innerHTML = (Object.keys(SPECIES) as Species[]).map((sp) => {
    const def = SPECIES[sp];
    if (saved.seen[sp]) {
      const cls = sp === 'gold' ? 'citem goldSeen' : 'citem';
      // after three lifetime deadlies, the notes stop just listing it and start warning
      const warn = (sp === 'deadly' && saved.deadlyMistakes >= 3)
        ? '<em class="cwarn">…the white ones bite back. check the ring on the stem.</em>' : '';
      return `<div class="${cls}"><span>${sp === 'gold' ? '✦ ' : ''}${def.name}<b>+${def.val}g</b></span><i>${def.host}</i>${warn}</div>`;
    }
    return `<div class="citem undis"><span>???</span><i>${def.host}</i></div>`;
  }).join('');
  const bestEl = document.getElementById('titleBest');
  if (bestEl) bestEl.textContent = saved.bestWeight > 0 ? `BEST BASKET  ${saved.bestWeight}g` : '';
}
renderCodex();

function startGame(): void {
  if (G.started) return;
  G.started = true;
  G.mode = 'play';
  titleEl.style.display = 'none';
  document.body.classList.remove('menu');
  SFX.gong();
  SFX.startAmbient();
  hudTime.textContent = formatTime(G.timeLeft);
  updateHud();
}

// ---------- input ----------
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (IS_TOUCH) document.body.classList.add('touch');
let started = false;
let joyX = 0, joyY = 0;
document.addEventListener('mousedown', () => {
  if (IS_TOUCH) return; // touch: the pointer logic below handles picking
  if (G.mode === 'play') doPickAction();
});
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyM') { SFX.setMuted(!SFX.isMuted()); }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('mousemove', (e) => {
  if (G.mode !== 'play' || !document.pointerLockElement) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement && G.mode === 'pause') {
    G.mode = 'play';
    pauseEl.style.display = 'none';
  } else if (!IS_TOUCH && !document.pointerLockElement && G.mode === 'play' && G.started) {
    G.mode = 'pause';
    pauseEl.style.display = 'flex';
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.getElementById('startBtn')!.addEventListener('click', () => {
  started = true;
  startGame(); // first — on iOS requestPointerLock can throw, which used to swallow the start
  if (!IS_TOUCH) { try { renderer.domElement.requestPointerLock(); } catch { /* fine */ } }
  if (IS_TOUCH) document.getElementById('hint')!.textContent = 'drag left half to walk · drag right half to look · tap to pick';
});
// "new woods": re-roll the forest seed (field notes + best basket are yours to keep)
document.getElementById('newWoodsBtn')!.addEventListener('click', () => newWoods());
pauseEl.addEventListener('click', () => {
  if (G.mode !== 'pause') return;
  G.mode = 'play';
  pauseEl.style.display = 'none';
  if (!IS_TOUCH) { try { renderer.domElement.requestPointerLock(); } catch { /* fine */ } }
});
document.getElementById('againBtn')!.addEventListener('click', () => location.reload());
document.getElementById('pauseBtn')!.addEventListener('click', () => {
  if (G.mode !== 'play') return;
  G.mode = 'pause';
  pauseEl.style.display = 'flex';
});

// ---------- touch controls (coarse pointers) ----------
const joyEl = document.getElementById('joy')!;
const joyKnob = document.getElementById('joyKnob')!;
let joyId: number | null = null;
let joyOrigin = { x: 0, y: 0 };
let lookId: number | null = null;
let lookLast = { x: 0, y: 0 };
let lookMoved = 0;
let lookDownAt = 0;
const JOY_R = 48;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (G.mode !== 'play' || !IS_TOUCH) return;
  e.preventDefault();
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* synthetic ids (tests) */ }
  if (e.clientX < window.innerWidth * 0.45 && joyId === null) {
    joyId = e.pointerId;
    joyOrigin = { x: e.clientX, y: e.clientY };
    joyEl.style.left = (e.clientX - 60) + 'px';
    joyEl.style.top = (e.clientY - 60) + 'px';
    joyEl.style.display = 'block';
  } else if (lookId === null) {
    lookId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    lookMoved = 0;
    lookDownAt = performance.now();
  }
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (G.mode !== 'play') return;
  if (e.pointerId === joyId) {
    let dx = e.clientX - joyOrigin.x, dy = e.clientY - joyOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
    joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
    joyX = dx / JOY_R;
    joyY = dy / JOY_R;
  } else if (e.pointerId === lookId) {
    const dx = e.clientX - lookLast.x, dy = e.clientY - lookLast.y;
    lookMoved += Math.abs(dx) + Math.abs(dy);
    lookLast = { x: e.clientX, y: e.clientY };
    const S = 0.0045;
    player.yaw -= dx * S;
    player.pitch -= dy * S;
    player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
  }
});
const endTouch = (e: PointerEvent) => {
  if (e.pointerId === joyId) {
    joyId = null;
    joyX = 0; joyY = 0;
    joyEl.style.display = 'none';
    joyKnob.style.transform = 'translate(0,0)';
  } else if (e.pointerId === lookId) {
    lookId = null;
    if (lookMoved < 14 && performance.now() - lookDownAt < 300 && G.mode === 'play') doPickAction();
  }
};
renderer.domElement.addEventListener('pointerup', endTouch);
renderer.domElement.addEventListener('pointercancel', endTouch);

// ---------- movement ----------
const WALK = 3.1, RUN = 5.0;
function updateMove(dt: number): void {
  const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const dir = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) dir.add(fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) dir.sub(fwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) dir.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) dir.sub(right);
  if (joyX !== 0 || joyY !== 0) { dir.addScaledVector(fwd, -joyY); dir.addScaledVector(right, joyX); }
  const moving = dir.lengthSq() > 0;
  moveAmount = THREE.MathUtils.damp(moveAmount, moving ? 1 : 0, 8, dt);
  if (moving) {
    dir.normalize();
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK;
    let nx = player.x + dir.x * speed * dt;
    let nz = player.z + dir.z * speed * dt;
    // collision: push out of circles
    for (const o of obstacles) {
      const dx = nx - o.x, dz = nz - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + 0.26;
      if (d < min && d > 0.0001) {
        nx = o.x + (dx / d) * min;
        nz = o.z + (dz / d) * min;
      }
    }
    nx = Math.max(-46, Math.min(46, nx));
    nz = Math.max(-46, Math.min(46, nz));
    // footsteps
    stepAcc += speed * dt;
    const stride = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 0.62 : 0.46;
    if (stepAcc > stride) {
      stepAcc = 0;
      const onB = onBoard(nx, nz);
      SFX.footstep(onB ? 0.5 : 1);
      if (onB && Math.random() < 0.12) SFX.creak();
    }
    walkPhase += (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 11 : 8) * dt;
    player.x = nx;
    player.z = nz;
  }
  const gy = groundH(player.x, player.z) + (onBoard(player.x, player.z) ? boardTop : 0);
  player.y = THREE.MathUtils.damp(player.y, gy, 10, dt);
}

// ---------- main loop ----------
document.body.classList.add('menu');
const clock = new THREE.Clock();
let tAcc = 0;
let bellTimer = 2.8; // the golden cap's bell, first ring
function animate(): void {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const dt = freezeS > 0 ? rawDt * 0.18 : rawDt; // golden-cap freeze: half a heartbeat
  if (freezeS > 0) freezeS -= rawDt;

  // pluck feedback: flights into the fist, drifting motes, ground ring, weight tick
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    f.t += rawDt / f.dur;
    if (f.t >= 1) {
      world.remove(f.g);
      flights.splice(i, 1);
      continue;
    }
    f.g.position.lerpVectors(f.from, handWorld, f.t);
    f.g.scale.setScalar(Math.max(0.15, 1 - f.t * 0.5));
  }
  for (let i = motes.length - 1; i >= 0; i--) {
    const mo = motes[i];
    mo.t += rawDt;
    mo.m.position.addScaledVector(mo.v, rawDt);
    mo.v.multiplyScalar(0.94);
    const k = mo.t / mo.dur;
    if (k >= 1) {
      world.remove(mo.m);
      (mo.m.material as THREE.Material).dispose();
      motes.splice(i, 1);
    } else {
      (mo.m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      mo.m.scale.setScalar(1 - k * 0.5);
    }
  }
  if (ringT < 1) {
    ringT = Math.min(1, ringT + rawDt * 2.6);
    const rk = ringT;
    pickRing.scale.setScalar(0.3 + rk * 1.1);
    (pickRing.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - rk);
  }
  if (shownWeight !== G.weight) {
    shownWeight = THREE.MathUtils.damp(shownWeight, G.weight, 10, rawDt);
    if (Math.abs(shownWeight - G.weight) < 0.6) shownWeight = G.weight;
    hudWeight.textContent = `${Math.round(shownWeight)}g`;
  }

  if (G.mode === 'title') {
    // slow cinematic dolly toward the thicket, arm reaching
    const a = t * 0.05;
    camera.position.set(Math.sin(a) * 0.8 - 1.2, groundH(0, 21) + 1.35 + Math.sin(t * 0.2) * 0.05, 21 + Math.cos(a) * 0.8);
    camera.lookAt(-1.4, groundH(-1.4, 20) + 0.35, 20);
    // hand the camera's pose back to the player so play starts facing the thicket
    {
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      player.yaw = e.y;
      player.pitch = e.x;
    }
  } else if (G.mode === 'play') {
    updateMove(dt);
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) { G.timeLeft = 0; endGame(); }
    applyLight(1 - G.timeLeft / 150);
    // the golden pilgrimage: the surviving caps breathe, and a faint bell rings
    // from their bearing — you can't hear where it's from until you're close,
    // but the pan tells you which way to walk
    for (const gc of goldCaps) {
      const gl = gc.userData.light as THREE.PointLight | undefined;
      if (gl) gl.intensity = 0.5 + 0.28 * (0.5 + 0.5 * Math.sin(t * 2.1 + (gc.userData.phase as number)));
    }
    if (goldCaps.length) {
      let best: THREE.Group | null = null;
      let bd = 1e9;
      for (const gc of goldCaps) {
        const d = Math.hypot(gc.position.x - player.x, gc.position.z - player.z);
        if (d < bd) { bd = d; best = gc; }
      }
      if (best) {
        const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
        const dx = best.position.x - player.x, dz = best.position.z - player.z;
        const len = Math.max(0.001, Math.hypot(dx, dz));
        const cross = fx * (dz / len) - fz * (dx / len);
        const dot = fx * (dx / len) + fz * (dz / len);
        const rel = Math.atan2(cross, dot);
        bellTimer -= dt;
        if (bellTimer <= 0) {
          SFX.goldBell(THREE.MathUtils.clamp(rel * 1.15, -1, 1), THREE.MathUtils.clamp(1 - bd / 30, 0.06, 1));
          bellTimer = 2.4 + Math.random() * 1.6;
        }
      }
    }
    // head bob
    const bobY = Math.sin(walkPhase * 2) * 0.024 * moveAmount;
    const bobX = Math.cos(walkPhase) * 0.014 * moveAmount;
    camera.position.set(player.x + bobX * Math.cos(player.yaw), player.y + 1.5 + bobY, player.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(player.yaw + Math.sin(walkPhase) * 0.004 * moveAmount);
    camera.rotateX(player.pitch);
  } else if (G.mode === 'pause' || G.mode === 'end') {
    camera.position.set(player.x, player.y + 1.5, player.z);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(player.yaw);
    camera.rotateX(player.pitch * 0.5 - 0.1);
  }

  updateTarget();
  updateArm(dt, t);

  // shroom idle sway + gold pulse
  for (const g of shrooms) {
    if (g.userData.sp === 'gold') {
      const s = 1 + Math.sin(t * 2.6 + g.userData.phase) * 0.06;
      g.scale.setScalar(s);
      const l = g.userData.light as THREE.PointLight | undefined;
      if (l) l.intensity = 0.6 + Math.sin(t * 2.6 + g.userData.phase) * 0.25;
    }
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

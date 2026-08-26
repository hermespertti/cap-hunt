import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', protocolTimeout: 360000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=vulkan', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:5190/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2500));
const pickNearest = async () => {
  return await page.evaluate(() => {
    const st = window.__cap.state();
    if (st.mode !== 'play') return null;
    const info = window.__cap.info();
    const all = [];
    for (const [sp, arr] of Object.entries(info.shrooms.bySp)) for (const p of arr) all.push({ ...p, sp });
    let best = null, bd = 1e9;
    for (const c of all) { const d = Math.hypot(c.x - st.x, c.z - st.z); if (d < bd) { bd = d; best = c; } }
    if (!best) return null;
    window.__cap.teleport(best.x, best.z + 1.3);
    window.__cap.aimAt(best.x, best.z);
    return best;
  });
};
const pick = async () => {
  const before = await page.evaluate(() => window.__cap.state());
  await new Promise(r => setTimeout(r, 80));
  await page.evaluate(() => window.__cap.click());
  await new Promise(r => setTimeout(r, 350));
  return { before, after: await page.evaluate(() => window.__cap.state()) };
};
let results = {};

// 1. first discovery: pick until a new species joins the codex, capture the note line
await page.evaluate(() => window.__cap.clearSave());
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 800));
let noteSeen = null;
for (let i = 0; i < 14 && !noteSeen; i++) {
  const spot = await pickNearest();
  if (!spot) break;
  const r = await pick();
  if (r.before.seenCount !== undefined) {}
  const note = await page.evaluate(() => {
    const el = document.querySelector('.float.note');
    return el ? el.textContent : null;
  });
  if (note) noteSeen = { species: spot.sp, note };
}
results.firstNote = noteSeen;

// 2. deadly learning: force 3 deadly picks, then check the codex warning
await page.evaluate(() => window.__cap.clearSave());
for (let i = 0; i < 3; i++) {
  const spot = await page.evaluate(() => {
    const st = window.__cap.state();
    const info = window.__cap.info();
    const all = [];
    for (const [sp, arr] of Object.entries(info.shrooms.bySp)) for (const p of arr) all.push({ ...p, sp });
    const d = all.find(c => c.sp === 'deadly');
    if (d) { window.__cap.teleport(d.x, d.z + 1.3); window.__cap.aimAt(d.x, d.z); return d; }
    return null;
  });
  if (!spot) break;
  await new Promise(r => setTimeout(r, 80));
  await page.evaluate(() => window.__cap.click());
  await new Promise(r => setTimeout(r, 300));
}
results.deadlyWarn = await page.evaluate(() => {
  const w = document.querySelector('.cwarn');
  return { mistakeCount: window.__cap.save().deadlyMistakes, warnText: w ? w.textContent : null };
});

// 3. gold caps tracked for the pilgrimage
results.goldCaps = await page.evaluate(() => {
  const info = window.__cap.info();
  return (info.shrooms.bySp.gold || []).length;
});

// 4. end screen: run to the end (skip time), check ghost bar + rise
await page.evaluate(() => window.__cap.skipTime(150));
await new Promise(r => setTimeout(r, 900));
results.endScreen = await page.evaluate(() => ({
  mode: window.__cap.state().mode,
  ghost: document.getElementById('endGhost') ? document.getElementById('endGhost').textContent : null,
  rating: document.getElementById('endRating') ? document.getElementById('endRating').textContent : null,
}));

console.log(JSON.stringify(results, null, 1));
await browser.close();

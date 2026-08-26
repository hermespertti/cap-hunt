import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', protocolTimeout: 360000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=vulkan', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:5190/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2500));
const deadlyCount = await page.evaluate(() => {
  const info = window.__cap.info();
  return (info.shrooms.bySp.deadly || []).length;
});
console.log('deadly caps in this forest:', deadlyCount);
// prime the save at 2 lifetime mistakes, then pick a deadly -> must hit 3 and warn
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('caphunt_save_v1') || '{}');
  raw.deadlyMistakes = 2;
  raw.seen = { champ: false, fly: false, chant: false, trump: false, deadly: true, gold: false };
  localStorage.setItem('caphunt_save_v1', JSON.stringify(raw));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2500));
// pick one deadly
const spot = await page.evaluate(() => {
  const st = window.__cap.state();
  if (st.mode !== 'play') window.__cap.state();
  const info = window.__cap.info();
  const all = [];
  for (const [sp, arr] of Object.entries(info.shrooms.bySp)) for (const p of arr) all.push({ ...p, sp });
  const d = all.find(c => c.sp === 'deadly');
  if (d) { window.__cap.teleport(d.x, d.z + 1.3); window.__cap.aimAt(d.x, d.z); return d; }
  return null;
});
if (!spot) { console.log('no deadly to pick'); process.exit(0); }
await page.evaluate(() => {
  const el = document.getElementById('startBtn');
  if (el) el.click();
});
await new Promise(r => setTimeout(r, 600));
// re-aim after start (start resets nothing but mode changed)
await page.evaluate(() => {
  const d = (() => { const info = window.__cap.info(); const all = []; for (const [sp, arr] of Object.entries(info.shrooms.bySp)) for (const p of arr) all.push({ ...p, sp }); return all.find(c => c.sp === 'deadly'); })();
  if (d) { window.__cap.teleport(d.x, d.z + 1.3); window.__cap.aimAt(d.x, d.z); }
});
await new Promise(r => setTimeout(r, 200));
await page.evaluate(() => window.__cap.click());
await new Promise(r => setTimeout(r, 400));
const result = await page.evaluate(() => ({
  mistakes: window.__cap.save().deadlyMistakes,
  warn: document.querySelector('.cwarn') ? document.querySelector('.cwarn').textContent : null,
}));
console.log('after 3rd lifetime deadly:', JSON.stringify(result));
await browser.close();

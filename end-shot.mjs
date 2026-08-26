import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', protocolTimeout: 360000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=vulkan', '--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.goto('http://localhost:5190/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => window.__cap.clearSave());
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 700));
const pick = async () => {
  const spot = await page.evaluate(() => {
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
  if (!spot) return null;
  await new Promise(r => setTimeout(r, 60));
  await page.evaluate(() => window.__cap.click());
  await new Promise(r => setTimeout(r, 260));
  return spot;
};
// forage a varied basket
let got = {};
for (let i = 0; i < 26; i++) {
  const s = await pick();
  if (!s) break;
  got[s.sp] = (got[s.sp] ?? 0) + 1;
  if (Object.keys(got).length >= 4 && i > 8) break;
}
// run the light out
await page.evaluate(() => window.__cap.skipTime(150));
await new Promise(r => setTimeout(r, 1100));
await page.screenshot({ path: 'shot-v04-end.png' });
console.log('picked', JSON.stringify(got), 'mode', await page.evaluate(() => window.__cap.state().mode));
console.log('ghost label:', await page.evaluate(() => document.getElementById('endGhost')?.querySelector('.glabel')?.textContent));
await browser.close();

// cap-hunt production smoke test — headless Chromium vs the deployed site
import puppeteer from 'puppeteer-core';

const URL = 'https://hermespertti.github.io/cap-hunt/';
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/chromium',
  protocolTimeout: 360000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=vulkan', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 4000));

// 1. boot: hooks + title
let s = await page.evaluate(() => window.__cap && window.__cap.state());
ok('hooks present', !!s);
ok('title mode at boot', s && s.mode === 'title', String(s && s.mode));
ok('title screen visible', await page.$('#titleScreen') !== null);
ok('HUD hidden on title', await page.evaluate(() => document.body.classList.contains('menu')));

// 2. start via button
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 1000));
s = await page.evaluate(() => window.__cap.state());
ok('start -> play', s.mode === 'play', String(s.mode));
ok('timer at 150', s.timeLeft === 150, String(s.timeLeft));

// 3. movement
const p0 = await page.evaluate(() => { const st = window.__cap.state(); return [st.x, st.z]; });
await page.evaluate(() => { window.__cap.keys('KeyW', true); });
await new Promise(r => setTimeout(r, 1200));
await page.evaluate(() => { window.__cap.keys('KeyW', false); });
const p1 = await page.evaluate(() => { const st = window.__cap.state(); return [st.x, st.z]; });
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
ok('W moves the player', moved > 0.5, `moved=${moved.toFixed(2)}`);

// 4. aim + pick
let spot = null;
for (let i = 0; i < 8 && !spot; i++) {
  spot = await page.evaluate(() => {
    const n = window.__cap.nearestShroom();
    if (n && n.d < 2.3) { window.__cap.aimAt(n.x, n.z); return n; }
    window.__cap.keys('KeyW', true); return null;
  });
  if (!spot) {
    await new Promise(r => setTimeout(r, 150));
    await page.evaluate(() => { window.__cap.keys('KeyW', false); });
    await page.evaluate(() => { window.__cap.keys('KeyD', true); });
    await new Promise(r => setTimeout(r, 150));
    await page.evaluate(() => { window.__cap.keys('KeyD', false); });
  }
}
await new Promise(r => setTimeout(r, 200));
const tgt = await page.evaluate(() => window.__cap.state().target);
ok('raycast finds a shroom', !!spot && !!tgt, `dist=${spot ? spot.d.toFixed(2) : 'n/a'} target=${tgt}`);
if (spot && tgt) {
  const before = await page.evaluate(() => window.__cap.state());
  await page.evaluate(() => window.__cap.click());
  await new Promise(r => setTimeout(r, 400));
  const after = await page.evaluate(() => window.__cap.state());
  ok('click picks', after.picks === before.picks + 1, `picks ${before.picks} -> ${after.picks}`);
  ok('weight increased', after.weight > before.weight, `${before.weight} -> ${after.weight}`);
  ok('basket recorded', after.basket[tgt] === 1);
}

// 5. mute
await page.evaluate(() => window.__cap.mute());
ok('mute toggles', await page.evaluate(() => window.__cap.muted()) === true);

// 6. v0.3 personal forest: the woods are persistent and re-rollable
const snapWoods = () => page.evaluate(() =>
  window.__cap.info().shrooms.map(s => `${s.x.toFixed(2)},${s.z.toFixed(2)},${s.t}`).sort().join('|'));
const seedAt = () => page.evaluate(() => window.__cap.info().seed);
ok('new woods button on title', (await page.$('#newWoodsBtn')) !== null);
ok('seed hook present', Number.isInteger(await seedAt()));
const woods1 = await snapWoods();
const seed1 = await seedAt();
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));
ok('reload keeps the same woods', (await snapWoods()) === woods1);
ok('reload keeps the same seed', (await seedAt()) === seed1);
const bestBefore = await page.evaluate(() => window.__cap.state().bestWeight);
await page.evaluate(() => window.__cap.newWoods());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));
ok('new woods re-rolls the forest', (await snapWoods()) !== woods1);
ok('new woods keeps the codex', (await page.evaluate(() => window.__cap.state().bestWeight)) === bestBefore);

const pageErrs = errors.filter(e => !/favicon/i.test(e));
ok('no page errors', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '));

console.log(`\n${pass} PASS, ${fail} FAIL`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);

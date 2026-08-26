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
ok('timer running from 150', s.timeLeft > 140 && s.timeLeft <= 150, String(s.timeLeft));

// 3. movement
const p0 = await page.evaluate(() => { const st = window.__cap.state(); return [st.x, st.z]; });
await page.evaluate(() => { window.__cap.keys('KeyW', true); });
await new Promise(r => setTimeout(r, 1200));
await page.evaluate(() => { window.__cap.keys('KeyW', false); });
const p1 = await page.evaluate(() => { const st = window.__cap.state(); return [st.x, st.z]; });
const moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
ok('W moves the player', moved > 0.5, `moved=${moved.toFixed(2)}`);

// 4. aim + pick — teleport to a known cap so the raycast is deterministic
const capSpot = await page.evaluate(() => {
  const info = window.__cap.info();
  const all = [];
  for (const [sp, arr] of Object.entries(info.shrooms.bySp)) for (const p of arr) all.push({ ...p, sp });
  if (!all.length) return null;
  // closest cap to the player, within 2u
  const st = window.__cap.state();
  let best = null, bd = 1e9;
  for (const c of all) { const d = Math.hypot(c.x - st.x, c.z - st.z); if (d < bd) { bd = d; best = c; } }
  if (!best) return null;
  // stand ~1.3u from the cap so the pick ray reaches it
  window.__cap.teleport(best.x, best.z + 1.3);
  window.__cap.aimAt(best.x, best.z);
  return best;
});
await new Promise(r => setTimeout(r, 300));
const tgt = await page.evaluate(() => window.__cap.state().target);
ok('raycast finds a shroom', !!capSpot && !!tgt, `spot=${capSpot ? capSpot.sp : 'none'} target=${tgt}`);
if (capSpot && tgt) {
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
const snapWoods = () => page.evaluate(() => {
  const info = window.__cap.info();
  const all = [];
  for (const [sp, arr] of Object.entries(info.shrooms.bySp)) for (const p of arr) all.push(`${sp}:${p.x.toFixed(2)},${p.z.toFixed(2)}`);
  const trees = (window.__cap.info().treeList || []).map(t => `${t.kind}:${t.x.toFixed(2)},${t.z.toFixed(2)}`);
  return all.sort().join('|') + '#' + trees.sort().join('|');
});
const seedAt = () => page.evaluate(() => window.__cap.seed());
ok('new woods button on title', (await page.$('#newWoodsBtn')) !== null);
const seedNow = await seedAt();
ok('seed hook present', Number.isInteger(seedNow));
// two consecutive reloads of an UNPICKED forest must be byte-identical
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));
const woodsA = await snapWoods();
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));
const woodsB = await snapWoods();
ok('reload keeps the same woods', woodsB === woodsA);
ok('reload keeps the same seed', (await seedAt()) === seedNow);
const bestBefore = await page.evaluate(() => window.__cap.state().bestWeight);
await page.evaluate(() => window.__cap.newWoods());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));
ok('new woods re-rolls the forest', (await snapWoods()) !== woodsA);
ok('new woods keeps the codex', (await page.evaluate(() => window.__cap.state().bestWeight)) === bestBefore);

// 7. v0.4 rituals: first-pick discovery note + end-screen ghost bar
await page.evaluate(() => window.__cap.clearSave());
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 700));
const dSpot = await page.evaluate(() => {
  const st = window.__cap.state();
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
if (dSpot) {
  await new Promise(r => setTimeout(r, 60));
  await page.evaluate(() => window.__cap.click());
  await new Promise(r => setTimeout(r, 250));
  ok('first pick raises a discovery note', (await page.$('.float.note')) !== null);
}
await page.evaluate(() => window.__cap.skipTime(150));
await new Promise(r => setTimeout(r, 900));
ok('end screen shows the per-woods ghost bar', (await page.$('#endGhost .glabel')) !== null);

// 8. v0.5 the forest remembers: picks leave stubs that survive reload and
//    regrow on the real-time clock
await page.evaluate(() => window.__cap.clearSave());
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 700));
const mSpot = await page.evaluate(() => {
  const st = window.__cap.state();
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
if (mSpot) {
  await new Promise(r => setTimeout(r, 60));
  await page.evaluate(() => window.__cap.click());
  await new Promise(r => setTimeout(r, 400));
  const led = await page.evaluate(() => window.__cap.save());
  ok('pick leaves a stub + ledger entry', (await page.evaluate(() => window.__cap.info().stubs)) === 1 && Object.keys(led.harvested).length === 1);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  ok('stub survives reload (forest memory)', (await page.evaluate(() => window.__cap.info().stubs)) === 1);
  ok('title shows the forest memory line', /CUT \d+ CAP/.test(await page.evaluate(() => document.getElementById('titleMemory').textContent)));
  await page.evaluate((sp) => {
    const win = { champ: 15, fly: 20, deadly: 20, chant: 30, trump: 30, gold: 120 }[sp] * 60e3;
    window.__cap.shiftTime(win + 5000);
  }, mSpot.sp);
  await new Promise(r => setTimeout(r, 400));
  ok('cap regrows after its real-time window', (await page.evaluate(() => window.__cap.info().stubs)) === 0);
}

// 9. v0.7 body: crouch + jump on the deployed build
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 700));
{
  const g0 = await page.evaluate(() => window.__cap.state().y);
  await page.evaluate(() => window.__cap.jump());
  await new Promise(r => setTimeout(r, 180));
  const air = await page.evaluate(() => window.__cap.state());
  ok('jump lifts off (v0.7)', air.airborne === true && air.y > g0 + 0.25, `y=${air.y.toFixed(2)} airborne=${air.airborne}`);
  await new Promise(r => setTimeout(r, 900));
  ok('jump lands (v0.7)', (await page.evaluate(() => window.__cap.state())).airborne === false);
}
{
  await page.evaluate(() => window.__cap.keys('ControlLeft', true));
  await new Promise(r => setTimeout(r, 900));
  ok('crouch lowers the eye (v0.7)', (await page.evaluate(() => window.__cap.state())).crouch > 0.9);
  await page.evaluate(() => window.__cap.keys('ControlLeft', false));
}

// 10. v0.6 perf guard: instanced rendering must keep the scene lean —
//    2,700+ draw calls in v0.5 dropped to ~75; a regression back to
//    per-mesh rendering would blow well past 200
const perf = await page.evaluate(() => window.__cap.perf());
ok('draw calls under 200 (instancing intact)', perf && perf.calls < 200, `calls=${perf && perf.calls}`);
ok('frame time under 10ms on the 880M', perf && perf.frameAvgMs < 10, `frameAvgMs=${perf && perf.frameAvgMs}`);

const pageErrs = errors.filter(e => !/favicon/i.test(e));
ok('no page errors', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '));

console.log(`\n${pass} PASS, ${fail} FAIL`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);

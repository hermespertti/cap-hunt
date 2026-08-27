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
// v0.8 momentum: after any movement the player glides a bit — settle before
// reading raycast results (a drifting crosshair would otherwise miss)
for (let i = 0; i < 40; i++) {
  const sp = await page.evaluate(() => window.__cap.state().speed);
  if (sp < 0.2) break;
  await new Promise(r => setTimeout(r, 100));
}
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
  await new Promise(r => setTimeout(r, 900));
  ok('release crouch stands up (v0.7.1)', (await page.evaluate(() => window.__cap.state())).crouch < 0.1);
}
{
  // legs are a solid HL-style viewmodel (v0.9.1): on at all times, no fade
  await page.evaluate(() => window.__cap.aim(window.__cap.state().yaw, 0));
  await new Promise(r => setTimeout(r, 300));
  ok('legs on at eye level (v0.9.1)', (await page.evaluate(() => window.__cap.state())).legs > 0.95);
  await page.evaluate(() => window.__cap.aim(window.__cap.state().yaw, -1.1));
  await new Promise(r => setTimeout(r, 300));
  ok('legs on looking down (v0.9.1)', (await page.evaluate(() => window.__cap.state())).legs > 0.95);
}

{
  // v0.8 weighted movement: speed ramps (not instant), decays when released,
  // and the FOV widens with speed — the "feel" regressions the probe catches
  const rest0 = await page.evaluate(() => window.__cap.state());
  ok('fov at rest (v0.8)', Math.abs(rest0.fov - 68) < 1.5, `fov=${rest0.fov}`);
  await page.evaluate(() => window.__cap.keys('KeyW', true));
  await page.evaluate(() => window.__cap.keys('ShiftLeft', true));
  await new Promise(r => setTimeout(r, 1600));
  const run = await page.evaluate(() => window.__cap.state());
  ok('run reaches speed (v0.8)', run.speed > 4.3, `speed=${run.speed}`);
  ok('fov widens at run speed (v0.8)', run.fov > 71, `fov=${run.fov}`);
  await page.evaluate(() => window.__cap.keys('KeyW', false));
  await page.evaluate(() => window.__cap.keys('ShiftLeft', false));
  await new Promise(r => setTimeout(r, 1300));
  const stopped = await page.evaluate(() => window.__cap.state());
  ok('friction: speed decays to 0 (v0.8)', stopped.speed < 0.3, `speed=${stopped.speed}`);
  ok('fov recovers to rest (v0.8)', Math.abs(stopped.fov - 68) < 1.5, `fov=${stopped.fov}`);
}

{
  // v0.9 the finale: at 20s the light FAILS — fog to point-blank, vignette up,
  // birds silenced, bell loses bearing; before that, nothing changes
  const t0 = await page.evaluate(() => window.__cap.state().timeLeft);
  if (t0 > 24) await page.evaluate((d) => window.__cap.skipTime(d), t0 - 22);
  await new Promise(r => setTimeout(r, 400));
  let s = await page.evaluate(() => window.__cap.state());
  ok('no finale above 20s (v0.9)', s.finale === false && s.timeLeft > 20, `timeLeft=${s.timeLeft} finale=${s.finale}`);
  const vigEarly = await page.evaluate(() => document.getElementById('vignette').style.opacity);
  ok('vignette hidden early (v0.9)', vigEarly === '0', `opacity=${vigEarly}`);
  const fogEarly = s.fogFar;
  await page.evaluate((d) => window.__cap.skipTime(d), 13); // deep into the finale
  await new Promise(r => setTimeout(r, 500));
  s = await page.evaluate(() => window.__cap.state());
  ok('finale trips at 20s (v0.9)', s.finale === true, `timeLeft=${s.timeLeft} finale=${s.finale}`);
  ok('fog tightens in the finale (v0.9)', s.fogFar < fogEarly - 5, `early=${fogEarly} now=${s.fogFar}`);
  const vigMid = await page.evaluate(() => parseFloat(document.getElementById('vignette').style.opacity || '0'));
  ok('vignette rises in the finale (v0.9)', vigMid > 0.3, `opacity=${vigMid}`);
  await page.evaluate(() => window.__cap.skipTime(500));
  await new Promise(r => setTimeout(r, 400));
  s = await page.evaluate(() => window.__cap.state());
  ok('point-blank fog when the light dies (v0.9)', s.fogFar < 13, `fogFar=${s.fogFar}`);
  await page.evaluate(() => window.__cap.skipTime(500));
  await new Promise(r => setTimeout(r, 400));
  ok('run ends at zero light (v0.9)', (await page.evaluate(() => window.__cap.state())).mode === 'end');
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

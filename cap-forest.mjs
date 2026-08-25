// cap-hunt forest + habitat test: bigger map, elevation, 5 tree species, host-bound caps
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium', protocolTimeout: 360000, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=vulkan'] });
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

await page.goto('http://localhost:5190/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));

const info = await page.evaluate(() => window.__cap.info());

// 1. forest scale + all five species present
ok('forest has 80+ trees', info.trees.total >= 80, `got ${info.trees.total}`);
const kinds = Object.keys(info.trees.byKind);
ok('all 5 tree species present', kinds.length === 5, JSON.stringify(info.trees.byKind));
for (const k of ['oak', 'pine', 'birch', 'aspen', 'giant']) {
  ok(`  species: ${k}`, (info.trees.byKind[k] ?? 0) >= 6, `got ${info.trees.byKind[k] ?? 0}`);
}

// 2. real elevation: meaningful span, north ridge higher than the spawn clearing
ok('elevation span >= 0.8', info.elevation.span >= 0.8, `span=${info.elevation.span.toFixed(2)}`);
ok('north ridge higher than spawn', info.elevation.north > info.elevation.spawn + 0.4,
  `north=${info.elevation.north.toFixed(2)} spawn=${info.elevation.spawn.toFixed(2)}`);

// 3. cap population: enough to find all six species
ok('90+ mushrooms in world', info.shrooms.total >= 90, `got ${info.shrooms.total}`);
for (const sp of ['champ', 'fly', 'chant', 'trump', 'deadly']) {
  const n = (info.shrooms.bySp[sp] ?? []).length;
  ok(`  species population: ${sp} (${n})`, n >= 6, `got ${n}`);
}
ok('exactly 4 golden caps', (info.shrooms.bySp.gold ?? []).length === 4, `got ${(info.shrooms.bySp.gold ?? []).length}`);

// 4. habitat co-location: every host-bound cap grows within reach of one of
//    its host trees (the codex hint is real, verifiable in-world)
// (scan client-side using exposed data — cheaper than N evaluate round-trips)
const all = await page.evaluate(() => {
  const { treeList, shrooms } = window.__cap.info();
  const HOST = {
    chant: ['pine', 'giant'], trump: ['pine', 'birch'],
    deadly: ['birch', 'aspen'], fly: ['birch', 'aspen'], gold: ['giant'],
  };
  const out = {};
  for (const sp of Object.keys(HOST)) {
    let bad = 0, n = 0;
    for (const p of shrooms.bySp[sp] ?? []) {
      n++;
      const reach = 1.0; // caps spawn at trunk + 0.25..0.9
      const hostNear = treeList.some((t) =>
        HOST[sp].includes(t.kind) && Math.hypot(t.x - p.x, t.z - p.z) <= t.r + reach);
      if (!hostNear) bad++;
    }
    out[sp] = { bad, n };
  }
  return out;
});
for (const [sp, label] of [
  ['chant', 'chanterelles hug pine/giants'],
  ['trump', 'black trumpets hug pine/birch'],
  ['gold', 'golden caps hide in old growth'],
  ['deadly', 'deadly whites hug birch/aspen'],
]) {
  const r = all[sp];
  ok(label, r.n >= 4 && r.bad === 0, `${r.bad}/${r.n} caps out of host range`);
}
// fly agarics: birch/aspen is their home — the majority must sit at one
const fly = await page.evaluate(() => {
  const { treeList, shrooms } = window.__cap.info();
  let good = 0, n = 0;
  for (const p of shrooms.bySp.fly ?? []) {
    n++;
    if (treeList.some((t) => (t.kind === 'birch' || t.kind === 'aspen') &&
      Math.hypot(t.x - p.x, t.z - p.z) <= t.r + 1.0)) good++;
  }
  return { good, n };
});
ok('fly agarics favor birch/aspen (>=70% in range)',
  fly.n >= 4 && fly.good / fly.n >= 0.7, `in-range=${fly.good}/${fly.n}`);

// 5. field notes codex shows the host hint for every species
const codex = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#codex .citem')).map(e => ({
    cls: e.className,
    host: (e.querySelector('i') || {}).textContent || '',
  })));
ok('codex has 6 entries', codex.length === 6, `got ${codex.length}`);
ok('every codex entry carries a habitat hint', codex.every(c => c.host.length > 3), JSON.stringify(codex.map(c => c.host)));
ok('codex undiscovered entries show ???', codex.filter(c => c.cls.includes('undis')).length === 6);

ok(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 3).join(' | '));

// 6. screenshots: title + codex, then a ridge POV (started game, so the
//    teleport/aim actually move the play camera)
await page.screenshot({ path: 'shot-forest-title.png' });
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => { window.__cap.teleport(0, -18); window.__cap.aim(Math.PI, -0.15); });
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: 'shot-forest-ridge.png' });

console.log(`\n${pass} PASS, ${fail} FAIL`);
await browser.close();
process.exit(fail ? 1 : 0);

// cap-hunt field-notes + persistence test
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium', protocolTimeout: 360000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

await page.goto('http://localhost:5190/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));

// 1. fresh state: codex all undiscovered, save empty
await page.evaluate(() => window.__cap.clearSave());
let codex = await page.evaluate(() => Array.from(document.querySelectorAll('#codex .citem')).map(e => e.className));
ok('codex renders 6 species', codex.length === 6, `got ${codex.length}`);
ok('codex all undiscovered at start', codex.every(c => c.includes('undis')), JSON.stringify(codex));
let sv = await page.evaluate(() => window.__cap.save());
ok('save empty at start', sv.bestWeight === 0 && Object.values(sv.seen).every(v => !v));

// 2. start, pick one — precise aimAt on the nearest shroom (aimAt is now synchronous)
await page.click('#startBtn');
await new Promise(r => setTimeout(r, 900));
const pickedOk = await page.evaluate(async () => {
  const cap = window.__cap;
  let guard = 0;
  while (guard++ < 60) {
    const n = cap.nearestShroom();
    if (n && n.d < 2.3) {
      cap.aimAt(n.x, n.z);
      if (cap.state().target) {
        cap.click();
        await new Promise(r => setTimeout(r, 40));
        if (cap.state().weight > 0) return true;
      }
    } else {
      cap.keys('KeyW', true);
      await new Promise(r => setTimeout(r, 100));
      cap.keys('KeyW', false);
    }
  }
  return false;
});
ok('picked at least one cap', pickedOk);
await new Promise(r => setTimeout(r, 200));
sv = await page.evaluate(() => window.__cap.save());
const seenCount = Object.values(sv.seen).filter(Boolean).length;
ok('pick marks a species seen', seenCount >= 1, `seen=${JSON.stringify(sv.seen)}`);
const beforeReload = await page.evaluate(() => window.__cap.save());

// 3. run to the end — keep picking precisely so bestWeight is meaningful
let end = await page.evaluate(async () => {
  const cap = window.__cap;
  let guard = 0;
  while (guard++ < 400) {
    if (cap.state().mode === 'end') return cap.state();
    const n = cap.nearestShroom();
    if (n && n.d < 2.3) {
      cap.aimAt(n.x, n.z);
      if (cap.state().target) { cap.click(); await new Promise(r => setTimeout(r, 40)); continue; }
    }
    cap.keys('KeyW', true);
    await new Promise(r => setTimeout(r, 90));
    cap.keys('KeyW', false);
  }
  return cap.state();
});
if (end.mode !== 'end') {
  await page.evaluate(() => window.__cap.skipTime(500));
  await new Promise(r => setTimeout(r, 600));
  end = await page.evaluate(() => window.__cap.state());
}
sv = await page.evaluate(() => window.__cap.save());
ok('bestWeight recorded at end', sv.bestWeight >= end.weight && sv.bestWeight > 0, `best=${sv.bestWeight} end.weight=${end.weight}`);

// 4. RELOAD — everything must persist from localStorage
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 3500));
sv = await page.evaluate(() => window.__cap.save());
ok('save survives reload (best)', sv.bestWeight === beforeReload.bestWeight || sv.bestWeight >= beforeReload.bestWeight, `after reload best=${sv.bestWeight}`);
const stillSeen = Object.values(sv.seen).filter(Boolean).length;
ok('seen species survive reload', stillSeen >= seenCount, `seen ${seenCount} -> ${stillSeen}`);
codex = await page.evaluate(() => Array.from(document.querySelectorAll('#codex .citem')).map(e => e.className));
ok('codex shows discovered species after reload', codex.some(c => !c.includes('undis')), JSON.stringify(codex));
const bestTxt = await page.evaluate(() => document.getElementById('titleBest').textContent);
ok('title shows best basket', /BEST BASKET/.test(bestTxt) && /\d+g/.test(bestTxt), JSON.stringify(bestTxt));

ok(errors.length === 0, `no page errors (${errors.length})`, errors.slice(0, 3).join(' | '));
console.log(`\n${pass} PASS, ${fail} FAIL`);
await browser.close();
process.exit(fail ? 1 : 0);

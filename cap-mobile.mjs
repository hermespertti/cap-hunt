// cap-hunt mobile smoke test — emulated touch device (Pixel 5)
import puppeteer from 'puppeteer-core';

const URL = 'http://localhost:5190/';
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/usr/bin/chromium',
  protocolTimeout: 360000,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage();
const device = {
  name: 'Google Pixel 5',
  userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  viewport: { width: 393, height: 851, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true, isLandscape: false },
};
await page.emulate(device);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
};

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 4000));

// boot
let s = await page.evaluate(() => window.__cap && window.__cap.state());
ok('hooks present', !!s);
ok('title mode at boot', s && s.mode === 'title', String(s && s.mode));
ok('touch class applied', await page.evaluate(() => document.body.classList.contains('touch')));
ok('viewport locks zoom', await page.evaluate(() => /user-scalable=no/.test(document.querySelector('meta[name=viewport]').content)));

// START via a real touch tap on the button
await page.tap('#startBtn');
await new Promise(r => setTimeout(r, 1200));
s = await page.evaluate(() => window.__cap.state());
ok('start button works on touch', s.mode === 'play', String(s.mode));
ok('pause button visible in play', await page.evaluate(() => {
  const el = document.getElementById('pauseBtn');
  return el && getComputedStyle(el).display !== 'none';
}));
ok('no pointerlock on touch', await page.evaluate(() => document.pointerLockElement === null));

// joystick: press on left half, drag up, release
const before = await page.evaluate(() => { const st = window.__cap.state(); return [st.x, st.z]; });
await page.evaluate(async () => {
  const c = document.querySelector('#app canvas');
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width * 0.2, cy = r.top + r.height * 0.7;
  const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
    clientX: x, clientY: y,
  }));
  fire('pointerdown', cx, cy);
  await new Promise(rs => setTimeout(rs, 100));
  // walk forward: drag knob toward top
  for (let i = 1; i <= 6; i++) {
    fire('pointermove', cx, cy - i * 7);
    await new Promise(rs => setTimeout(rs, 100));
  }
  fire('pointerup', cx, cy - 42);
});
await new Promise(r => setTimeout(r, 400));
const after = await page.evaluate(() => { const st = window.__cap.state(); return [st.x, st.z]; });
const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
ok('joystick moves the player', moved > 0.5, `moved=${moved.toFixed(2)}`);

// look: drag on right half
const yaw0 = await page.evaluate(() => window.__cap.state().yaw);
await page.evaluate(async () => {
  const c = document.querySelector('#app canvas');
  const r = c.getBoundingClientRect();
  const cx = r.left + r.width * 0.75, cy = r.top + r.height * 0.5;
  const fire = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
    pointerId: 8, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
    clientX: x, clientY: y,
  }));
  fire('pointerdown', cx, cy);
  await new Promise(rs => setTimeout(rs, 80));
  for (let i = 1; i <= 5; i++) {
    fire('pointermove', cx + i * 12, cy);
    await new Promise(rs => setTimeout(rs, 60));
  }
  fire('pointerup', cx + 60, cy);
});
const yaw1 = await page.evaluate(() => window.__cap.state().yaw);
ok('look drag turns the camera', Math.abs(yaw1 - yaw0) > 0.1, `delta=${(yaw1 - yaw0).toFixed(3)}`);

// tap-to-pick: aim at nearest shroom, short tap on right half
let picked = false;
for (let i = 0; i < 6 && !picked; i++) {
  const n = await page.evaluate(() => {
    const s0 = window.__cap.state();
    const sh = window.__cap.nearestShroom();
    if (sh && sh.d < 2.2) { window.__cap.aimAt(sh.x, sh.z); return true; }
    window.__cap.keys('KeyW', true); return false;
  });
  if (!n) { await new Promise(r => setTimeout(r, 150)); await page.evaluate(() => window.__cap.keys('KeyW', false)); }
  await new Promise(r => setTimeout(r, 250));
  const beforeP = await page.evaluate(() => window.__cap.state().picks);
  await page.evaluate(async () => {
    const c = document.querySelector('#app canvas');
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width * 0.7, cy = r.top + r.height * 0.5;
    const fire = (type) => c.dispatchEvent(new PointerEvent(type, {
      pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
      clientX: cx, clientY: cy,
    }));
    fire('pointerdown');
    await new Promise(rs => setTimeout(rs, 100));
    fire('pointerup');
  });
  await new Promise(r => setTimeout(r, 300));
  const afterP = await page.evaluate(() => window.__cap.state().picks);
  if (afterP === beforeP + 1) picked = true;
}
ok('tap picks a mushroom', picked);

// pause button
await page.tap('#pauseBtn');
await new Promise(r => setTimeout(r, 250));
s = await page.evaluate(() => window.__cap.state());
ok('pause button pauses', s.mode === 'pause', String(s.mode));
await page.tap('#pauseScreen');
await new Promise(r => setTimeout(r, 250));
s = await page.evaluate(() => window.__cap.state());
ok('resume from pause works', s.mode === 'play', String(s.mode));

const pageErrs = errors.filter(e => !/favicon/i.test(e));
ok('no page errors', pageErrs.length === 0, pageErrs.slice(0, 3).join(' | '));

console.log(`\n${pass} PASS, ${fail} FAIL`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);

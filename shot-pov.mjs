import puppeteer from 'puppeteer-core';
import fs from 'fs';
const browser = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:'new', protocolTimeout:300000, args:['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','--window-size=1280,720'] });
const page = await browser.newPage();
await page.setViewport({ width:1280, height:720 });
await page.goto('http://localhost:5190/', { waitUntil:'domcontentloaded' });
await new Promise(r=>setTimeout(r,3000));

fs.writeFileSync('/home/lex/.hermes/cap-hunt/tex-camo.png', Buffer.from((await page.evaluate(() => window.__cap.texDataUrl())).split(',')[1], 'base64'));
await page.screenshot({ path:'/home/lex/.hermes/cap-hunt/shot-title.png' });

// deterministic reference framing at spawn: log left, boardwalk right, thicket ahead
await page.click('#startBtn');
await new Promise(r=>setTimeout(r,500));
const pose = await page.evaluate(() => window.__cap.refShot());
await new Promise(r=>setTimeout(r,1600)); // arm eases into reach
await page.screenshot({ path:'/home/lex/.hermes/cap-hunt/shot-pov.png' });
console.log('done', JSON.stringify(pose));
await browser.close();

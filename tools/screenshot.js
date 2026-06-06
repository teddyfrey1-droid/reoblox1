// @ts-check
/**
 * Headless screenshot tool for the playable web prototype (dev-only).
 *
 *   npm i -D puppeteer        # not a committed dependency
 *   node tools/screenshot.js  http://localhost:8787  /tmp/out
 *
 * It boots a Chromium, loads the prototype (which auto-creates a player and renders
 * generated Lumi on <canvas>), waits for the render loop, and captures each tab.
 * Used to produce visual proof that the prototype actually plays in a browser.
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:8787';
const outDir = process.argv[3] || '/tmp/lumora-shots';
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 860, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(base, { waitUntil: 'networkidle0', timeout: 20000 });
  await page.waitForSelector('#gen-canvas', { timeout: 10000 });
  await sleep(1500); // let the canvas render loop + API bootstrap settle

  const shot = async (name) => {
    const p = join(outDir, name);
    await page.screenshot({ path: p });
    console.log('shot:', p);
  };

  await shot('01-generator.png');

  // Reroll a few times to land on something colourful, then capture again.
  await page.click('#gen-reroll'); await sleep(400);
  await page.click('#gen-reroll'); await sleep(700);
  await shot('02-generator-reroll.png');

  await clickTab(page, 'collection'); await sleep(1200); await shot('03-collection.png');
  await clickTab(page, 'breed'); await sleep(1200); await shot('04-breed.png');
  await clickTab(page, 'social'); await sleep(1000); await shot('05-world.png');

  if (errors.length) {
    console.error('PAGE ERRORS:\n' + errors.join('\n'));
    process.exitCode = 2;
  } else {
    console.log('No page errors — prototype rendered cleanly.');
  }
} finally {
  await browser.close();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function clickTab(page, name) {
  await page.evaluate((n) => {
    const tab = [...document.querySelectorAll('.tab')].find((t) => t.dataset.tab === n);
    if (tab) tab.click();
  }, name);
}

// Uses Parts Bin in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// A pretend NFC reader stands in for the phone, and test/fake-google.mjs for Google Drive.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fakeGoogle } from './fake-google.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const body = await readFile(join(root, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const origin = `http://localhost:${server.address().port}`, base = origin + '/';

// A small inventory in the Stockroom artifact's export shape.
const tmp = await mkdtemp(join(tmpdir(), 'pb-'));
const exportFile = join(tmp, 'stockroom.json');
await writeFile(exportFile, JSON.stringify({
  bins: [{ id: 'bin-env', code: 'ENV', name: 'Environmental', location: 'Workroom', updatedAt: '2026-09-30T13:30:00Z' }],
  parts: [
    { id: 'p-bme280', name: 'BME280 (Adafruit)', binId: 'bin-env', category: 'Sensors', qty: 5, unit: 'pcs', tags: [], updatedAt: '2026-09-30T13:30:00Z' },
    { id: 'p-scd41', name: 'SCD41', binId: 'bin-env', category: 'Sensors', qty: 3, unit: 'pcs', tags: ['generic'], updatedAt: '2026-09-30T13:30:00Z' },
  ],
  projects: [{ id: 'proj-x', name: 'Test BOM', text: '2 BME280\n1 SCD41\n1 SGP30', updatedAt: '2026-09-30T13:30:00Z' }],
}));

const fakeNfc = () => {
  window.__written = []; let pending = null;
  window.__tap = () => { const p = pending; pending = null; if (!p) return false; window.__written.push(p.msg.records[0].data); p.resolve(); return true; };
  window.NDEFReader = class {
    async write(msg, o = {}) { return new Promise((resolve, reject) => { pending = { msg, resolve, reject }; o.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError'))); }); }
    async scan() { window.__reader = this; }
  };
  window.__read = url => window.__reader?.onreading?.({ message: { records: [{ recordType: 'url', data: new TextEncoder().encode(url) }] } });
  navigator.permissions.query = async () => ({ state: 'granted' });
  navigator.vibrate = () => true;
};

const g = fakeGoogle();
const browser = await pw.chromium.launch();
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
  await g.install(ctx, { rewrite: { '**/js/sync.js': s => s.replace("['https://junkdrawer.works']", `['https://junkdrawer.works', '${origin}']`) } });
  await ctx.addInitScript(fakeNfc);
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') page.problems.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('https://www.googleapis.com/') && !u.startsWith('https://accounts.google.com/')) page.problems.push('left the site: ' + u); });
  await page.goto(base);
  return { ctx, page };
}

// ---- phone: first open, load the Stockroom export
const { ctx, page } = await device();
await page.waitForSelector('text=No bins yet');
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#imp')]);
await chooser.setFiles(exportFile);
await page.waitForSelector('text=Environmental');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-scd41'].qty), 3);

// ---- Pack: type, pick the existing part, save, and the tag is written in the same flow
await page.goto(base + '#scan');
await page.selectOption('#dest', 'bin-env');
await page.fill('#desc', 'bme');
await page.waitForSelector('.matchlist [data-id="p-bme280"]');
await page.click('.matchlist [data-id="p-bme280"]');
await page.waitForSelector('#p-name');
assert.equal(await page.inputValue('#p-bag'), '1');
await page.fill('#p-qty', '4');
await page.click('.sheet #save');
await page.waitForSelector('#tz.wait'); // listening for the sticker without another tap
assert.ok(await page.evaluate(() => window.__tap()));
await page.waitForSelector('#tz.ok');
assert.match((await page.evaluate(() => window.__written))[0], /#bag\/001$/);
await page.waitForFunction(() => !document.querySelector('.sheet'));
const bme = await page.evaluate(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-bme280']);
assert.equal(bme.qty, 4); assert.equal(bme.bag, 1); assert.equal(bme.tagWritten, true);
// next bag number moves on
assert.match(await page.textContent('.packhead .big'), /#002/);

// ---- a new part through the same flow
await page.fill('#desc', 'Soldering iron');
await page.click('.matchlist [data-id=""]');
await page.click('.sheet #save');
await page.waitForSelector('#tz.wait');
await page.evaluate(() => window.__tap());
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.match((await page.evaluate(() => window.__written))[1], /#bag\/002$/);
await page.screenshot({ path: join(root, 'docs/phone-pack.png') });

// ---- reading a tag opens that bag
await page.goto(base + '#bins');
await page.click('#readtag');
await page.evaluate(u => window.__read(u), base + '#bag/001');
await page.waitForSelector('h2:has-text("BME280")');

// ---- BOM check against the inventory
await page.goto(base + '#bom');
await page.selectOption('#proj', 'proj-x');
await page.waitForSelector('.bom-summary');
const summary = await page.textContent('.bom-summary');
assert.match(summary, /2 have/); assert.match(summary, /1 missing/);
await page.screenshot({ path: join(root, 'docs/phone-bom.png') });

// ---- Drive: turn it on here, then a laptop picks the inventory up
await page.goto(base + '#settings');
await page.click('[data-a="on"]');
await page.waitForFunction(() => document.querySelector('#drivecard')?.textContent.includes('Saved to Google Drive') && /Last synced/.test(document.querySelector('#drivecard').textContent), null, { timeout: 10000 });
const file = () => g.files().find(f => f.appProperties?.partsbin === 'sync');
assert.ok(file(), 'a Parts Bin file in Drive');
assert.equal(JSON.parse(file().body).items.parts['p-bme280'].qty, 4);

const laptop = await device();
await laptop.page.goto(base + '#settings');
await laptop.page.click('[data-a="on"]');
await laptop.page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin') || '{}').items?.parts?.['p-scd41']);
await laptop.page.goto(base + '#parts');
await laptop.page.waitForSelector('text=Soldering iron');
// the laptop changes a count; the phone gets it at its next sync
await laptop.page.evaluate(() => { const d = JSON.parse(localStorage.getItem('parts-bin')); return d; });
await laptop.page.goto(base + '#part/p-scd41');
await laptop.page.click('#inc');
await laptop.page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-scd41'].qty === 4);
await laptop.page.waitForFunction(() => document.querySelector('#cloud')?.dataset.s === 'ok', null, { timeout: 8000 });
await laptop.page.waitForTimeout(1600);
await page.evaluate(() => document.querySelector('#cloud-m').click());
await page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-scd41'].qty === 4, null, { timeout: 8000 });

// ---- phone basics
await page.goto(base + '#bins');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');
await page.screenshot({ path: join(root, 'docs/phone-bins.png') });
const desk = await browser.newPage({ viewport: { width: 1280, height: 820 } });
await desk.goto(base);

await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 5000 }).catch(() => {});
for (const p of [page, laptop.page]) assert.deepEqual(p.problems, [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');

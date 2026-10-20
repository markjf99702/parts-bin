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
    async write(msg, o = {}) { return new Promise((resolve, reject) => { const p = pending = { msg, resolve, reject }; o.signal?.addEventListener('abort', () => { if (pending === p) pending = null; reject(new DOMException('stopped', 'AbortError')); }); }); } // a write that's stopped isn't made
    async scan() { window.__reader = this; }
  };
  window.__read = url => window.__reader?.onreading?.({ message: { records: [{ recordType: 'url', data: new TextEncoder().encode(url) }] } });
  navigator.permissions.query = async () => ({ state: 'granted' });
  navigator.vibrate = () => true;
  // sharing with Claude: the phone's share sheet, or the clipboard anywhere else
  navigator.share = async d => { window.__shared = d.text; };
  if (navigator.clipboard) navigator.clipboard.writeText = async t => { window.__shared = t; };
};

const g = fakeGoogle();
const browser = await pw.chromium.launch();
async function device() {
  // No offline copy on these devices (it's checked on one of its own at the end): routes can't reach what a service worker
  // fetches, so it would hand the page sync.js without the stand-in Drive's address.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true, serviceWorkers: 'block' });
  await g.install(ctx, { rewrite: { '**/js/sync.js': s => s.replace("['https://parts-bin.junkdrawer.works', 'https://junkdrawer.works']", `['https://parts-bin.junkdrawer.works', '${origin}']`) } });
  await ctx.addInitScript(fakeNfc);
  // reference photos load from wherever they're hosted; here, one that exists and one that's gone
  await ctx.route('https://img.test/**', async r => (r.request().url().includes('missing') ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ contentType: 'image/png', body: await readFile(join(root, 'icon-192.png')) })));
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.location().url.startsWith('https://img.test/')) page.problems.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('https://www.googleapis.com/') && !u.startsWith('https://accounts.google.com/') && !u.startsWith('https://img.test/')) page.problems.push('left the site: ' + u); });
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
// next bag number moves on, with the description and its matches cleared for it
assert.match(await page.textContent('.packhead .big'), /#002/);
assert.equal(await page.inputValue('#desc'), ''); assert.equal(await page.locator('.matchlist').count(), 0);

// ---- a new part through the same flow
await page.fill('#desc', 'Soldering iron');
await page.click('.matchlist [data-id=""]');
await page.click('.sheet #save');
await page.waitForSelector('#tz.wait');
await page.evaluate(() => window.__tap());
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.match((await page.evaluate(() => window.__written))[1], /#bag\/002$/);
await page.screenshot({ path: join(root, 'docs/phone-pack.png') });

// ---- Parts → + Part: a new part goes into a new bag and is tagged on save
await page.goto(base + '#parts');
await page.click('#addp');
await page.fill('#p-name', 'M3 heat-set inserts');
await page.fill('#p-qty', '50');
assert.ok(await page.isChecked('#p-dotag'));
assert.equal(await page.textContent('#p-bagshow'), '#003');
assert.equal(await page.textContent('.sheet #save'), 'Save & tag');
await page.click('.sheet #save');
await page.waitForSelector('#tz.wait');
await page.evaluate(() => window.__tap());
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.match((await page.evaluate(() => window.__written)).at(-1), /#bag\/003$/);
const ins = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('parts-bin')).items.parts).find(x => x.name === 'M3 heat-set inserts'));
assert.equal(ins.bag, 3); assert.equal(ins.qty, 50); assert.equal(ins.tagWritten, true);
// unticking it saves without a bag or a tag (ticking it again brings the number back)
await page.click('#addp');
await page.fill('#p-name', 'Loose spare');
assert.equal(await page.inputValue('#p-bag'), '4');
await page.uncheck('#p-dotag');
assert.equal(await page.inputValue('#p-bag'), '', 'unticked, the bag number it filled in goes');
await page.check('#p-dotag');
assert.equal(await page.inputValue('#p-bag'), '4');
await page.uncheck('#p-dotag');
await page.click('.sheet #save');
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.equal((await page.evaluate(() => window.__written)).length, 3);
assert.ok(!(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('parts-bin')).items.parts).find(x => x.name === 'Loose spare').bag)), 'saved without a bag');

// ---- Bag tag on the page of a part that has no bag yet: it gets the next number, and the tag carries it
const spareId = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('parts-bin')).items.parts).find(([, x]) => x.name === 'Loose spare')[0]);
const spare = () => page.evaluate(id => JSON.parse(localStorage.getItem('parts-bin')).items.parts[id], spareId);
await page.goto(base + '#part/' + spareId);
await page.click('text=Bag tag');
assert.match(await page.textContent('.sheet h3'), /#004/);
assert.match(await page.textContent('.sheet'), /This will be bag #004/);
// looking at the sheet and backing out takes no number
assert.equal(await page.textContent('.sheet #done'), 'Cancel');
await page.click('.sheet #done');
assert.ok(!(await spare()).bag);
await page.click('text=Bag tag');
await page.click('.sheet #write');
await page.waitForSelector('#tz.wait');
await page.evaluate(() => window.__tap());
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.equal((await page.evaluate(() => window.__written)).at(-1), base + '#bag/004');
assert.equal((await spare()).bag, 4); assert.equal((await spare()).tagWritten, true);
assert.equal(await page.textContent('.binhead .bagno'), '#004');
// if the number is taken while the sheet is open (another tab, a sync), it stops rather than double up
await page.goto(base + '#parts'); await page.click('#addp'); await page.fill('#p-name', 'Second spare'); await page.uncheck('#p-dotag'); await page.click('.sheet #save');
await page.waitForFunction(() => !document.querySelector('.sheet'));
const second = await page.evaluate(() => Object.entries(JSON.parse(localStorage.getItem('parts-bin')).items.parts).find(([, x]) => x.name === 'Second spare')[0]);
await page.goto(base + '#part/' + second); await page.click('text=Bag tag');
assert.match(await page.textContent('.sheet h3'), /#005/);
await page.evaluate(id => { const d = JSON.parse(localStorage.getItem('parts-bin')); d.items.parts.stolen = { name: 'Took the number', bag: 5, qty: 1, t: Date.now() }; localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' })); }, second);
await page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts.stolen);
await page.waitForTimeout(100);
await page.click('.sheet #write');
await page.waitForSelector('text=has just been used');
assert.ok(!(await page.evaluate(id => JSON.parse(localStorage.getItem('parts-bin')).items.parts[id].bag, second)));
assert.equal(await page.evaluate(() => window.__tap()), false, 'nothing was waiting to be written');
// put things back so the bag numbers below read on from #004
await page.evaluate(id => { const d = JSON.parse(localStorage.getItem('parts-bin')); delete d.items.parts.stolen; delete d.items.parts[id]; localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' })); }, second);
await page.waitForTimeout(100);
await page.goto(base + '#part/' + spareId);
// tagging it again keeps its number
await page.click('text=Bag tag');
await page.click('.sheet #write');
await page.waitForSelector('#tz.wait');
await page.evaluate(() => window.__tap());
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.equal((await page.evaluate(() => window.__written)).at(-1), base + '#bag/004');
assert.equal((await spare()).bag, 4);

// ---- reading a tag opens that bag, with no tap first: the page listens while it's open
await page.goto(base + '#bins');
await page.reload();
await page.waitForFunction(() => window.__reader?.onreading);
assert.ok(await page.$('#readtag.on'), 'the NFC button shows it is listening');
await page.evaluate(u => window.__read(u), base + '#bag/001');
await page.waitForSelector('h2:has-text("BME280")');
// an old tag from the Stockroom artifact opens here too, and offers to rewrite it for Parts Bin
await page.goto(base + '#bins');
await page.evaluate(() => window.__read('https://claude.ai/artifact/3tWd7DUCw34ExEy7Jo4CpG#bag/001'));
await page.waitForSelector('h2:has-text("BME280")');
await page.waitForSelector('.sheet:has-text("Update this tag?")');
await page.click('.sheet #go');
await page.waitForSelector('#tz.wait');
await page.evaluate(() => window.__tap());
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.equal((await page.evaluate(() => window.__written)).at(-1), base + '#bag/001');
// the tag just written, still against the phone, doesn't bounce the page around
await page.goto(base + '#bins');
await page.evaluate(u => window.__read(u), base + '#bag/001');
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => location.hash), '#bins');
await page.waitForTimeout(3000);
// someone else's link is left alone
await page.evaluate(() => window.__read('https://example.com/#bag/001'));
await page.waitForSelector('text=That tag isn’t one of yours');
assert.equal(await page.evaluate(() => location.hash), '#bins');

// ---- BOM check against the inventory
await page.goto(base + '#bom');
await page.selectOption('#proj', 'proj-x');
await page.waitForSelector('.bom-summary');
const summary = await page.textContent('.bom-summary');
assert.match(summary, /2 have/); assert.match(summary, /1 missing/);
await page.screenshot({ path: join(root, 'docs/phone-bom.png') });
// a list typed but not checked yet stays through another screen, a reload, and Save as project
await page.fill('#bom', '1 SCD41\n2 heat-set inserts');
await page.click('#tabbar [data-go="parts"]'); await page.waitForSelector('#cat');
await page.click('#tabbar [data-go="bom"]'); await page.waitForSelector('#bom');
assert.equal(await page.inputValue('#bom'), '1 SCD41\n2 heat-set inserts');
await page.reload(); await page.waitForSelector('#bom');
assert.equal(await page.inputValue('#bom'), '1 SCD41\n2 heat-set inserts');
await page.fill('#bom', '3 WS2812 strip segment');
page.once('dialog', d => d.accept('Lamp'));
await page.click('#save');
await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('parts-bin')).items.projects).some(p => p.name === 'Lamp'));
await page.waitForTimeout(100);
assert.equal(await page.inputValue('#bom'), '3 WS2812 strip segment');
// a shortfall in metres reads 0.2, not 0.19999999999999998, on screen and in the shopping list
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('parts-bin')); d.items.parts['p-heat'] = { name: 'Heat shrink tubing 3mm', qty: 0.1, unit: 'm', tags: [], t: Date.now() }; localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' })); });
await page.fill('#bom', '0.3 m heat shrink tubing 3mm'); await page.click('#check');
assert.equal(await page.textContent('.bom-table .chip.warn'), 'short 0.2');
await page.click('#out #copy');
await page.waitForFunction(() => window.__shared === '0.2 × m heat shrink tubing 3mm');

// ---- Inbox: a link from Claude brings parts to check; each is saved and tagged from its card
const IN = await import('../js/inbox.js');
const part = id => page.evaluate(id => JSON.parse(localStorage.getItem('parts-bin')).items.parts[id], id);
const partNamed = name => page.evaluate(name => Object.entries(JSON.parse(localStorage.getItem('parts-bin')).items.parts).map(([id, x]) => ({ id, ...x })).find(x => x.name === name), name);
const tapTag = async () => { await page.waitForSelector('#tz.wait'); await page.evaluate(() => window.__tap()); await page.waitForFunction(() => !document.querySelector('.sheet')); };
const photoLink = base + '#' + await IN.encode({ partsbin: 1, batch: { id: 'ptest-photo', name: 'Bench photo', source: 'photo', bin: 'ENV', items: [
  { name: 'SCD41 CO2 sensor', qty: 3, match: 'p-scd41', mpn: 'SCD41', iface: ['I2C'], addr: '0x62', volts: '2.4–5.5 V', logic: '3.3 V', img: 'https://img.test/scd41.png', check: 'Bench Identifier Port A should name it SCD41 at 0x62.' },
  { name: 'TCA9548A I2C multiplexer', qty: 2, category: 'Sensors', iface: 'iic', addr: '0x70–0x77', img: 'https://img.test/missing.png', onclick: 'alert(1)' },
  { name: 'Unmarked purple board', check: 'No markings to read. Bench Identifier Port A will name it if it’s I2C.' },
] } });
await page.goto(photoLink);
await page.waitForSelector('.batch .card.inb');
assert.equal(await page.evaluate(() => location.hash), '#inbox', 'the long code is gone from the address');
assert.equal(await page.locator('.card.inb').count(), 3);
assert.equal(await page.textContent('#tabbar .badge'), '3');
await page.waitForFunction(() => document.querySelector('.card.inb[data-k="i0"] img.ref')?.naturalWidth > 0);
await page.screenshot({ path: join(root, 'docs/phone-inbox.png') });
// the part Claude matched is offered first; picking it opens that record with its blanks filled, ready to tag
await page.click('.card.inb[data-k="i0"] button.pick');
await page.waitForSelector('.sheet #p-name');
assert.equal(await page.inputValue('#p-name'), 'SCD41');
assert.equal(await page.inputValue('#p-iface'), 'I2C'); assert.equal(await page.inputValue('#p-addr'), '0x62'); assert.equal(await page.inputValue('#p-qty'), '3');
assert.equal(await page.textContent('.sheet #save'), 'Save & tag');
await page.click('.sheet #save'); await tapTag();
assert.equal((await page.evaluate(() => window.__written)).at(-1), base + '#bag/005');
let scd = await part('p-scd41');
assert.equal(scd.bag, 5); assert.equal(scd.tagWritten, true); assert.deepEqual(scd.iface, ['I2C']); assert.equal(scd.img, 'https://img.test/scd41.png'); assert.match(scd.check, /Bench Identifier/); assert.deepEqual(scd.tags, ['generic']);
assert.equal(await page.locator('.card.inb').count(), 2);
// a new part opens filled in, in the bin the batch named
await page.click('.card.inb[data-k="i1"] [data-id=""]');
await page.waitForSelector('.sheet #p-name');
assert.equal(await page.inputValue('#p-name'), 'TCA9548A I2C multiplexer'); assert.equal(await page.inputValue('#p-bin'), 'bin-env'); assert.equal(await page.inputValue('#p-qty'), '2'); assert.equal(await page.inputValue('#p-iface'), 'I2C');
await page.click('.sheet #save'); await tapTag();
assert.equal((await page.evaluate(() => window.__written)).at(-1), base + '#bag/006');
const tca = await partNamed('TCA9548A I2C multiplexer');
assert.equal(tca.bag, 6); assert.equal(tca.binId, 'bin-env'); assert.equal(tca.addr, '0x70–0x77'); assert.equal(tca.onclick, undefined);
// skipping takes a card out and saves nothing
await page.click('.card.inb[data-k="i2"] [data-a="skip"]');
await page.waitForSelector('text=Nothing waiting');
assert.equal(await page.locator('#tabbar .badge').count(), 0);
assert.equal(await partNamed('Unmarked purple board'), undefined);
// the same link again, on a fresh load, doesn't bring the batch back unless asked
await page.goto('about:blank'); await page.goto(photoLink);
await page.waitForSelector('#again');
assert.equal(await page.locator('.card.inb').count(), 0);
await page.click('#again'); await page.waitForSelector('.card.inb');
assert.equal(await page.locator('.card.inb').count(), 3);
assert.ok(await page.$(`.card.inb[data-k="i1"] [data-id="${tca.id}"]`), 'the part added a moment ago is offered as an existing one');
page.once('dialog', d => d.accept());
await page.click('[data-a="drop"]'); await page.waitForSelector('text=Nothing waiting');

// ---- suggested details for parts already here: pasted in, one field unticked, applied
await page.fill('#inb-paste', await IN.encode({ partsbin: 1, batch: { id: 'ptest-details', name: 'Details', source: 'details', items: [
  { id: 'p-bme280', category: 'Sensors', mpn: 'BME280', iface: ['I2C', 'SPI'], addr: '0x77, 0x76', volts: '3–5 V', notes: 'Bosch', tags: ['qwiic'] },
  { id: 'p-scd41', iface: ['I2C'], addr: '0x62' },
  { id: 'p-not-here', volts: '5 V' },
] } }));
await page.click('#inb-go');
await page.waitForSelector('.diff');
assert.equal(await page.inputValue('#inb-paste'), '', 'the link that opened is still in the box');
assert.equal(await page.locator('.card.inb').count(), 1, 'a part that already says it all isn’t shown');
assert.deepEqual(await page.locator('.diff .k').allTextContents(), ['Part number', 'Interface', 'I2C address', 'Supply', 'Tags', 'Notes']);
await page.uncheck('.diff input[data-k="notes"]');
await page.click('[data-a="apply"]');
// a suggestion for a part this browser doesn't have is kept and explained, until it's dismissed
await page.waitForSelector('text=isn’t in this browser’s inventory');
assert.equal(await page.locator('.card.inb').count(), 0); assert.equal(await page.textContent('#tabbar .badge'), '1');
page.once('dialog', d => d.accept());
await page.click('[data-a="drop"]'); await page.waitForSelector('text=Nothing waiting');
let bme2 = await part('p-bme280');
assert.equal(bme2.mpn, 'BME280'); assert.deepEqual(bme2.iface, ['I2C', 'SPI']); assert.equal(bme2.addr, '0x77, 0x76'); assert.equal(bme2.volts, '3–5 V'); assert.deepEqual(bme2.tags, ['qwiic']);
assert.ok(!bme2.notes, 'the unticked field was left alone'); assert.equal(bme2.qty, 4); assert.equal(bme2.bag, 1);
// a batch as a file, loaded from Settings, and everything in it applied at once
const moreFile = join(tmp, 'more.partsbin.json');
await writeFile(moreFile, JSON.stringify({ partsbin: 1, batch: { id: 'ptest-more', source: 'details', items: [
  { id: 'p-bme280', logic: '3.3 V or 5 V', check: 'Could be a BMP280. Bench Identifier Port A: ID 0x60 is a BME280.' },
  { id: 'p-scd41', link: 'https://sensirion.com/products/catalog/SCD41', notes: 'Photoacoustic' },
  { id: 'p-scd41', notes: 'Single-shot mode', tags: ['co2'] },
] } }));
await page.goto(base + '#settings');
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('#imp')]);
await chooser2.setFiles(moreFile);
await page.waitForSelector('[data-a="all"]');
assert.equal(await page.evaluate(() => location.hash), '#inbox');
await page.click('[data-a="all"]'); await page.waitForSelector('text=Nothing waiting');
bme2 = await part('p-bme280'); scd = await part('p-scd41');
assert.equal(bme2.logic, '3.3 V or 5 V'); assert.match(bme2.check, /BMP280/); assert.equal(scd.link, 'https://sensirion.com/products/catalog/SCD41');
assert.equal(scd.notes, 'Photoacoustic · Single-shot mode', 'two suggestions for one part build on each other'); assert.deepEqual(scd.tags, ['generic', 'co2']);

// ---- the part page shows the specs and a reference photo, and keeps what's still to check in view
await page.goto(base + '#part/p-scd41');
await page.waitForFunction(() => document.querySelector('.binhead .refphoto img.ref')?.naturalWidth > 0);
assert.deepEqual(await page.locator('.binhead .chip.spec').allTextContents(), ['I2C', '0x62', '2.4–5.5 V supply', '3.3 V logic']);
await page.click('.binhead .refphoto'); await page.waitForSelector('.sheet .refbig img'); await page.click('.sheet #done');
await page.click('#checked'); await page.waitForFunction(() => !document.querySelector('.checknote'));
assert.ok(!(await part('p-scd41')).check);
await page.goto(base + '#part/' + tca.id); // its photo is gone from the site it was on: the icon stays
await page.waitForFunction(() => !document.querySelector('.binhead img.ref') && !document.querySelector('.binhead .refphoto') && document.querySelector('.binhead .photo svg'));
await page.goto(base + '#parts'); await page.selectOption('#cat', '__check');
assert.deepEqual(await page.locator('.item .t').allTextContents(), ['BME280 (Adafruit)']);
await page.selectOption('#cat', '__bagged');
const bagged = await page.locator('.item .bagno').allTextContents();
assert.deepEqual(bagged, ['#001', '#002', '#003', '#004', '#005', '#006'], 'Bagged lists the parts in bag order');
await page.selectOption('#cat', '');
await page.fill('#q', '0x62'); await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
assert.equal(await page.textContent('.item .t'), 'SCD41'); await page.fill('#q', ''); await page.waitForFunction(() => document.querySelectorAll('.item').length > 1);
// nothing found is "No parts match.", not "No parts here yet"
await page.fill('#q', 'zzzz'); await page.waitForSelector('#main .empty:has-text("No parts match.")');
await page.fill('#q', ''); await page.waitForFunction(() => document.querySelectorAll('.item').length > 1);
await page.selectOption('#cat', '__low'); await page.waitForSelector('#main .empty:has-text("No parts match.")');
await page.selectOption('#cat', '');

// ---- a receipt adds to what's in stock, and a part that's already bagged isn't tagged again
await page.goto(base + '#' + await IN.encode({ partsbin: 1, batch: { id: 'ptest-receipt', name: 'Order 1234', source: 'receipt', items: [{ name: 'TCA9548A I2C multiplexer', qty: 3, match: tca.id }, { name: 'Mystery <b>board</b><img src=x onerror=window.__xss=1>', notes: '<i>hi</i>' }] } }));
await page.waitForSelector('.card.inb[data-k="i1"]');
assert.equal(await page.locator('.card.inb .t b, .card.inb i, .card.inb img:not(.ref)').count(), 0, 'what a batch says is shown as text, never as markup');
assert.equal(await page.evaluate(() => window.__xss), undefined);
await page.click('.card.inb[data-k="i1"] [data-a="skip"]');
await page.click('.card.inb button.pick');
await page.waitForSelector('.sheet #p-name');
assert.equal(await page.inputValue('#p-qty'), '5'); assert.equal(await page.textContent('.sheet #save'), 'Save');
const wrote = (await page.evaluate(() => window.__written)).length;
await page.click('.sheet #save'); await page.waitForSelector('text=Nothing waiting');
assert.equal((await part(tca.id)).qty, 5); assert.equal((await page.evaluate(() => window.__written)).length, wrote);

// ---- asking Claude for details hands over the part, with its id so the answer finds its way back
const iron = await partNamed('Soldering iron');
await page.goto(base + '#part/' + iron.id);
await page.click('#ask');
const shared = await page.evaluate(() => window.__shared);
assert.match(shared, /^Parts Bin: fill in details for this part/);
assert.deepEqual(JSON.parse(shared.slice(shared.indexOf('{'))).parts.map(x => x.id), [iron.id]);
await page.goto(base + '#part/p-scd41'); assert.equal(await page.locator('#ask').count(), 0, 'a part with details doesn’t ask');

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
// meanwhile the phone is typing in Pack: the sync draws the screen again, and the description, its matches and the
// keyboard stay (it used to empty them)
await page.goto(base + '#scan'); await page.fill('#desc', 'scd'); await page.waitForSelector('.matchlist [data-id="p-scd41"]:has-text("in stock 3")');
await page.evaluate(() => document.querySelector('#cloud-m').click());
await page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-scd41'].qty === 4, null, { timeout: 8000 });
await page.waitForSelector('.matchlist [data-id="p-scd41"]:has-text("in stock 4")');
assert.equal(await page.inputValue('#desc'), 'scd'); assert.equal(await page.evaluate(() => document.activeElement.id), 'desc');

// ---- a Drive file that isn't JSON at all is left alone, and the page says it can't read it (Drive itself is fine)
const BROKEN = '{"app":"parts-bin","items":{';
g.drive.files.fb1 = { owner: 'broken', name: 'Parts Bin', mimeType: 'application/vnd.google-apps.folder', appProperties: { partsbin: 'folder' }, version: 1, modified: Date.now(), body: null };
g.drive.files.fb2 = { owner: 'broken', name: 'Parts Bin.json', mimeType: 'application/json', appProperties: { partsbin: 'sync' }, parents: ['fb1'], version: 1, modified: Date.now(), body: BROKEN };
const other = await device();
await other.page.evaluate(() => localStorage.setItem('__who', 'broken'));
await other.page.goto(base + '#settings');
await other.page.click('[data-a="on"]');
await other.page.waitForFunction(() => /isn’t readable|Couldn’t reach/.test(document.querySelector('#drivecard')?.textContent), null, { timeout: 10000 });
assert.match(await other.page.textContent('#drivecard'), /The file in your Drive isn’t readable/);
assert.equal(g.drive.files.fb2.body, BROKEN, 'the file was left as it was');

// ---- phone basics
await page.goto(base + '#bins');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');
await page.screenshot({ path: join(root, 'docs/phone-bins.png') });
// the Drive button in the corner doesn't sit on top of a page's own buttons
const clear = sel => page.evaluate(sel => { const r = e => e.getBoundingClientRect(), c = r(document.querySelector('#cloud-m')), x = r(document.querySelector(sel)); return c.width > 0 && (x.right <= c.left || x.bottom <= c.top); }, sel);
await page.goto(base + '#part/p-bme280');
await page.waitForSelector('#edit');
assert.ok(await clear('#edit'), 'the Drive button covers Edit on a part page');
await page.goto(base + '#bin/bin-env');
await page.waitForSelector('#add');
assert.ok(await clear('#add'), 'the Drive button covers a button on a bin page');
// long names wrap rather than push the page sideways: a bin named in full (listed in a box's Unpack into), a saved BOM, a
// part name with no spaces
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('parts-bin')), t = Date.now();
  d.items.bins['bin-long'] = { code: 'PWR', name: 'Power, regulators, buck and boost converters', location: 'Rack A, shelf 2', t };
  d.items.bins['box-long'] = { code: 'BOX 01', kind: 'box', name: 'Workroom — sensors, boards and the bench supplies', location: 'Moving boxes', t };
  d.items.parts['p-long'] = { name: 'Breakout-board-whose-name-goes-on-and-on-without-a-single-space', qty: 1, unit: 'pcs', binId: 'box-long', tags: [], t };
  d.items.projects['proj-long'] = { name: 'Workshop air quality monitor with e-ink display (v2)', text: '1 SCD41', t };
  localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' }));
});
for (const hash of ['#scan', '#inbox', '#parts', '#part/p-scd41', '#bins', '#bin/box-long', '#bom', '#part/p-long']) { await page.goto(base + hash); await page.waitForTimeout(150); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, hash + ' scrolls sideways on a phone'); }
// at the bottom of a screen, the footer's links show above the tab bar and can be tapped
for (const hash of ['#bins', '#parts', '#settings', '#bin/bin-env']) {
  await page.goto(base + hash); await page.waitForTimeout(150);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  assert.ok(await page.evaluate(() => { const a = document.querySelector('.jd-foot a').getBoundingClientRect(); return !!document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2)?.closest('.jd-foot'); }), hash + ': the footer is under the tab bar');
}
// small grey text, warnings, and the writing on teal buttons and labels can be read (4.5:1), in the light theme and the dark
for (const colorScheme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme });
  await page.goto(base + '#bins'); await page.waitForSelector('#addbin'); await page.waitForSelector('.label.box');
  const ratios = await page.evaluate(() => {
    const lum = c => c.match(/[\d.]+/g).slice(0, 3).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const color = v => { const i = document.createElement('i'); i.style.color = `var(${v})`; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; };
    const btn = getComputedStyle(document.querySelector('.btn.primary')), box = getComputedStyle(document.querySelector('.label.box'));
    return { 'grey on the page': ratio(color('--ink3'), color('--bg')), 'grey on a card': ratio(color('--ink3'), color('--panel')), 'a warning': ratio(color('--warn'), color('--warn-soft')),
      'a teal button': ratio(btn.color, btn.backgroundColor), 'a box label': ratio(box.color, box.backgroundColor) };
  });
  for (const [what, r] of Object.entries(ratios)) assert.ok(r >= 4.5, `${colorScheme}: ${what} is ${r.toFixed(2)}:1`);
}
await page.emulateMedia({ colorScheme: 'light' });

// ---- unpacking a box: the bin picked under Unpack into stays picked from bag to bag, and the page keeps its place
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('parts-bin')), t = Date.now();
  d.items.bins['box-move'] = { code: 'BOX 02', kind: 'box', name: 'Bench', location: 'Moving boxes', t };
  for (let i = 1; i <= 16; i++) d.items.parts['p-move' + i] = { name: 'Moved part ' + String(i).padStart(2, '0'), qty: 1, unit: 'pcs', binId: 'box-move', tags: [], t };
  localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' }));
});
await page.goto(base + '#bin/box-move');
assert.equal(await page.locator('button button').count(), 0, 'a ⇢ inside a row’s own button');
assert.equal(await page.getByRole('button', { name: 'Move Moved part 01 to the chosen bin', exact: true }).count(), 1, 'each ⇢ says which bag it moves');
await page.selectOption('#unpack-to', 'bin-env');
await page.evaluate(() => window.scrollTo(0, 200));
const moveButtons = () => page.locator('button[aria-label$="to the chosen bin"]');
await moveButtons().first().click();
await page.waitForFunction(() => document.querySelectorAll('button[aria-label$="to the chosen bin"]').length === 15);
assert.equal(await page.inputValue('#unpack-to'), 'bin-env', 'the bin picked is still picked');
assert.equal(await page.evaluate(() => scrollY), 200, 'the page kept its place');
await moveButtons().first().click();
await page.waitForFunction(() => document.querySelectorAll('button[aria-label$="to the chosen bin"]').length === 14);
assert.deepEqual(await page.evaluate(() => ['p-move1', 'p-move2'].map(id => JSON.parse(localStorage.getItem('parts-bin')).items.parts[id].binId)), ['bin-env', 'bin-env']);

// ---- a count stops at zero, from − or from the sheet
await page.goto(base + '#part/' + spareId);
assert.equal((await spare()).qty, 1);
await page.click('#dec');
await page.waitForFunction(id => JSON.parse(localStorage.getItem('parts-bin')).items.parts[id].qty === 0, spareId);
await page.click('#dec'); await page.waitForTimeout(200);
assert.equal((await spare()).qty, 0); assert.equal(await page.inputValue('#qv'), '0');
await page.click('#edit'); await page.fill('#p-qty', '-3'); await page.click('.sheet #save');
await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.equal((await spare()).qty, 0);
// − and + on a count in metres: 1.1 m less one is 0.1 m, not 0.10000000000000009
await page.goto(base + '#part/p-heat');
await page.click('#inc'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-heat'].qty === 1.1);
await page.click('#dec'); await page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-heat'].qty < 1);
assert.equal((await part('p-heat')).qty, 0.1); assert.equal(await page.inputValue('#qv'), '0.1');
await page.goto(base + '#part/' + spareId);

// ---- a bag number is a whole number from 1 up (a tag for "-5" would open no bag)
await page.click('#edit');
for (const v of ['-5', '0', '2.5']) {
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await page.fill('#p-bag', v); await page.click('.sheet #save');
  await page.waitForSelector('#toast:has-text("whole number")');
  assert.ok(await page.$('.sheet #p-bag'), 'the sheet stays open'); assert.equal((await spare()).bag, 4, 'bag ' + v + ' wasn’t saved');
}
await page.click('.sheet #cancel');

// ---- with this browser's storage full, a save is refused and says so (it used to say "Saved", and the change was gone
// after a reload): a sheet stays open with its edits, and nothing on screen shows what wasn't kept
const storageFull = on => page.evaluate(on => {
  if (!on) { Storage.prototype.setItem = window.__setItem; return; }
  window.__setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'parts-bin') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); return window.__setItem.call(this, k, v); };
}, on);
const stored = () => page.evaluate(() => localStorage.getItem('parts-bin'));
const noToast = () => page.evaluate(() => { document.getElementById('toast').hidden = true; });
const FULL = '#toast:has-text("Storage is full — delete something first")';
await page.goto(base + '#part/p-scd41'); await page.waitForSelector('#edit');
await storageFull(true);
const kept = await stored(), { qty: scdQty, notes: scdNotes } = await part('p-scd41');
await noToast(); await page.click('#edit'); await page.fill('#p-notes', 'A note there’s no room for'); await page.click('.sheet #save');
await page.waitForSelector(FULL); await page.waitForTimeout(300);
assert.equal(await page.textContent('#toast'), 'Storage is full — delete something first', 'it said Saved after all');
assert.equal(await page.inputValue('.sheet #p-notes'), 'A note there’s no room for', 'the sheet stays open with the edit');
// deleting is a save too (the part is kept, marked deleted, so other devices hear of it)
await noToast(); page.once('dialog', d => d.accept()); await page.click('.sheet #del');
await page.waitForSelector(FULL); assert.ok(await page.$('.sheet #p-name'), 'the sheet stays open after a refused delete');
await page.click('.sheet #cancel');
// + on the count goes back to what's kept
await noToast(); await page.click('#inc'); await page.waitForSelector(FULL);
assert.equal(await page.inputValue('#qv'), String(scdQty));
// Save as project
await page.goto(base + '#bom'); await page.waitForSelector('#save');
await noToast(); page.once('dialog', d => d.accept('No room')); await page.click('#save'); await page.waitForSelector(FULL);
// suggestions from the Inbox stay waiting until they can be saved
await page.goto(base + '#inbox');
await page.fill('#inb-paste', await IN.encode({ partsbin: 1, batch: { id: 'ptest-full', source: 'details', items: [{ id: 'p-bme280', volts: '1.71–3.6 V' }] } }));
await page.click('#inb-go'); await page.waitForSelector('[data-a="apply"]');
await noToast(); await page.click('[data-a="apply"]'); await page.waitForSelector(FULL);
assert.equal(await page.locator('.card.inb').count(), 1, 'the suggestion is still waiting');
assert.equal(await stored(), kept, 'nothing was written');
await storageFull(false);
page.once('dialog', d => d.accept()); await page.click('[data-a="drop"]'); await page.waitForSelector('text=Nothing waiting');
await page.goto(base + '#part/p-scd41'); await page.reload(); await page.waitForSelector('h2:has-text("SCD41")');
assert.equal((await part('p-scd41')).notes, scdNotes);
assert.equal((await part('p-scd41')).qty, scdQty);
assert.ok(!Object.values(JSON.parse(await stored()).items.projects).some(p => p.name === 'No room'));

// ---- the phone's Back closes a sheet and leaves the page as it was, as an Android app does (it used to go back a page
// underneath, with the sheet still open over it)
const at = h => page.waitForFunction(h => location.hash === h, h);
const shut = p => p.waitForFunction(() => !document.querySelector('.sheet') && !history.state?.sheet); // closed, and off its step
await page.goto(base + '#bins'); await page.goto(base + '#bin/bin-env'); await page.goto(base + '#part/p-bme280');
await page.click('#edit'); await page.waitForSelector('.sheet #p-name');
await page.goBack(); await shut(page);
assert.equal(await page.evaluate(() => location.hash), '#part/p-bme280', 'Back went to another page');
assert.equal(await page.textContent('.binhead h2'), 'BME280 (Adafruit)');
assert.equal(await page.evaluate(() => document.querySelector('.app').inert), false, 'the page behind the sheet can be used again');
await page.goBack(); await at('#bin/bin-env');
assert.equal(await page.locator('.sheet').count(), 0);
// closed by Cancel, Escape or a tap outside, a sheet takes its step with it: the next Back leaves the page, and so does ←
for (const how of ['Cancel', 'Escape', 'a tap outside', '←']) {
  await page.goto(base + '#bin/bin-env'); await page.goto(base + '#part/p-bme280');
  await page.click('#edit'); await page.waitForSelector('.sheet #p-name');
  if (how === 'Escape') await page.keyboard.press('Escape'); else if (how === 'a tap outside') await page.mouse.click(5, 5); else await page.click('.sheet #cancel');
  await shut(page);
  if (how === '←') await page.click('#back'); else await page.goBack();
  await at('#bin/bin-env');
}
// Save, then the tag sheet: one step for the two, and Back stops the write waiting for the sticker
await page.goto(base + '#part/p-bme280'); await page.click('#edit'); await page.check('#p-dotag'); await page.click('.sheet #save');
await page.waitForSelector('#tz.wait');
await page.goBack(); await shut(page);
assert.equal(await page.evaluate(() => location.hash), '#part/p-bme280');
assert.equal(await page.evaluate(() => window.__tap()), false, 'the write was still waiting after Back');
await page.goBack(); await at('#bin/bin-env');
// a new bag's tag sheet closed by Back, Escape or a tap outside stops waiting for the sticker and takes no number
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('parts-bin')); d.items.parts['p-back'] = { name: 'Back test', qty: 1, t: Date.now() }; localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' })); });
await page.goto(base + '#part/p-back');
for (const how of ['Back', 'Escape', 'a tap outside']) {
  await page.click('text=Bag tag'); await page.click('.sheet #write'); await page.waitForSelector('#tz.wait');
  if (how === 'Back') await page.goBack(); else if (how === 'Escape') await page.keyboard.press('Escape'); else await page.mouse.click(5, 5);
  await shut(page);
  assert.equal(await page.evaluate(() => location.hash), '#part/p-back', how);
  assert.equal(await page.evaluate(() => window.__tap()), false, `${how}: the write was still waiting`);
  assert.ok(!(await part('p-back')).bag, `${how}: the bag number was taken`);
}
// reloaded with a sheet open (as a phone does with a tab it put away), one Back still leaves the page
await page.goto(base + '#bin/bin-env'); await page.goto(base + '#part/p-bme280'); await page.click('#edit'); await page.waitForSelector('.sheet #p-name');
await page.reload(); await page.waitForSelector('#edit'); await shut(page);
await page.goBack(); await at('#bin/bin-env');
// a part opened in a tab of its own (as a tag does when Parts Bin is closed): after a sheet, its ← goes to Parts
const [solo] = await Promise.all([ctx.waitForEvent('page'), page.evaluate(u => { window.open(u); }, base + '#part/p-scd41')]);
await solo.waitForSelector('#edit');
await solo.click('#edit'); await solo.click('.sheet #cancel'); await shut(solo);
await solo.click('#back'); await solo.waitForFunction(() => location.hash === '#parts');
await solo.close();
// a step back off a closed sheet that never lands (nothing behind it) doesn't hold up opening anything else for long
await page.goto(base + '#part/p-bme280'); await page.evaluate(() => { window.__back = History.prototype.back; History.prototype.back = () => {}; });
await page.click('#edit'); await page.click('.sheet #cancel'); await page.waitForTimeout(2100);
await page.click('#tabbar [data-go="parts"]'); await at('#parts');
await page.evaluate(() => { History.prototype.back = window.__back; });
// a new bin opens its page, and Back from there goes to the page the sheet was on
await page.goto(base + '#bins'); await page.click('#addbin'); await page.fill('#f-code', 'BACK'); await page.click('.sheet #save');
await page.waitForFunction(() => location.hash.startsWith('#bin/') && !document.querySelector('.sheet'));
await page.goBack(); await at('#bins');
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('parts-bin')), t = Date.now() + 1000; d.items.parts['p-back'].del = t; for (const b of Object.values(d.items.bins)) if (b.code === 'BACK') b.del = t; localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' })); });

// ---- a change made in another tab draws the screen again, keeping what's being typed and where the keyboard is (it used to
// empty Pack's description and its matches and the API key being typed, and leave the keyboard nowhere)
const tabB = await ctx.newPage();
await tabB.goto(base + '#part/p-bme280'); await tabB.waitForSelector('#inc');
const bump = async () => { const q = (await part('p-bme280')).qty; await tabB.click('#inc'); await page.waitForFunction(q => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-bme280'].qty === q + 1, q); return q + 1; };
const mark = sel => page.evaluate(sel => { document.querySelector(sel).firstElementChild.dataset.was = '1'; }, sel);
const redrawn = sel => page.waitForFunction(sel => !document.querySelector(sel).querySelector(':scope > [data-was]'), sel);
const keyboard = () => page.evaluate(() => { const a = document.activeElement; return [a.id, a.selectionStart, a.selectionEnd]; });
// Pack: the description, its matches (showing the new count) and the caret
await page.goto(base + '#scan'); await page.fill('#desc', 'bme'); await page.waitForSelector('.matchlist [data-id="p-bme280"]');
await page.evaluate(() => document.getElementById('desc').setSelectionRange(1, 2));
await mark('#main'); let bmeQty = await bump(); await redrawn('#main');
assert.equal(await page.inputValue('#desc'), 'bme');
await page.waitForSelector(`.matchlist [data-id="p-bme280"]:has-text("in stock ${bmeQty}")`);
assert.deepEqual(await keyboard(), ['desc', 1, 2]);
// a count that isn't being typed shows the new one
await page.goto(base + '#part/p-bme280'); await page.waitForSelector('#qv');
await mark('#main'); bmeQty = await bump(); await redrawn('#main');
assert.equal(await page.inputValue('#qv'), String(bmeQty));
// a sheet open over the screen as it's drawn again still hands the keyboard back to the button that opened it
await page.focus('#edit'); await page.keyboard.press('Enter'); await page.waitForSelector('.sheet #p-name');
await mark('#main'); bmeQty = await bump(); await redrawn('#main');
await page.keyboard.press('Escape'); await shut(page);
assert.equal(await page.evaluate(() => document.activeElement.id), 'edit');
// Settings shows none of the inventory, so it isn't drawn again at all: the API key and model being typed stay as they are
await page.goto(base + '#settings'); await page.fill('#ai-key', 'sk-ant-typed-not-saved'); await page.fill('#ai-model', 'claude-typed');
await page.evaluate(() => document.getElementById('ai-model').setSelectionRange(3, 3));
await mark('#tabbar'); await bump(); await redrawn('#tabbar'); // the counts beside it are
assert.equal(await page.inputValue('#ai-key'), 'sk-ant-typed-not-saved'); assert.equal(await page.inputValue('#ai-model'), 'claude-typed');
assert.deepEqual(await keyboard(), ['ai-model', 3, 3]);
// and Save shows what was kept (trimmed, and the usual model for none), Remove key an empty box
await page.fill('#ai-key', '  sk-ant-not-a-real-key  '); await page.fill('#ai-model', ''); await page.click('#ai-save');
await page.waitForSelector('#ai-clear');
assert.equal(await page.inputValue('#ai-key'), 'sk-ant-not-a-real-key'); assert.equal(await page.inputValue('#ai-model'), (await import('../js/ai.js')).DEFAULT_MODEL);
await page.click('#ai-clear'); await page.waitForFunction(() => !document.querySelector('#ai-clear'));
assert.equal(await page.inputValue('#ai-key'), '');
await tabB.close();

// ---- an API key the API refuses (a stand-in for the API, and no real key): it says so, and the part can be typed in
const aiCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await aiCtx.route('https://api.anthropic.com/**', r => (r.request().method() === 'OPTIONS'
  ? r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } })
  : r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) })));
const ai = await aiCtx.newPage();
await ai.goto(base + '#settings');
await ai.fill('#ai-key', 'sk-ant-not-a-real-key'); await ai.click('#ai-save');
await ai.goto(base + '#scan'); await ai.fill('#desc', 'BME280'); await ai.click('#identify');
await ai.waitForSelector('.sheet #p-name');
assert.equal(await ai.textContent('#status'), 'The API key was refused. Check it in Settings.');
assert.equal(await ai.inputValue('#p-name'), 'BME280', 'the part can still be typed in by hand');
await ai.click('.sheet #cancel');
await ai.goto(base + '#bom'); await ai.fill('#bom', '1 SCD41'); await ai.click('#smart');
await ai.waitForSelector('#toast:has-text("The API key was refused")');
await ai.waitForSelector('.bom-summary');
// with nothing in the inventory yet: Parts points at Pack (it used to be "Scan in"), and the Inbox doesn't say every part
// has details
await ai.goto(base + '#parts'); assert.match(await ai.textContent('#main .empty'), /^No parts here yet\. Add one, or use Pack/);
await ai.goto(base + '#inbox'); await ai.waitForSelector('text=Fill in details');
assert.equal(await ai.locator('text=Every part has some details already').count(), 0);
await aiCtx.close();

// ---- in a browser that can't write tags, a bag's tag sheet says tags need Chrome on Android and offers the link to copy.
// (It used to offer Tag Along, which needs NFC too and didn't read the link it was given, and opening it took the number.)
const noNfcCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await noNfcCtx.addInitScript(d => { if (!localStorage.getItem('parts-bin')) localStorage.setItem('parts-bin', d); }, JSON.stringify({ app: 'parts-bin', v: 1, items: { bins: {}, parts: { 'p-loose': { name: 'Loose part', qty: 1, t: 1 } }, projects: {} } }));
await noNfcCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
const noNfc = await noNfcCtx.newPage();
await noNfc.goto(base + '#part/p-loose');
assert.equal(await noNfc.evaluate(() => 'NDEFReader' in window), false);
await noNfc.click('text=Bag tag');
await noNfc.waitForSelector('.sheet #copy');
assert.equal(await noNfc.locator('.sheet a').count(), 0, 'a link out of the tag sheet');
assert.equal(await noNfc.textContent('.sheet #t-status'), 'Tags need Chrome on Android. Open Parts Bin there to write this one, or copy its link.');
assert.match(await noNfc.textContent('.sheet p.muted'), /The number is saved once its link is copied/);
const looseBag = () => noNfc.evaluate(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-loose'].bag);
await noNfc.click('.sheet #done'); assert.ok(!(await looseBag()), 'looking at the sheet took no number');
await noNfc.click('text=Bag tag'); await noNfc.click('.sheet #copy');
await noNfc.waitForSelector('#toast:has-text("Link copied")');
assert.equal(await noNfc.evaluate(() => navigator.clipboard.readText()), base + '#bag/001');
assert.equal(await looseBag(), 1, 'copying the link took the number');
await noNfcCtx.close();

// ---- a backup saved late in the evening is named for that day, not the next one (as it is in UTC)
const tzCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/New_York', acceptDownloads: true });
const tz = await tzCtx.newPage();
await tz.goto(base + '#settings');
await tz.clock.setFixedTime(new Date('2026-10-14T02:30:00Z')); // 22:30 on 13 October in New York
const [backup] = await Promise.all([tz.waitForEvent('download'), tz.click('#exp')]);
assert.equal(backup.suggestedFilename(), 'parts-bin-2026-10-13.json');
await tzCtx.close();

// ---- every control has a name a screen reader can say, a sheet is named by its heading, and toasts are announced
const named = async (hash, role, name) => { await page.goto(base + hash); assert.equal(await page.getByRole(role, { name, exact: true }).count(), 1, `${hash}: a ${role} called "${name}"`); };
await named('#parts', 'searchbox', 'Search'); await named('#parts', 'combobox', 'Category');
await named('#bin/box-move', 'combobox', 'Unpack into'); await named('#bom', 'combobox', 'Saved BOMs');
await named('#scan', 'combobox', 'Packing into'); await named('#part/p-scd41', 'spinbutton', 'Quantity');
await page.click('#edit');
assert.equal(await page.getByRole('dialog', { name: 'Edit part' }).count(), 1);
await page.click('.sheet #save');
await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent === 'Saved');
// a sheet keeps the keyboard while it's open, and hands it back to the button that opened it
await page.focus('#edit'); await page.keyboard.press('Enter'); await page.waitForSelector('.sheet #save');
await page.focus('.sheet #save'); await page.keyboard.press('Tab');
assert.ok(await page.evaluate(() => !document.activeElement.closest('.app, #tabbar, .jd-foot, .mobile-cloud')), 'Tab went behind the sheet');
await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.sheet'));
assert.equal(await page.evaluate(() => document.activeElement.id), 'edit', 'the keyboard is back on Edit');

// ---- a file with a change time no date can hold loads, and the inventory still shows (it used to vanish)
const farFile = join(tmp, 'far.json');
await writeFile(farFile, JSON.stringify({ app: 'parts-bin', v: 1, items: { parts: { 'p-far': { name: 'From the far future', qty: 1, t: 9e15 } } } }));
await page.goto(base + '#settings');
const [chooser3] = await Promise.all([page.waitForEvent('filechooser'), page.click('#imp')]);
await chooser3.setFiles(farFile);
await page.waitForSelector('text=Loaded: 1 item');
await page.goto(base + '#parts'); await page.reload();
await page.waitForSelector('.item:has-text("BME280 (Adafruit)")'); await page.waitForSelector('.item:has-text("From the far future")');

// ---- the buttons tapped over and over while counting and unpacking are big enough for a thumb (44 px)
const big = async sel => { const b = await page.locator(sel).first().boundingBox(); assert.ok(b.width >= 44 && b.height >= 44, `${sel} is ${b.width}×${b.height}`); };
await page.goto(base + '#part/p-bme280'); await big('#dec'); await big('#inc');
await page.goto(base + '#bin/box-move'); await big('button[aria-label$="to the chosen bin"]');

// ---- a box's printed packing list says Parts Bin, and the site's footer and Drive button stay off the paper
await page.evaluate(() => { window.print = () => {}; });
await page.click('#print');
assert.match(await page.textContent('#print-root .sub'), / · Parts Bin, /);
await page.emulateMedia({ media: 'print' });
assert.deepEqual(await page.evaluate(() => ['.app', '.jd-foot', '.mobile-cloud'].map(s => getComputedStyle(document.querySelector(s)).display)), ['none', 'none', 'none']);
await page.emulateMedia({ media: 'screen' });

// ---- when the clipboard says no, Copy list and Copy shopping list show the text to copy by hand
await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')); });
await page.click('.pagehead #copy');
await page.waitForSelector('.sheet textarea');
assert.match(await page.inputValue('.sheet textarea'), /^Moved part 03 ×1\n/);
await page.click('.sheet #done');
await page.goto(base + '#bom'); await page.click('#out #copy');
await page.waitForSelector('.sheet textarea');
assert.equal(await page.inputValue('.sheet textarea'), '0.2 × m heat shrink tubing 3mm');
await page.click('.sheet #done');
await page.reload(); // the pretend clipboard again

// ---- photo ids from the Stockroom artifact (its photos stayed on claude.ai) show the icon, or the reference photo
const blobs = []; page.on('request', r => { if (r.url().includes('/_blob/')) blobs.push(r.url()); });
await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('parts-bin')); d.items.bins['bin-env'].photo = 'asset-abc123'; d.items.parts['p-scd41'].photo = 'asset-def456'; localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' })); });
await page.goto(base + '#bins'); await page.waitForSelector('.bin:has-text("Environmental") .photo svg');
await page.goto(base + '#part/p-scd41'); await page.waitForFunction(() => document.querySelector('.binhead .refphoto img.ref')?.naturalWidth > 0);
assert.deepEqual(blobs, [], 'asked this site for a photo it can’t have');
const desk = await browser.newPage({ viewport: { width: 1280, height: 820 } });
await desk.goto(base);

// ---- works offline once it has been opened: the inventory, the screens and the fonts, with no network at all
const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const off = await offCtx.newPage();
off.problems = [];
off.on('pageerror', e => off.problems.push(e.message));
off.on('console', m => { if (m.type() === 'error') off.problems.push(m.text()); });
await off.goto(base);
await off.evaluate(v => localStorage.setItem('parts-bin', v), await page.evaluate(() => localStorage.getItem('parts-bin')));
await off.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
await offCtx.setOffline(true);
await off.reload();
await off.waitForSelector('.bin:has-text("Environmental")');
await off.goto(base + '#part/p-bme280'); await off.waitForSelector('h2:has-text("BME280")');
await off.evaluate(() => document.fonts.ready);
assert.ok(await off.evaluate(() => document.fonts.check('600 24px "Barlow Condensed"') && document.fonts.check('16px Barlow')), 'the fonts came from the offline copy');
await offCtx.setOffline(false);
for (const p of [page, laptop.page, other.page, off]) assert.deepEqual(p.problems, [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');

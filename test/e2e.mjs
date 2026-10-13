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
  // sharing with Claude: the phone's share sheet, or the clipboard anywhere else
  navigator.share = async d => { window.__shared = d.text; };
  if (navigator.clipboard) navigator.clipboard.writeText = async t => { window.__shared = t; };
};

const g = fakeGoogle();
const browser = await pw.chromium.launch();
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
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

// ---- Parts → + Part: a new part goes into a new bag and is tagged on save
await page.goto(base + '#parts');
await page.click('#addp');
await page.fill('#p-name', 'M3 heat-set inserts');
await page.fill('#p-qty', '50');
assert.ok(await page.isChecked('#p-dotag'));
assert.equal(await page.textContent('#p-bagshow'), '#003');
assert.equal(await page.textContent('.sheet #save'), 'Save & tag');
await page.screenshot({ path: join(root, 'docs/phone-add.png') });
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
await page.evaluate(() => document.querySelector('#cloud-m').click());
await page.waitForFunction(() => JSON.parse(localStorage.getItem('parts-bin')).items.parts['p-scd41'].qty === 4, null, { timeout: 8000 });

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

// ---- unpacking a box: the bin picked under Unpack into stays picked from bag to bag, and the page keeps its place
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('parts-bin')), t = Date.now();
  d.items.bins['box-move'] = { code: 'BOX 02', kind: 'box', name: 'Bench', location: 'Moving boxes', t };
  for (let i = 1; i <= 12; i++) d.items.parts['p-move' + i] = { name: 'Moved part ' + String(i).padStart(2, '0'), qty: 1, unit: 'pcs', binId: 'box-move', tags: [], t };
  localStorage.setItem('parts-bin', JSON.stringify(d)); dispatchEvent(new StorageEvent('storage', { key: 'parts-bin' }));
});
await page.goto(base + '#bin/box-move');
await page.selectOption('#unpack-to', 'bin-env');
await page.evaluate(() => window.scrollTo(0, 200));
const moveButtons = () => page.locator('button[aria-label="Move to chosen bin"]');
await moveButtons().first().click();
await page.waitForFunction(() => document.querySelectorAll('button[aria-label="Move to chosen bin"]').length === 11);
assert.equal(await page.inputValue('#unpack-to'), 'bin-env', 'the bin picked is still picked');
assert.equal(await page.evaluate(() => scrollY), 200, 'the page kept its place');
await moveButtons().first().click();
await page.waitForFunction(() => document.querySelectorAll('button[aria-label="Move to chosen bin"]').length === 10);
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

// ---- a bag number is a whole number from 1 up (a tag for "-5" would open no bag)
await page.click('#edit');
for (const v of ['-5', '0', '2.5']) {
  await page.evaluate(() => { document.getElementById('toast').hidden = true; });
  await page.fill('#p-bag', v); await page.click('.sheet #save');
  await page.waitForSelector('#toast:has-text("whole number")');
  assert.ok(await page.$('.sheet #p-bag'), 'the sheet stays open'); assert.equal((await spare()).bag, 4, 'bag ' + v + ' wasn’t saved');
}
await page.click('.sheet #cancel');

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
await aiCtx.close();
const desk = await browser.newPage({ viewport: { width: 1280, height: 820 } });
await desk.goto(base);

await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 5000 }).catch(() => {});
for (const p of [page, laptop.page]) assert.deepEqual(p.problems, [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');

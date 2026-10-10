// Batches from Claude: reading a link, keeping only what's safe, and what a suggestion changes.  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as IN from '../js/inbox.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const batch = items => ({ partsbin: 1, batch: { name: 'Test', source: 'photo', items } });

test('a batch survives the trip through a link, a bare code and plain JSON', async () => {
  const raw = batch([{ name: 'BME280 breakout', qty: 5, iface: ['I2C'], addr: '0x76, 0x77' }]);
  const code = await IN.encode(raw);
  assert.ok(IN.isCode(code));
  for (const text of ['https://junkdrawer.works/parts-bin/#' + code, code, '  #' + code + '\n', JSON.stringify(raw)]) assert.deepEqual(await IN.read(text), raw);
  for (const stray of ['.', ')', '%3D', ' and then some words']) assert.deepEqual(await IN.read('https://junkdrawer.works/parts-bin/#' + code + stray), raw, 'a character picked up with the link: ' + stray);
  for (const junk of ['', 'hello', 'https://junkdrawer.works/parts-bin/#bag/001', 'p1z!!!!', IN.PREFIX + 'AAAAAAAAAAAA']) await assert.rejects(IN.read(junk));
});

test('cleaning keeps the known fields, cut to size, and nothing else', () => {
  const b = IN.cleanBatch(batch([
    { name: '  TCA9548A   mux ', qty: '2', iface: 'iic, QWIIC, spi', tags: ['Generic', 'generic'], link: 'https://example.com/p', img: 'javascript:alert(1)', onclick: 'x', html: '<img src=x onerror=alert(1)>', check: 'x'.repeat(900) },
    { id: 'p-scd41', volts: '2.4–5.5 V', img: 'http://plain.example/a.png', match: 'ignored when there is an id?' },
    { junk: true }, 'nope', null, { id: 'bad id with spaces' },
  ]));
  assert.equal(b.items.length, 2);
  const [a, c] = b.items;
  assert.deepEqual({ ...a, check: undefined }, { name: 'TCA9548A mux', iface: ['I2C', 'SPI'], link: 'https://example.com/p', tags: ['generic'], qty: 2, k: 'i0', check: undefined });
  assert.equal(a.check.length, 300);
  assert.deepEqual(c, { volts: '2.4–5.5 V', id: 'p-scd41', k: 'i1' });
  assert.equal(IN.cleanBatch({ batch: { items: [{ name: 'x' }] } }), null, 'no partsbin marker');
  assert.equal(IN.cleanBatch(batch([{ junk: 1 }])), null, 'nothing usable');
  assert.equal(IN.httpsUrl('https://cdn-shop.adafruit.com/a.jpg'), 'https://cdn-shop.adafruit.com/a.jpg');
  for (const bad of ['http://a.bc/d', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'https://localhost/x', 'https://192.168.1.1/a.png', 'https://127.1/', '//a.bc/d', 'a.bc/d']) assert.equal(IN.httpsUrl(bad), '', bad);
  for (const [qty, want] of [['', undefined], [' ', undefined], ['abc', undefined], [-1, undefined], ['0', 0], [' 12 ', 12], [2.5, 2.5]]) assert.equal(IN.cleanItem({ name: 'x', qty }).qty, want, 'count ' + JSON.stringify(qty));
});

test('a code can’t unpack into something enormous', async () => {
  const big = await IN.encode({ partsbin: 1, batch: { items: [{ name: 'x', notes: 'a'.repeat(3_000_000) }] } });
  assert.ok(big.length < 20_000);
  await assert.rejects(IN.read(big), /too long/);
});

test('a suggestion shows only what would change, and adds to notes and tags instead of replacing them', () => {
  const part = { name: 'SCD41', category: 'Sensors', notes: 'True CO2 · Ideas: CO2 canary', tags: ['generic'], iface: ['I2C'], mpn: '' };
  const d = IN.diff(part, { id: 'p', category: 'Sensors', iface: ['I2C'], mpn: 'SCD41', addr: '0x62', notes: 'Photoacoustic', tags: ['generic', 'qwiic'] });
  assert.deepEqual(d.map(r => r.k), ['mpn', 'addr', 'tags', 'notes']);
  assert.equal(d.find(r => r.k === 'notes').to, 'True CO2 · Ideas: CO2 canary · Photoacoustic');
  assert.deepEqual(d.find(r => r.k === 'tags').to, ['generic', 'qwiic']);
  assert.deepEqual(IN.diff(part, { id: 'p', notes: 'true co2', tags: ['generic'], category: 'Sensors' }), [], 'already says all of it');
  assert.deepEqual(IN.diff({ link: 'https://adafruit.com' }, { id: 'p', link: IN.httpsUrl('https://adafruit.com') }), [], 'the same address with a slash added isn’t a change');
});

test('a finished batch is remembered, so its link can’t add it twice', () => {
  const st = IN.clean(null), b = IN.cleanBatch(batch([{ name: 'A' }, { name: 'B' }]));
  assert.equal(IN.addBatch(st, b), 'added');
  assert.equal(IN.addBatch(st, b), 'open');
  assert.equal(IN.count(st), 2);
  IN.resolve(st, b.id, ['i0']); assert.equal(IN.count(st), 1);
  IN.resolve(st, b.id, ['i1']); assert.equal(st.batches.length, 0);
  assert.equal(IN.addBatch(st, b), 'used');
  assert.equal(IN.addBatch(st, b, { again: true }), 'added');
  assert.deepEqual(IN.clean(JSON.parse(JSON.stringify(st))), st, 'the saved copy reads back the same');
  assert.deepEqual(IN.clean({ batches: [{ id: 'x', items: [{ k: 1 }] }, 'junk'], seen: 'no' }), { batches: [], seen: {} });
  // what's read back from storage is cleaned like anything else
  const back = IN.clean({ batches: [{ id: 'x', source: 'nope', items: [{ k: 'i0', name: 'A', img: 'javascript:alert(1)', extra: 1 }, { k: 'evil"', name: 'B' }] }], seen: {} });
  assert.deepEqual(back.batches[0].items, [{ name: 'A', k: 'i0' }]); assert.equal(back.batches[0].source, 'list');
  // a full inbox turns the next batch away instead of pushing one out
  const full = IN.clean(null);
  for (let i = 0; i < 20; i++) assert.equal(IN.addBatch(full, IN.cleanBatch({ partsbin: 1, batch: { id: 'b' + i, items: [{ name: 'P' + i }] } })), 'added');
  assert.equal(IN.addBatch(full, IN.cleanBatch({ partsbin: 1, batch: { id: 'b20', items: [{ name: 'late' }] } })), 'full');
  assert.equal(full.batches.length, 20); assert.equal(full.batches.at(-1).id, 'b0');
  assert.equal(IN.addBatch(IN.clean(null), IN.cleanBatch({ partsbin: 1, batch: { id: '__proto__', items: [{ name: 'x' }] } })), 'added');
});

// The Claude skill builds links with a Python script kept in its SKILL.md. What it writes has to open here.
test('a link from the skill’s script opens in the app', t => {
  const md = readFileSync(join(root, 'skill/parts-bin-cataloger/SKILL.md'), 'utf8');
  const py = /## Appendix: make_partsbin\.py\s+```python\n([\s\S]*?)\n```/.exec(md)?.[1];
  assert.ok(py, 'the script is in the skill');
  try { execFileSync('python3', ['--version']); } catch { return t.skip('no python3 here'); }
  const dir = mkdtempSync(join(tmpdir(), 'pb-skill-'));
  writeFileSync(join(dir, 'make_partsbin.py'), py);
  writeFileSync(join(dir, 'inv.json'), JSON.stringify({ app: 'parts-bin', v: 1, items: { bins: { b1: { code: 'ENV', name: 'Environmental', t: 1 } }, projects: {}, parts: {
    'p-scd41': { name: 'SCD41', category: 'Sensors', qty: 3, binId: 'b1', tags: [], t: 1 }, 'p-gone': { name: 'Deleted', t: 1, del: 2 } } } }));
  writeFileSync(join(dir, 'batch.json'), JSON.stringify({ name: 'From the script', source: 'photo', bin: 'ENV', parts: [
    { name: 'SCD41 CO2 sensor', qty: 3, match: 'p-scd41', iface: 'iic', addr: '0x62', unsure: 'label torn' },
    { name: 'TCA9548A I2C multiplexer', qty: 2, img: 'https://cdn-shop.adafruit.com/x.jpg', link: 'http://not-https.example/' },
    { id: 'p-scd41', category: 'Sensors', volts: '2.4–5.5 V' }, { id: 'p-gone', volts: '5 V' }, { id: 'p-scd41', logic: '3.3 V', volts: 'ignored: the first one wins' },
    { name: 'M3 x 8 screw', qty: 50 }, { name: 'M3 x 6 screw', qty: 20 }, { name: 'm3 X 6  screw', qty: 5 },
  ] }));
  const out = execFileSync('python3', [join(dir, 'make_partsbin.py'), join(dir, 'batch.json'), '--inventory', join(dir, 'inv.json'), '--out', dir], { encoding: 'utf8' });
  const link = /^Link .*?: (https:\/\/\S+)$/m.exec(out)?.[1];
  assert.ok(link, out);
  assert.match(out, /isn’t an https address/); assert.match(out, /p-gone isn’t in the inventory/);
  return IN.read(link).then(raw => {
    const b = IN.cleanBatch(raw);
    assert.equal(b.bin, 'ENV'); assert.equal(b.source, 'photo');
    assert.deepEqual(b.items.map(({ k, ...x }) => x), [
      { name: 'SCD41 CO2 sensor', iface: ['I2C'], addr: '0x62', check: 'label torn', match: 'p-scd41', qty: 3 },
      { name: 'TCA9548A I2C multiplexer', img: 'https://cdn-shop.adafruit.com/x.jpg', qty: 2 },
      { volts: '2.4–5.5 V', logic: '3.3 V', id: 'p-scd41' },
      { name: 'M3 x 8 screw', qty: 50 }, { name: 'M3 x 6 screw', qty: 25 },
    ]);
    const file = /^File: (.+)$/m.exec(out)[1];
    assert.deepEqual(IN.cleanBatch(JSON.parse(readFileSync(file, 'utf8'))), b, 'the file holds the same batch as the link');
  });
});

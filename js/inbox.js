// Batches from Claude: parts read off a photo, a receipt or a web page, and details suggested for parts already here.
// A batch arrives as a link (…/parts-bin/#p1z…), a pasted code, or a file, and waits in the Inbox. Nothing in one
// reaches the inventory until it's accepted there. No page code in this file, so tests run it in Node.
//
// { partsbin: 1, batch: { id, name, made, source, bin, items: [item] } }
// An item with an `id` that's in the inventory suggests changes to that part. Any other item is something to bag:
// a new part, or (with `match`) one that's already listed.

export const PREFIX = 'p1z';
export const KEY = 'parts-bin.inbox';
const MAX_ITEMS = 400, MAX_BATCHES = 20, MAX_BYTES = 2_000_000;
const SOURCES = ['photo', 'receipt', 'link', 'list', 'details'];

// What a batch may say about a part, and how the Inbox names each one.
export const LABELS = {
  name: 'Name', category: 'Category', mpn: 'Part number', iface: 'Interface', addr: 'I2C address', volts: 'Supply',
  logic: 'Logic level', link: 'Link', img: 'Reference photo', tags: 'Tags', notes: 'Notes', check: 'To check',
};
export const FIELDS = Object.keys(LABELS);

const IFACE = {
  i2c: 'I2C', iic: 'I2C', twi: 'I2C', qwiic: 'I2C', 'stemma qt': 'I2C', spi: 'SPI', uart: 'UART', serial: 'UART', ttl: 'UART',
  '1-wire': '1-Wire', onewire: '1-Wire', '1wire': '1-Wire', i2s: 'I2S', analog: 'Analog', adc: 'Analog', digital: 'Digital', gpio: 'Digital',
  pwm: 'PWM', usb: 'USB', can: 'CAN', 'rs-485': 'RS-485', rs485: 'RS-485', 'rs-232': 'RS-232', rs232: 'RS-232', pdm: 'PDM',
};

const idOk = v => typeof v === 'string' && /^[\w.:@+~-]{1,80}$/.test(v);
const str = (v, n) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).replace(/\s+/g, ' ').trim().slice(0, n) : '');
const list = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;/]/) : []);
// Links and photos are only ever https to a named site, so a batch can't hand the page a script, a file, or an
// address on the home network.
export function httpsUrl(v) {
  const s = str(v, 800); if (!s) return '';
  try { const u = new URL(s); return u.protocol === 'https:' && /\.[a-z]{2,}$/i.test(u.hostname) ? u.href : ''; } catch { return ''; }
}
export function ifaces(v) {
  const out = [];
  for (const x of list(v)) { const s = str(x, 14); if (!s) continue; const k = IFACE[s.toLowerCase()] || s; if (!out.includes(k)) out.push(k); }
  return out.slice(0, 6);
}
const tags = v => [...new Set(list(v).map(x => str(x, 30).toLowerCase()).filter(Boolean))].slice(0, 8);

// Keeps what a batch handed us to the fields above, each cut to size. Anything else is dropped.
export function cleanItem(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out = {
    name: str(x.name, 120), category: str(x.category, 40), mpn: str(x.mpn, 60), iface: ifaces(x.iface), addr: str(x.addr, 40),
    volts: str(x.volts, 28), logic: str(x.logic, 28), link: httpsUrl(x.link), img: httpsUrl(x.img), tags: tags(x.tags),
    notes: str(x.notes, 400), check: str(x.check ?? x.unsure, 300), unit: str(x.unit, 12),
  };
  if (idOk(x.id)) out.id = x.id;
  if (idOk(x.match)) out.match = x.match;
  const q = typeof x.qty === 'string' ? (/^\s*\d+(\.\d+)?\s*$/.test(x.qty) ? Number(x.qty) : null) : x.qty;
  if (typeof q === 'number' && Number.isFinite(q) && q >= 0 && q < 1e6) out.qty = q;
  if (x.add === true || x.add === false) out.add = x.add;
  for (const k of Object.keys(out)) if (out[k] === '' || (Array.isArray(out[k]) && !out[k].length)) delete out[k];
  if (!out.id && !out.name) return null; // nothing to show
  return out;
}

export function cleanBatch(raw) {
  const b = raw && typeof raw === 'object' && raw.partsbin && raw.batch && typeof raw.batch === 'object' ? raw.batch : null;
  if (!b || !Array.isArray(b.items)) return null;
  const items = b.items.slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean).map((x, i) => ({ ...x, k: 'i' + i }));
  if (!items.length) return null;
  const source = SOURCES.includes(b.source) ? b.source : 'list';
  return { id: idOk(b.id) ? b.id : 'b' + hash(JSON.stringify(items)), name: str(b.name, 120), made: str(b.made, 10), source, bin: str(b.bin, 24), items };
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }

// ---- reading a link, a code or a file's text
const b64url = {
  toBytes(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; },
  fromBytes(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
};
// Stops as soon as the result passes the limit, so a small code can't unpack into something enormous.
async function pipe(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.length; if (n > limit) { reader.cancel().catch(() => {}); throw new Error('too long'); }
    chunks.push(value);
  }
  const out = new Uint8Array(n); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
export async function encode(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  return PREFIX + b64url.fromBytes(await pipe(raw, new CompressionStream('deflate-raw')));
}
// Takes the whole link, just the code, or the JSON itself. Throws if it's none of them.
export async function read(text) {
  text = String(text || '').trim();
  if (text.length > MAX_BYTES) throw new Error('too long');
  if (text.startsWith('{')) return JSON.parse(text);
  // the code is everything after the marker up to the first character that can't be part of one,
  // so a full stop or bracket picked up with the link doesn't spoil it
  const m = new RegExp('(?:^|#)(' + PREFIX + '[A-Za-z0-9_-]{8,})').exec(text);
  if (!m) throw new Error('not a Parts Bin code');
  const bytes = await pipe(b64url.toBytes(m[1].slice(PREFIX.length)), new DecompressionStream('deflate-raw'), MAX_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes));
}
export const isCode = text => new RegExp('^#?' + PREFIX + '[A-Za-z0-9_-]{8,}$').test(String(text || '').trim());

// ---- what an item would change on a part
const same = (a, b) => (Array.isArray(a) || Array.isArray(b) ? (a || []).join('|') === (b || []).join('|') : String(a ?? '') === String(b ?? ''));
// Notes and tags are added to, never replaced: the notes hold the person's own ideas for the part.
export function proposed(part, item, k) {
  const v = item[k];
  if (k === 'notes') { const old = String(part.notes || ''); return !old ? v : old.toLowerCase().includes(String(v).toLowerCase()) ? old : (old + ' · ' + v).slice(0, 4000); }
  if (k === 'tags') return [...new Set([...(part.tags || []), ...v])];
  return v;
}
export function diff(part, item) {
  const out = [];
  for (const k of FIELDS) {
    if (item[k] == null) continue;
    const to = proposed(part, item, k);
    if ((k === 'link' || k === 'img') && httpsUrl(part[k]) === to) continue; // the same address, written slightly differently
    if (!same(part[k], to)) out.push({ k, label: LABELS[k], from: part[k] ?? '', to });
  }
  return out;
}
export const show = v => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));

// ---- the waiting batches, kept in this browser
const blank = () => ({ batches: [], seen: {} });
export function clean(st) {
  const out = blank();
  if (!st || typeof st !== 'object') return out;
  for (const b of Array.isArray(st.batches) ? st.batches.slice(0, MAX_BATCHES) : []) {
    if (!b || !idOk(b.id) || !Array.isArray(b.items)) continue;
    const items = b.items.slice(0, MAX_ITEMS).map(x => { const c = x && typeof x.k === 'string' && /^i\d+$/.test(x.k) ? cleanItem(x) : null; return c && { ...c, k: x.k }; }).filter(Boolean);
    if (items.length) out.batches.push({ id: b.id, name: str(b.name, 120), made: str(b.made, 10), source: SOURCES.includes(b.source) ? b.source : 'list', bin: str(b.bin, 24), at: Number.isFinite(+b.at) ? +b.at : 0, items });
  }
  if (st.seen && typeof st.seen === 'object') for (const [k, v] of Object.entries(st.seen).slice(-200)) if (idOk(k) && Number.isFinite(+v)) out.seen[k] = +v;
  return out;
}
export function loadInbox() { try { return clean(JSON.parse(localStorage.getItem(KEY))); } catch { return blank(); } }
export function saveInbox(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); return true; } catch { return false; } }
// 'added', 'open' (already waiting here, left as it is), 'used' (finished before; loaded again only if asked),
// or 'full' (too many waiting; nothing is pushed out to make room).
export function addBatch(st, batch, { again = false } = {}) {
  if (st.batches.some(b => b.id === batch.id)) return 'open';
  if (Object.hasOwn(st.seen, batch.id) && !again) return 'used';
  if (st.batches.length >= MAX_BATCHES) return 'full';
  st.batches.unshift({ ...batch, at: Date.now() });
  return 'added';
}
// Takes finished items out. A batch with nothing left goes too, and is remembered so its link can't add it twice.
export function resolve(st, batchId, keys) {
  const b = st.batches.find(x => x.id === batchId); if (!b) return;
  b.items = keys ? b.items.filter(x => !keys.includes(x.k)) : [];
  if (!b.items.length) { st.batches = st.batches.filter(x => x !== b); st.seen[batchId] = Date.now(); }
}
export const count = st => st.batches.reduce((n, b) => n + b.items.length, 0);

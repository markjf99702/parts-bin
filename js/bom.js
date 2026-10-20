// BOM check: reading a pasted parts list, and finding each line in the inventory. Search uses norm() too.
// No page code, so tests run it in Node.

// Lower case, with anything but letters, digits, dots and plus signs read as a space: "ESP32-S3" is "esp32 s3".
export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9.+]+/g, ' ').trim();

// One part per line (or per ;), with its count first or last: "2x XIAO ESP32-S3", "SCD41 ×1". Lines starting with # are
// skipped, and a bullet in front is dropped. A name can start with a digit (1N4148, 74HC595, 18650 cells), so each way of
// writing a count says which side the count is on, and a marked count (2x, x8, ×2, ", 5") is believed before a bare
// number at the start: "18650 cells ×2" is two 18650 cells.
const N = '(\\d+(?:\\.\\d+)?)';
const COUNTS = [ // [pattern, the count's group, the name's group]
  [new RegExp(`^${N}\\s*[x×*]\\s+(.+)$`, 'i'), 1, 2], // 2x name, 2 x name
  [new RegExp(`^(.+?)\\s+[x×*]\\s*${N}$`, 'i'), 2, 1], // name x8, name × 2
  [new RegExp(`^(.+?)\\s*[,\\t]\\s*${N}$`), 2, 1], // name, 5 (or a tab, from a spreadsheet)
  [new RegExp(`^${N}\\s+(.+)$`), 1, 2], // 3 name
  [new RegExp(`^(.+?)[x×*]\\s*${N}$`, 'i'), 2, 1], // name×2
];
export function parseBom(text) {
  return String(text || '').split(/\n|;/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => l.replace(/^[-•*]\s*/, '')).filter(Boolean).map(l => {
    for (const [re, q, n] of COUNTS) { const m = re.exec(l); if (m) return { qty: Number(m[q]), name: m[n].trim() }; }
    return { qty: 1, name: l };
  });
}

// A part number is a word with letters and digits, four characters or more: SCD41, 1N4148, ESP32, 3.3V. A number with a
// unit isn't one (100uF, 40pin, 1000mAh, 2.54mm): those are written so many ways ("40pin", "40 pin") that they can't rule a
// part out. A voltage is one, though, since a 3.3V regulator isn't a 5V one. Takes a word from norm().
const UNIT = /^\d+(\.\d+)?[a-z]+$/, VOLTS = /^\d+(\.\d+)?v$/;
export const isPartNumber = w => w.length >= 4 && /[a-z]/.test(w) && /\d/.test(w) && (!UNIT.test(w) || VOLTS.test(w));

// The part a line most likely means: the one whose name, part number and tags hold the most of the line's words, counted
// by length, with part numbers counted twice. A line that names a part number only matches a part that has one of them,
// and a part that has one always matches, at a share of at least 0.6: "SCD41 breakout" is the SCD41, and "BME280
// breakout" isn't a BMP280 breakout. A line of plain words needs at least half of them. conf is the share.
export function matchPart(name, parts) {
  const t = norm(name).split(' ').filter(w => w.length > 1); if (!t.length) return null;
  const weight = w => (isPartNumber(w) ? 2 : 1) * w.length, all = t.reduce((n, w) => n + weight(w), 0);
  const numbered = t.some(isPartNumber);
  let best = null, bs = 0;
  for (const p of parts) {
    const hay = norm([p.name, p.mpn, (p.tags || []).join(' ')].join(' '));
    let s = 0, shared = false;
    for (const w of t) if (hay.includes(w)) { s += weight(w); if (isPartNumber(w)) shared = true; }
    const cov = s / all;
    if (numbered ? !shared : cov < 0.5) continue;
    if (cov > bs) { bs = cov; best = p; }
  }
  return best ? { p: best, conf: numbered ? Math.max(bs, 0.6) : bs } : null;
}

// How many more a line needs than there are, to the thousandth: 0.3 m wanted with 0.1 m in stock is short 0.2 (plain
// subtraction says 0.19999999999999998).
export const shortBy = (need, have) => Math.round((need - have) * 1000) / 1000;

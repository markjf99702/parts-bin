// BOM check: reading a pasted parts list, and finding each line in the inventory. Search uses norm() too.
// No page code, so tests run it in Node.

// Lower case, with anything but letters, digits, dots and plus signs read as a space: "ESP32-S3" is "esp32 s3".
export const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9.+]+/g, ' ').trim();

// One part per line (or per ;), with its count first or last: "2x XIAO ESP32-S3", "SCD41 ×1". Lines starting with # are skipped.
export function parseBom(text) {
  return String(text || '').split(/\n|;/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    let qty = 1, name = l;
    const mm = l.match(/^(\d+(?:\.\d+)?)\s*[x×*]?\s+(.+)$/i) || l.match(/^(.+?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i) || l.match(/^(.+?)\s*[,\t]\s*(\d+(?:\.\d+)?)$/);
    if (mm) { if (/^\d/.test(mm[1])) { qty = Number(mm[1]); name = mm[2]; } else { qty = Number(mm[2]); name = mm[1]; } }
    return { qty, name: name.replace(/^[-•*]\s*/, '').trim() };
  });
}

// The part a line most likely means: the one whose name, part number and tags hold the most of the line's words
// (counted by length), as long as that's at least half. conf is that share.
export function matchPart(name, parts) {
  const t = norm(name).split(' ').filter(w => w.length > 1); if (!t.length) return null;
  let best = null, bs = 0;
  for (const p of parts) {
    const hay = norm([p.name, p.mpn, (p.tags || []).join(' ')].join(' '));
    let s = 0; for (const w of t) { if (hay.includes(w)) s += w.length; }
    const cov = s / t.join('').length;
    if (cov > bs && cov >= 0.5) { bs = cov; best = p; }
  }
  return best ? { p: best, conf: bs } : null;
}

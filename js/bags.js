// Bag numbers across the inventory: which are on more than one part, which below the highest are on none, and which
// part a bag's tag opens. No page code, so tests run it in Node.
//
// A device hands out the next bag number from the parts it holds. Two devices numbering bags before they've synced can
// give out the same number, and the merge (model.js) keeps both parts, so a clash is shown until one is renumbered.

const GAP_LIMIT = 100000; // a mistyped bag 999999 shouldn't make the gap list run on for ever

// A part's bag number, or 0 if it has none (or one no tag could open).
export function bagOf(p) {
  if (!p || p.bag === '' || p.bag == null) return 0;
  const n = Number(p.bag);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

// The bag's tag was written onto this part, so its sticker carries the number: it keeps it, and comes first.
const order = ps => ps.slice().sort((a, b) => Number(!!b.tagWritten) - Number(!!a.tagWritten));

export function byBag(parts) {
  const m = new Map();
  for (const p of parts) {
    const n = bagOf(p);
    if (!n) continue;
    if (!m.has(n)) m.set(n, []);
    m.get(n).push(p);
  }
  return m;
}

// [[number, [part, …]], …] for each number on more than one part, in number order, the tagged part first in each.
export function clashes(parts) {
  return [...byBag(parts)].filter(([, ps]) => ps.length > 1).sort((a, b) => a[0] - b[0]).map(([n, ps]) => [n, order(ps)]);
}

// Numbers from 1 up to the highest in use that no part has.
export function gaps(parts) {
  const m = byBag(parts);
  let max = 0;
  for (const n of m.keys()) if (n > max) max = n;
  const out = [];
  for (let n = 1; n < Math.min(max, GAP_LIMIT); n++) if (!m.has(n)) out.push(n);
  return out;
}

// The part a tag for bag n opens: the one whose tag was written, if bag n is on more than one.
export function opens(parts, n) {
  return order(byBag(parts).get(Number(n)) || [])[0] || null;
}

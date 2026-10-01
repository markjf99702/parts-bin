// The inventory as one document, and how two copies of it merge. No page code, so tests run it in Node.
//
// { app: 'parts-bin', v: 1, items: { bins: {id: bin}, parts: {id: part}, projects: {id: project} } }
// Every item carries t (when it last changed, ms) and, once deleted, del (when). Deleted items keep their
// details so a deletion on one device reaches the others instead of the item coming back from their copy.
// Merging goes item by item: the newer version wins, and a deletion wins over anything older than it.
export const APP = 'parts-bin';
export const KINDS = ['bins', 'parts', 'projects'];

const idOk = id => typeof id === 'string' && /^[\w.:@+~-]{1,80}$/.test(id);
const tOk = t => (Number.isFinite(+t) && +t >= 0 ? Math.floor(+t) : 0);

export const blankDoc = () => ({ app: APP, v: 1, items: { bins: {}, parts: {}, projects: {} } });
export const gone = x => !!(x && x.del && x.del >= (x.t || 0));
export const stamp = old => Math.max(Date.now(), (old?.t || 0) + 1, (old?.del || 0) + 1);

export function newId() {
  const b = new Uint8Array(8); globalThis.crypto.getRandomValues(b);
  return [...b].map(x => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
}

// Keeps what a page or a file handed us to plain JSON fields, and drops anything malformed.
export function cleanItem(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out = {};
  for (const [k, v] of Object.entries(x)) {
    if (k === 'id' || typeof k !== 'string' || k.length > 40) continue;
    if (v == null) continue;
    if (['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 4000) : v;
    else if (Array.isArray(v)) out[k] = v.filter(s => typeof s === 'string').slice(0, 40).map(s => s.slice(0, 80));
  }
  out.t = tOk(x.t);
  if (tOk(x.del)) out.del = tOk(x.del); else delete out.del;
  return out;
}

export function cleanDoc(raw) {
  const doc = blankDoc();
  if (!raw || typeof raw !== 'object') return doc;
  for (const kind of KINDS) {
    const src = raw.items?.[kind];
    if (!src || typeof src !== 'object') continue;
    for (const [id, x] of Object.entries(src)) {
      const c = idOk(id) && cleanItem(x);
      if (c) doc.items[kind][id] = c;
    }
  }
  return doc;
}

// The same document always prints the same way, so two copies can be compared as text.
export function canon(doc) {
  const sortObj = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? sortObj(o[k]) : o[k]]));
  return JSON.stringify(sortObj({ app: APP, v: 1, items: doc.items }));
}

const newer = (x, y) => Math.max(x.t || 0, x.del || 0) >= Math.max(y.t || 0, y.del || 0);

// first: this device's first sync with this copy. Then nothing on either side counts as removed.
export function mergeDocs(local, remote, { first = false } = {}) {
  const out = blankDoc();
  for (const kind of KINDS) {
    const a = local?.items?.[kind] || {}, b = remote?.items?.[kind] || {};
    for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const x = a[id], y = b[id];
      let m = !x ? y : !y ? x : newer(x, y) ? x : y;
      if (first && x && y && gone(m) && (!gone(x) || !gone(y))) m = gone(x) ? y : x;
      out.items[kind][id] = m;
    }
  }
  return out;
}

export const live = (doc, kind) => Object.entries(doc.items[kind]).filter(([, x]) => !gone(x)).map(([id, x]) => ({ id, ...x }));

export function putItem(doc, kind, id, fields) {
  const old = doc.items[kind][id];
  const item = cleanItem({ ...fields, t: stamp(old) });
  delete item.del;
  return { ...doc, items: { ...doc.items, [kind]: { ...doc.items[kind], [id]: item } } };
}
export function removeItem(doc, kind, id) {
  const old = doc.items[kind][id];
  if (!old || gone(old)) return doc;
  return { ...doc, items: { ...doc.items, [kind]: { ...doc.items[kind], [id]: { ...old, del: stamp(old) } } } };
}

// An export from the Stockroom artifact, or a parts-bin backup: either way, one document.
export function fromImport(raw) {
  if (raw?.app === APP) return cleanDoc(raw);
  const doc = blankDoc();
  if (!raw || typeof raw !== 'object') return doc;
  for (const kind of KINDS) {
    const list = Array.isArray(raw[kind]) ? raw[kind] : [];
    for (const x of list) {
      const id = String(x?.id || '');
      if (!idOk(id)) continue;
      const t = Date.parse(x.updatedAt) || 1;
      const c = cleanItem({ ...x, t });
      if (c) doc.items[kind][id] = c;
    }
  }
  return doc;
}

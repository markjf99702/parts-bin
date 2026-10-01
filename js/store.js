// localStorage is the working copy. The page talks to it through a few calls shaped like the ones the
// Stockroom artifact used (doc(path).set/update/delete, collection(name).onSnapshot), so the screens
// didn't need rewriting. sync.js merges this copy with Google Drive when that's on.
import * as M from './model.js';

export const KEY = 'parts-bin';
const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

let doc = M.cleanDoc(get(KEY));
const subs = { bins: [], parts: [], projects: [] };
const saved = [];

function write(next) {
  doc = next;
  try { localStorage.setItem(KEY, M.canon(doc)); } catch { saved.forEach(f => f('full')); }
  notify();
  saved.forEach(f => f('saved'));
}
let pending = false;
function notify() {
  if (pending) return; pending = true;
  queueMicrotask(() => { pending = false; deliver(); });
}
function deliver() {
  for (const kind of M.KINDS) {
    const docs = M.live(doc, kind).map(x => { const { t, del, id, ...data } = x; return { id, data: () => ({ ...data, updatedAt: new Date(t).toISOString() }) }; });
    for (const f of subs[kind]) { try { f({ docs, size: docs.length, empty: !docs.length }); } catch (e) { console.error(e); } }
  }
}
function split(path) {
  const [kind, id] = String(path).split('/');
  if (!M.KINDS.includes(kind) || !id) throw new TypeError('Not a document path: ' + path);
  return [kind, id];
}

export const db = {
  doc(path) {
    const [kind, id] = split(path);
    return {
      id,
      async get() { const x = doc.items[kind][id]; return { id, exists: !!x && !M.gone(x), data: () => x && !M.gone(x) ? { ...x } : undefined }; },
      async set(data) { const { updatedAt, ...rest } = data || {}; write(M.putItem(doc, kind, id, rest)); },
      async update(data) {
        const old = doc.items[kind][id];
        if (!old || M.gone(old)) throw { code: 'invalid_argument', message: 'No such item' };
        const { t, updatedAt, ...base } = old; write(M.putItem(doc, kind, id, { ...base, ...data }));
      },
      async delete() { write(M.removeItem(doc, kind, id)); },
    };
  },
  collection(kind) {
    if (!M.KINDS.includes(kind)) throw new TypeError('Not a collection: ' + kind);
    return {
      doc: id => db.doc(kind + '/' + (id || M.newId())),
      onSnapshot(next) { subs[kind].push(next); setTimeout(notify, 0); return () => { subs[kind] = subs[kind].filter(f => f !== next); }; },
    };
  },
};

export const store = {
  get doc() { return doc; },
  onSave(f) { saved.push(f); },
  reload() { doc = M.cleanDoc(get(KEY)); notify(); },
  backup: () => JSON.stringify({ ...JSON.parse(M.canon(doc)), saved: new Date().toISOString() }, null, 1),
  // Merges a file in item by item, so nothing here is lost. Returns how many items it added or changed.
  importText(text) {
    let raw; try { raw = JSON.parse(text); } catch { throw new Error('That file isn’t JSON.'); }
    const incoming = M.fromImport(raw);
    const n = M.KINDS.reduce((s, k) => s + Object.keys(incoming.items[k]).length, 0);
    if (!n) throw new Error('That file doesn’t hold any bins, parts or projects.');
    const merged = M.mergeDocs(doc, incoming, { first: true });
    let changed = 0;
    for (const k of M.KINDS) for (const id of Object.keys(merged.items[k])) if (JSON.stringify(merged.items[k][id]) !== JSON.stringify(doc.items[k][id])) changed++;
    write(merged);
    return changed;
  },
};

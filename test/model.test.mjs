import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';

const doc = (parts) => ({ app: M.APP, v: 1, items: { bins: {}, parts, projects: {} } });

test('newer edit wins, item by item', () => {
  const a = doc({ x: { name: 'BME280', qty: 5, t: 10 }, y: { name: 'SCD41', qty: 3, t: 50 } });
  const b = doc({ x: { name: 'BME280', qty: 4, t: 20 }, y: { name: 'SCD41', qty: 1, t: 40 } });
  const m = M.mergeDocs(a, b);
  assert.equal(m.items.parts.x.qty, 4);
  assert.equal(m.items.parts.y.qty, 3);
});
test('a deletion reaches the other copy, unless it is the first sync', () => {
  const a = doc({ x: { name: 'BME280', t: 10, del: 30 } });
  const b = doc({ x: { name: 'BME280', t: 20 } });
  assert.ok(M.gone(M.mergeDocs(a, b).items.parts.x));
  assert.ok(!M.gone(M.mergeDocs(a, b, { first: true }).items.parts.x));
});
test('an edit after a deletion brings it back', () => {
  const a = doc({ x: { name: 'BME280', t: 10, del: 30 } });
  const b = doc({ x: { name: 'BME280', t: 40, qty: 2 } });
  assert.ok(!M.gone(M.mergeDocs(a, b).items.parts.x));
});
test('merging is the same either way round', () => {
  const a = doc({ x: { name: 'A', t: 10 }, y: { name: 'B', t: 5, del: 7 } });
  const b = doc({ x: { name: 'A2', t: 12 }, z: { name: 'C', t: 3 } });
  assert.equal(M.canon(M.mergeDocs(a, b)), M.canon(M.mergeDocs(b, a)));
});
test('reads a Stockroom artifact export', () => {
  const d = M.fromImport({ bins: [{ id: 'bin-env', code: 'ENV', name: 'Environmental', updatedAt: '2026-09-30T13:30:00Z' }],
    parts: [{ id: 'p-scd41', name: 'SCD41', qty: 3, binId: 'bin-env', tags: ['generic'], updatedAt: '2026-09-30T13:30:00Z' }, { id: '../bad', name: 'x' }], projects: [] });
  assert.equal(d.items.bins['bin-env'].code, 'ENV');
  assert.equal(d.items.parts['p-scd41'].qty, 3);
  assert.deepEqual(d.items.parts['p-scd41'].tags, ['generic']);
  assert.equal(Object.keys(d.items.parts).length, 1);
});
test('putItem and removeItem stamp times that move forward', () => {
  let d = M.blankDoc();
  d = M.putItem(d, 'parts', 'a', { name: 'X' });
  const t1 = d.items.parts.a.t;
  d = M.removeItem(d, 'parts', 'a');
  assert.ok(d.items.parts.a.del > t1 - 1 && M.gone(d.items.parts.a));
  d = M.putItem(d, 'parts', 'a', { name: 'X' });
  assert.ok(!M.gone(d.items.parts.a));
});

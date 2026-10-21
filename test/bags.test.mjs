// Bag numbers on more than one part, numbers on none, and which part a bag's tag opens.  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as BG from '../js/bags.js';

const P = (id, bag, more = {}) => ({ id, name: id, bag, ...more });

test('a bag number is a whole number from 1 up; anything else is no bag', () => {
  for (const [bag, want] of [[7, 7], ['7', 7], [0, 0], ['', 0], [null, 0], [undefined, 0], [-3, 0], [2.5, 0], ['x', 0], [1e20, 0]]) assert.equal(BG.bagOf({ bag }), want, String(bag));
});

test('clashes: each number on more than one part, in order, with the tagged part first', () => {
  const parts = [P('a', 33), P('b', 33, { tagWritten: true }), P('c', 35, { tagWritten: true }), P('d', '35'), P('e', 36), P('f', ''), P('g', 7)];
  const got = BG.clashes(parts).map(([n, ps]) => [n, ps.map(p => p.id)]);
  assert.deepEqual(got, [[33, ['b', 'a']], [35, ['c', 'd']]]);
  assert.deepEqual(BG.clashes([P('a', 1), P('b', 2)]), []);
  const three = BG.clashes([P('a', 4), P('b', 4), P('c', 4, { tagWritten: true })]);
  assert.deepEqual(three[0][1].map(p => p.id), ['c', 'a', 'b']);
});

test('gaps: numbers below the highest that no part has', () => {
  assert.deepEqual(BG.gaps([P('a', 1), P('b', 2), P('c', 5), P('d', 5), P('e', '')]), [3, 4]);
  assert.deepEqual(BG.gaps([P('a', 3)]), [1, 2]);
  assert.deepEqual(BG.gaps([]), []);
  assert.ok(BG.gaps([P('a', 9_000_000)]).length < 100000, 'a mistyped number doesn’t run on for ever');
});

test('a tag opens the part with the tag, if the number is on more than one', () => {
  const parts = [P('untagged', 33), P('tagged', 33, { tagWritten: true }), P('solo', 40)];
  assert.equal(BG.opens(parts, 33).id, 'tagged');
  assert.equal(BG.opens(parts, '040').id, 'solo');
  assert.equal(BG.opens(parts, 99), null);
});

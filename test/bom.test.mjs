// BOM check: reading a pasted parts list, and finding each line in the inventory.  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBom, matchPart } from '../js/bom.js';

test('a count first or last, or none', () => {
  assert.deepEqual(parseBom('2x XIAO ESP32-S3\n1 SCD41 breakout\n3 WS2812 strip segment\nM3 heat-set inserts x8\nSCD41 ×1\nLED strip, 3\nProto board\n# a note\n\n'), [
    { qty: 2, name: 'XIAO ESP32-S3' }, { qty: 1, name: 'SCD41 breakout' }, { qty: 3, name: 'WS2812 strip segment' },
    { qty: 8, name: 'M3 heat-set inserts' }, { qty: 1, name: 'SCD41' }, { qty: 3, name: 'LED strip' }, { qty: 1, name: 'Proto board' },
  ]);
  assert.deepEqual(parseBom('2 BME280; 1 SGP30'), [{ qty: 2, name: 'BME280' }, { qty: 1, name: 'SGP30' }]);
});

test('a part name can start with a digit', () => {
  assert.deepEqual(parseBom('1N4148 diodes x 4\n74HC595 x2\n2N2222 transistor, 5\n18650 cells ×2\n0.96in OLED x2\n2N7000\n10 1N4148 diodes'), [
    { qty: 4, name: '1N4148 diodes' }, { qty: 2, name: '74HC595' }, { qty: 5, name: '2N2222 transistor' }, { qty: 2, name: '18650 cells' },
    { qty: 2, name: '0.96in OLED' }, { qty: 1, name: '2N7000' }, { qty: 10, name: '1N4148 diodes' },
  ]);
  // a count before the name still reads as one, with or without the x
  assert.deepEqual(parseBom('4 x 18650\n2 M3x8\n2 18650 cells\n2x 74HC595'), [
    { qty: 4, name: '18650' }, { qty: 2, name: 'M3x8' }, { qty: 2, name: '18650 cells' }, { qty: 2, name: '74HC595' },
  ]);
});

test('a list pasted with bullets keeps its counts', () => {
  assert.deepEqual(parseBom('- 2x XIAO ESP32-S3\n• 1 SCD41\n* M3 heat-set inserts x8\n-'), [
    { qty: 2, name: 'XIAO ESP32-S3' }, { qty: 1, name: 'SCD41' }, { qty: 8, name: 'M3 heat-set inserts' },
  ]);
});

test('each line finds the part that holds most of its words', () => {
  const parts = [
    { id: 'xiao', name: 'Seeed XIAO ESP32-S3', tags: ['esp32'] },
    { id: 'bme', name: 'BME280 (Adafruit)' },
    { id: 'm3', name: 'M3 heat-set inserts' },
  ];
  assert.equal(matchPart('XIAO ESP32-S3', parts).p.id, 'xiao');
  assert.equal(matchPart('XIAO ESP32-S3', parts).conf, 1);
  assert.equal(matchPart('BME280', parts).p.id, 'bme');
  assert.equal(matchPart('heat-set inserts', parts).p.id, 'm3');
  assert.equal(matchPart('SGP30', parts), null);
  assert.equal(matchPart('', parts), null);
});

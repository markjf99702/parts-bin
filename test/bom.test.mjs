// BOM check: reading a pasted parts list, and finding each line in the inventory.  node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBom, matchPart, isPartNumber, shortBy } from '../js/bom.js';

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

test('a part number decides the match', () => {
  for (const w of ['scd41', '1n4148', 'esp32', '3.3v', '74hc595', 'm3x8']) assert.ok(isPartNumber(w), w);
  for (const w of ['100uf', '40pin', '1000mah', '2.54mm', '22awg', '18650', 's3', '10k', 'breakout']) assert.ok(!isPartNumber(w), w);
  // the placeholder's own example: SCD41 is 5 of the line's 13 letters, but it's the part (shown as fuzzy)
  const scd = [{ id: 'scd41', name: 'SCD41', tags: ['generic'] }];
  assert.equal(matchPart('SCD41 breakout', scd).p.id, 'scd41');
  assert.equal(matchPart('SCD41 breakout', scd).conf, 0.6);
  // a line that names one part doesn't match another on the words around it
  assert.equal(matchPart('BME280 breakout', [{ id: 'bmp', name: 'BMP280 breakout' }]), null);
  assert.equal(matchPart('BME280 breakout board', [{ id: 'bmp', name: 'BMP280 breakout board' }]), null);
  assert.equal(matchPart('3.3V regulator', [{ id: 'r5', name: '5V regulator' }]), null);
  assert.equal(matchPart('3.3V regulator', [{ id: 'r5', name: '5V regulator' }, { id: 'r33', name: 'AMS1117 3.3V regulator' }]).p.id, 'r33');
  // the part number can be in the name, the part number field or the tags
  assert.equal(matchPart('BMP280 breakout', [{ id: 'hw', name: 'HW611 (BMP280)' }]).p.id, 'hw');
  assert.equal(matchPart('BMP280 breakout', [{ id: 'hw', name: 'HW-611 pressure sensor', mpn: 'BMP280' }]).p.id, 'hw');
  assert.equal(matchPart('ESP32 board', [{ id: 'x', name: 'Seeed XIAO', tags: ['esp32'] }]).p.id, 'x');
  // of two parts with the number, the one that holds more of the line wins
  assert.equal(matchPart('BME280 breakout (Adafruit)', [{ id: 'g', name: 'BME280' }, { id: 'a', name: 'BME280 breakout (Adafruit)' }]).p.id, 'a');
});

test('a number with a unit, and a line of plain words, match as before', () => {
  assert.equal(matchPart('40pin header', [{ id: 'h', name: 'Male header 40 pin' }]).p.id, 'h');
  assert.equal(matchPart('100uF capacitor', [{ id: 'c', name: '100 uF electrolytic capacitor' }]).p.id, 'c');
  assert.equal(matchPart('2.54mm header', [{ id: 'h', name: 'Pin header 2.54 mm' }]).p.id, 'h');
  assert.equal(matchPart('heat shrink tubing 3mm', [{ id: 'hs', name: 'Heat shrink tubing 3mm' }]).conf, 1);
  assert.equal(matchPart('silicone wire', [{ id: 'w', name: 'Silicone wire 22AWG' }]).p.id, 'w');
  assert.equal(matchPart('red hookup wire', [{ id: 'w', name: 'Silicone wire 22AWG' }]), null, 'under half of the words');
});

test('a shortfall in metres or grams reads as a person would write it', () => {
  assert.equal(shortBy(0.3, 0.1), 0.2);
  assert.equal(shortBy(1.25, 0.5), 0.75);
  assert.equal(shortBy(5, 2), 3);
});

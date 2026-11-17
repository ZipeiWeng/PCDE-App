import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundFrostSettings } from '../dist/background.js';

test('default frost preserves the established material and zero leaves the photo clear', () => {
  assert.deepEqual(backgroundFrostSettings(), { intensity:60, scatter:24, grain:.16, integration:1 });
  assert.deepEqual(backgroundFrostSettings(0), { intensity:0, scatter:0, grain:0, integration:0 });
  assert.deepEqual(backgroundFrostSettings(100), { intensity:100, scatter:40, grain:.2667, integration:1 });
});

test('frost progresses monotonically without changing the photo into an opaque wash', () => {
  let previous = backgroundFrostSettings(0);
  for (let value=1; value<=100; value++) {
    const next = backgroundFrostSettings(value);
    assert.ok(next.scatter > previous.scatter);
    assert.ok(next.grain > previous.grain);
    assert.ok(next.integration >= previous.integration && next.integration <= 1);
    previous = next;
  }
  assert.equal(backgroundFrostSettings(-200).intensity, 0);
  assert.equal(backgroundFrostSettings(200).intensity, 100);
  assert.equal(backgroundFrostSettings('bad').intensity, 60);
});

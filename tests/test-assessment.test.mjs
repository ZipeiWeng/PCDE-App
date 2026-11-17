import test from 'node:test';
import assert from 'node:assert/strict';
import { withTestAssessment } from '../dist/model.js';

const testAccount = Object.freeze({ id: 'test_fixture', isTest: true });
function cloudSnapshot(overrides = {}) {
  return {
    source: 'test', simulated: true, scenario: null,
    heart: 82, temp: 34.6, steps: 6248, sleep: 7.7,
    score: null, status: 'unknown', baseline: {}, deviations: [],
    availability: 'available', connected: false, stale: false,
    updatedAt: '2026-11-14T12:30:00.000Z',
    metricUpdatedAt: { heart: '2026-11-14T12:30:00.000Z', temp: '2026-11-14T12:25:00.000Z' },
    dayTimezone: 'UTC',
    history: [{ date: '2026-11-13', heart: 79, temp: 34.4, steps: 6400, sleep: 7.8 }],
    segments: [], observedSigns: [], observationSource: 'unavailable',
    triage: { level: 'unknown', reasons: ['baseline_unavailable'], emergencySigns: [], assessedAt: '2026-11-14T12:30:00.000Z' },
    ...overrides,
  };
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('complete TEST database readings gain a clearly simulated comparison score', () => {
  const value = withTestAssessment(cloudSnapshot(), testAccount);
  assert.equal(value.score, 93);
  assert.equal(value.status, 'good');
  assert.deepEqual(value.baseline, { heart: 80, temp: 34.5, steps: 6500, sleep: 8 });
  assert.equal(value.triage.level, 'good');
  assert.match(value.triage.provenance, /simulat/i);
  assert.equal(value.deviations.length, 4);
  assert.deepEqual(value.deviations.map(({ key, current, baseline, difference }) => ({ key, current, baseline, difference })), [
    { key: 'heart', current: 82, baseline: 80, difference: 2 },
    { key: 'temp', current: 34.6, baseline: 34.5, difference: 0.1 },
    { key: 'steps', current: 6248, baseline: 6500, difference: -252 },
    { key: 'sleep', current: 7.7, baseline: 8, difference: -0.3 },
  ]);
});

test('TEST assessment preserves immutable database readings, history and freshness', () => {
  const original = deepFreeze(cloudSnapshot({ stale: true }));
  const before = structuredClone(original);
  const value = withTestAssessment(original, testAccount);
  assert.deepEqual(original, before);
  for (const key of ['heart', 'temp', 'steps', 'sleep', 'source', 'simulated', 'scenario', 'availability', 'connected', 'stale', 'updatedAt', 'metricUpdatedAt', 'dayTimezone', 'history', 'segments', 'observedSigns', 'observationSource']) {
    assert.deepEqual(value[key], original[key], `${key} must remain database-owned`);
  }
  assert.equal(value.score, 93, 'stale transport must not erase an existing example score');
});

test('partial, missing or invalid metrics never inherit a healthy sample assessment', () => {
  for (const key of ['heart', 'temp', 'steps', 'sleep']) {
    for (const invalid of [null, undefined, NaN, Infinity, -1, '82']) {
      const input = cloudSnapshot({ [key]: invalid });
      assert.deepEqual(withTestAssessment(input, testAccount), input, `${key}=${String(invalid)}`);
    }
    const input = cloudSnapshot();
    delete input[key];
    assert.deepEqual(withTestAssessment(input, testAccount), input, `missing ${key}`);
  }
  assert.equal(withTestAssessment(null, testAccount), null);
  assert.equal(withTestAssessment(undefined, testAccount), undefined);
});

test('ordinary accounts and non-test sources never gain the TEST baseline or score', () => {
  for (const account of [null, undefined, {}, { id: 'owner_1' }, { id: 'owner_1', isTest: false }, { id: 'test_fixture' }, { demo: true }, { isTest: 'true' }]) {
    const input = cloudSnapshot();
    assert.deepEqual(withTestAssessment(input, account), input);
  }
  for (const source of ['device', 'unavailable', 'demo', undefined]) {
    const input = cloudSnapshot({ source });
    assert.deepEqual(withTestAssessment(input, testAccount), input);
  }
  for (const simulated of [false, undefined, 'true']) {
    const input = cloudSnapshot({ simulated });
    assert.deepEqual(withTestAssessment(input, testAccount), input);
  }
});

test('polling deterministically recalculates from current DB values instead of fixed demo fixtures', () => {
  const input = cloudSnapshot();
  assert.deepEqual(withTestAssessment(input, testAccount), withTestAssessment(structuredClone(input), testAccount));
  const changed = cloudSnapshot({ heart: 91, updatedAt: '2026-11-14T12:45:00.000Z' });
  const value = withTestAssessment(changed, testAccount);
  assert.equal(value.heart, 91);
  assert.equal(value.score, 76);
  assert.equal(value.status, 'watch');
  assert.equal(value.triage.level, 'watch');
  assert.ok(value.triage.reasons.includes('heart_change'));
  assert.equal(value.deviations.find(row => row.key === 'heart').current, 91);
  assert.equal(value.updatedAt, changed.updatedAt);
  assert.deepEqual(value.history, changed.history);
  assert.equal(value.scenario, null);
});

test('TEST emergency observations remain urgent even when the example metrics are steady', () => {
  const input = cloudSnapshot({ observedSigns: ['collapse'], observationSource: 'owner' });
  const value = withTestAssessment(input, testAccount);
  assert.equal(value.status, 'alert');
  assert.equal(value.triage.level, 'alert');
  assert.deepEqual(value.triage.emergencySigns, ['collapse']);
  assert.deepEqual(value.observedSigns, input.observedSigns);
  assert.equal(value.observationSource, 'owner');
});

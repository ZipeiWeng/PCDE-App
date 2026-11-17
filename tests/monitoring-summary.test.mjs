import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMonitoring } from '../dist/monitoring-summary.js';
import { createSnapshot } from '../dist/model.js';

const localDate = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour);
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const reading = (date, value = 80) => ({ date, heart: value, temp: 34.5, steps: 6000, sleep: 8 });

test('the seven available demo readings remain seven for 30 days and all records', () => {
  const snapshot = createSnapshot();
  const source = structuredClone(snapshot.history);
  const summaries = ['7', '30', 'all'].map(range => summarizeMonitoring(snapshot.history, { range }));
  for (const summary of summaries) {
    assert.equal(summary.count, 7);
    assert.equal(summary.observedDays, 7);
    assert.equal(summary.metrics.heart.count, 7);
    assert.deepEqual(summary.rows, snapshot.history);
  }
  assert.deepEqual(summaries.map(item => item.requestedDays), [7, 30, null]);
  assert.deepEqual(snapshot.history, source);
});

test('7-day and 30-day windows select only actual calendar dates from a longer archive', () => {
  const now = localDate(2026, 11, 13);
  const history = Array.from({ length: 45 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - index);
    return reading(dayKey(date), index + 50);
  });
  const before = structuredClone(history);
  const seven = summarizeMonitoring(history, { range: '7', now });
  const thirty = summarizeMonitoring(history, { range: '30', now });
  const all = summarizeMonitoring(history, { range: 'all', now });
  assert.equal(seven.count, 7);
  assert.equal(seven.firstDate, '2026-11-07');
  assert.equal(seven.lastDate, '2026-11-13');
  assert.deepEqual(seven.metrics.heart, { count: 7, min: 50, max: 56 });
  assert.equal(thirty.count, 30);
  assert.equal(thirty.firstDate, '2026-10-15');
  assert.equal(all.count, 45);
  assert.equal(all.firstDate, '2026-09-30');
  assert.deepEqual(history, before, 'filtering and sorting must not reorder stored readings');
});

test('invalid dates, rolled-over dates, future dates and nonnumeric readings are excluded', () => {
  const now = localDate(2026, 3, 5);
  const history = [
    reading('2026-03-05', 80),
    reading('2026-02-31', 500),
    reading('2026-02-29T10:00:00Z', 500),
    reading('2026-03-05T25:00:00Z', 500),
    reading('2026-03-06', 500),
    reading('not-a-date', 500),
    reading(null, 500),
    reading(0, 500),
    { date: '2026-03-04', heart: '80', temp: null, steps: '', sleep: undefined },
    { date: '2026-03-03', heart: NaN, temp: Infinity, steps: -1, sleep: -Infinity },
  ];
  const summary = summarizeMonitoring(history, { range: 'all', now });
  assert.equal(summary.count, 1);
  assert.equal(summary.metrics.heart.max, 80);
  assert.equal(summary.firstDate, '2026-03-05');
  assert.equal(summary.lastDate, '2026-03-05');
});

test('missing metrics keep independent sample counts and real zero values', () => {
  const history = [
    { date: '2026-11-13', heart: 80, temp: null, steps: 0 },
    { date: '2026-11-12', heart: 90, temp: 34.6, sleep: '' },
    { date: '2026-11-12T08:00:00', temp: 34.2, sleep: 7.5 },
    { date: '2026-11-10', heart: '', temp: null, sleep: 0 },
  ];
  const summary = summarizeMonitoring(history, { now: localDate(2026, 11, 13) });
  assert.equal(summary.count, 4);
  assert.equal(summary.observedDays, 3, 'multiple readings on one date do not imply extra days of coverage');
  assert.deepEqual(summary.metrics, {
    heart: { count: 2, min: 80, max: 90 },
    temp: { count: 2, min: 34.2, max: 34.6 },
    steps: { count: 1, min: 0, max: 0 },
    sleep: { count: 2, min: 0, max: 7.5 },
  });
});

test('a stale archive is empty for recent periods and remains available under all records', () => {
  const history = [{ date: '2025-01-01', heart: 78 }];
  const now = localDate(2026, 11, 13);
  for (const range of ['7', '30']) {
    const summary = summarizeMonitoring(history, { range, now });
    assert.equal(summary.count, 0);
    assert.equal(summary.observedDays, 0);
    assert.equal(summary.firstDate, null);
    assert.equal(summary.lastDate, null);
    assert.deepEqual(summary.metrics.heart, { count: 0, min: null, max: null });
  }
  assert.equal(summarizeMonitoring(history, { range: 'all', now }).count, 1);
  assert.equal(summarizeMonitoring(history, { range: 'invalid', now }).range, '7');
  assert.equal(summarizeMonitoring(null, { now }).count, 0);
});

test('windows include the boundary day and today while rejecting future timestamps later today', () => {
  const now = localDate(2026, 11, 13, 12);
  const midnight = localDate(2026, 11, 7, 0);
  const beforeStart = new Date(midnight.valueOf() - 1);
  const afterNow = new Date(now.valueOf() + 1);
  const history = [
    reading('2026-11-07', 70),
    reading(midnight.toISOString(), 71),
    reading(beforeStart.toISOString(), 500),
    reading('2026-11-13', 72),
    reading(now.toISOString(), 73),
    reading(afterNow.toISOString(), 500),
  ];
  const summary = summarizeMonitoring(history, { now });
  assert.equal(summary.count, 4);
  assert.equal(summary.observedDays, 2);
  assert.deepEqual(summary.metrics.heart, { count: 4, min: 70, max: 73 });
  assert.equal(summary.lastDate, now.toISOString());
});

test('leap dates are accepted only in leap years and invalid reference times never invent coverage', () => {
  const history = [reading('2024-02-29'), reading('2025-02-29')];
  assert.equal(summarizeMonitoring(history, { range: 'all', now: localDate(2026, 11, 13) }).count, 1);
  assert.equal(summarizeMonitoring(history, { range: 'all', now: new Date('invalid') }).count, 0);
});

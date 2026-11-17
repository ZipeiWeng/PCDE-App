const metricKeys = ['heart', 'temp', 'steps', 'sleep'];
const isReading = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function readingDate(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
  if (!parts) return null;
  const [, yearText, monthText, dayText, suffix] = parts;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  // Reject calendar rollover before Date can turn 31 February into March.
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  if (!suffix) {
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return { date, dateOnly: true };
  }
  const clock = /^T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(suffix);
  if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] || 0) > 59) return null;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? { date, dateOnly: false } : null;
}

// Date-only rows follow the device model's local calendar. Timestamped rows are
// included only through `now`; date-only readings for today remain eligible.
// firstDate/lastDate retain the validated original row.date strings for display.
export function summarizeMonitoring(history, { range = '7', now = new Date() } = {}) {
  const selectedRange = ['7', '30', 'all'].includes(range) ? range : '7';
  const requestedDays = selectedRange === 'all' ? null : Number(selectedRange);
  const reference = new Date(now);
  const today = new Date(reference);
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  if (requestedDays) start.setDate(start.getDate() - requestedDays + 1);
  const dated = (Array.isArray(history) ? history : []).flatMap(row => {
    if (!row || !metricKeys.some(key => isReading(row[key]))) return [];
    const parsed = readingDate(row.date);
    if (!parsed || !Number.isFinite(reference.valueOf())) return [];
    const time = parsed.date.valueOf();
    if (time > (parsed.dateOnly ? today.valueOf() : reference.valueOf()) || (requestedDays && time < start.valueOf())) return [];
    return [{ row, time, day: localDay(parsed.date) }];
  }).sort((a, b) => a.time - b.time);
  const rows = dated.map(item => item.row);
  const metrics = Object.fromEntries(metricKeys.map(key => {
    const values = rows.map(row => row[key]).filter(isReading);
    return [key, {
      count: values.length,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
    }];
  }));
  return {
    range: selectedRange,
    requestedDays,
    rows,
    count: rows.length,
    observedDays: new Set(dated.map(item => item.day)).size,
    firstDate: rows[0]?.date ?? null,
    lastDate: rows.at(-1)?.date ?? null,
    metrics,
  };
}

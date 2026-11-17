const METRICS = ['heart', 'temp', 'steps', 'sleep'];
const SIGNS = ['breathing_difficulty', 'collapse', 'blue_gums', 'seizure', 'severe_pain'];
const SOURCES = ['demo', 'owner'];
const LEVELS = ['watch', 'alert'];
const TREND_STATES = ['insufficient', 'improving', 'worsening', 'unchanged'];
const DAY = 24 * 60 * 60 * 1000;
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const time = value => {
  if (!(typeof value === 'string' || value instanceof Date)) return '';
  if (typeof value === 'string') {
    const calendar = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
    if (!calendar) return '';
    const [,year,month,day] = calendar.map(Number);
    const check = new Date(Date.UTC(year,month-1,day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month-1 || check.getUTCDate() !== day) return '';
  }
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : '';
};
const metrics = value => Object.fromEntries(METRICS.filter(key => typeof value?.[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= 1e8).map(key => [key, value[key]]));
const signs = value => [...new Set((Array.isArray(value) ? value : []).filter(id => SIGNS.includes(id)))].sort();
const hash = value => {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return (result >>> 0).toString(36);
};

// These distances describe a change from the pet's baseline, not a validated
// disease threshold or evidence of improvement in a diagnosed condition.
function distance(key, value, baseline) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) return null;
  if (key === 'temp') return Math.abs(value - baseline) / .5;
  if (key === 'sleep') return Math.abs(value - baseline) / .75;
  return Math.abs(value / baseline - 1) / (key === 'heart' ? .1 : .2);
}
function relevant(metricsValue, baseline) {
  return METRICS.filter(key => (distance(key, metricsValue[key], baseline[key]) ?? 0) >= 1);
}
function snapshotData(snapshot) {
  const value = object(snapshot);
  return { level:value.triage?.level || value.status, metrics:metrics(value), baseline:metrics(value.baseline), observedSigns:signs(value.observedSigns ?? value.triage?.emergencySigns), hasSigns:Array.isArray(value.observedSigns) || Array.isArray(value.triage?.emergencySigns) };
}
function signature(sample, source) {
  if (source === 'owner') return JSON.stringify([sample.level, signs(sample.observedSigns)]);
  return JSON.stringify([sample.level, METRICS.map(key => sample.metrics?.[key] ?? null), METRICS.map(key => sample.baseline?.[key] ?? null), signs(sample.observedSigns)]);
}
function normalizedEntry(value) {
  const item = object(value), at = time(item.at);
  if (!at || !SOURCES.includes(item.source) || !LEVELS.includes(item.level)) return null;
  const recordedMetrics = metrics(item.metrics), baseline = metrics(item.baseline);
  const relevantMetrics = Array.isArray(item.relevantMetrics)
    ? [...new Set(item.relevantMetrics.filter(key => METRICS.includes(key) && distance(key, recordedMetrics[key], baseline[key]) !== null))]
    : relevant(recordedMetrics, baseline);
  const trend = object(item.trend);
  return {
    id:text(item.id, 100) || `alert-${hash(`${at}:${item.source}:${signature(item)}`)}`,
    at, level:item.level, title:text(item.title, 160), risk:text(item.risk, 1200), reason:text(item.reason, 1200), source:item.source,
    score:typeof item.score === 'number' && Number.isFinite(item.score) ? Math.max(0, Math.min(100, Math.round(item.score))) : null,
    metrics:recordedMetrics, baseline, observedSigns:signs(item.observedSigns), relevantMetrics, active:item.active !== false,
    trend:{
      state:TREND_STATES.includes(trend.state) ? trend.state : 'insufficient',
      at:time(trend.at) || at,
      summary:text(trend.summary, 500) || 'Waiting for a later comparable reading.',
      sampleSignature:text(trend.sampleSignature, 1200),
    },
  };
}

export function normalizeDeviceAlerts(history) {
  if (!Array.isArray(history)) return [];
  const seen = new Set(), seenSources = new Set();
  return history.map(normalizedEntry).filter(Boolean).sort((a,b) => Date.parse(b.at) - Date.parse(a.at))
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).slice(0, 200)
    .map(item => { const active = item.active && !seenSources.has(item.source); seenSources.add(item.source); return {...item, active}; });
}

export function recordDeviceAlert(history, snapshot, { title='', risk='', reason='', source='demo', now=new Date().toISOString() } = {}) {
  const original = Array.isArray(history) ? history : [];
  const sample = snapshotData(snapshot), at = time(now);
  if (!at || !SOURCES.includes(source) || !LEVELS.includes(sample.level)) return original;
  if (snapshot?.observationSource && snapshot.observationSource !== source) return original;
  const current = normalizeDeviceAlerts(original), latest = current.find(item => item.source === source);
  // A refresh of the same active warning is not another warning occurrence.
  if (latest?.active && Math.abs(Date.parse(at) - Date.parse(latest.at)) <= DAY && signature(latest, source) === signature(sample, source)) return original;
  const next = normalizedEntry({
    id:`alert-${hash(`${at}:${source}:${signature(sample, source)}`)}`, at, level:sample.level, title, risk, reason, source,
    score:snapshot?.score, metrics:sample.metrics, baseline:sample.baseline, observedSigns:sample.observedSigns,
    relevantMetrics:relevant(sample.metrics, sample.baseline), active:true,
    trend:{state:'insufficient',at,summary:'Waiting for a later comparable reading.',sampleSignature:''},
  });
  return normalizeDeviceAlerts([next, ...current]);
}

function compare(entry, sample) {
  if (entry.source === 'owner') {
    const before = entry.observedSigns, after = sample.observedSigns;
    if (!sample.hasSigns) return {state:'insufficient',summary:'A new owner check-in is needed to compare the reported signs.'};
    if (!before.length) return {state:'insufficient',summary:'There are no comparable owner-reported signs.'};
    if (!after.length) return {state:'improving',summary:'The previously reported urgent signs are no longer reported. This does not confirm recovery.',active:false};
    if (after.some(sign => !before.includes(sign))) return {state:'worsening',summary:'Additional urgent signs have been reported. This is a change in observations, not a diagnosis.'};
    if (after.length < before.length) return {state:'improving',summary:'Fewer urgent signs are reported, but urgent signs remain. This does not confirm recovery.'};
    return {state:'unchanged',summary:'The same urgent signs remain reported. Sensor readings cannot establish recovery.'};
  }
  if (sample.level === 'unknown' || !['good','watch','alert'].includes(sample.level)) return {state:'insufficient',summary:'No current comparable assessment is available.'};
  const keys = entry.relevantMetrics;
  if (!keys.length || keys.some(key => distance(key, sample.metrics[key], entry.baseline[key]) === null)) return {state:'insufficient',summary:'More comparable readings are needed to describe a trend.'};
  if (sample.level === 'alert' && entry.level !== 'alert') return {state:'worsening',summary:'The current warning level is higher. This does not identify a disease.'};
  if (sample.level === 'good') {
    if (keys.some(key => distance(key, sample.metrics[key], entry.baseline[key]) >= 1)) return {state:'insufficient',summary:'The latest assessment and the original baseline need a comparable reading.'};
    return {state:'improving',summary:'The flagged readings are now within the usual pattern. This does not confirm recovery.',active:false};
  }
  if (entry.level === 'alert' && sample.level === 'watch') return {state:'improving',summary:'The warning level is lower, but readings still need attention. This does not confirm recovery.'};
  const before = keys.reduce((sum,key) => sum + distance(key, entry.metrics[key], entry.baseline[key]), 0);
  const after = keys.reduce((sum,key) => sum + distance(key, sample.metrics[key], entry.baseline[key]), 0);
  const change = (after - before) / Math.max(before, 1);
  if (change < -.1) return {state:'improving',summary:'The originally flagged readings are closer to their earlier baseline. This does not confirm recovery.'};
  if (change > .1) return {state:'worsening',summary:'The originally flagged readings are farther from their earlier baseline. This does not identify a disease.'};
  return {state:'unchanged',summary:'The originally flagged readings show no clear change from the warning.'};
}

export function updateDeviceAlertTrend(history, snapshot, { source='demo', now=new Date().toISOString() } = {}) {
  const original = Array.isArray(history) ? history : [], at = time(now);
  if (!at || !SOURCES.includes(source) || (snapshot?.observationSource && snapshot.observationSource !== source)) return original;
  const index = original.findIndex(item => item?.source === source && item.active !== false);
  if (index < 0) return original;
  const entry = normalizedEntry(original[index]);
  if (!entry || Date.parse(at) <= Date.parse(entry.at) || Date.parse(at) < Date.parse(entry.trend.at)) return original;
  const sample = snapshotData(snapshot), sampleSignature = signature(sample, source);
  const stale = Date.parse(at) - Date.parse(entry.at) > DAY;
  const result = stale ? {state:'insufficient',summary:'This warning is too old for a current trend comparison.'} : compare(entry, sample);
  if (entry.trend.state === result.state && entry.trend.summary === result.summary && entry.trend.sampleSignature === sampleSignature) return original;
  const next = original.slice();
  next[index] = {...entry, active:result.active ?? entry.active, trend:{state:result.state,at,summary:result.summary,sampleSignature}};
  return next;
}

const localDay = value => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
export function alertCountSeries(history, { now=new Date().toISOString(), days=7, source } = {}) {
  const current = time(now);
  if (!current) return [];
  const count = Number.isInteger(days) ? Math.max(1, Math.min(90, days)) : 7;
  const end = new Date(current), series = [];
  for (let offset=count-1; offset>=0; offset--) {
    const date = new Date(end); date.setHours(0,0,0,0); date.setDate(date.getDate()-offset);
    series.push({date:localDay(date),count:0});
  }
  const buckets = new Map(series.map(item => [item.date,item]));
  for (const entry of normalizeDeviceAlerts(history)) {
    if (source && entry.source !== source) continue;
    if (Date.parse(entry.at) > Date.parse(current)) continue;
    const bucket = buckets.get(localDay(new Date(entry.at)));
    if (bucket) bucket.count++;
  }
  return series;
}

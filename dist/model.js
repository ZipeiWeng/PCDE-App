import { normalizeDeviceAlerts } from './device-alerts.js';
import { createMochiHistory, MOCHI_HISTORY_VERSION, MOCHI_DEMO_ESSENTIALS, upgradeMochiDemoCare } from './mochi-history.js';
import { normalizeBackgroundImage } from './background-images.js';
import { normalizePhotoSource, normalizePhotoCrop } from './avatar.js';

const demoStoreKey = 'pawprint-health.store.v2';
const legacyKey = 'pawprint-health.preferences.v1';
let storeKey = demoStoreKey;
let activeAccount = null;
const recordTypes = new Set(['visit', 'vaccine', 'parasite', 'medication', 'observation']);
const healthCardModuleIds = ['allergies', 'conditions', 'vaccination', 'parasite', 'medication', 'history'];
const pad = value => String(value).padStart(2, '0');
const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const round = (value, decimals = 2) => Number(value.toFixed(decimals));

// Preferences belong to the same account boundary as care data. The subscription
// value is a preview choice only; it does not grant paid access or represent billing.
export function normalizeBackgroundFrost(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : 60;
}

export function normalizePreferences(value) {
  return {
    language: value?.language === 'zh' ? 'zh' : 'en',
    alertsEnabled: typeof value?.alertsEnabled === 'boolean' ? value.alertsEnabled : true,
    syncInterval: [1, 5, 15].includes(value?.syncInterval) ? value.syncInterval : 5,
    subscription: value?.subscription === 'plus' ? 'plus' : 'free',
    quietHours: typeof value?.quietHours === 'boolean' ? value.quietHours : false,
    backgroundMode: ['profile', 'custom', 'neutral'].includes(value?.backgroundMode) ? value.backgroundMode : 'neutral',
    backgroundPhoto: normalizeBackgroundImage(value?.backgroundPhoto),
    backgroundProfilePhoto: normalizeBackgroundImage(value?.backgroundProfilePhoto, { allowDemo:true }),
    backgroundFrost: normalizeBackgroundFrost(value?.backgroundFrost),
    pawPattern: value?.pawPattern !== false,
  };
}

function normalizeHealthCardModules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(healthCardModuleIds
    .filter(id => Object.hasOwn(value, id) && typeof value[id] === 'boolean')
    .map(id => [id, value[id]]));
}

// A birthday is a calendar date, so avoid UTC conversion shifting its day.
export function normalizeBirthday(value, today = new Date()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900) return '';
  const birthday = new Date(year, month - 1, day);
  if (birthday.getFullYear() !== year || birthday.getMonth() !== month - 1 || birthday.getDate() !== day || value > dayKey(today)) return '';
  return value;
}

export function ageFromBirthday(value, today = new Date()) {
  const birthday = normalizeBirthday(value, today);
  if (!birthday) return null;
  const [year, month, day] = birthday.split('-').map(Number);
  return today.getFullYear() - year - (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0);
}

// Account selection is a local persistence boundary, not cloud synchronization.
// Missing identity is the explicit preview context; real accounts never migrate demo data.
export function selectAccount(account) {
  if (!account || account.demo === true) {
    activeAccount = null;
    storeKey = demoStoreKey;
    return;
  }
  if (typeof account.id !== 'string' || !account.id.trim()) throw new TypeError('An account ID is required.');
  activeAccount = { ...account, id: account.id.trim() };
  storeKey = `pawprint-health.store.v3:${activeAccount.id}`;
}

function demoDate(offset = 0, hour = 16, minute = 42) {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, hour, minute);
}

function defaultStore() {
  if (activeAccount) {
    const birthday = normalizeBirthday(activeAccount.petBirthday);
    const sex = typeof activeAccount.petSex === 'string' ? activeAccount.petSex.toLowerCase() : '';
    return {
      profile: {
        name: textOr(activeAccount.petName, '').trim() || 'Your pet',
        breed: activeAccount.isTest === true ? 'Golden retriever' : 'Not recorded',
        birthday,
        age: ageFromBirthday(birthday) ?? 0,
        weight: activeAccount.isTest === true ? 28.5 : 0,
        sex: sex === 'male' ? 'Male' : sex === 'female' ? 'Female' : 'Not recorded',
        photo: '',
        photoRemoved: false,
        photoSource: '',
        photoCrop: null,
      },
      goals: { steps: 8000, sleep: 10 },
      preferences: normalizePreferences(),
      healthCardModules: {},
      records: activeAccount.isTest === true ? createMochiHistory() : [],
      ...(activeAccount.isTest === true ? { demoHistoryVersion:MOCHI_HISTORY_VERSION } : {}),
      deviceAlerts: [],
      allergies: activeAccount.isTest === true ? MOCHI_DEMO_ESSENTIALS.allergies : 'None recorded',
      conditions: activeAccount.isTest === true ? MOCHI_DEMO_ESSENTIALS.conditions : 'None recorded',
      ownerName: textOr(activeAccount.username, '').trim(),
      doctorName: '',
      clinicName: '',
    };
  }
  return {
    profile: { name: 'Mochi', breed: 'Golden retriever', age: 3, weight: 28.5, sex: 'Male', photo: '', photoRemoved:false, photoSource:'', photoCrop:null },
    goals: { steps: 8000, sleep: 10 },
    preferences: normalizePreferences(),
    healthCardModules: {},
    deviceAlerts: [],
    records: createMochiHistory(),
    demoHistoryVersion: MOCHI_HISTORY_VERSION,
    allergies: MOCHI_DEMO_ESSENTIALS.allergies,
    conditions: MOCHI_DEMO_ESSENTIALS.conditions,
    ownerName: 'Alex',
    doctorName: 'Dr. Taylor',
    clinicName: 'Willow Veterinary',
  };
}

function textOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function numberOr(value, fallback, minimum = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum ? value : fallback;
}

function stableId(value, index) {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `record-${(hash >>> 0).toString(36)}-${index}`;
}

function normalizeRecord(record, index) {
  const normalized = {
    id: textOr(record.id, stableId(record, index)),
    // Keep retired records identifiable so they can remain stored without
    // reappearing as a supported observation or losing the owner's history.
    type: recordTypes.has(record.type) || record.type === 'meal' ? record.type : 'observation',
    title: textOr(record.title, 'Care record'),
    date: textOr(record.date, demoDate().toISOString()),
    details: textOr(record.details, ''),
    author: record.author === 'Vet demo' ? 'Vet demo' : 'Owner',
  };
  if (record.sample === true || record.demo === true) normalized.sample = true;
  for (const key of ['clinic', 'doctor', 'dose', 'symptoms', 'diagnosis', 'plan', 'medications', 'sourceFilename']) {
    if (typeof record[key] === 'string') normalized[key] = record[key];
  }
  if (typeof record.city === 'string') normalized.city = record.city.trim().slice(0, 160);
  if (record.source === 'scan') normalized.source = 'scan';
  return normalized;
}

function normalizeStore(value) {
  const defaults = defaultStore();
  const profile = value?.profile;
  const goals = value?.goals;
  const birthday = normalizeBirthday(profile?.birthday ?? defaults.profile.birthday);
  const photoRemoved = profile?.photoRemoved === true;
  const photoSource = photoRemoved ? '' : normalizePhotoSource(profile?.photoSource);
  return {
    profile: {
      name: textOr(profile?.name, defaults.profile.name),
      breed: textOr(profile?.breed, defaults.profile.breed),
      birthday,
      age: ageFromBirthday(birthday) ?? numberOr(profile?.age, defaults.profile.age),
      weight: numberOr(profile?.weight, defaults.profile.weight),
      sex: textOr(profile?.sex, defaults.profile.sex),
      photo: textOr(profile?.photo, defaults.profile.photo),
      photoRemoved,
      photoSource,
      photoCrop: photoSource ? normalizePhotoCrop(profile?.photoCrop) : null,
    },
    goals: {
      steps: numberOr(goals?.steps, defaults.goals.steps, 1),
      sleep: numberOr(goals?.sleep, defaults.goals.sleep, 0.1),
    },
    preferences: normalizePreferences(value?.preferences),
    healthCardModules: normalizeHealthCardModules(value?.healthCardModules),
    records: Array.isArray(value?.records)
      ? value.records.filter(record => record && typeof record === 'object').map(normalizeRecord)
      : defaults.records,
    ...(!activeAccount || activeAccount.isTest === true ? {demoHistoryVersion:Number.isSafeInteger(value?.demoHistoryVersion) && value.demoHistoryVersion >= 0 ? value.demoHistoryVersion : 0} : {}),
    deviceAlerts: normalizeDeviceAlerts(value?.deviceAlerts),
    allergies: textOr(value?.allergies, defaults.allergies),
    conditions: textOr(value?.conditions, defaults.conditions),
    ownerName: textOr(value?.ownerName, defaults.ownerName),
    doctorName: textOr(value?.doctorName, defaults.doctorName),
    clinicName: textOr(value?.clinicName, defaults.clinicName),
  };
}

function readRaw(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function enrichMochiHistory(store) {
  if ((activeAccount && activeAccount.isTest !== true) || store.demoHistoryVersion >= MOCHI_HISTORY_VERSION) return store;
  const upgraded=upgradeMochiDemoCare(store);
  const existing = new Set(upgraded.records.map(record => record.id));
  // Enrich only explicit demonstration contexts. Existing entries (including
  // edited old examples), uploaded photos and owner-entered care data win.
  const records=store.demoHistoryVersion>=1?upgraded.records:[...upgraded.records,...createMochiHistory().filter(record=>!existing.has(record.id))];
  return {...upgraded,records,demoHistoryVersion:MOCHI_HISTORY_VERSION};
}

// Keep this boundary when replacing local persistence with a Firebase repository.
// Reading never mutates storage. Legacy migration belongs only to the preview.
export function readStore() {
  const saved = readRaw(storeKey);
  if (saved) return enrichMochiHistory(normalizeStore(saved));
  if (activeAccount) return defaultStore();
  const legacy = readRaw(legacyKey);
  if (!legacy) return defaultStore();

  const migrated = normalizeStore(legacy);
  if (migrated.profile.breed === '金毛寻回犬') migrated.profile.breed = 'Golden retriever';
  const medications = Array.isArray(legacy.medications) ? legacy.medications : [];
  const converted = medications.filter(entry => entry && typeof entry === 'object').map((entry, index) => ({
    id: stableId(entry, index),
    type: 'medication',
    title: textOr(entry.name, 'Medication record'),
    date: textOr(entry.date, demoDate().toISOString()),
    details: textOr(entry.note, ''),
    dose: textOr(entry.dose, ''),
    author: 'Owner',
  }));
  migrated.records.push(...converted);
  return enrichMochiHistory(migrated);
}

export function saveStore(store) {
  try {
    // Retired tracking can round-trip existing entries, but cannot create new ones.
    const previous = readRaw(storeKey);
    const retiredIds = new Set((previous ? normalizeStore(previous).records : [])
      .filter(record => record.type === 'meal').map(record => record.id));
    if (Array.isArray(store?.records) && store.records.some(record => record?.type === 'meal' && !retiredIds.has(record.id))) return false;
    // Persist only the care-data schema. Session identity and credentials stay outside it.
    localStorage.setItem(storeKey, JSON.stringify(normalizeStore(store)));
    return true;
  } catch {
    return false;
  }
}

// Seven synthetic readings captured at 16:42 on the previous seven days.
// Same-time comparisons keep today's partial steps and sleep comparable.
const priorReadings = [
  { heart: 78, temp: 34.3, steps: 6100, sleep: 7.6 },
  { heart: 81, temp: 34.6, steps: 6700, sleep: 8.2 },
  { heart: 79, temp: 34.4, steps: 6400, sleep: 7.8 },
  { heart: 82, temp: 34.7, steps: 6900, sleep: 8.4 },
  { heart: 80, temp: 34.5, steps: 6500, sleep: 8.0 },
  { heart: 77, temp: 34.2, steps: 6000, sleep: 7.7 },
  { heart: 83, temp: 34.8, steps: 6900, sleep: 8.3 },
];
const scoreMetrics = [
  { key: 'heart', label: 'Heart rate', unit: 'bpm', weight: 30, scale: 0.2 },
  { key: 'temp', label: 'Surface temperature', unit: '°C', weight: 24, scale: 1.5 },
  { key: 'steps', label: 'Steps', unit: 'steps', weight: 23, scale: 1 },
  { key: 'sleep', label: 'Estimated sleep', unit: 'h', weight: 23, scale: 1 },
];
const demoBaseline = Object.freeze(Object.fromEntries(scoreMetrics.map(({ key }) => [
  key, round(priorReadings.reduce((sum, day) => sum + day[key], 0) / priorReadings.length),
])));
const scenarioReadings = {
  good: { heart: 82, temp: 34.6, steps: 6248, sleep: 7.7 },
  watch: { heart: 90, temp: 35.0, steps: 5000, sleep: 7.0 },
  alert: { heart: 100, temp: 35.7, steps: 3000, sleep: 6.0 },
};
const scenarioSegments = {
  good: [{ start: '00:00', end: '06:30' }, { start: '12:14', end: '13:02' }, { start: '14:50', end: '15:14' }],
  watch: [{ start: '00:20', end: '06:20' }, { start: '12:10', end: '13:10' }],
  alert: [{ start: '00:40', end: '05:40' }, { start: '12:00', end: '13:00' }],
};

// This prototype flags patterns for review; these are not clinical cut-offs.
// Urgency comes from an explicitly reported emergency sign, never from the
// wellness score, estimated sleep or surface temperature alone.
export const emergencySignIds = Object.freeze(['breathing_difficulty', 'collapse', 'blue_gums', 'seizure', 'severe_pain']);
export function assessCurrentHealth(reading = {}, observedSigns = []) {
  const emergencySigns = [...new Set((Array.isArray(observedSigns) ? observedSigns : []).filter(sign => emergencySignIds.includes(sign)))];
  const assessedAt = new Date().toISOString();
  if (emergencySigns.length) return { level: 'alert', emergencySigns, reasons: emergencySigns, assessedAt };
  const keys = ['heart', 'temp', 'steps', 'sleep'];
  const valid = keys.every(key => Number.isFinite(reading[key]) && reading[key] >= 0 && Number.isFinite(reading.baseline?.[key]) && reading.baseline[key] > 0);
  if (!valid) return { level: 'unknown', emergencySigns, reasons: ['incomplete_readings'], assessedAt };
  const reasons = [];
  if (Math.abs(reading.heart / reading.baseline.heart - 1) >= .10) reasons.push('heart_change');
  if (Math.abs(reading.temp - reading.baseline.temp) >= .5) reasons.push('skin_temperature_change');
  if (Math.abs(reading.steps / reading.baseline.steps - 1) >= .20) reasons.push('activity_change');
  if (Math.abs(reading.sleep - reading.baseline.sleep) >= .75) reasons.push('rest_change');
  return { level: reasons.length ? 'watch' : 'good', emergencySigns, reasons, assessedAt };
}

// Absence of sensor data is not a zero reading or a healthy assessment.
// A Bluetooth connection alone cannot supply measurements or a baseline.
export function createEmptySnapshot({ connected = false, observedSigns = [] } = {}) {
  const triage = assessCurrentHealth({}, observedSigns);
  return {
    scenario: null,
    simulated: false,
    source: 'unavailable',
    connected: connected === true,
    score: null,
    status: triage.level,
    triage,
    observedSigns: triage.emergencySigns,
    observationSource: triage.emergencySigns.length ? 'owner' : 'unavailable',
    updatedAt: null,
    heart: null,
    temp: null,
    steps: null,
    sleep: null,
    history: [],
    segments: [],
    baseline: {},
    deviations: [],
  };
}

// The score is a demo index of weighted differences from a personal baseline.
// Each row's impact is its point deduction, capped at the metric's weight.
// Temperature uses an absolute °C difference. Other metrics use relative change.
function demoScore(reading, baseline) {
  const deviations = scoreMetrics.map(({ key, label, unit, weight, scale }) => {
    const difference = round(reading[key] - baseline[key]);
    const relativeChange = difference / baseline[key];
    const distance = key === 'temp' ? Math.abs(difference) : Math.abs(relativeChange);
    const impact = round(Math.min(1, distance / scale) * weight);
    return { key, label, current: reading[key], baseline: baseline[key], unit, change: round(relativeChange * 100, 1), difference, impact, weight };
  });
  const score = Math.max(0, Math.min(100, Math.round(100 - deviations.reduce((sum, row) => sum + row.impact, 0))));
  return {score, deviations};
}

// A test account has a synthetic comparison baseline. Derive only its example
// assessment here: measurements, history and freshness still come from the DB.
// Real accounts and incomplete uploads must never inherit this sample baseline.
export function withTestAssessment(value, account) {
  if (account?.isTest !== true || value?.source !== 'test' || value.simulated !== true ||
      !scoreMetrics.every(({key}) => Number.isFinite(value[key]) && value[key] >= 0)) return value;
  const baseline = {...demoBaseline};
  const triage = assessCurrentHealth({...value, baseline}, value.observedSigns);
  return {...value, ...demoScore(value, baseline), baseline, status:triage.level,
    triage:{...triage, assessedAt:value.updatedAt || triage.assessedAt, provenance:'Simulated assessment · fixed example baseline'}};
}

export function createSnapshot(requestedScenario = 'good', options = {}) {
  const scenario = Object.hasOwn(scenarioReadings, requestedScenario) ? requestedScenario : 'good';
  const reading = scenarioReadings[scenario];
  const baseline = {...demoBaseline};
  const {score, deviations} = demoScore(reading, baseline);
  const observedSigns = Array.isArray(options?.observedSigns)
    ? options.observedSigns.filter(sign => emergencySignIds.includes(sign))
    : scenario === 'alert' ? ['breathing_difficulty', 'collapse'] : [];
  const triage = assessCurrentHealth({ ...reading, baseline }, observedSigns);
  const status = triage.level;
  const history = priorReadings.slice(1).map((day, index) => ({
    date: dayKey(demoDate(index - 6)),
    heart: day.heart,
    temp: day.temp,
    steps: day.steps,
    sleep: day.sleep,
  }));
  history.push({ date: dayKey(demoDate()), heart: reading.heart, temp: reading.temp, steps: reading.steps, sleep: reading.sleep });
  return {
    scenario,
    score,
    status,
    triage,
    observedSigns: triage.emergencySigns,
    observationSource: options?.observationSource === 'owner' ? 'owner' : 'demo',
    updatedAt: demoDate().toISOString(),
    ...reading,
    history,
    segments: scenarioSegments[scenario].map(segment => ({ ...segment })),
    baseline,
    deviations,
  };
}

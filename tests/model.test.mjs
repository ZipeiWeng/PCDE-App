import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { selectAccount, readStore, saveStore, normalizePreferences, normalizeBirthday, ageFromBirthday, createSnapshot, createEmptySnapshot, assessCurrentHealth } from '../dist/model.js';
import { recordDeviceAlert } from '../dist/device-alerts.js';

const demoKey = 'pawprint-health.store.v2';
const account = { id: 'owner-a', username: 'Jamie', petName: 'Pip', petBirthday: '2022-03-04', petSex: 'female' };
let saved;

beforeEach(() => {
  saved = new Map();
  globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  selectAccount(null);
});

test('new real accounts seed identity with no sample care records or medical details', () => {
  const demo = readStore();
  saveStore(demo);
  selectAccount(account);
  const real = readStore();
  assert.equal(real.profile.name, 'Pip');
  assert.equal(real.profile.breed, 'Not recorded');
  assert.equal(real.profile.birthday, '2022-03-04');
  assert.equal(real.profile.age, ageFromBirthday(account.petBirthday));
  assert.equal(real.profile.sex, 'Female');
  assert.equal(real.profile.weight, 0);
  assert.equal(real.ownerName, 'Jamie');
  assert.equal(real.doctorName, '');
  assert.equal(real.clinicName, '');
  assert.deepEqual(real.records, []);
  assert.equal(saved.size, 1, 'reading a new account does not write storage');
  assert.ok(demo.records.length > 0);
});

test('a new sensor snapshot has no score, zero readings, fabricated history or sync date', () => {
  for (const connected of [false, true]) {
    const empty = createEmptySnapshot({connected});
    assert.equal(empty.status, 'unknown');
    assert.equal(empty.score, null);
    for (const key of ['heart','temp','steps','sleep','updatedAt','scenario']) assert.equal(empty[key], null);
    assert.equal(empty.connected, connected);
    assert.equal(empty.simulated, false);
    assert.equal(empty.source, 'unavailable');
    assert.equal(empty.observationSource, 'unavailable');
    assert.deepEqual(empty.history, []);
    assert.deepEqual(empty.segments, []);
    assert.deepEqual(empty.deviations, []);
    assert.deepEqual(empty.baseline, {});
    assert.equal(assessCurrentHealth(empty).level, 'unknown');
  }
});

test('owner emergency observations override missing sensors without inventing measurements', () => {
  const empty = createEmptySnapshot({connected:true, observedSigns:['collapse','collapse','unrecognized']});
  assert.equal(empty.status, 'alert');
  assert.equal(empty.score, null);
  assert.equal(empty.heart, null);
  assert.deepEqual(empty.observedSigns, ['collapse']);
  assert.equal(empty.observationSource, 'owner');
  assert.equal(createEmptySnapshot({observedSigns:[]}).status, 'unknown');
});

test('real account stores remain separate from one another and the legacy demo store', () => {
  const demo = readStore();
  demo.profile.name = 'Demo pet';
  saveStore(demo);
  const originalDemo = saved.get(demoKey);

  selectAccount(account);
  const first = readStore();
  first.records.push({ id: 'note-a', type: 'observation', title: 'Owner note', date: '2026-01-01T10:00:00Z', details: 'A-only', author: 'Owner' });
  first.goals.steps = 9200;
  assert.equal(saveStore(first), true);
  assert.ok(saved.has('pawprint-health.store.v3:owner-a'));

  selectAccount({ ...account, id: 'owner-b', username: 'Morgan', petName: 'Ash' });
  assert.deepEqual(readStore().records, []);
  assert.equal(readStore().profile.name, 'Ash');
  const second = readStore();
  second.allergies = 'Owner B note';
  saveStore(second);

  selectAccount(account);
  assert.equal(readStore().records[0].details, 'A-only');
  assert.equal(readStore().goals.steps, 9200);
  assert.equal(readStore().allergies, 'None recorded');
  assert.equal(readStore().profile.weight, 0, 'unknown weight survives normalization');
  assert.equal(saved.get(demoKey), originalDemo);

  selectAccount({ id: 'preview-session', demo: true });
  assert.equal(readStore().profile.name, 'Demo pet');
  assert.equal(readStore().records.length, demo.records.length);
});

test('health card modules retain independent open states through saving and reopening', () => {
  selectAccount(account);
  const first = readStore();
  assert.deepEqual(first.healthCardModules, {});
  first.healthCardModules = { allergies: false, conditions: true, vaccination: false, parasite: true, medication: false, history: true };
  assert.equal(saveStore(first), true);
  const reopened = readStore();
  assert.deepEqual(reopened.healthCardModules, first.healthCardModules);
  reopened.healthCardModules.vaccination = true;
  assert.equal(saveStore(reopened), true);
  assert.deepEqual(readStore().healthCardModules, { ...first.healthCardModules, vaccination: true });
  assert.deepEqual(readStore().records, first.records, 'presentation preferences do not change care data');
});

test('health card module preferences stay separate for accounts, test accounts and preview', () => {
  const preview = readStore();
  assert.deepEqual(preview.healthCardModules, {});
  saveStore({ ...preview, healthCardModules: { allergies: false } });
  selectAccount(account);
  assert.deepEqual(readStore().healthCardModules, {});
  saveStore({ ...readStore(), healthCardModules: { vaccination: false, parasite: true } });
  selectAccount({ ...account, id: 'owner-b' });
  assert.deepEqual(readStore().healthCardModules, {});
  saveStore({ ...readStore(), healthCardModules: { conditions: false } });
  selectAccount({ ...account, id: 'test-owner', isTest: true });
  assert.deepEqual(readStore().healthCardModules, {});
  saveStore({ ...readStore(), healthCardModules: { history: false } });
  selectAccount(account);
  assert.deepEqual(readStore().healthCardModules, { vaccination: false, parasite: true });
  selectAccount({ ...account, id: 'owner-b' });
  assert.deepEqual(readStore().healthCardModules, { conditions: false });
  selectAccount({ ...account, id: 'test-owner', isTest: true });
  assert.deepEqual(readStore().healthCardModules, { history: false });
  selectAccount(null);
  assert.deepEqual(readStore().healthCardModules, { allergies: false });
});

test('health card module normalization ignores invalid entries and preserves default-open omissions', () => {
  selectAccount(account);
  const initial = readStore();
  const legacy = { ...initial };
  delete legacy.healthCardModules;
  saved.set('pawprint-health.store.v3:owner-a', JSON.stringify(legacy));
  assert.deepEqual(readStore().healthCardModules, {}, 'existing accounts have no forced closed modules');
  saveStore({ ...initial, healthCardModules: { allergies: false, vaccination: true, conditions: 'false', parasite: 0, medication: null, history: {}, unknown: false } });
  assert.deepEqual(readStore().healthCardModules, { allergies: false, vaccination: true });
  assert.equal(Object.hasOwn(readStore().healthCardModules, 'conditions'), false, 'missing or invalid modules use the view default');
  for (const value of [null, false, 0, 'closed', [false, true]]) {
    saveStore({ ...initial, healthCardModules: value });
    assert.deepEqual(readStore().healthCardModules, {});
  }
});

test('legacy preferences migrate only in preview and never into a real account', () => {
  saved.set('pawprint-health.preferences.v1', JSON.stringify({
    profile: { name: 'Legacy dog', breed: '金毛寻回犬', age: 4, weight: 30 },
    medications: [{ name: 'Legacy care', note: 'Historical owner entry' }],
  }));
  selectAccount(account);
  assert.deepEqual(readStore().records, []);
  assert.equal(readStore().profile.name, 'Pip');
  saved.set('pawprint-health.store.v3:owner-a', '{broken json');
  assert.deepEqual(readStore().records, []);
  selectAccount(null);
  const legacy = readStore();
  assert.equal(legacy.profile.name, 'Legacy dog');
  assert.equal(legacy.profile.breed, 'Golden retriever');
  assert.ok(legacy.records.some(record => record.title === 'Legacy care'));
  assert.equal(saved.has(demoKey), false);
});

test('birthdays use valid local calendar dates and derive completed years', () => {
  const today = new Date(2026, 10, 11, 12);
  assert.equal(normalizeBirthday('2024-02-29', today), '2024-02-29');
  assert.equal(normalizeBirthday('2025-02-29', today), '');
  assert.equal(normalizeBirthday('2026-11-12', today), '');
  assert.equal(normalizeBirthday('2022-3-4', today), '');
  assert.equal(normalizeBirthday('2022-03-04T00:00:00Z', today), '');
  assert.equal(ageFromBirthday('2022-11-11', today), 4);
  assert.equal(ageFromBirthday('2022-11-12', today), 3);
  assert.equal(ageFromBirthday('', today), null);
  selectAccount(account);
  const store = readStore();
  store.profile.age = 99;
  saveStore(store);
  assert.equal(readStore().profile.age, ageFromBirthday(account.petBirthday));
  store.profile.birthday = '';
  store.profile.age = 2.5;
  saveStore(store);
  assert.equal(readStore().profile.age, 2.5, 'manual age remains available without a birthday');
});

test('invalid identity fails without switching into another account store', () => {
  selectAccount(account);
  assert.throws(() => selectAccount({ username: 'No ID' }), /account ID/);
  assert.equal(readStore().profile.name, 'Pip');
  assert.equal(saveStore(readStore()), true);
  assert.deepEqual([...saved.keys()], ['pawprint-health.store.v3:owner-a']);
});

test('explicit avatar removal survives saving and stays inside its account', () => {
  selectAccount(account);
  const store=readStore();
  assert.equal(store.profile.photoRemoved,false);
  assert.equal(saveStore({...store,profile:{...store.profile,photo:'',photoRemoved:true}}),true);
  assert.equal(readStore().profile.photoRemoved,true);
  assert.equal(readStore().profile.photo,'');
  selectAccount({...account,id:'owner-b'});
  assert.equal(readStore().profile.photoRemoved,false);
  selectAccount(account);
  assert.equal(readStore().profile.photoRemoved,true);
  const removed=readStore();
  assert.equal(saveStore({...removed,profile:{...removed.profile,photo:'data:image/jpeg;base64,YWJj',photoRemoved:false}}),true);
  assert.equal(readStore().profile.photoRemoved,false);
});

test('avatar source and crop survive isolated reloads without changing the saved display image', () => {
  selectAccount(account);
  const source='data:image/jpeg;base64,c291cmNl';
  const display='data:image/jpeg;base64,ZGlzcGxheQ==';
  const crop={zoom:2.25,centerX:0.35,centerY:0.6};
  const store=readStore();
  assert.equal(store.profile.photoSource,'');
  assert.equal(store.profile.photoCrop,null);
  assert.equal(saveStore({...store,profile:{...store.profile,photo:display,photoSource:source,photoCrop:crop}}),true);
  selectAccount({...account,id:'crop-owner-b'});
  assert.equal(readStore().profile.photoSource,'');
  assert.equal(readStore().profile.photoCrop,null);
  selectAccount(account);
  assert.equal(readStore().profile.photo,display);
  assert.equal(readStore().profile.photoSource,source);
  assert.deepEqual(readStore().profile.photoCrop,crop);
  const removed=readStore();
  assert.equal(saveStore({...removed,profile:{...removed.profile,photoRemoved:true}}),true);
  assert.equal(readStore().profile.photo,display,'existing display-image bytes are preserved by normalization');
  assert.equal(readStore().profile.photoSource,'','explicit removal clears editable source');
  assert.equal(readStore().profile.photoCrop,null,'explicit removal clears crop');
});

test('editable avatar sources are bounded JPEGs and crop coordinates are validated and clamped', () => {
  selectAccount(account);
  const display='existing-display-photo';
  const prefix='data:image/jpeg;base64,';
  const maxSource=prefix+'A'.repeat(1800000-prefix.length);
  const crop={zoom:2,centerX:0.4,centerY:0.6};
  const write=(source,position)=>{
    const state=readStore();
    assert.equal(saveStore({...state,profile:{...state.profile,photo:display,photoSource:source,photoCrop:position,photoRemoved:false}}),true);
    const profile=readStore().profile;
    assert.equal(profile.photo,display);
    return profile;
  };
  assert.equal(write(maxSource,crop).photoSource,maxSource);
  for(const invalid of [maxSource+'A','data:image/png;base64,YWJj','data:image/webp;base64,YWJj','data:image/svg+xml;base64,YWJj','https://example.com/photo.jpg','./mochi.webp','data:image/jpeg;base64,',null,{}]){
    const profile=write(invalid,crop);
    assert.equal(profile.photoSource,'');
    assert.equal(profile.photoCrop,null,'a crop cannot survive without its source image');
  }
  const source=prefix+'YWJj';
  assert.deepEqual(write(source,{zoom:8,centerX:-0.5,centerY:1.5}).photoCrop,{zoom:4,centerX:0,centerY:1});
  assert.deepEqual(write(source,{zoom:0,centerX:0.2,centerY:0.3}).photoCrop,{zoom:1,centerX:0.2,centerY:0.3});
  for(const invalid of [null,{},[],{zoom:2,centerX:0.5},{zoom:'2',centerX:0.5,centerY:0.5},{zoom:NaN,centerX:0.5,centerY:0.5},{zoom:2,centerX:Infinity,centerY:0.5},{zoom:2,centerX:0.5,centerY:false}]){
    const profile=write(source,invalid);
    assert.equal(profile.photoSource,source);
    assert.equal(profile.photoCrop,null);
  }
});

test('monitoring remains explicitly synthetic and unchanged by account selection', () => {
  const demo = createSnapshot('good');
  selectAccount(account);
  const real = createSnapshot('good');
  for (const metric of ['heart', 'temp', 'steps', 'sleep', 'score']) assert.equal(real[metric], demo[metric]);
});

test('wellness scenarios use only the four supported sensor metrics', () => {
  const snapshots = ['good', 'watch', 'alert'].map(createSnapshot);
  for (const snapshot of snapshots) {
    assert.equal('sneezes' in snapshot, false);
    assert.equal('meals' in snapshot, false);
    assert.deepEqual(Object.keys(snapshot.baseline), ['heart', 'temp', 'steps', 'sleep']);
    assert.deepEqual(snapshot.deviations.map(row => row.key), ['heart', 'temp', 'steps', 'sleep']);
    assert.equal(snapshot.deviations.reduce((sum, row) => sum + row.weight, 0), 100);
    assert.ok(Number.isFinite(snapshot.score) && snapshot.score >= 0 && snapshot.score <= 100);
    assert.equal(snapshot.status, snapshot.scenario);
  }
  assert.ok(snapshots[0].score > snapshots[1].score && snapshots[1].score > snapshots[2].score);
  assert.equal(readStore().records.some(record => record.type === 'meal'), false);
});

test('sleep, activity, surface temperature and score cannot independently declare an emergency', () => {
  const base = createSnapshot('good');
  for (const changed of [{sleep:.1}, {steps:0}, {temp:40}, {heart:150}, {score:1}]) {
    const result = assessCurrentHealth({...base,...changed}, []);
    assert.notEqual(result.level, 'alert');
  }
  const severePattern = createSnapshot('alert', {observedSigns:[]});
  assert.equal(severePattern.status, 'watch');
  assert.ok(severePattern.score < 50);
});

test('reported urgent signs override a reassuring score, even with missing readings', () => {
  for (const sign of ['breathing_difficulty','collapse','blue_gums','seizure','severe_pain']) {
    assert.equal(assessCurrentHealth(createSnapshot('good'), [sign]).level, 'alert');
    assert.equal(assessCurrentHealth({}, [sign]).level, 'alert');
  }
  const result = assessCurrentHealth(createSnapshot('good'), ['sleep','collapse','collapse','<script>']);
  assert.deepEqual(result.emergencySigns,['collapse']);
  assert.equal(assessCurrentHealth({}, []).level,'unknown');
  assert.equal(assessCurrentHealth({...createSnapshot('good'),sleep:NaN}, []).level,'unknown');
});

test('demo emergency signs stay explicit and owner check-ins can replace them', () => {
  const demo = createSnapshot('alert');
  assert.equal(demo.observationSource,'demo');
  assert.deepEqual(demo.observedSigns,['breathing_difficulty','collapse']);
  const checked = createSnapshot('alert',{observedSigns:[],observationSource:'owner'});
  assert.equal(checked.status,'watch');
  assert.equal(checked.observationSource,'owner');
  const reported = createSnapshot('good',{observedSigns:['blue_gums'],observationSource:'owner'});
  assert.equal(reported.status,'alert');
  assert.equal(reported.score,createSnapshot('good').score);
});

test('retired meal tracking preserves existing history but rejects new entries', () => {
  const oldEntry = { id: 'old-meal', type: 'meal', title: 'Historical entry', date: '2026-01-01T08:00:00Z', details: 'Owner history', author: 'Owner' };
  saved.set(demoKey, JSON.stringify({ records: [oldEntry] }));
  const oldStorage = saved.get(demoKey);
  const store = readStore();
  assert.equal(saved.get(demoKey), oldStorage, 'reading never writes or deletes history');
  assert.deepEqual(store.records.filter(record=>record.type==='meal'), [oldEntry]);
  store.goals.steps = 9000;
  assert.equal(saveStore(store), true);
  assert.deepEqual(readStore().records.filter(record=>record.type==='meal'), [oldEntry], 'unrelated edits retain retired records');
  const beforeRejectedWrite = saved.get(demoKey);
  store.records.push({ ...oldEntry, id: 'new-meal' });
  assert.equal(saveStore(store), false);
  assert.equal(saved.get(demoKey), beforeRejectedWrite);
});

test('settings defaults are safe and normalization bounds every stored preference', () => {
  const defaults = { language: 'en', alertsEnabled: true, syncInterval: 5, subscription: 'free', quietHours: false, backgroundMode: 'neutral', backgroundPhoto: '', backgroundProfilePhoto: '', backgroundFrost: 60, pawPattern: true };
  assert.deepEqual(readStore().preferences, defaults);
  selectAccount(account);
  assert.deepEqual(readStore().preferences, defaults);
  const store = readStore();
  store.preferences = {
    language: 'fr', alertsEnabled: 'false', syncInterval: 0, subscription: 'admin', startupPage: 'settings', quietHours: 'true', reducedMotion: 1,
    sessionToken: 'must-not-persist', billingAuthorized: true,
  };
  assert.equal(saveStore(store), true);
  assert.deepEqual(readStore().preferences, defaults);
  const persisted = JSON.parse(saved.get('pawprint-health.store.v3:owner-a'));
  assert.deepEqual(persisted.preferences, defaults, 'unknown settings and credential fields are discarded');

  store.preferences = { language: 'zh', alertsEnabled: false, syncInterval: 15, subscription: 'plus', quietHours: true, backgroundMode: 'profile', backgroundPhoto: '', backgroundProfilePhoto: '', backgroundFrost: 85, pawPattern: false };
  assert.equal(saveStore(store), true);
  assert.deepEqual(readStore().preferences, store.preferences);
  store.preferences.syncInterval = 1;
  store.preferences.backgroundFrost = 42;
  saveStore(store);
  assert.equal(readStore().preferences.syncInterval, 1);
  assert.equal(readStore().preferences.backgroundFrost, 42);
  for (const invalid of [-1, 2, 60, '5', null]) {
    store.preferences.syncInterval = invalid;
    saveStore(store);
    assert.equal(readStore().preferences.syncInterval, 5);
  }
  store.preferences = null;
  saveStore(store);
  assert.deepEqual(readStore().preferences, defaults);
});

test('preferences stay isolated between accounts, preview and unsaved views', () => {
  const preview = readStore();
  preview.preferences.language = 'zh';
  preview.preferences.syncInterval = 15;
  saveStore(preview);
  const originalPreview = saved.get(demoKey);

  selectAccount(account);
  const first = readStore();
  assert.equal(first.preferences.language, 'en');
  first.preferences.alertsEnabled = false;
  first.preferences.quietHours = true;
  first.preferences.backgroundFrost = 80;
  first.preferences.subscription = 'plus';
  saveStore(first);

  selectAccount({ ...account, id: 'owner-b' });
  const second = readStore();
  assert.deepEqual(second.preferences, { language: 'en', alertsEnabled: true, syncInterval: 5, subscription: 'free', quietHours: false, backgroundMode: 'neutral', backgroundPhoto: '', backgroundProfilePhoto: '', backgroundFrost: 60, pawPattern: true });
  second.preferences.language = 'zh';
  second.preferences.syncInterval = 1;
  assert.equal(readStore().preferences.language, 'en', 'mutating an unsaved view does not change defaults');
  saveStore(second);

  selectAccount(account);
  assert.deepEqual(readStore().preferences, first.preferences);
  assert.equal(saved.get(demoKey), originalPreview);
  selectAccount(null);
  assert.deepEqual(readStore().preferences, preview.preferences);
});


test('saved profile backgrounds accept only local raster photos and remain isolated from later avatar changes', () => {
  const photo='data:image/jpeg;base64,YWJj';
  for(const valid of [photo,'data:image/png;base64,YWJj','data:image/webp;base64,YWJj','./mochi.webp']) {
    assert.equal(normalizePreferences({backgroundProfilePhoto:valid}).backgroundProfilePhoto,valid);
  }
  for(const invalid of [null,{},'https://example.com/dog.jpg','//example.com/dog.jpg','./mochi.webp?other=1','./avatar-default.svg','data:image/svg+xml;base64,YWJj','data:image/jpeg;base64,','data:image/jpeg;base64,<script>','data:image/jpeg;base64,'+'A'.repeat(1800001)]) {
    assert.equal(normalizePreferences({backgroundProfilePhoto:invalid}).backgroundProfilePhoto,'');
  }
  selectAccount(account);
  const first=readStore();
  first.preferences.backgroundProfilePhoto=photo;
  first.profile.photo='';
  first.profile.photoRemoved=true;
  assert.equal(saveStore(first),true);
  selectAccount({...account,id:'background-owner-b'});
  assert.equal(readStore().preferences.backgroundProfilePhoto,'');
  selectAccount(account);
  const restored=readStore();
  assert.equal(restored.preferences.backgroundProfilePhoto,photo);
  assert.equal(restored.profile.photoRemoved,true);
  assert.equal(restored.profile.photo,'');
  const changed={...restored,profile:{...restored.profile,photo:'data:image/png;base64,ZGVm',photoRemoved:false}};
  assert.equal(saveStore(changed),true);
  assert.equal(readStore().preferences.backgroundProfilePhoto,photo,'an avatar replacement cannot overwrite the separately stored background');
  selectAccount(null);
  assert.equal(readStore().preferences.backgroundProfilePhoto,'');
});

test('custom backgrounds and scanned record provenance survive isolated account storage', () => {
  selectAccount(account);
  const store = readStore();
  store.preferences.backgroundMode = 'custom';
  store.preferences.backgroundPhoto = 'data:image/jpeg;base64,YWJj';
  store.preferences.pawPattern = true;
  store.records.push({ id: 'scan-one', type: 'visit', title: 'Document review', date: '2026-11-13', details: 'Owner reviewed', source: 'scan', sourceFilename: 'visit.pdf', medications: 'As recorded on document', city: 'London', author: 'Owner' });
  assert.equal(saveStore(store), true);
  const restored = readStore();
  assert.equal(restored.preferences.backgroundPhoto, store.preferences.backgroundPhoto);
  assert.equal(restored.records[0].source, 'scan');
  assert.equal(restored.records[0].medications, 'As recorded on document');
  assert.equal(restored.records[0].city, 'London');
  selectAccount({ ...account, id: 'another-owner' });
  assert.equal(readStore().preferences.backgroundPhoto, '');
  assert.equal(readStore().records.length, 0);
  selectAccount(account);
  const invalid = readStore();
  invalid.preferences.backgroundPhoto = 'javascript:alert(1)';
  saveStore(invalid);
  assert.equal(readStore().preferences.backgroundPhoto, '');
});


test('frost amount survives storage, is bounded, and retired controls cannot reappear', () => {
  const store = readStore();
  for (const [input, expected] of [[0, 0], [100, 100], [56.6, 57], [-40, 0], [180, 100], ['80', 60], [null, 60], [NaN, 60], [Infinity, 60]]) {
    store.preferences.backgroundFrost = input;
    store.preferences.startupPage = 'assistant';
    store.preferences.reducedMotion = true;
    assert.equal(saveStore(store), true);
    const preferences = readStore().preferences;
    assert.equal(preferences.backgroundFrost, expected);
    assert.equal('startupPage' in preferences, false);
    assert.equal('reducedMotion' in preferences, false);
  }
});

test('historical record city is optional, preserved in its original language and bounded', () => {
  const store = readStore();
  store.records = [{ id:'history', type:'visit', title:'Follow-up', date:'2026-11-10', details:'Recorded visit', clinic:'Example Veterinary', author:'Owner' }];
  assert.equal(saveStore(store), true);
  assert.equal(readStore().records[0].city, undefined, 'older records do not acquire an inferred city');
  for (const [city, expected] of [['  南昌  ', '南昌'], ['', ''], ['a'.repeat(170), 'a'.repeat(160)], [null, undefined], [123, undefined]]) {
    store.records[0].city = city;
    assert.equal(saveStore(store), true);
    assert.equal(readStore().records[0].city, expected);
  }
});

test('device warning history is empty by default, persists without advice, and remains account isolated', () => {
  const preview = readStore();
  assert.deepEqual(preview.deviceAlerts, []);
  preview.deviceAlerts = recordDeviceAlert([], createSnapshot('watch'), {title:'Possible discomfort',risk:'A pattern to review',reason:'Readings differ',source:'demo',now:'2026-11-13T10:00:00Z'});
  preview.deviceAlerts[0].advice = 'Not part of the alert record';
  assert.equal(saveStore(preview), true);
  const savedPreview = readStore().deviceAlerts;
  assert.equal(savedPreview.length, 1);
  assert.equal('advice' in savedPreview[0], false);
  selectAccount(account);
  const real = readStore();
  assert.deepEqual(real.deviceAlerts, []);
  real.deviceAlerts = recordDeviceAlert([], createSnapshot('good', {observedSigns:['collapse'],observationSource:'owner'}), {title:'Urgent signs',risk:'Acute illness possible',reason:'Collapse reported',source:'owner',now:'2026-11-13T11:00:00Z'});
  assert.equal(saveStore(real), true);
  selectAccount({...account,id:'owner-b'});
  assert.deepEqual(readStore().deviceAlerts, []);
  selectAccount(account);
  assert.equal(readStore().deviceAlerts[0].source, 'owner');
  selectAccount(null);
  assert.deepEqual(readStore().deviceAlerts, savedPreview);
});

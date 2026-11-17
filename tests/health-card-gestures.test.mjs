import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

class Surface {
  handlers = new Map();
  attributes = new Map();
  dataset = {};
  isConnected = true;
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type, event = {}) { return [...(this.handlers.get(type) || [])].map(fn => fn(event)); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  click() { return this.emit('click', { detail: 0 }); }
  focus() { this.focused = true; }
  contains() { return true; }
}

const win = new Surface(), dialog = new Surface(), root = new Surface();
const classes = new Set();
let nodes = new Map(), markup = '', selection = false, role = 'owner', saves = [], account = null, onboarding = false;
const node = selector => {
  if (!nodes.has(selector)) {
    const element = new Surface();
    element.elements = new Proxy({}, { get: (_, name) => node(`${selector} [name=${String(name)}]`) });
    element.querySelector = child => node(`${selector} ${child}`);
    nodes.set(selector, element);
  }
  return nodes.get(selector);
};
const body = {
  set innerHTML(value) {
    for (const old of nodes.values()) old.isConnected = false;
    nodes = new Map(); markup = value;
  },
  get innerHTML() { return markup; },
};
const elements = {
  'app-sheet': dialog,
  'sheet-close': new Surface(),
  'sheet-title': {},
  'sheet-eyebrow': {},
  toast: {},
};
dialog.open = false;
dialog.classList = {
  add: (...names) => names.forEach(name => classes.add(name)),
  remove: (...names) => names.forEach(name => classes.delete(name)),
  contains: name => classes.has(name),
};
dialog.querySelector = selector => selector === '.sheet-body' ? body : node(selector);
dialog.querySelectorAll = selector => {
  if (selector === '.card-scan-file') return [node('[data-scan-camera]'), node('[data-scan-upload]')];
  if (selector === '[data-medical-history]') return [...markup.matchAll(/data-medical-history="([^"]+)"/g)].map(([, id]) => {
    const button = node(`history-${id}`); button.dataset.medicalHistory = id; return button;
  });
  if (selector === 'details') return [...markup.matchAll(/<details\b([^>]*)>/g)].map(([, attributes], index) => {
    const key = `details-${index}`, exists = nodes.has(key), details = node(key);
    if (!exists) { details.open = /(?:^|\s)open(?:\s|$)/.test(attributes); details.dataset.summaryModule = /data-summary-module="([^"]+)"/.exec(attributes)?.[1]; }
    return details;
  });
  return [];
};
dialog.showModal = () => { dialog.open = true; };
dialog.close = () => { if (dialog.open) { dialog.open = false; dialog.emit('close'); } };
root.contains = () => true;
root.querySelector = () => null;
globalThis.window = win;
globalThis.document = root.ownerDocument = dialog.ownerDocument = {
  defaultView: win,
  getElementById: id => elements[id],
  getSelection: () => ({ isCollapsed: !selection, toString: () => selection ? 'selected text' : '' }),
};
globalThis.requestAnimationFrame = callback => callback();
globalThis.FormData = class { constructor(form) { this.values = form.values; } get(name) { return this.values[name] ?? ''; } };
let readFile = reader => { reader.result = 'data:application/pdf;base64,AA=='; reader.onload(); };
globalThis.FileReader = class { readAsDataURL() { readFile(this); } };
const { initHealthCard } = await import('../dist/health-card.js');
const { openSheet } = await import('../dist/ui.js');
const { installSwipeDismiss } = await import('../dist/settings-gestures.js');
const store = {
  profile: { name: 'Mochi', breed: 'Golden retriever', age: 3, weight: 28.5, sex: 'Female', photo: '' },
  allergies: 'None recorded', conditions: 'None recorded', deviceAlerts: [],
  records: [
    { id: 'visit-1', type: 'visit', title: 'Ear recheck', date: '2026-11-01T12:00:00Z', symptoms: 'Recheck', diagnosis: 'Resolved', clinic: 'Sample clinic', city: 'Sample city', sample: true },
    { id: 'vaccine-1', type: 'vaccine', title: 'Recorded vaccine', date: '2026-10-01T12:00:00Z', details: 'Archived clinic record', sample: true },
  ],
};
let snapshot = { history: [] };
const card = initHealthCard(root, {
  getStore: () => store,
  getSnapshot: () => snapshot,
  getRole: () => role,
  persist: next => { saves.push(next); store.healthCardModules = next.healthCardModules; return true; },
  getAccount: () => account,
  isOnboarding: () => onboarding,
  onChange() {},
});
// Match the main card's independent return recognizer: a child swipe must not
// also close its parent once the modal is dismissed.
installSwipeDismiss(root, { isEnabled: () => !root.hidden && !dialog.open, onDismiss: () => { root.hidden = true; } });

function action(name) {
  const button = { dataset: { cardAction: name } };
  root.emit('click', { target: { closest: () => button } });
}
function record(id) {
  const button = { dataset: { cardRecord: id } };
  root.emit('click', { target: { closest: () => button } });
}
function pointer(x, y = 100, target = { closest: () => false }) {
  return {
    pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
    clientX: x, clientY: y, target, cancelable: true, detail: 1,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}
function swipe(dx = 100, dy = 0, target) {
  const down = pointer(100, 100, target);
  win.emit('pointerdown', down); dialog.emit('pointerdown', down);
  const movement = pointer(100 + dx, 100 + dy, target); win.emit('pointermove', movement);
  const release = pointer(100 + dx, 100 + dy, target); win.emit('pointerup', release);
  return { movement, release };
}
function releaseClick() { const event = pointer(200); win.emit('click', event); return event; }
const title = () => elements['sheet-title'].textContent;
const pdf = { name: 'clinic-note.pdf', type: 'application/pdf', size: 1000 };
function choosePdf() { const input = node('[data-scan-upload]'); input.files = [pdf]; input.emit('change'); }
function extract() { return node('.card-scan-extract').click()[0]; }
const scanResult = { ok: true, json: async () => ({ draft: { type: 'visit', title: 'Scanned check-up', date: '2026-11-01', symptoms: 'Follow-up' }, warnings: [] }) };
afterEach(() => {
  // Replacing an open view cleans up without triggering its parent return route.
  if (dialog.open) { openSheet({ title: 'Reset', body: '' }); dialog.close(); }
  win.emit('blur'); selection = false; role = 'owner'; saves = []; root.hidden = false; snapshot = { history: [] };
  delete store.healthCardModules; account = null; onboarding = false;
  readFile = reader => { reader.result = 'data:application/pdf;base64,AA=='; reader.onload(); };
});

test('every Health card child view returns to the main card on right swipe', () => {
  root.hidden = false;
  for (const [name, expected] of [['profile', 'Pet profile'], ['health', 'Health essentials'], ['add', 'Add a health record'], ['summary', 'Summary card'], ['scan', 'Scan a record'], ['visit', 'Record a consultation']]) {
    role = name === 'visit' ? 'vet' : 'owner';
    action(name);
    assert.equal(title(), expected);
    assert.equal(dialog.open, true);
    const { release } = swipe();
    assert.equal(dialog.open, false, expected);
    assert.equal(root.hidden, false, 'the underlying Health card remains open');
    assert.equal(release.prevented, true);
    assert.equal(releaseClick().prevented, true, 'release cannot tap the exposed page');
  }
  record('visit-1'); swipe();
  assert.equal(dialog.open, false);
  assert.equal(root.hidden, false);
});

test('medical-history detail returns one level to its summary, preserving scroll and expanded information', () => {
  action('summary');
  dialog.scrollTop = 480;
  dialog.querySelectorAll('details')[0].open = false;
  dialog.querySelectorAll('details').find(item => !item.dataset.summaryModule).open = true;
  dialog.querySelectorAll('[data-medical-history]')[0].click();
  assert.equal(title(), 'Ear recheck');
  assert.equal(elements['sheet-close'].attributes.get('aria-label'), 'Back to summary card');
  swipe();
  assert.equal(dialog.open, true);
  assert.equal(title(), 'Summary card');
  assert.equal(dialog.scrollTop, 480);
  assert.equal(dialog.querySelectorAll('details')[0].open, false);
  assert.equal(dialog.querySelectorAll('details').find(item => !item.dataset.summaryModule).open, true);
  assert.equal(dialog.querySelectorAll('[data-medical-history]')[0].focused, true);
  assert.equal(root.hidden, false);
  swipe();
  assert.equal(dialog.open, false);
  assert.equal(root.hidden, false);
});

test('form editing, slider gestures, selected text, vertical scrolling and left swipes do not dismiss', () => {
  action('profile');
  for (const [dx, dy, target] of [
    [-100, 0], [5, 100], [3, 2],
    ...['input', 'select', 'textarea', 'contenteditable', 'input[type=range]'].map(name => [100, 0, { closest: selector => selector.includes(name.split('[')[0]) }]),
  ]) {
    const { movement, release } = swipe(dx, dy, target);
    assert.equal(dialog.open, true);
    assert.equal(movement.prevented, false);
    assert.equal(release.prevented, false);
    assert.equal(releaseClick().prevented, false);
  }
  selection = true; swipe(); assert.equal(dialog.open, true);
  selection = false; swipe(); assert.equal(dialog.open, false);
  assert.equal(saves.length, 0, 'dismissing does not submit an edited form');
});

test('a replaced card sheet leaves unrelated shared dialogs and hospital pages untouched', () => {
  action('summary');
  openSheet({ title: 'Nearby vets', body: '<div>Map and clinics</div>', onOpen: target => target.classList.add('vet-finder-sheet') });
  const { movement, release } = swipe();
  assert.equal(dialog.open, true);
  assert.equal(title(), 'Nearby vets');
  assert.equal(movement.prevented, false);
  assert.equal(release.prevented, false);
  assert.equal(releaseClick().prevented, false);
  dialog.close();
  action('health'); swipe(); assert.equal(dialog.open, false, 'reopening a card sheet restores its own gesture');
});

test('scan review returns to the selected document, then one further swipe returns to the card', async () => {
  globalThis.fetch = async () => scanResult;
  action('scan'); choosePdf(); await extract();
  assert.equal(title(), 'Review the record');
  assert.equal(elements['sheet-close'].attributes.get('aria-label'), 'Back to scan records');
  swipe();
  assert.equal(dialog.open, true);
  assert.equal(title(), 'Scan a record');
  assert.equal(node('.card-scan-selected').textContent, pdf.name);
  assert.equal(node('.card-scan-extract').disabled, false);
  assert.equal(saves.length, 0);
  swipe(); assert.equal(dialog.open, false); assert.equal(root.hidden, false);
});

test('saving a reviewed document returns to the card without reopening the scan screen', async () => {
  globalThis.fetch = async () => scanResult;
  action('scan'); choosePdf(); await extract();
  const form = node('#card-scan-review');
  form.values = { type: 'visit', title: 'Reviewed check-up', date: '2026-11-01', symptoms: 'Follow-up' };
  form.emit('submit', { preventDefault() {} });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].records.at(-1).source, 'scan');
  assert.equal(dialog.open, false);
  assert.equal(root.hidden, false);
});

test('leaving while reading a file prevents any extraction request from starting', async () => {
  let reader, requests = 0;
  readFile = current => { reader = current; };
  globalThis.fetch = async () => { requests++; return scanResult; };
  action('scan'); choosePdf(); const pending = extract();
  swipe();
  reader.result = 'data:application/pdf;base64,AA=='; reader.onload();
  await pending;
  assert.equal(requests, 0);
  assert.equal(dialog.open, false);
  assert.equal(saves.length, 0);
});

test('leaving during extraction aborts it and ignores even a late successful response', async () => {
  let finish, signal;
  globalThis.fetch = (_, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); };
  action('scan'); choosePdf(); const pending = extract();
  await Promise.resolve();
  assert.equal(signal.aborted, false);
  swipe();
  assert.equal(signal.aborted, true);
  openSheet({ title: 'Nearby vets', body: 'Map' });
  finish(scanResult); await pending;
  assert.equal(title(), 'Nearby vets', 'late scan output cannot replace the page opened after returning');
  assert.equal(saves.length, 0);
});

test('a queued native close event cannot let a dismissed scan start a request', async () => {
  let reader, requests = 0, deliverClose;
  const closeImmediately = dialog.close;
  dialog.close = () => { dialog.open = false; deliverClose = () => dialog.emit('close'); };
  readFile = current => { reader = current; };
  globalThis.fetch = async () => { requests++; return scanResult; };
  try {
    action('scan'); choosePdf(); const pending = extract();
    swipe();
    reader.result = 'data:application/pdf;base64,AA=='; reader.onload();
    await pending;
    assert.equal(requests, 0);
    assert.equal(dialog.open, false);
    deliverClose();
  } finally { dialog.close = closeImmediately; }
});

test('returning from the profile form discards a photo still being processed', async () => {
  let finishPhoto, bitmapClosed = false;
  const originalCreateElement = document.createElement;
  globalThis.createImageBitmap = () => new Promise(resolve => { finishPhoto = resolve; });
  document.createElement = () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/webp;base64,AA==' });
  try {
    action('profile');
    const form = node('#card-profile-form');
    form.values = { name: 'Changed name', breed: 'Golden retriever', age: '3', weight: '28.5', sex: 'Female', photo: { type: 'image/jpeg', size: 1000 } };
    const pending = form.emit('submit', { preventDefault() {} })[0];
    swipe();
    finishPhoto({ width: 900, height: 900, close() { bitmapClosed = true; } });
    await pending;
    assert.equal(bitmapClosed, true);
    assert.equal(saves.length, 0);
    assert.equal(dialog.open, false);
    assert.equal(root.hidden, false);
  } finally { document.createElement = originalCreateElement; }
});

test('Summary card care modules open initially and each can collapse while alerts and monitoring stay visible', () => {
  action('summary');
  assert.equal(title(), 'Summary card');
  const modules = dialog.querySelectorAll('details').filter(item => item.dataset.summaryModule);
  assert.deepEqual(modules.map(item => item.dataset.summaryModule), ['allergies','conditions','vaccination','parasite','medication','history']);
  assert.equal(modules.every(item => item.open), true);
  modules.forEach(item => { item.open = false; });
  assert.match(markup, /<section class="card-device-alerts">/);
  assert.match(markup, /<section class="card-monitoring-summary">/);
  assert.match(markup, /Copy summary card/);
  assert.doesNotMatch(markup, /Visit summary/);
});

test('each module keeps its own disclosure state after closing, reopening and rerendering the Health card', () => {
  action('summary');
  const modules = dialog.querySelectorAll('details').filter(item => item.dataset.summaryModule);
  for (const id of ['allergies','vaccination','history']) {
    const section = modules.find(item => item.dataset.summaryModule === id);
    section.open = false; section.emit('toggle');
  }
  assert.deepEqual(store.healthCardModules, {allergies:false, vaccination:false, history:false});
  swipe(); action('summary');
  for (const section of dialog.querySelectorAll('details').filter(item => item.dataset.summaryModule)) {
    assert.equal(section.open, !['allergies','vaccination','history'].includes(section.dataset.summaryModule));
  }
  const vaccine = dialog.querySelectorAll('details').find(item => item.dataset.summaryModule === 'vaccination');
  vaccine.open = true; vaccine.emit('toggle');
  assert.deepEqual(store.healthCardModules, {allergies:false, vaccination:true, history:false});
  root.emit('click', {target:{closest:() => ({dataset:{cardTab:'overview'}})}});
  assert.match(root.innerHTML, /data-summary-module="allergies"><summary>/);
  assert.match(root.innerHTML, /data-summary-module="vaccination" open><summary>/);
  assert.match(root.innerHTML, /data-summary-module="parasite" open><summary>/);
});

test('temporary tutorial, copy and stale-account disclosure changes do not overwrite saved choices', () => {
  account = {id:'first'};
  store.healthCardModules = {allergies:false};
  action('summary');
  const section = dialog.querySelectorAll('details')[0];
  onboarding = true;
  section.open = true; section.emit('toggle');
  section.open = false; section.emit('toggle');
  onboarding = false;
  section.open = true; section.open = false; section.emit('toggle');
  assert.equal(saves.length, 0);
  account = {id:'second'};
  section.open = true; section.emit('toggle');
  assert.equal(saves.length, 0, 'queued changes cannot leak into another account');
  account = {id:'first'};
  action('summary');
  section.open = false; section.emit('toggle');
  assert.equal(saves.length, 0, 'detached sections cannot overwrite current choices');
  assert.deepEqual(store.healthCardModules, {allergies:false});
});

test('monitoring period changes keep available coverage honest and survive a case-detail return', () => {
  const date = new Date(), day = date.toISOString().slice(0,10);
  snapshot = { scenario:'good', history:[{date:day,heart:82,temp:34.6,steps:6248,sleep:7.7}] };
  action('summary');
  const monitoring = node('.card-monitoring-slot');
  const changeRange = value => monitoring.emit('click', { target:{closest:() => ({dataset:{monitoringRange:value}})} });
  changeRange('30');
  assert.match(monitoring.innerHTML, /1 of 30 days have readings/);
  assert.match(monitoring.innerHTML, /data-monitoring-range="30" aria-pressed="true"/);
  changeRange('all');
  assert.match(monitoring.innerHTML, /<strong>1 reading<\/strong> · 1 recorded day/);
  assert.match(monitoring.innerHTML, /Only available readings are included/);
  dialog.querySelectorAll('[data-medical-history]')[0].click();
  swipe();
  assert.equal(title(), 'Summary card');
  assert.match(markup, /data-monitoring-range="all" aria-pressed="true"/);
});

test('copying the Summary card includes folded records and restores their visual state', async () => {
  action('summary');
  const details = dialog.querySelectorAll('details');
  details.forEach(item => { item.open = false; });
  node('.card-visit-summary').children = [{matches:() => false, get innerText() { return details.every(item => item.open) ? 'All recorded care' : 'Collapsed headings'; }}];
  let copied;
  Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{clipboard:{writeText:async text => { copied = text; }}}});
  await node('.card-copy-button').click()[0];
  assert.match(copied, /^SUMMARY CARD/);
  assert.match(copied, /All recorded care/);
  assert.equal(details.every(item => !item.open), true);
});

test('Health card opens directly on full Summary card modules without a redundant destination', () => {
  root.emit('click', {target:{closest:() => ({dataset:{cardTab:'overview'}})}});
  assert.match(root.innerHTML, /data-card-tab="overview">Summary<\/button>/);
  assert.match(root.innerHTML, /data-card-tab="timeline">Timeline<\/button>/);
  assert.doesNotMatch(root.innerHTML, /card-summary-link|Latest consultation|Vaccines, parasite care &amp; medicines/);
  const modules = [...root.innerHTML.matchAll(/data-summary-module="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(modules, ['allergies','conditions','vaccination','parasite','medication','history']);
  assert.match(root.innerHTML, /Recorded vaccine/);
  assert.match(root.innerHTML, /Archived clinic record/);
  assert.match(root.innerHTML, /data-medical-history="visit-1"/);
  assert.match(root.innerHTML, /data-card-action="scan"/);
  assert.match(root.innerHTML, /data-card-action="add"/);
  assert.match(root.innerHTML, /data-card-action="health"/);
  assert.match(root.innerHTML, /card-device-alerts/);
  assert.match(root.innerHTML, /data-monitoring-range="30"/);
  assert.match(root.innerHTML, /data-monitoring-range="all"/);
  assert.equal((root.innerHTML.match(/<h2>Mochi<\/h2>/g) || []).length, 1);
  assert.doesNotMatch(root.innerHTML, /card-summary-pet/);
});

test('a case opened from the main summary returns directly to it without rebuilding the card', () => {
  root.emit('click', {target:{closest:() => ({dataset:{cardTab:'overview'}})}});
  const original = root.innerHTML;
  root.scrollTop = 680;
  root.emit('click', { target:{closest:() => ({dataset:{medicalHistory:'visit-1'}})} });
  assert.equal(title(), 'Ear recheck');
  assert.match(markup, /Resolved/);
  swipe();
  assert.equal(dialog.open, false);
  assert.equal(root.hidden, false);
  assert.equal(root.innerHTML, original, 'the mounted accordion state is not replaced');
  assert.equal(root.scrollTop, 680);
});

test('the main summary changes monitoring period in place without rebuilding records', () => {
  root.emit('click', {target:{closest:() => ({dataset:{cardTab:'overview'}})}});
  const original = root.innerHTML;
  const originalQuery = root.querySelector;
  const monitoring = new Surface();
  monitoring.querySelector = () => null;
  root.querySelector = selector => selector === '.card-monitoring-slot' ? monitoring : null;
  try {
    root.emit('click', { target:{closest:() => ({dataset:{monitoringRange:'30'}})} });
    assert.match(monitoring.innerHTML, /data-monitoring-range="30" aria-pressed="true"/);
    assert.equal(root.innerHTML, original);
    root.emit('click', { target:{closest:() => ({dataset:{monitoringRange:'all'}})} });
    assert.match(monitoring.innerHTML, /data-monitoring-range="all" aria-pressed="true"/);
    assert.equal(root.innerHTML, original);
  } finally { root.querySelector = originalQuery; }
});

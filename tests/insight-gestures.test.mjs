import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';

class Surface {
  handlers = new Map();
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type, event = {}) { for (const fn of this.handlers.get(type) || []) fn(event); }
  setAttribute() {}
}

const win = new Surface();
const dialog = new Surface();
const classes = new Set();
const body = { innerHTML: '' };
const control = new Surface();
const elements = {
  'app-sheet': dialog,
  'sheet-close': new Surface(),
  'sheet-title': {},
  'sheet-eyebrow': {},
};
dialog.open = false;
dialog.dataset = {};
dialog.classList = {
  add: (...names) => names.forEach(name => classes.add(name)),
  remove: (...names) => names.forEach(name => classes.delete(name)),
  contains: name => classes.has(name),
};
dialog.querySelector = selector => selector === '.sheet-body' ? body : control;
dialog.querySelectorAll = () => [];
dialog.showModal = () => { dialog.open = true; };
dialog.close = () => { dialog.open = false; dialog.emit('close'); };
globalThis.window = win;
globalThis.document = dialog.ownerDocument = {
  defaultView: win,
  getElementById: id => elements[id],
  getSelection: () => ({ isCollapsed: true }),
};
const { initInsights } = await import('../dist/insights.js');
const { createEmptySnapshot } = await import('../dist/model.js');
const usual = { heart: 80, temp: 34.5, steps: 6500, sleep: 8 };
let status = 'watch';
let canDismiss = true;
const insights = initInsights({
  getSnapshot: () => ({ ...usual, baseline: usual, status }),
  getStore: () => ({ profile: { name: 'Mochi' } }),
  canDismiss: () => canDismiss,
});

function event(x, y = 100, target = { closest: () => false }) {
  return {
    pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0,
    clientX: x, clientY: y, target, cancelable: true, detail: 1,
    prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}
function swipe(dx, dy = 0, target) {
  const down = event(100, 100, target);
  win.emit('pointerdown', down);
  dialog.emit('pointerdown', down);
  const movement = event(100 + dx, 100 + dy, target);
  win.emit('pointermove', movement);
  const release = event(100 + dx, 100 + dy, target);
  win.emit('pointerup', release);
  return { movement, release };
}
function click() {
  const releaseClick = event(200);
  win.emit('click', releaseClick);
  return releaseClick;
}
afterEach(() => {
  dialog.close();
  win.emit('blur');
  status = 'watch';
  canDismiss = true;
});

test('guided detail explanations cannot be swiped away until the return step', () => {
  for (const open of [() => insights.open(), () => insights.openVets()]) {
    canDismiss = false;
    open();
    for (const direction of [-100, 100]) {
      swipe(direction);
      assert.equal(dialog.open, true);
    }
    canDismiss = true;
    swipe(100);
    assert.equal(dialog.open, false);
    click();
  }
});

test('Current health closes in either direction and shields the release click after teardown', () => {
  for (const direction of [-100, 100]) {
    insights.open();
    assert.equal(elements['sheet-title'].textContent, 'Current health');
    const { release } = swipe(direction);
    assert.equal(dialog.open, false);
    assert.equal(release.prevented, true);
    assert.equal(click().prevented, true);
    assert.equal(click().prevented, false);
  }
});

test('Current health ignores vertical scrolls, taps and form gestures', () => {
  insights.open();
  for (const [dx, dy, target] of [
    [5, 100], [3, 2],
    [100, 0, { closest: selector => selector.includes('input') }],
  ]) {
    const { movement, release } = swipe(dx, dy, target);
    assert.equal(dialog.open, true);
    assert.equal(movement.prevented, false);
    assert.equal(release.prevented, false);
    assert.equal(release.stopped, false);
    assert.equal(click().prevented, false);
  }
});

test('replacing Current health removes dismissal from urgent-sign and alarm views', () => {
  for (const [openNext, title] of [
    [() => insights.openSignCheck(), 'Check urgent signs'],
    [() => insights.open({ alarm: true }), 'Health alert'],
  ]) {
    insights.open();
    openNext();
    assert.equal(elements['sheet-title'].textContent, title);
    assert.equal(classes.has('insight-current'), false);
    const { movement, release } = swipe(100);
    assert.equal(dialog.open, true);
    assert.equal(movement.prevented, false);
    assert.equal(release.prevented, false);
    assert.equal(click().prevented, false);
    dialog.close();
  }
});

test('reopening Current health restores right dismissal for normal and unknown status', () => {
  for (const nextStatus of ['good', 'unknown']) {
    status = nextStatus;
    insights.open();
    swipe(100);
    assert.equal(dialog.open, false);
    click();
  }
});


test('Nearby vets owns dismissal in both directions without inheriting Current health direction rules', () => {
  for (const direction of [-100, 100]) {
    insights.open();
    insights.openVets();
    assert.equal(elements['sheet-title'].textContent, 'Nearby vets');
    assert.equal(classes.has('insight-current'), false);
    assert.equal(classes.has('vet-finder-sheet'), true);
    const { release } = swipe(direction);
    assert.equal(dialog.open, false);
    assert.equal(release.prevented, true);
    assert.equal(classes.has('vet-finder-sheet'), false);
    assert.equal(click().prevented, true, 'gesture release cannot activate the exposed app');
  }
});

test('Nearby vets leaves map drags untouched and removes its gesture listener when another sheet opens', () => {
  insights.openVets();
  const mapTarget = { closest: selector => selector.includes('[data-no-settings-swipe]') };
  for (const direction of [-100, 100]) {
    const { movement, release } = swipe(direction, 0, mapTarget);
    assert.equal(dialog.open, true, 'panning the map must not dismiss the finder');
    assert.equal(movement.prevented, false);
    assert.equal(release.prevented, false);
    assert.equal(click().prevented, false);
  }
  insights.openSignCheck();
  assert.equal(classes.has('vet-finder-sheet'), false);
  for (const direction of [-100, 100]) {
    const { release } = swipe(direction);
    assert.equal(dialog.open, true, 'the replacement sheet has no inherited vet dismiss handler');
    assert.equal(release.prevented, false);
  }
  insights.openVets();
  insights.open();
  swipe(-100);
  assert.equal(dialog.open, false, 'Current health uses its own bidirectional dismissal');
});

test('empty Current health distinguishes disconnected from connected without making an assessment', () => {
  let sample=createEmptySnapshot();
  const empty=initInsights({getSnapshot:()=>sample,getStore:()=>({profile:{name:'Pip'}}),onConnect(){}});
  empty.open();
  assert.match(body.innerHTML,/<h3>No readings yet<\/h3>/);
  assert.match(body.innerHTML,/Connect collar/);
  assert.doesNotMatch(body.innerHTML,/Looking good|No unusual changes|Possible joint|Usual|Simulated data/);
  dialog.close();
  sample=createEmptySnapshot({connected:true});
  empty.open();
  assert.match(body.innerHTML,/Waiting for first reading/);
  assert.match(body.innerHTML,/No measurements have arrived yet/);
  assert.match(body.innerHTML,/Device settings/);
});

test('an owner-reported emergency with no readings never says sensor changes are normal', () => {
  const empty=initInsights({getSnapshot:()=>createEmptySnapshot({observedSigns:['collapse']}),getStore:()=>({profile:{name:'Pip'}})});
  empty.open({alarm:true});
  assert.match(body.innerHTML,/No sensor readings available/);
  assert.match(body.innerHTML,/Contact nearest vet/);
  assert.doesNotMatch(body.innerHTML,/No major sensor changes|No unusual changes|Simulated data/);
});

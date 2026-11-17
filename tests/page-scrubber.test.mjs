import test from 'node:test';
import assert from 'node:assert/strict';
import { installPageScrubber } from '../dist/page-scrubber.js';
import { installPageGestures } from '../dist/gestures.js';

class Surface {
  handlers = new Map();
  addEventListener(type, callback) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.handlers.get(type)?.delete(callback); }
  emit(type, event) {
    for (const callback of [...(this.handlers.get(type) || [])]) callback(event);
  }
}

function harness() {
  const root = new Surface(), win = new Surface();
  const classes = new Set(), styles = new Map(), captures = new Set();
  let enabled = true, clock = 100;
  const selected = [];
  const buttons = [0, 1, 2].map(position => ({
    dataset: { position: String(position) },
    getBoundingClientRect: () => ({ left: position * 44, right: (position + 1) * 44, width: 44, top: 80, height: 44 }),
  }));
  win.performance = { now: () => clock };
  root.ownerDocument = { defaultView: win };
  root.querySelectorAll = () => buttons;
  root.getBoundingClientRect = () => ({ left: 0, right: 132, width: 132, top: 80, height: 44 });
  root.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  root.style = { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) };
  root.setPointerCapture = id => captures.add(id);
  root.hasPointerCapture = id => captures.has(id);
  root.releasePointerCapture = id => captures.delete(id);
  const cleanup = installPageScrubber(root, { enabled: () => enabled, onSelect: position => selected.push(position) });
  function event(x = 66, y = 100, extra = {}) {
    return {
      clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true,
      button: 0, detail: 1, cancelable: true, target: buttons[1],
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...extra,
    };
  }
  function down(x = 66, y = 100, extra = {}) {
    const value = event(x, y, extra); win.emit('pointerdown', value); root.emit('pointerdown', value); return value;
  }
  function move(x, y = 100, extra = {}) { const value = event(x, y, extra); win.emit('pointermove', value); return value; }
  function up(x = 66, y = 100, extra = {}) { const value = event(x, y, extra); win.emit('pointerup', value); return value; }
  function click(extra = {}) { const value = event(66, 100, extra); root.emit('click', value); return value; }
  return { root, win, selected, classes, styles, captures, cleanup, event, down, move, up, click,
    enable: value => { enabled = value; }, clock: value => { clock = value; } };
}

test('holding and dragging across dots selects their physical positions before release', () => {
  const h = harness();
  h.down();
  const left = h.move(22);
  assert.deepEqual(h.selected, [0]);
  assert.equal(left.prevented, true);
  assert.equal(h.classes.has('is-scrubbing'), true);
  h.move(66); h.move(110);
  assert.deepEqual(h.selected, [0, 1, 2]);
  h.move(111);
  assert.deepEqual(h.selected, [0, 1, 2], 'moving within one dot must not rerender it repeatedly');
  h.up(110);
  assert.deepEqual(h.selected, [0, 1, 2], 'release must not also advance a page');
  assert.equal(h.classes.has('is-scrubbing'), false);
  h.cleanup();
});

test('ordinary taps and keyboard clicks remain available; a real drag shields its trailing click', () => {
  const h = harness();
  h.down(22); h.up(24, 102);
  assert.deepEqual(h.selected, []);
  assert.equal(h.click().prevented, false, 'tap is handled by the existing button click listener');
  h.down(); h.move(110); h.up(110);
  assert.equal(h.click({ detail: 0 }).prevented, false, 'keyboard activation is not a synthetic pointer click');
  const trailingClick = h.click();
  assert.equal(trailingClick.prevented, true);
  assert.equal(trailingClick.stopped, true);
  h.clock(1000);
  assert.equal(h.click().prevented, false, 'click shielding must expire');
  h.cleanup();
});

test('vertical intent locks out navigation even when the finger later moves sideways', () => {
  const h = harness();
  h.down(22);
  const vertical = h.move(24, 140);
  h.move(110, 145); h.up(110, 145);
  assert.equal(vertical.prevented, false);
  assert.deepEqual(h.selected, []);
  assert.equal(h.classes.has('is-scrubbing'), false);
  h.cleanup();
});

test('pointer cancellation, capture loss, and window blur clear the gesture without a later switch', () => {
  for (const [surface, type] of [['win', 'pointercancel'], ['root', 'lostpointercapture'], ['win', 'blur']]) {
    const h = harness();
    h.down(); h.move(22);
    assert.deepEqual(h.selected, [0]);
    if (type === 'lostpointercapture') h.captures.delete(1);
    h[surface].emit(type, h.event(22, 100, { target: type === 'blur' ? h.win : h.root }));
    h.move(110); h.up(110);
    assert.deepEqual(h.selected, [0], type);
    assert.equal(h.classes.has('is-scrubbing'), false, type);
    h.cleanup();
  }
});

test('a previous dot losing focus must not cancel the new drag, but window blur must', () => {
  const h = harness();
  h.down(66); h.move(22); h.up(22);
  h.down(22);
  h.win.emit('blur', h.event(22));
  h.move(66); h.move(110); h.up(110);
  assert.deepEqual(h.selected, [0, 1, 2], 'descendant focus changes during a new press do not cancel scrubbing');
  h.down(110);
  h.win.emit('blur', { target: h.win });
  h.move(22); h.up(22);
  assert.deepEqual(h.selected, [0, 1, 2], 'leaving the browser window still cancels the pending drag');
  h.cleanup();
});

test('touch capture transfer from a dot to the row does not cancel this or the next drag', () => {
  const h = harness();
  h.down(66); h.move(56);
  assert.equal(h.captures.has(1), true);
  h.root.emit('lostpointercapture', h.event(56));
  h.move(22); h.up(22);
  assert.deepEqual(h.selected, [1, 0]);
  assert.equal(h.captures.has(1), false);
  h.down(22); h.move(32);
  h.root.emit('lostpointercapture', h.event(32));
  h.move(66); h.move(110); h.up(110);
  assert.deepEqual(h.selected, [1, 0, 0, 1, 2]);
  assert.equal(h.classes.has('is-scrubbing'), false);
  h.cleanup();
});

test('a second finger and disabled navigation cannot continue an active scrub', () => {
  const h = harness();
  h.down();
  h.down(70, 100, { pointerId: 2, isPrimary: false });
  h.move(110); h.up(110); h.up(70, 100, { pointerId: 2, isPrimary: false });
  assert.deepEqual(h.selected, []);
  h.enable(false); h.down(); h.move(22); h.up(22);
  assert.deepEqual(h.selected, []);
  h.enable(true); h.down(); h.enable(false); h.move(110); h.up(110);
  assert.deepEqual(h.selected, []);
  assert.equal(h.classes.has('is-scrubbing'), false);
  h.cleanup();
});

test('tracking survives leaving the dot row and cleans up all listeners', () => {
  const h = harness();
  h.down(); h.move(240); h.up(240);
  assert.deepEqual(h.selected, [2], 'outside movement resolves to the nearest available dot');
  h.cleanup();
  h.down(); h.move(22); h.up(22);
  assert.deepEqual(h.selected, [2]);
  for (const surface of [h.root, h.win]) {
    for (const listeners of surface.handlers.values()) assert.equal(listeners.size, 0);
  }
});

test('the page swipe recognizer excludes dot drags while ordinary cyclic swipes keep working', () => {
  const h = harness(), workspace = new Surface(), doc = new Surface();
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const steps = [];
  let page = 0;
  globalThis.window = h.win;
  globalThis.document = doc;
  try {
    installPageGestures(workspace, {
      enabled: () => true,
      onSwipe: direction => { steps.push(direction); page = (page + direction + 3) % 3; },
    });
    const dotTarget = { closest: selector => selector.includes('[data-page-scrubber]') };
    const down = h.event(22, 100, { target: dotTarget });
    h.win.emit('pointerdown', down); workspace.emit('pointerdown', down); h.root.emit('pointerdown', down);
    const movement = h.event(110, 100, { target: dotTarget });
    h.win.emit('pointermove', movement); workspace.emit('pointermove', movement);
    h.win.emit('pointerup', movement);
    assert.deepEqual(h.selected, [2]);
    assert.deepEqual(steps, [], 'ancestor capture must not arm a second swipe for the same dot drag');
    for (const dx of [100, -100]) {
      const target = { closest: () => false };
      workspace.emit('pointerdown', h.event(100, 100, { target }));
      workspace.emit('pointermove', h.event(100 + dx, 100, { target }));
      h.win.emit('pointerup', h.event(100 + dx, 100, { target }));
      assert.equal(page, dx > 0 ? 2 : 0, 'main-page swipes continue wrapping first and last');
    }
    assert.deepEqual(steps, [-1, 1]);
  } finally {
    h.cleanup();
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

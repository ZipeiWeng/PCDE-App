import test from 'node:test';
import assert from 'node:assert/strict';

let fixtureId = 0;
async function withSheet(callback) {
  const pending = [];
  const listeners = new Map();
  const body = { innerHTML: '' };
  const dialog = {
    open: false, scrollTop: 0, classList: { remove() {} },
    querySelector: () => body,
    showModal() { this.open = true; },
    close() {
      if (!this.open) return;
      this.open = false;
      pending.push(() => listeners.get('close')());
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
  };
  const elements = {
    'app-sheet': dialog, 'sheet-title': {}, 'sheet-eyebrow': {},
    'sheet-close': { addEventListener() {}, setAttribute() {} },
  };
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => elements[id] };
  try {
    // Each sheet module attaches its close listener to this fixture's dialog.
    const api = await import(`../dist/ui.js?sheet-test=${++fixtureId}`);
    await callback({ ...api, dialog, elements, pending });
  } finally { globalThis.document = previous; }
}

test('closing a case can reopen its parent summary without erasing the summary cleanup', async () => {
  await withSheet(({ openSheet, closeSheet, dialog, elements, pending }) => {
    const events = [];
    openSheet({ title: 'Case details', body: 'Full recorded case', onClose() {
      events.push('case closed');
      openSheet({ title: 'Visit summary', body: 'Medical history',
        onOpen() { events.push('summary opened'); },
        onClose() { events.push('summary closed'); },
      });
    } });
    closeSheet();
    assert.equal(dialog.open, false);
    pending.shift()();
    assert.equal(dialog.open, true);
    assert.equal(elements['sheet-title'].textContent, 'Visit summary');
    assert.deepEqual(events, ['case closed', 'summary opened']);
    closeSheet();
    pending.shift()();
    assert.equal(dialog.open, false);
    assert.deepEqual(events, ['case closed', 'summary opened', 'summary closed']);
    closeSheet();
    assert.equal(pending.length, 0);
  });
});

test('a queued close event cannot tear down a newly opened sheet', async () => {
  await withSheet(({ openSheet, closeSheet, dialog, pending }) => {
    let oldCleanups = 0, newCleanups = 0;
    openSheet({ title: 'Demo picker', body: '', onClose: () => oldCleanups++ });
    closeSheet();
    openSheet({ title: 'Health alert', body: '', onClose: () => newCleanups++ });
    pending.shift()();
    assert.equal(oldCleanups, 1);
    assert.equal(newCleanups, 0);
    assert.equal(dialog.open, true);
    closeSheet();
    pending.shift()();
    assert.equal(newCleanups, 1);
  });
});

test('replacing sheet content cleans up the previous view once before mounting the next view', async () => {
  await withSheet(({ openSheet, closeSheet, elements, pending }) => {
    const events = [];
    openSheet({ title: 'Visit summary', body: 'Summary body',
      onOpen: () => events.push('summary opened'),
      onClose: () => events.push('summary cleaned'),
    });
    openSheet({ title: 'Case details', body: 'Complete case',
      onOpen() {
        assert.equal(elements['sheet-title'].textContent, 'Case details');
        events.push('case opened');
      },
      onClose: () => events.push('case cleaned'),
    });
    assert.deepEqual(events, ['summary opened', 'summary cleaned', 'case opened']);
    assert.equal(pending.length, 0);
    closeSheet();
    pending.shift()();
    assert.deepEqual(events, ['summary opened', 'summary cleaned', 'case opened', 'case cleaned']);
  });
});

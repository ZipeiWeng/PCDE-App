import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDeviceAlerts } from '../dist/device-alert-view.js';

const now = new Date('2026-11-13T12:00:00Z');

test('an empty alert history has an honest empty timeline and seven zero counts', () => {
  const html = renderDeviceAlerts([], {now});
  assert.match(html, /No alerts recorded\./);
  assert.match(html, /<strong>0 alerts<\/strong>/);
  assert.equal((html.match(/class="card-alert-day"/g) || []).length,7);
  assert.equal((html.match(/class="card-alert-number">0</g) || []).length,7);
  assert.doesNotMatch(html,/class="card-alert-event /);
});

test('alert timeline is newest-first while chart counts only the last seven days', () => {
  const events = [
    {id:'old',at:'2026-10-01T12:00:00Z',level:'watch',risk:'Older pattern',reason:'Older readings',source:'demo'},
    {id:'a',at:'2026-11-12T12:00:00Z',level:'watch',risk:'First recent pattern',reason:'Recorded reason',source:'demo'},
    {id:'b',at:'2026-11-13T09:00:00Z',level:'alert',risk:'Newer event',reason:'Reported urgent signs',source:'owner',trend:{state:'insufficient',summary:'No later readings.'}},
  ];
  const html = renderDeviceAlerts(events,{now});
  assert.match(html, /<strong>2 alerts<\/strong>/);
  assert.ok(html.indexOf('Newer event')<html.indexOf('First recent pattern'));
  assert.ok(html.indexOf('First recent pattern')<html.indexOf('Older pattern'));
  assert.match(html, /Owner reported/);
  assert.match(html, />Demo</);
  assert.match(html, /More observations needed/);
});

test('alert content is escaped, metric improvement is explicit, and advice is not part of the module', () => {
  const html = renderDeviceAlerts([{id:'a',at:'2026-11-13T09:00:00Z',level:'watch',risk:'<script>risk</script>',reason:'sleep < baseline',source:'demo',advice:'Do not render this advice',trend:{state:'improving',summary:'Sleep moved closer to its baseline.'}}],{now});
  assert.match(html,/&lt;script&gt;risk&lt;\/script&gt;/);
  assert.match(html,/sleep &lt; baseline/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/Readings closer to baseline/);
  assert.match(html,/Sleep moved closer to its baseline\./);
  assert.doesNotMatch(html,/Do not render this advice/);
});


test('owner follow-ups describe observations and show only valid later timestamps', () => {
  const entry={id:'owner',at:'2026-11-12T09:00:00Z',level:'alert',risk:'Urgent signs',reason:'Owner observation',source:'owner',trend:{state:'improving',at:'2026-11-13T09:30:00Z',summary:'One fewer urgent sign was reported.'}};
  const html=renderDeviceAlerts([entry],{now});
  assert.match(html,/Fewer urgent signs reported/);
  assert.doesNotMatch(html,/Readings closer to baseline/);
  assert.match(html,/datetime="2026-11-13T09:30:00Z"/);
  assert.match(html,/Updated 13 Nov 2026, 09:30/);
  for (const at of ['<script>bad</script>','2026-11-11T09:00:00Z','2026-11-12T09:00:00Z']) {
    const invalid=renderDeviceAlerts([{...entry,trend:{...entry.trend,at}}],{now});
    assert.doesNotMatch(invalid,/card-alert-followup/);
    assert.doesNotMatch(invalid,/<script>/);
  }
});

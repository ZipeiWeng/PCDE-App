import test from 'node:test';
import assert from 'node:assert/strict';
import { medicalIcon } from '../dist/medical-icons.js';

test('reusable care markers have independent accessible names without duplicate IDs or hidden semantics',()=>{
  for(const [kind,label] of [['vaccine','Vaccination record'],['deworming','Deworming record']]){
    const svg=medicalIcon(kind);
    assert.match(svg,/role="img"/);
    assert.ok(svg.includes(`aria-label="${label}"`));
    assert.doesNotMatch(svg,/\bid=|aria-hidden/);
  }
  assert.match(medicalIcon('vaccine',{label:'Sample vaccination record'}),/aria-label="Sample vaccination record"/);
});

test('contextual labels and classes cannot inject markup, and unsupported record types are rejected',()=>{
  const svg=medicalIcon('deworming',{label:'Owner "note" <script>alert(1)</script>',className:'x" onload="alert(1)'});
  assert.ok(svg.includes('aria-label="Owner &quot;note&quot; &lt;script&gt;alert(1)&lt;/script&gt;"'));
  assert.doesNotMatch(svg,/<script|\sonload="/);
  assert.throws(()=>medicalIcon('__proto__'),TypeError);
  assert.throws(()=>medicalIcon('planned-vaccine'),TypeError);
});

test('uncompleted parasite care retains the bug and slash without the green check badge',()=>{
  const completed=medicalIcon('deworming',{label:'Parasite care record'});
  const planned=medicalIcon('deworming',{label:'Planned parasite care',recorded:false});
  for(const svg of [completed,planned]){
    assert.match(svg,/<ellipse[^>]+fill="#a2abb2"/);
    assert.match(svg,/stroke="#273138"/);
  }
  assert.match(completed,/stroke="#63a14b"/);
  assert.doesNotMatch(planned,/stroke="#63a14b"/);
  assert.match(planned,/aria-label="Planned parasite care"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptParts } from '../dist/companion-motion.js';

test('appending live speech keeps the confirmed prefix still and marks only new words',()=>{
  assert.deepEqual(transcriptParts('Mochi is ','Mochi is resting.'),[
    {text:'Mochi ',fresh:false},
    {text:'is ',fresh:false},
    {text:'resting.',fresh:true},
  ]);
});

test('revising interim speech replaces its ending instead of keeping stale recognized words',()=>{
  const parts=transcriptParts('Mochi is running','Mochi is resting now');
  assert.equal(parts.map(part=>part.text).join(''),'Mochi is resting now');
  assert.deepEqual(parts.map(part=>part.fresh),[false,false,true,true]);
});

test('unchanged speech has no newly animated words and clearing discards every word',()=>{
  assert.equal(transcriptParts('Mochi is resting.','Mochi is resting.').every(part=>!part.fresh),true);
  assert.deepEqual(transcriptParts('Mochi is resting.',''),[]);
});

test('live speech preserves punctuation, whitespace, Unicode and CJK text exactly',()=>{
  for(const text of ['  Mochi\nfeels\tbetter.  ','Mochi 今天很活泼。','它今天吃了饭，还喝了水！','He’s asleep 🐕 — at 10:30.','<script>not markup</script>']){
    const parts=transcriptParts('',text);
    assert.equal(parts.map(part=>part.text).join(''),text);
    assert.equal(parts.every(part=>part.fresh),true);
  }
});

test('appending Chinese, Japanese or Korean speech does not replay its existing sentence',()=>{
  for(const [before,after] of [['今天很开心','今天很开心还想出门'],['モチか\u3099ねて','モチか\u3099ねています'],['모치가자고','모치가자고있어요']]){
    const parts=transcriptParts(before,after);
    assert.equal(parts.filter(part=>!part.fresh).map(part=>part.text).join(''),before);
    assert.equal(parts.filter(part=>part.fresh).map(part=>part.text).join(''),after.slice(before.length));
    assert.equal(parts.map(part=>part.text).join(''),after);
  }
});

test('mixed speech keeps English words and confirmed Chinese characters while replacing an interim ending',()=>{
  const parts=transcriptParts('Mochi 今天在跑步','Mochi 今天在睡觉');
  assert.equal(parts[0].text,'Mochi ');
  assert.equal(parts.filter(part=>!part.fresh).map(part=>part.text).join(''),'Mochi 今天在');
  assert.equal(parts.filter(part=>part.fresh).map(part=>part.text).join(''),'睡觉');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createVetTutorialResults,vetTutorialFeedback} from '../dist/vet-tutorial.js';
import {ratingLabel,recoveryLabel} from '../dist/vet-data.js';

test('practice search creates clearly fictional, non-contactable clinic data',()=>{
 const result=createVetTutorialResults('W12 7GR');
 assert.equal(result.tutorial,true);
 assert.equal(result.query,'W12 7GR');
 assert.equal(result.center.label,'Example area');
 assert.equal(result.vets.length,3);
 for(const vet of result.vets){
  assert.match(vet.id,/^tutorial\//);
  assert.match(vet.name,/example clinic/);
  assert.match(vet.address,/fictional/);
  assert.equal(vet.website,null);
  assert.equal(vet.tutorial,true);
  assert.doesNotMatch(vet.phone,/\d/);
 }
 assert.ok(result.vets.every((vet,i)=>!i||vet.distanceKm>=result.vets[i-1].distanceKm));
 assert.equal(createVetTutorialResults('x'.repeat(200)).query.length,120);
});

test('practice feedback is visibly illustrative, read-only, and uses valid denominators',()=>{
 for(const vet of createVetTutorialResults().vets){
  const all=vetTutorialFeedback(vet.id),matched=vetTutorialFeedback(vet.id,'respiratory');
  assert.equal(all.tutorial,true);assert.equal(all.canReview,false);
  assert.deepEqual(all.summary.conditionRecovery,all.summary.reportedRecovery);
  assert.notEqual(ratingLabel(all.summary).value,'—');
  assert.match(recoveryLabel(all.summary.reportedRecovery).value,/^\d+%$/);
  assert.match(recoveryLabel(matched.summary.conditionRecovery).value,/^\d+%$/);
  assert.ok(all.reviews.every(review=>review.displayName.startsWith('Example')&&review.comment.startsWith('Example')));
 }
});



test('example clinics have distinct recovery statistics and full review samples',()=>{
 const data=createVetTutorialResults().vets.map(vet=>vetTutorialFeedback(vet.id));
 assert.equal(new Set(data.map(item=>item.summary.reportedRecovery.recoveredCount)).size,3);
 assert.equal(new Set(data.map(item=>item.summary.reviewCount)).size,3);
 assert.ok(data.every(item=>item.reviews.length===3&&item.reviews.every(review=>review.illustrative)));
});

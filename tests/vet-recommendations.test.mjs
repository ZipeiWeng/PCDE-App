import test from 'node:test';
import assert from 'node:assert/strict';
import {concernCategory,rankClinics,recommendationEvidence,recommendationText,validVetRadius} from '../dist/vet-recommendations.js';
import {exampleVetFeedback} from '../dist/vet-example-feedback.js';
const vets=[{id:'close',distanceKm:.8},{id:'matched',distanceKm:3},{id:'far',distanceKm:12}];
const recovery=(recoveredCount,completedCount)=>({conditionRecovery:{recoveredCount,completedCount}});
const rated=(positiveCount,reviewCount,condition='vaccination')=>({conditionRating:{condition,positiveCount,reviewCount}});
test('free-text concern chooses a broad editable feedback category, in English and Chinese',()=>{
 for(const [text,category]of[['sneezing','respiratory'],['狗狗打喷嚏','respiratory'],['疫苗','vaccination'],['Annual booster','vaccination'],['skin rash','skin'],['Routine check-up','general'],['Something else','other']])assert.equal(concernCategory(text),category);
});
test('search radius filters exact range before recommending, never expanding silently',()=>{
 assert.deepEqual(rankClinics(vets,{far:recovery(9,10)},{routine:true,condition:'skin',radiusKm:10}).map(v=>v.id),['close','matched']);
 assert.deepEqual(rankClinics(vets,{}, {radiusKm:1}).map(v=>v.id),['close']);
 assert.equal(validVetRadius(200),10);assert.equal(validVetRadius('25'),25);
});
test('related recovery outranks proximity only with at least five valid completed followups',()=>{
 assert.deepEqual(rankClinics(vets,{matched:recovery(8,10)},{routine:true,condition:'skin',radiusKm:10}).map(v=>v.id),['matched','close']);
 assert.deepEqual(rankClinics(vets,{matched:recovery(4,4)},{routine:true,condition:'skin',radiusKm:10}).map(v=>v.id),['close','matched']);
 for(const summary of[recovery(8,5),recovery(-1,5),recovery(5,NaN),recovery(3.5,5)])assert.equal(recommendationEvidence(summary,'skin'),null);
});
test('vaccination recommendations use related positive reviews rather than cure rates',()=>{
 assert.equal(recommendationEvidence(recovery(10,10),'vaccination'),null);
 assert.deepEqual(recommendationEvidence(rated(8,10),'vaccination'),{kind:'positive',percent:80,count:10,numerator:8,illustrative:false});
 assert.equal(recommendationEvidence(rated(8,10,'skin'),'vaccination'),null);
 assert.equal(recommendationEvidence(rated(4,4),'vaccination'),null);
});
test('unrelated overall and public ratings never become condition-specific evidence',()=>{
 assert.equal(recommendationEvidence({rating:5,reviewCount:200,reportedRecovery:{recoveredCount:99,completedCount:100}},'skin'),null);
 assert.equal(recommendationEvidence(rated(8,10),'all'),null);
 assert.equal(recommendationEvidence({conditionRecovery:{condition:'skin',recoveredCount:10,completedCount:10}},'respiratory'),null);
 assert.match(recommendationText(null),/Limited related feedback/);
});
test('urgent search always keeps nearest first even if another clinic has better related feedback',()=>{
 assert.deepEqual(rankClinics(vets,{matched:recovery(10,10)},{routine:false,condition:'skin',radiusKm:10}).map(v=>v.id),['close','matched']);
});
test('demo service evidence is explicitly illustrative, stable by clinic and uses valid counts',()=>{
 const a=exampleVetFeedback('node/22','vaccination').summary,b=exampleVetFeedback('node/22','vaccination').summary;
 assert.deepEqual(a,b);const e=recommendationEvidence(a,'vaccination');assert.equal(e.illustrative,true);assert.match(recommendationText(e),/^Example ·/);assert.ok(e.numerator<=e.count);
});

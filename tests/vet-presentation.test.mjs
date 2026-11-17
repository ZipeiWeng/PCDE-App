import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicStats,clinicDistanceParts,clinicDisplayName} from '../dist/vet-presentation.js';
import {PUBLIC_VET_RATINGS,publicVetRating} from '../dist/vet-public-ratings.js';
import {exampleVetFeedback} from '../dist/vet-example-feedback.js';

const brackenbury={id:'node/123',name:'Village Vet',address:'146 Goldhawk Road, London, W12 8HH',distanceKm:1};
const empty={rating:null,reviewCount:0,reportedRecovery:{recoveredCount:0,completedCount:0},conditionRecovery:{recoveredCount:0,completedCount:0}};

test('public rating snapshots require the exact clinic branch and keep their source',()=>{
 assert.equal(publicVetRating(brackenbury).rating,4.5);
 assert.equal(publicVetRating({...brackenbury,address:'71 St Helen’s Gardens'}).rating,4.2);
 assert.equal(publicVetRating({...brackenbury,address:'Another road, London'}),null);
 assert.equal(publicVetRating({...brackenbury,name:'A different clinic'}),null);
 assert.equal(publicVetRating({...brackenbury,tutorial:true}),null);
 assert.equal(clinicDisplayName(brackenbury),'Village Vet · Brackenbury');
 for(const record of PUBLIC_VET_RATINGS){
  assert.ok(record.reviewCount>0&&record.rating>=1&&record.rating<=5);
  assert.match(record.sourceUrl,/^https:\/\//);
  assert.equal(record.retrievedAt,'2026-11-13');
 }
});

test('Google fallback is explicitly sourced and never manufactures recovery data for real accounts',()=>{
 const view=clinicStats(brackenbury,empty,{available:true});
 assert.equal(view.items[0].label,'Google rating');
 assert.equal(view.items[0].value,'4.5');
 assert.equal(view.items[0].note,'213 Google reviews');
 assert.equal(view.items[1].value,'—');
 assert.equal(view.items[2].value,'0');
 assert.equal(view.illustrative,false);
 assert.match(view.source.source,/Pawthority/);
});

test('real owner feedback wins over public and illustrative ratings',()=>{
 const summary={rating:4.1,reviewCount:12,reportedRecovery:{recoveredCount:4,completedCount:5},conditionRecovery:{recoveredCount:6,completedCount:8}};
 const view=clinicStats(brackenbury,summary,{demo:true,condition:'skin'});
 assert.equal(view.items[0].label,'Owner rating');
 assert.equal(view.items[0].value,'4.1');
 assert.equal(view.items[1].value,'80%');
 assert.equal(view.items[2].value,'75%');
 assert.equal(view.source,null);
 assert.equal(view.illustrative,false);
});

test('test and demo views fill missing fields with labeled examples and all-condition report counts',()=>{
 const view=clinicStats(brackenbury,empty,{demo:true,variant:0});
 assert.equal(view.items[0].label,'Google rating');
 assert.equal(view.items[0].illustrative,undefined);
 assert.equal(view.items[1].value,'86%');
 assert.equal(view.items[1].illustrative,true);
 assert.equal(view.items[2].label,'Follow-ups');
 assert.equal(view.items[2].value,'72');
 assert.equal(view.items[2].illustrative,true);
 const matched=clinicStats(brackenbury,empty,{demo:true,condition:'skin',variant:0});
 assert.equal(matched.items[2].label,'This condition');
 assert.match(matched.items[2].value,/^\d+%$/);
 const unknown=clinicStats({id:'way/33',name:'Other',address:''},empty,{demo:true,variant:1});
 assert.equal(unknown.items[0].label,'Example rating');
 assert.equal(unknown.items[0].value,'4.6');
 assert.equal(unknown.source,null);
});

test('fictional tutorial feedback never inherits a real clinic source or publishes reviews',()=>{
 const data=exampleVetFeedback('tutorial/clinic-1','ear');
 const view=clinicStats({...brackenbury,id:'tutorial/clinic-1'},data.summary,{tutorial:true,condition:'ear'});
 assert.equal(view.source,null);
 assert.equal(view.items[0].label,'Example rating');
 assert.ok(view.items.every(item=>item.illustrative));
 assert.equal(data.canReview,false);
 assert.ok(data.reviews.every(review=>review.illustrative&&review.comment.startsWith('Example')));
});

test('distance has separate large numerals and units without losing accessible wording',()=>{
 assert.deepEqual(clinicDistanceParts(brackenbury),{value:'1.0',unit:'km',text:'1.0 km'});
 assert.deepEqual(clinicDistanceParts({distanceKm:.04}),{value:'<100',unit:'m',text:'Under 100 m'});
 assert.deepEqual(clinicDistanceParts({distanceKm:null}),{value:'—',unit:'',text:'Distance unavailable'});
});


test('branch matching respects house-number, street-name and postcode boundaries',()=>{
 for(const address of ['1146 Goldhawk Road','146A Goldhawk Road','146 Goldhawk Roadside','London W12 8HHA','London AW12 8HH']){
  assert.equal(publicVetRating({...brackenbury,address}),null,address);
 }
 for(const address of ['146 Goldhawk Rd, London','146 Goldhawk Road, London','London W128HH','London W12 8HH']){
  assert.equal(publicVetRating({...brackenbury,address})?.branch,'Village Vet · Brackenbury',address);
 }
 assert.equal(publicVetRating({...brackenbury,address:"71 St Helen’s Gardens, London"})?.branch,'Village Vet · St Helens');
});

test('a real zero-follow-up count is never labeled as illustrative',()=>{
 const view=clinicStats(brackenbury,empty,{available:true});
 assert.equal(view.items[2].value,'0');
 assert.equal(view.items[2].note,'No completed reports');
 assert.equal(view.items[2].illustrative,false);
 const demo=clinicStats(brackenbury,empty,{demo:true,available:true});
 assert.equal(demo.items[2].note,'Example completed reports');
 assert.equal(demo.items[2].illustrative,true);
});


test('the eight White City search listings resolve to their own sourced branch snapshots',()=>{
 const results=[
  {name:'Village Vet',address:'146 Goldhawk Road, London, W12 8HH',rating:4.5,count:213},
  {name:'Village Vet',address:'71 St Helens Gardens',rating:4.2,count:186},
  {name:'Addison & Holland Park Veterinary Clinic',address:'9 Addison Avenue, W11 4QS',rating:4.8,count:250},
  {name:'Creature Comforts',address:'241 Westbourne Grove, W11 2SE',rating:5,count:256},
  {name:'Blue Cross Pet Clinic',address:'Argyle Place, W6 0RQ',rating:4.5,count:316},
  {name:'Village Vet',address:'748 Harrow Road, NW10 5LG',rating:4.3,count:193},
  {name:'Notting Hill Vet',address:'106 Talbot Road, W11 1JR',rating:4.6,count:174},
  {name:'Village Vet',address:'75 Masbro Road, W14 0LR',rating:4.8,count:323},
 ];
 for(const vet of results){
  const snapshot=publicVetRating(vet);
  assert.equal(snapshot?.rating,vet.rating,vet.name+' '+vet.address);
  assert.equal(snapshot?.reviewCount,vet.count);
  assert.equal(snapshot?.retrievedAt,'2026-11-13');
  assert.match(snapshot.source,/^Google · via /);
  assert.match(snapshot.sourceUrl,/^https:\/\//);
 }
 assert.equal(publicVetRating({name:'Notting Hill Vet',address:'Another street'}),null);
 assert.equal(publicVetRating({name:'Creature Comforts',address:'Another branch W12 8HH'}),null);
 const kensal={name:'Village Vet',address:'748 Harrow Road, NW10 5LG'};
 publicVetRating(kensal);
 assert.equal(kensal.address,'748 Harrow Road, NW10 5LG');
});

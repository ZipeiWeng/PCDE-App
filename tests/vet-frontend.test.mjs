import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCoordinate,unprojectCoordinate,fitMapView,wrapMapDelta} from '../dist/vet-map.js';
import {cleanVet,vetDistance,recoveryLabel,ratingLabel,safeVetWebsite} from '../dist/vet-data.js';

test('geographic markers round-trip in Mercator and remain finite near polar limits',()=>{
 for(const point of [{lat:51.50944,lon:-.22675},{lat:-33.86,lon:151.2},{lat:0,lon:0},{lat:84,lon:179.99}]){
  const projected=projectCoordinate(point,13),restored=unprojectCoordinate(projected,13);
  assert.ok(Math.abs(restored.lat-point.lat)<1e-8);assert.ok(Math.abs(restored.lon-point.lon)<1e-8);
 }
 for(const lat of [-90,90]){const p=projectCoordinate({lat,lon:0},18);assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(Math.abs(unprojectCoordinate(p,18).lat)<=85.05112878);}
});

test('fit keeps every clinic inside a mobile viewport including an antimeridian cluster',()=>{
 for(const [center,points]of[[{lat:51.51,lon:-.23},[{lat:51.49,lon:-.19},{lat:51.53,lon:-.25},{lat:51.47,lon:-.28}]],[{lat:0,lon:179.98},[{lat:.02,lon:-179.98},{lat:-.03,lon:179.95}]]]){
  const fit=fitMapView(center,points,280,250),origin=projectCoordinate(fit.center,fit.zoom);
  for(const point of[center,...points]){const p=projectCoordinate(point,fit.zoom);assert.ok(Math.abs(wrapMapDelta(p.x-origin.x,fit.zoom))<=100);assert.ok(Math.abs(p.y-origin.y)<=75);}
 }
});

test('clinic data rejects unusable coordinates and unsafe websites without inventing contacts or reviews',()=>{
 assert.equal(cleanVet({lat:NaN,lon:0}),null);assert.equal(cleanVet({lat:0,lon:181}),null);
 for(const value of['javascript:alert(1)','data:text/html,x','file:///tmp/file'])assert.equal(safeVetWebsite(value),null);
 const vet=cleanVet({id:'node/1',name:'Actual clinic',lat:51,lon:-.2,distanceKm:.04,website:'https://example.org/clinic',rating:9,reviewCount:-4});
 assert.equal(vetDistance(vet),'Under 100 m');assert.equal(vet.phone,'');assert.equal(vet.address,'');assert.equal(vet.rating,null);assert.equal(vet.reviewCount,null);assert.equal(vet.website,'https://example.org/clinic');
 assert.equal(vetDistance(cleanVet({lat:0,lon:0})),'Distance unavailable');
});

test('owner recovery percentages require five completed follow-ups and a valid denominator',()=>{
 assert.deepEqual(recoveryLabel(null),{value:'—',note:'No outcome data'});
 assert.deepEqual(recoveryLabel({percent:100,recoveredCount:4,completedCount:4}),{value:'—',note:'4 follow-ups · 5 needed'});
 assert.deepEqual(recoveryLabel({percent:100,recoveredCount:0,completedCount:5}),{value:'0%',note:'0 / 5 follow-ups'});
 assert.deepEqual(recoveryLabel({recoveredCount:4,completedCount:5}),{value:'80%',note:'4 / 5 follow-ups'});
 assert.equal(recoveryLabel({recoveredCount:8,completedCount:5}).value,'—');
 assert.equal(recoveryLabel({recoveredCount:3,completedCount:-1}).value,'—');
});

test('empty or invalid owner-rating inputs never become a fabricated star score',()=>{
 for(const summary of[null,{}, {rating:5,reviewCount:0},{rating:7,reviewCount:9},{rating:4,reviewCount:1.2}])assert.deepEqual(ratingLabel(summary),{value:'—',note:'No owner reviews'});
 assert.deepEqual(ratingLabel({rating:4.25,reviewCount:8}),{value:'4.3',note:'8 owner reviews'});
});

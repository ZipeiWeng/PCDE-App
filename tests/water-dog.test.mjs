import test from 'node:test';
import assert from 'node:assert/strict';
import {waterDogPose,waterDogContours,waterDogWake,waterDogImpacts,waterDogParticles} from '../dist/water-dog.js';

const radius=150;
test('water animal remains finite and inside the local shading texture during every pose',()=>{
  for(let t=0;t<16.8;t+=.03){
    const p=waterDogPose(t,radius);
    for(const value of [p.x,p.y,p.scale,p.tilt,p.opacity,p.immersion])assert.ok(Number.isFinite(value));
    for(const outline of waterDogContours(t)){
      assert.ok(outline.length>3);
      for(const point of outline)for(const coordinate of point){assert.ok(Number.isFinite(coordinate));assert.ok(Math.abs(coordinate)<108);}
    }
  }
});
test('visible travel has no positional teleport at swimming and wall-contact phase changes',()=>{
  for(let t=.001;t<8.4;t+=.001){
    const p=waterDogPose(t,radius),before=waterDogPose(t-.001,radius);
    if(p.hidden||before.hidden)continue;
    assert.ok(Math.hypot(p.x-before.x,p.y-before.y)<radius*.02,`position discontinuity at ${t}`);
    assert.ok(Math.abs(p.tilt-before.tilt)<.03,`orientation discontinuity at ${t}`);
  }
});
test('swimming wake follows recent travel and dissipates while the animal is submerged',()=>{
  const wake=waterDogWake(1.8,radius),p=waterDogPose(1.8,radius);
  assert.ok(wake.length>12);
  assert.ok(Math.hypot(wake[0].x-p.x,wake[0].y-p.y)<radius*.22);
  assert.ok(wake.at(-1).alpha<wake[0].alpha);
  assert.equal(waterDogWake(3.69,radius).length,0);
  assert.ok(waterDogWake(3.05,radius).length>0);
});
test('both wall plunges produce bounded one-shot spray, with no stationary permanent impact',()=>{
  const seen=new Set();
  for(let t=0;t<8.4;t+=.03){
    for(const impact of waterDogImpacts(t)){seen.add(impact.id);assert.ok(impact.age>=0&&impact.age<impact.lifetime);}
    for(const d of waterDogParticles(t,radius)){assert.ok(Number.isFinite(d.x)&&Number.isFinite(d.y));assert.ok(d.alpha>=0&&d.alpha<=1);}
  }
  assert.deepEqual([...seen].sort(),['lower-left','right']);
  assert.equal(waterDogImpacts(1.5).length,0);
});

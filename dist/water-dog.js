// A single water animal. A flowing continuous silhouette replaces inflated parts.
// All geometry is pure and deterministic; orb.js owns material, drawing and burst.
const CYCLE = 8.4;
const clamp = value => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const ramp = (a, b, value) => smooth((value - a) / (b - a));
const fract = value => value - Math.floor(value);
const pointMix = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t)];
// Match the flight tangent at entry, then accelerate through the membrane.
const plunge = (start, end, velocity, seconds, duration = .30) => start.map((value, i) => value + velocity[i] * seconds + (end[i] - value - velocity[i] * duration) * (seconds / duration) ** 2);
const interval = (time, start, end) => clamp((time - start) / (end - start));
const recoil = (time, event) => time >= event && time < event + .32 ? Math.sin((time - event) / .32 * Math.PI) * (1 - (time - event) / .32) : 0;

// Buoyant bounds: a travelling water mass gathers twice, then opens into a dive.
// Squared arcs keep position and velocity continuous at the little mid-air hops.
function bounds(start, end, u, hops, height) {
  const q = Math.sin(Math.PI * hops * u);
  return [mix(start[0],end[0],u), mix(start[1],end[1],u) - height*q*q - .13*Math.sin(Math.PI*u)];
}
function jumpState(time) {
  const t = Number.isFinite(time) ? time : 0, clock = fract(t / CYCLE) * CYCLE;
  let phase, leg, position, tilt, direction, hidden = false;
  let flight=0, progress=0, wallAngle=Math.PI, contactKind=null, contactAge=0;
  let contactStrength=0, stretchBridge=0, contactRecoil=0, hop=0, hops=2;
  let contactAnchor={x:-40,y:0};
  if(clock < .65){
    phase='emerge-left';leg=0;direction=1;progress=interval(clock,0,.65);
    position=pointMix([-1.64,.18],[-.58,-.12],1-(1-progress)**1.6);
    tilt=mix(-.12,-.12,progress);contactKind='emerge';contactAge=clock;
    contactStrength=Math.sin(progress*Math.PI);stretchBridge=ramp(.15,.55,progress)*(1-ramp(.78,1,progress));
  }else if(clock < 2.65){
    phase='leap-right';leg=0;direction=1;flight=interval(clock,.65,2.65);hop=fract(flight*2);
    position=bounds([-.58,-.12],[.58,-.08],flight,2,.30);
    tilt=-.12*Math.cos(hop*Math.PI*2)+.34*ramp(.78,1,flight);
    contactRecoil=recoil(clock,.65);
  }else if(clock < 2.95){
    phase='merge-right';leg=0;direction=1;flight=1;wallAngle=.10;
    contactAge=clock-2.65;progress=contactAge/.30;
    position=plunge([.58,-.08],[1.72,.49],[.58,(.05+.13*Math.PI)/2],contactAge);
    tilt=mix(.22,.24,progress);contactKind='merge';contactStrength=Math.exp(-contactAge*8);
    stretchBridge=1-ramp(0,.14,contactAge);contactAnchor={x:mix(53,-81,progress),y:mix(-6,-2,progress)};
  }else if(clock < 3.70){
    phase='wall-pause-right';leg=0;direction=1;hidden=true;wallAngle=.10;
    position=[1.72,.49];tilt=.24;contactRecoil=recoil(clock,2.95);
  }else if(clock < 4.35){
    phase='emerge-right';leg=1;direction=-1;wallAngle=0;progress=interval(clock,3.70,4.35);
    position=pointMix([1.64,.18],[.57,-.02],1-(1-progress)**1.6);
    tilt=mix(.12,.12,progress);contactKind='emerge';contactAge=clock-3.70;
    contactStrength=Math.sin(progress*Math.PI);stretchBridge=ramp(.15,.55,progress)*(1-ramp(.78,1,progress));
  }else if(clock < 6.75){
    phase='leap-lower-left';leg=1;direction=-1;hops=3;flight=interval(clock,4.35,6.75);hop=fract(flight*3);
    position=bounds([.57,-.02],[-.43,.56],flight,3,.21);
    tilt=.12*Math.cos(hop*Math.PI*2)-.45*ramp(.7,1,flight);wallAngle=0;
    contactRecoil=recoil(clock,4.35);
  }else if(clock < 7.05){
    phase='merge-lower-left';leg=1;direction=-1;flight=1;wallAngle=2.50;
    contactAge=clock-6.75;progress=contactAge/.30;
    position=plunge([-.43,.56],[Math.cos(2.50)*1.82,Math.sin(2.50)*1.82],[-1/2.4,(.58+.13*Math.PI)/2.4],contactAge);
    tilt=mix(-.33,-.48,progress);contactKind='merge';contactStrength=Math.exp(-contactAge*8);
    stretchBridge=1-ramp(0,.14,contactAge);contactAnchor={x:mix(53,-81,progress),y:mix(-6,-2,progress)};
  }else{
    phase='wall-return';leg=1;direction=-1;hidden=true;progress=interval(clock,7.05,CYCLE);
    wallAngle=mix(2.50,Math.PI,smooth(progress));position=[Math.cos(wallAngle)*1.82,Math.sin(wallAngle)*1.82];
    tilt=-.48;contactKind='return';contactStrength=Math.sin(progress*Math.PI)*.12;contactRecoil=recoil(clock,7.05);
  }
  const flying=phase.startsWith('leap-'),emerging=contactKind==='emerge',merging=contactKind==='merge';
  const bounce=flying?Math.sin(hop*Math.PI):0;
  const height=flying?bounce*bounce:0;
  const tuck=flying?ramp(.10,.38,hop)*(1-ramp(.68,.92,hop)):0;
  const launch=emerging?ramp(.15,.65,progress):flying?.5+.5*Math.cos(hop*Math.PI*2):merging?1:0;
  const descent=flying?ramp(.78,1,flight):merging?1:0;
  const impact=merging?Math.sin(progress*Math.PI):0;
  return {t,u:clock/CYCLE,clock,phase,leg,position,tilt,direction,hidden,flying,flight,progress,hop,hops,
    height,tuck,launch,descent,impact,crouch:emerging?(1-smooth(progress))*.35:0,
    disperse:hidden?1:0,wallAngle,contactKind,contactAge,contactStrength,stretchBridge,contactRecoil,contactAnchor};
}

/** Spatial wall crossings stay opaque: orb.js reveals them with its real contour. */
export function waterDogPose(t, radius) {
  const s = jumpState(t), r = Number.isFinite(radius) && radius > 0 ? radius : 1;
  return {
    x:s.position[0] * r, y:s.position[1] * r,
    scale:r / 174 * (.92 + s.height * .035),
    turn:s.direction, tilt:s.tilt, tuck:s.tuck, disperse:s.disperse,
    opacity:s.hidden ? 0 : .88 + .12*s.height, u:s.u, direction:s.direction,
    immersion:s.hidden?1:.42+.26*(1-s.height),
    phase:s.phase, leg:s.leg, hidden:s.hidden, flight:s.flight, hop:s.hop, hops:s.hops, height:s.height, impact:s.impact,
    wallAngle:s.wallAngle, wallPoint:{x:Math.cos(s.wallAngle),y:Math.sin(s.wallAngle)},
    contactStrength:s.contactStrength, stretchBridge:s.stretchBridge, contactRecoil:s.contactRecoil,
    contactKind:s.contactKind, contactAge:s.contactAge, contactAnchor:s.contactAnchor, clipInside:true,
  };
}

function between(a, b, thickness, extension = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(dx, dy) / 2 + extension, thickness, Math.atan2(dy, dx)];
}
/** Exactly sixteen [x,y,rx,ry,angle] arrays, in the renderer's 220-unit space. */
export function waterDogNodes(t, requestedTuck) {
  const s = jumpState(t);
  const tuck = Number.isFinite(requestedTuck) ? clamp(requestedTuck) : s.tuck;
  const bodyStretch = 1 + s.launch * .045 + s.descent * .035 + s.impact * .07;
  const bodyDepth = 1 - s.crouch * .13 - s.impact * .24 + tuck * .035;
  const wave = Math.sin(s.t * 5.0) * 2.1;
  const spine = Math.sin(s.hop * Math.PI * 2 - .65) * 3.2;
  const fold = s.contactKind === 'merge' ? ramp(0, .16, s.contactAge) : 0;

  // Both pairs gather at once, then extend together: a jump, never a walk cycle.
  let frontElbow = pointMix([23, 23], [23, 15], s.crouch);
  let frontTip = pointMix([31, 38], [34, 26], s.crouch);
  frontElbow = pointMix(frontElbow, [10, 24], s.launch);
  frontTip = pointMix(frontTip, [-2, 42], s.launch);
  frontElbow = pointMix(frontElbow, [27, 12], tuck);
  frontTip = pointMix(frontTip, [13, 20], tuck);
  frontElbow = pointMix(frontElbow, [34, 12], s.descent);
  frontTip = pointMix(frontTip, [56, 8], s.descent);
  frontElbow = pointMix(frontElbow, [17, 8], fold);
  frontTip = pointMix(frontTip, [0, 15], fold);

  let hindKnee = pointMix([-24, 22], [-19, 14], s.crouch);
  let hindTip = pointMix([-39, 38], [-42, 25], s.crouch);
  hindKnee = pointMix(hindKnee, [-40, 24], s.launch);
  hindTip = pointMix(hindTip, [-60, 40], s.launch);
  hindKnee = pointMix(hindKnee, [-20, 10], tuck);
  hindTip = pointMix(hindTip, [-31, 21], tuck);
  hindKnee = pointMix(hindKnee, [-43, 13], s.descent);
  hindTip = pointMix(hindTip, [-65, 22], s.descent);
  hindKnee = pointMix(hindKnee, [-50, 4], fold);
  hindTip = pointMix(hindTip, [-72, 3], fold);

  const farFront = pointMix([8 - s.launch * 18, 34 - s.crouch * 9], [2, 17], tuck);
  const farHind = pointMix([-52 - s.launch * 10, 30 - s.crouch * 6], [-45, 17], tuck);
  const tailLift = s.launch * 9 + tuck * 10 - s.descent * 5;
  const tailBase = [-45, -3];
  const tailMiddle = [-58, -13 - tailLift * .48 + wave];
  const tailUpper = [-70, -22 - tailLift + Math.sin(s.t * 5.0 - .8) * 5];
  const tailTip = [-81, -20 - tailLift * .72 + Math.sin(s.t * 5.0 - 1.6) * 7];
  const headDip = s.descent * 5 + s.impact * 3 + Math.sin(s.hop*Math.PI*2-.4)*1.5;
  const earTop = [30, -23 + headDip];
  const earTip = [22-s.launch*5+s.descent*3, -5+headDip-tuck*3+Math.sin(s.t*5-.8)*3];

  const nodes = [
    [-10, spine + wave * .35, 30 * bodyStretch, 13 * bodyDepth, -.04],
    [-33, 3 - spine * .45, 14 * bodyStretch, 14 * bodyDepth, .10],
    between([16, -1 + spine * .3], [29, -11 + headDip], 10, 2),
    [36, -14 + headDip, 13, 11, .08 + s.descent * .07],
    [49, -9 + headDip, 11, 5.8, .10 + s.descent * .07],
    between(earTop, earTip, 4.2, 1.2),
    between([17, 5], frontElbow, 4.0, 1.3),
    between(frontElbow, frontTip, 2.4, 1.0),
    between([11, 7], farFront, 2.3, 1),
    between([-35, 6], hindKnee, 4.9, 1.5),
    between(hindKnee, hindTip, 2.7, 1),
    between([-40, 7], farHind, 2.2, 1),
    between(tailBase, tailMiddle, 4.0, 1.5),
    between(tailMiddle, tailUpper, 2.8, 1.5),
    between(tailUpper, tailTip, 1.7, 1),
    [14, -1, 10.5, 15 * bodyDepth, -.25],
  ];

  // Landing spreads the connected form into a shallow sheet before it disperses.
  // Small nonuniform offsets break the symmetry of perfect inflated ellipsoids.
  const flatten = 1 - s.impact * .22;
  return nodes.map((node, index) => [
    node[0] + Math.sin(s.t * 3.7 + index * .63) * (index < 6 ? .65 : .35),
    node[1] * flatten + Math.sin(s.t * 5.6 - index * .61) * 1.15,
    node[2],
    Math.max(1.25, node[3] * (1 + Math.sin(s.t * 4 + index * .7) * .035)),
    node[4],
  ]);
}

/**
 * The rendered animal is one continuous water silhouette. Limbs taper into
 * the torso; the two far limbs merge in the signed-distance field, so there
 * are no inflated ellipse seams. No face markings or hard cartoon outline.
 */
export function waterDogContours(t, requestedTuck) {
  const s=jumpState(t),tuck=Number.isFinite(requestedTuck)?clamp(requestedTuck):s.tuck;
  const stroke=s.flying?.5+.5*Math.sin(s.hop*Math.PI*2-.65):s.launch;
  const dive=s.descent,fold=s.contactKind==='merge'?ramp(0,.2,s.contactAge):0;
  const frontElbow=pointMix(pointMix([26,22],[33,11],tuck),[39,8],dive);
  const frontPaw=pointMix(pointMix([19+stroke*10,37],[13,23],tuck),[62,6],dive);
  const hindKnee=pointMix([-40,19],[-25,16],tuck);
  const hindPaw=pointMix(pointMix([-57-stroke*6,31],[-28,28],tuck),[-69,15],dive);
  const tailWave=Math.sin(s.t*4.4-1.2)*6,tailSweep=Math.sin(s.t*4.4-2)*8;
  const headNod=Math.sin(s.hop*Math.PI*2-.4)*1.6+dive*4;
  const point=(p,dx=0,dy=0)=>[p[0]+dx,p[1]+dy];
  const main=[
    [70,-22+headNod],[70,-16+headNod],[59,-13+headNod],[48,-12+headNod],
    [38,-5+headNod],[32,8],point(frontElbow,4),point(frontPaw,4),point(frontPaw,5,4),point(frontPaw,-3,5),point(frontElbow,-3,2),[19,11],
    [4,7],[-15,9],point(hindKnee,5),point(hindPaw,5),point(hindPaw,4,4),point(hindPaw,-4,5),point(hindKnee,-5),[-44,5],[-45,-5],
    [-59,-8+tailWave*.35],[-75,-20+tailWave],[-88,-37+tailSweep],[-78,-29+tailSweep*.8],[-61,-22+tailWave*.5],[-44,-18],
    [-29,-22],[-10,-24],[9,-22],[20,-22],[25,-34+headNod],[22,-49+headNod],[34,-44+headNod],
    [43,-44+headNod],[53,-37+headNod],[57,-29+headNod],[65,-25+headNod],
  ];
  const farFront=[ [20,4],[14,15],[6+stroke*13,29],[12+stroke*13,31],[24,18],[29,4] ];
  const farHind=[ [-32,4],[-43,15],[-61+stroke*8,24],[-56+stroke*8,28],[-32,22],[-23,6] ];
  // An undulation travels from chest to tail. It changes the silhouette and
  // the reflected surface, rather than moving a rigid animal up and down.
  return [main,farFront,farHind].map((outline,index)=>outline.map(([x,y])=>{
    const wave=Math.sin(s.t*4.4-x*.055)*2.2;
    const amplitude=clamp((35-x)/75);
    return [x*(1+fold*.08), y*(1-fold*.24)+wave*amplitude+(index?1:0)];
  }));
}

/** A broad ribbon of displaced water follows the actual recent dog path. */
export function waterDogWake(t,radius){
  const p=waterDogPose(t,radius),points=[];
  for(let i=0;i<20;i++){
    const age=i/19*.64,prior=waterDogPose(t-age,radius);
    if(prior.leg!==p.leg)break;
    if(prior.hidden)continue;
    const center=inOrb([-22,8],prior);
    points.push({x:center[0],y:center[1],width:radius*(.115+age*.13),alpha:(1-age/.68)*(.46+.25*(1-p.immersion)),age});
  }
  return points;
}

function inOrb(point, pose) {
  const x = point[0] * pose.scale * pose.turn;
  const y = point[1] * pose.scale * (1 - .045 * pose.tuck);
  const c = Math.cos(pose.tilt), s = Math.sin(pose.tilt);
  return [pose.x + x * c - y * s, pose.y + x * s + y * c];
}

/** Orb-local trails; wall particles also carry contour-relative placement data. */
export function waterDogParticles(t, radius) {
  const s = jumpState(t), p = waterDogPose(t, radius);
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const particles = [];
  if (!s.hidden) {
    const airborne = s.flying ? .8 : s.contactKind === 'merge' ? 1 - s.progress : s.progress * .6;
    for (let i = 0; i < 15; i++) {
      const age = fract(s.t * 1.55 + i * .173);
      const prior = waterDogPose(s.t - age * .19, r);
      if (prior.hidden || prior.leg !== p.leg) continue;
      const start = inOrb(i % 3 === 0 ? [-80,-19] : i % 3 === 1 ? [-37,21] : [17,22], prior);
      particles.push({
        x:start[0] - p.direction * r * age * (.045 + i % 3 * .025),
        y:start[1] + r * age * age * .11,
        size:r * (.0055 + i % 4 * .0022) * (1 - age * .46),
        angle:p.tilt - p.direction * .72,
        alpha:Math.sin(age * Math.PI) * airborne * .6,
        stretch:1.7 + s.launch * .9 + age * .65,
      });
    }
  }
  const energy = s.contactKind === 'emerge' ? s.contactStrength : 0;
  if (energy > .01) {
    const nx = Math.cos(s.wallAngle), ny = Math.sin(s.wallAngle);
    for (let i = 0; i < 16; i++) {
      const age = fract(s.t * 1.6 + i * .127);
      const inward = -(.012 + age * (.05 + i % 4 * .025));
      const sideways = Math.sin(i * 2.39996) * age * (.06 + i % 3 * .035);
      const wallOffset = {normal:inward, tangent:sideways};
      particles.push({
        x:r * (nx * (1 + inward) - ny * sideways),
        y:r * (ny * (1 + inward) + nx * sideways),
        size:r * (.005 + i % 4 * .0028) * (1 - age * .3),
        angle:s.wallAngle + Math.PI / 2 + Math.sin(i) * .4,
        alpha:Math.sin(age * Math.PI) * energy * .72,
        stretch:1.3 + age * 1.8,
        wallAngle:s.wallAngle, wallOffset,
      });
    }
  }
  return particles;
}

// Find each muzzle's first nominal sphere crossing once, rather than timing a
// burst from the centre. The renderer conforms this normal to its moving wall.
function muzzleAt(t) {
  const p = waterDogPose(t, 1), node = waterDogNodes(t)[4];
  return inOrb([node[0] + node[2] * Math.cos(node[4]), node[1] + node[2] * Math.sin(node[4])], p);
}
function contactEvent(id, start, end, side) {
  let lo = start, hi = end;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2, muzzle = muzzleAt(mid);
    if (Math.hypot(...muzzle) < 1) lo = mid; else hi = mid;
  }
  const muzzle = muzzleAt(hi);
  return {id, time:hi, angle:Math.atan2(muzzle[1], muzzle[0]), side};
}
const IMPACTS = [contactEvent('right', 2.50, 2.95, 1), contactEvent('lower-left', 6.55, 7.05, -1)];
/** One shot on first contact; water keeps falling after the animal vanishes. */
export function waterDogImpacts(time) {
  const t = Number.isFinite(time) ? time : 0;
  const clock = fract(t / CYCLE) * CYCLE;
  return IMPACTS.map(event => {
    const age = (clock - event.time + CYCLE) % CYCLE;
    return {...event, age, duration:.8, lifetime:.8, progress:age/.8,
      wallAngle:event.angle, strength:1, punch:Math.max(0, 1-age/.10),
      opacity:Math.pow(Math.max(0, 1-age/.8), .75)};
  }).filter(event => event.age < .8);
}

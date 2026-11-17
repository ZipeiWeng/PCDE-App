import test from 'node:test';
import assert from 'node:assert/strict';
import { placeCoachNote, placeAlertCoach } from '../dist/onboarding-position.js';

const intersects = (a, b) => a.left < b.right && a.left + a.width > b.left &&
  a.top < b.bottom && a.top + a.height > b.top;
function within(position, width, height, margin = 20) {
  assert.ok(position.left >= margin);
  assert.ok(position.left + position.width <= width - margin);
  assert.ok(position.top >= margin);
  assert.ok(position.top + position.height <= height - 40);
}

test('header buttons receive a caption below them without covering the action', () => {
  for (const width of [280, 320, 430]) {
    const target = { left: width - 72, right: width - 28, top: 28, bottom: 72 };
    const result = placeCoachNote({ width, height: 600, target });
    within(result, width, 600);
    assert.equal(result.side, 'below');
    assert.ok(result.top >= target.bottom + 24);
    assert.equal(intersects(result, target), false);
  }
});

test('a large water orb keeps its caption outside the orb in short and tall screens', () => {
  for (const [width, height, top, bottom] of [[320, 600, 150, 450], [430, 880, 240, 600]]) {
    const target = { left: 15, right: width - 15, top, bottom };
    const result = placeCoachNote({ width, height, target, preferredSide: 'above' });
    within(result, width, height);
    assert.equal(result.side, 'above');
    assert.equal(intersects(result, target), false);
  }
});

test('bottom controls receive an upper caption while leaving the safe bottom strip clear', () => {
  for (const height of [360, 600, 880]) {
    const target = { left: 240, right: 292, top: height - 92, bottom: height - 48 };
    const result = placeCoachNote({ width: 320, height, target });
    within(result, 320, height);
    assert.equal(result.side, 'above');
    assert.ok(result.top + result.height <= target.top - 24);
  }
});

test('nearby controls can move a caption to the other free side', () => {
  const target = { left: 100, right: 220, top: 230, bottom: 320 };
  const obstacle = { left: 0, right: 320, top: 70, bottom: 220 };
  const result = placeCoachNote({ width: 320, height: 600, target, obstacles: [obstacle], preferredSide: 'above' });
  within(result, 320, 600);
  assert.equal(result.side, 'below');
  assert.equal(intersects(result, target), false);
  assert.equal(intersects(result, obstacle), false);
});

test('oversized targets use a visible bounded fallback rather than pushing page content', () => {
  for (const width of [280, 320, 430]) {
    const result = placeCoachNote({ width, height: 600,
      target: { left: -30, right: width + 30, top: -500, bottom: 1500 }, noteHeight: 84 });
    within(result, width, 600);
    assert.equal(result.side, 'reserved');
    assert.equal(result.height, 84);
  }
});

test('partly offscreen targets are clipped and all narrow-screen outputs stay finite', () => {
  const result = placeCoachNote({ width: 220, height: 400,
    target: { left: 160, right: 260, top: -45, bottom: 30 }, noteWidth: 300, noteHeight: 90 });
  within(result, 220, 400);
  assert.equal(result.width, 180);
  assert.equal(result.side, 'below');
  for (const key of ['left', 'top', 'width', 'height']) assert.ok(Number.isFinite(result[key]));
});

test('a larger bottom inset reserves the real toolbar and phone safe area', () => {
  const target = { left: 80, right: 240, top: 420, bottom: 470 };
  const result = placeCoachNote({ width: 320, height: 600, target, bottomInset: 100, preferredSide: 'below' });
  within(result, 320, 600);
  assert.ok(result.top + result.height <= 500);
  assert.equal(intersects(result, target), false);
  assert.equal(result.side, 'above');
});

test('many aligned content obstacles retain a clear caption position', () => {
  const target = { left: 160, right: 270, top: 540, bottom: 620 };
  const obstacles = Array.from({ length: 60 }, (_, index) => {
    const column = index % 6, row = Math.floor(index / 6);
    return { left: 20 + column * 65, right: 70 + column * 65,
      top: 130 + row * 38, bottom: 151 + row * 38 };
  });
  const options = { width: 430, height: 700, target, obstacles, bottomInset: 65 };
  const result = placeCoachNote(options);
  within(result, 430, 700);
  assert.equal(intersects(result, target), false);
  assert.ok(obstacles.every(rect => !intersects(result, rect)));
  assert.deepEqual(placeCoachNote({ ...options, obstacles: [...obstacles, ...obstacles] }), result);
});

test('Activity caption stays clear of page dots on short and tall screens', async () => {
  const {placeActivityCoach}=await import('../dist/onboarding-position.js');
  for(const [width,height,dotsTop,noteHeight] of [[320,600,540,140],[430,880,800,120],[390,700,625,130]]){
    const note=placeActivityCoach({width,height,dotsTop,noteHeight});
    assert.ok(note.left>=20);
    assert.ok(note.left+note.width<=width-20);
    assert.ok(note.top>height/2,'caption stays in the lower half');
    assert.ok(note.top+note.height<=dotsTop-48,'caption cannot collide with the dot explanation');
    assert.deepEqual(placeActivityCoach({width,height,dotsTop,noteHeight,scrollTop:1200}),note,'scrolling cannot move the caption');
  }
});

test('alert heading stays in the upper half while its action caption sits below Contact', () => {
  for(const [width,height,top,bottom,headingHeight,noteHeight] of [
    [280,420,170,230,81,84], [320,568,240,302,54,62],
    [390,844,420,482,62,69], [430,932,460,522,62,69],
  ]){
    const target={left:30,right:width-30,top,bottom};
    const {heading,note}=placeAlertCoach({width,height,target,headingHeight,noteHeight,bottomInset:68});
    assert.equal(heading.visible,true);
    assert.ok(heading.top+heading.height<=height/2);
    assert.ok(heading.top+heading.height<=target.top-32);
    assert.equal(note.side,'below');
    assert.equal(note.top,target.bottom+32,'instruction stays next to the short button arrow');
    for(const block of [heading,note])within(block,width,height);
    assert.ok(note.top+note.height<=height-68,'caption stays clear of guide controls');
  }
});

test('scrolling an alert near viewport edges never overlaps its button or the two captions', () => {
  for(const [top,bottom] of [[10,70],[90,150],[130,190],[350,410],[500,560],[560,620]]){
    const target={left:30,right:290,top,bottom};
    const {heading,note}=placeAlertCoach({width:320,height:600,target,headingHeight:54,noteHeight:62,bottomInset:68});
    assert.equal(intersects(note,target),false);
    within(note,320,600);
    if(heading.visible){
      assert.equal(intersects(heading,target),false);
      assert.equal(intersects(note,{...heading,right:heading.left+heading.width,bottom:heading.top+heading.height}),false);
      assert.ok(heading.top+heading.height<=300);
    }else assert.ok(target.top<22+54+32,'only suppress the title when there is no room above Contact');
  }
});

test('resizing restores the separate alert heading without carrying stale geometry', () => {
  const options={width:390,height:844,target:{left:30,right:360,top:420,bottom:482},headingHeight:62,noteHeight:69,bottomInset:68};
  const initial=placeAlertCoach(options);
  const scrolled=placeAlertCoach({...options,height:500,target:{...options.target,top:24,bottom:86}});
  assert.equal(scrolled.heading.visible,false);
  assert.equal(scrolled.note.side,'below');
  assert.deepEqual(placeAlertCoach(options),initial);
});

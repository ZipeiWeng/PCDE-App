import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoCrop, movePhotoCrop, zoomPhotoCrop, sourceCropRect } from '../dist/profile-photo-crop.js';

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} ≠ ${expected}`);

test('initial framing covers the circle with a centered square from either photo orientation',()=>{
  assert.deepEqual(sourceCropRect(createPhotoCrop(2400,1200,300)),{x:600,y:0,size:1200});
  assert.deepEqual(sourceCropRect(createPhotoCrop(1200,2400,300)),{x:0,y:600,size:1200});
  assert.deepEqual(sourceCropRect(createPhotoCrop(512,512,300)),{x:0,y:0,size:512});
  assert.throws(()=>createPhotoCrop(0,200,300),/profilePhotoDecode/);
});

test('panning stops at image edges and zoom is bounded so the crop never exposes a blank corner',()=>{
  for(const [width,height] of [[2400,1200],[1200,2400],[1,1],[9000,10]]){
    for(const zoom of [-10,1,1.5,4,100]){
      for(const [x,y] of [[-1e6,-1e6],[1e6,1e6],[-1e6,1e6],[0,0]]){
        const crop=movePhotoCrop(zoomPhotoCrop(createPhotoCrop(width,height,280),zoom),x,y);
        const rect=sourceCropRect(crop);
        assert.ok(crop.zoom>=1&&crop.zoom<=4);
        assert.ok(rect.size>0&&rect.x>=0&&rect.y>=0);
        assert.ok(rect.x+rect.size<=width+1e-8&&rect.y+rect.size<=height+1e-8);
        const scale=Math.max(crop.size/width,crop.size/height)*crop.zoom;
        assert.ok(width*scale/2-Math.abs(crop.x)>=crop.size/2-1e-8);
        assert.ok(height*scale/2-Math.abs(crop.y)>=crop.size/2-1e-8);
      }
    }
  }
});

test('pinch zoom retains the photo point beneath its focal point before edge clamping',()=>{
  const before=movePhotoCrop(zoomPhotoCrop(createPhotoCrop(1600,1200,300),2),40,-20);
  const anchor={x:30,y:25},after=zoomPhotoCrop(before,3,anchor);
  const beforeScale=Math.max(before.size/before.width,before.size/before.height)*before.zoom;
  const afterScale=Math.max(after.size/after.width,after.size/after.height)*after.zoom;
  near((anchor.x-before.x)/beforeScale,(anchor.x-after.x)/afterScale);
  near((anchor.y-before.y)/beforeScale,(anchor.y-after.y)/afterScale);
});

test('dragging and zooming change the saved source framing rather than only the displayed image',()=>{
  const initial=createPhotoCrop(2000,1000,250);
  const zoomed=zoomPhotoCrop(initial,2);
  assert.deepEqual(sourceCropRect(zoomed),{x:750,y:250,size:500});
  assert.deepEqual(sourceCropRect(movePhotoCrop(zoomed,100,-50)),{x:550,y:350,size:500});
  const originalRect=sourceCropRect(movePhotoCrop(zoomed,100,-50));
  const resized={...zoomed,size:500,x:200,y:-100};
  assert.deepEqual(sourceCropRect(resized),originalRect);
});

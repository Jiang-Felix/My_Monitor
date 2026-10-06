import test from 'node:test';
import assert from 'node:assert/strict';
const geometry=await import('../desktop/floating-bounds.js').catch(()=>({}));
const main={x:0,y:0,width:1920,height:1040};
const left={x:-1280,y:120,width:1280,height:984};
const corners=b=>[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]];
const contained=(b,a)=>corners(b).every(([x,y])=>x>=a.x+16&&x<=a.x+a.width-16&&y>=a.y+16&&y<=a.y+a.height-16);

test('floating placement minimally corrects all four corners, preserving a 16px work-area margin',()=>{
  assert.equal(typeof geometry.placeFloating,'function');
  const valid={x:120,y:140,width:390,height:230};
  assert.deepEqual(geometry.placeFloating(valid,[main]),valid);
  assert.deepEqual(geometry.placeFloating({...valid,x:-100,y:-200},[main]),{...valid,x:16,y:16});
  assert.deepEqual(geometry.placeFloating({...valid,x:1900,y:1100},[main]),{...valid,x:1514,y:794});
});

test('floating placement chooses the nearest whole-window position across negative coordinates and monitor gaps',()=>{
  assert.equal(typeof geometry.placeFloating,'function');
  const valid={x:-1100,y:180,width:390,height:230};
  assert.deepEqual(geometry.placeFloating(valid,[main,left]),valid);
  assert.deepEqual(geometry.placeFloating({...valid,x:-100},[main,left]),{...valid,x:16});
  const upper={x:200,y:-1200,width:1600,height:900};
  const inGap=geometry.placeFloating({x:500,y:-200,width:390,height:230},[main,left,upper]);
  assert.deepEqual(inGap,{x:500,y:16,width:390,height:230});
  assert.ok([main,left,upper].some(area=>contained(inGap,area)));
});

test('disconnecting a display recovers offscreen windows and oversized windows shrink into the usable area',()=>{
  assert.equal(typeof geometry.placeFloating,'function');
  assert.deepEqual(geometry.placeFloating({x:-1100,y:180,width:390,height:230},[main]),{x:16,y:180,width:390,height:230});
  const small={x:100,y:50,width:800,height:600};
  const fitted=geometry.placeFloating({x:80,y:40,width:1200,height:900},[small]);
  assert.deepEqual(fitted,{x:116,y:66,width:768,height:568});
  assert.ok(contained(fitted,small));
  assert.deepEqual(geometry.placeFloating({x:0,y:0,width:314,height:74},[{x:0,y:0,width:100,height:50}]),{x:16,y:16,width:68,height:18});
});

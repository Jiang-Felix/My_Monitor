import test from 'node:test';
import assert from 'node:assert/strict';
const { floatingPlacement }=await import('../desktop/floating-position.js').catch(()=>({}));
test('saved floating coordinates restore on all screens and recover safely after display changes',()=>{
  assert.equal(typeof floatingPlacement,'function');
  const areas=[{x:0,y:0,width:1920,height:1040},{x:-1280,y:0,width:1280,height:984}];
  const size={width:390,height:150};
  assert.deepEqual(floatingPlacement({x:-1000,y:200},size,areas,areas[0]),{...size,x:-1000,y:200});
  assert.deepEqual(floatingPlacement({x:-1000,y:200},size,[areas[0]],areas[0]),{...size,x:16,y:200});
  for(const saved of [null,{x:NaN,y:0},{x:'500',y:10},{x:Infinity,y:0},{x:1e20,y:20}])assert.deepEqual(floatingPlacement(saved,size,areas,areas[0]),{...size,x:1514,y:24});
});

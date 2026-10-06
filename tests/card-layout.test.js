import test from 'node:test';
import assert from 'node:assert/strict';
const { cardLayout }=await import('../ui/card-layout.js').catch(()=>({}));
test('card widths and column counts adapt with a fixed 18px gap and no overflow',()=>{
  assert.equal(typeof cardLayout,'function');
  for(let width=260;width<=2500;width+=13){
    for(const count of [1,2,3,7,30]){
      const {columns,cardWidth}=cardLayout(width,count);
      assert.ok(columns>=1&&columns<=count);
      assert.ok(cardWidth>=260&&cardWidth<=340);
      assert.ok(columns*cardWidth+(columns-1)*18<=width+0.001);
      if(cardWidth<340)assert.ok(Math.abs(columns*cardWidth+(columns-1)*18-width)<0.001);
    }
  }
  assert.equal(cardLayout(921,6).columns,3,'default window provides three comfortable columns');
  assert.ok(cardLayout(921,6).cardWidth>290);
  assert.ok(cardLayout(1900,20).columns>cardLayout(921,20).columns);
  assert.equal(cardLayout(1900,2).cardWidth,340,'few cards remain bounded instead of stretching');
  assert.equal(cardLayout(200,1).cardWidth,200,'extremely narrow content does not overflow');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSource } from '../core/config.js';
import { Monitor } from '../core/monitor.js';

test('weekly and monthly source periods validate, persist and wait for their next scheduled update', async () => {
  const source={id:'monthly',name:'月度量',kind:'fixed',fixedValue:42,interval:2592000};
  assert.equal(validateSource({...source,interval:604800}).interval,604800);
  let now=1000,requests=0;
  const monitor=new Monitor({now:()=>now,collect:async()=>{requests++;return {};}});
  monitor.upsert(source);await monitor.refresh(source.id);
  assert.equal(monitor.snapshot()[0].nextRun,2592001000);
  now+=604800000;monitor.tick();assert.equal(requests,1);
  const restored=new Monitor({now:()=>now,collect:async()=>({})});
  restored.restore(monitor.snapshot());assert.equal(restored.snapshot()[0].interval,2592000);
  assert.throws(()=>validateSource({...source,interval:2592001}));
});

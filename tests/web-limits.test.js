import test from 'node:test';
import assert from 'node:assert/strict';
import { bounded, RollingBytes } from '../desktop/web-limits.js';

test('aborting before an asynchronous browser operation starts never starts it',async()=>{
  const controller=new AbortController();let started=false;
  const pending=bounded(()=>{started=true;return 1;},{signal:controller.signal});controller.abort();
  await assert.rejects(pending);assert.equal(started,false);
});
test('stream bytes remain accounted until their entire bucket expires',()=>{
  const bytes=new RollingBytes(60000);assert.equal(bytes.add(100,999),100);
  assert.equal(bytes.add(50,60000),150);
  assert.equal(bytes.add(10,61000),60);
});
test('a stalled browser operation times out and runs its cleanup once',async()=>{
  let cleaned=0;
  await assert.rejects(bounded(()=>new Promise(()=>{}),{timeoutMs:10,onTimeout:()=>cleaned++}),e=>e.code==='network');
  assert.equal(cleaned,1);
});

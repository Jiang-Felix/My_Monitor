import test from 'node:test';
import assert from 'node:assert/strict';
import { StateTransactions } from '../core/state-transactions.js';

test('failed persistence never activates candidate state; successful edits serialize',async()=>{
  let live=1,fail=true;const writes=[];
  const tx=new StateTransactions({write:async candidate=>{writes.push(candidate);if(fail)throw Error('disk unavailable');}});
  await assert.rejects(tx.run(()=>2,candidate=>{live=candidate;}),/disk/);assert.equal(live,1);
  fail=false;
  await Promise.all([tx.run(()=>live+1,c=>{live=c;}),tx.run(()=>live+1,c=>{live=c;})]);
  assert.equal(live,3);assert.deepEqual(writes,[2,2,3]);
});
test('timed out persistence aborts its write and cannot activate a late candidate',async()=>{
  let activated=false,signal,finish;
  const tx=new StateTransactions({timeoutMs:20,write:(_candidate,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
  await assert.rejects(tx.run(()=>1,()=>{activated=true;}),/超时/);assert.equal(signal.aborted,true);
  finish();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(activated,false);
});
test('bounded mutation queue rejects excess work and drains after failure',async()=>{
  let finish;const tx=new StateTransactions({maxPending:1,write:()=>new Promise(resolve=>{finish=resolve;})});
  const first=tx.run(()=>1,()=>{});await Promise.resolve();
  await assert.rejects(tx.run(()=>2,()=>{}),/繁忙/);finish();await first;assert.equal(tx.pending,0);
});

test('uncancellable commit timeout blocks further writes and requests recovery',async()=>{
  let finish,uncertain=0,activated=false;
  const tx=new StateTransactions({timeoutMs:20,onUncertain:()=>{uncertain++;},write:(_candidate,options)=>{
    options.onCommitStart();return new Promise(resolve=>{finish=resolve;});
  }});
  await assert.rejects(tx.run(()=>1,()=>{activated=true;}),/提交状态无法确认/);
  assert.equal(uncertain,1);await assert.rejects(tx.run(()=>2,()=>{}));
  finish();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(activated,false);
});

test('session disposal completes before a following save is prepared',async()=>{
  let release,start,disposed=false,writes=0;const started=new Promise(resolve=>{start=resolve;});
  const tx=new StateTransactions({write:async()=>{writes++;}});
  const cleanup=tx.runExclusive(async()=>{await new Promise(resolve=>{release=resolve;start();});disposed=true;});
  await started;const save=tx.run(()=>{assert.equal(disposed,true);return 1;},()=>{});
  release();await Promise.all([cleanup,save]);assert.equal(writes,1);
});

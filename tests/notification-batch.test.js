import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationBatch } from '../core/notification-batch.js';

test('notification storms become bounded summaries while retaining the total checkpoint count',()=>{
  const batches=[];const batch=new NotificationBatch({delayMs:100000,maxItems:200,onBatch:b=>batches.push(b)});
  for(let i=0;i<500;i++)batch.push({id:String(i),time:i});
  assert.equal(batch.size,200);batch.flush();assert.equal(batches.length,1);
  assert.equal(batches[0].count,500);assert.equal(batches[0].items.length,200);assert.equal(batches[0].items.at(-1).id,'499');
  batch.dispose();
});
test('disposing notifications cancels future delivery without leaving a timer',async()=>{
  let deliveries=0;const batch=new NotificationBatch({delayMs:10,onBatch:()=>deliveries++});batch.push({id:'one'});batch.dispose();
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(deliveries,0);assert.equal(batch.size,0);
});

test('a sparse rule retains its latest receipt during another rule notification storm',()=>{
  let delivered;const batch=new NotificationBatch({onBatch:value=>{delivered=value;}});
  batch.push({id:'sparse-last',ruleId:'sparse'});
  for(let i=0;i<500;i++)batch.push({id:`busy-${i}`,ruleId:'busy'});
  batch.flush();assert.equal(delivered.count,501);assert.equal(delivered.items.length,201);
  assert.ok(delivered.items.some(item=>item.id==='sparse-last'));assert.equal(batch.latestByRule.size,0);batch.dispose();
  assert.equal(delivered.items.at(-1).id,'busy-499');
});

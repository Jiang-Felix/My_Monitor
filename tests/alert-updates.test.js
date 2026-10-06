import test from 'node:test';
import assert from 'node:assert/strict';
import {AlertEngine,validateAlertRule} from '../core/alerts.js';
import {Monitor} from '../core/monitor.js';
const rule={id:'a',name:'更新计数',sourceId:'s',type:'delta',lower:-5,upper:5,updateEvery:3};
function fixture(){let time=1000,sequence=0;const engine=new AlertEngine({now:()=>time});engine.startRun();const source=value=>({id:'s',kind:'fixed',name:'数值',unit:'GB',interval:60,enabled:true,status:'ok',lastSuccess:time,updateSequence:sequence,sample:{value,total:null}});engine.upsert(rule,source(10));return {engine,source,read(value){time+=60000;sequence++;engine.observe([source(value)]);},tick(){time+=250;engine.observe([source(99)]);}};}
test('records exactly every N successful updates and never counts cached broadcasts',()=>{
  const f=fixture();f.read(10);f.read(12);assert.equal(f.engine.snapshot().tracking[0].points.length,0);
  f.read(14);assert.deepEqual(f.engine.snapshot().tracking[0].points.map(p=>p.measurement),[null]);
  for(let i=0;i<8;i++)f.tick();assert.equal(f.engine.snapshot().tracking[0].points.length,1);
  f.read(15);f.read(17);f.read(20);assert.deepEqual(f.engine.snapshot().tracking[0].points.map(p=>p.measurement),[null,6]);
});
test('stop freezes records across failures and restart, and start alone clears the saved graph',()=>{
  const f=fixture();for(const v of [10,11,12,13,14,20])f.read(v);
  f.engine.upsert({...rule,enabled:false},f.source(20));const saved=f.engine.snapshot().tracking[0];
  f.read(99);f.engine.observe([{...f.source(99),failed:true,status:'network'}]);assert.deepEqual(f.engine.snapshot().tracking[0],saved);
  f.engine.finishRun();const restored=new AlertEngine({now:()=>2000000});restored.startRun(f.engine.serialize());
  assert.deepEqual(restored.snapshot().tracking[0].points,saved.points);
  assert.equal(restored.snapshot().tracking[0].outside,saved.outside);
  f.engine.startRun(f.engine.serialize());f.engine.upsert(rule,f.source(99));assert.equal(f.engine.snapshot().tracking.length,0);
});
test('update-count rules reject invalid counts and migrate earlier timed rules using source frequency',()=>{
  for(const updateEvery of [0,-1,1.25,12.5,true,2592001,'bad'])assert.throws(()=>validateAlertRule({...rule,updateEvery}));
  const engine=new AlertEngine();engine.startRun({schemaVersion:2,rules:[{...rule,updateEvery:undefined,intervalSeconds:180}],tracking:[],notifications:[]},[{id:'s',interval:60}]);
  assert.equal(engine.snapshot().rules[0].updateEvery,3);
  engine.startRun({schemaVersion:2,rules:[{...rule,updateEvery:undefined,intervalSeconds:86400}],tracking:[],notifications:[]},[{id:'s',interval:1}]);
  assert.equal(engine.snapshot().rules[0].updateEvery,86400,'long legacy frequencies are never silently truncated');
});

test('half-step multipliers record on successful updates without rounding or accumulating cadence drift',()=>{
  for(let updateEvery=1;updateEvery<=12;updateEvery+=.5){
    const f=fixture();f.engine.upsert({...rule,type:'value',updateEvery},f.source(10));
    for(let i=1;i<=48;i++){f.read(i);f.tick();}
    const expected=Array.from({length:Math.floor(48/updateEvery)},(_,index)=>Math.ceil((index+1)*updateEvery));
    assert.deepEqual(f.engine.snapshot().tracking[0].points.map(p=>p.value),expected,`${updateEvery}x`);
  }
});

test('half-step cadence survives rule persistence and starts a fresh counter after interruptions',()=>{
  const f=fixture(),half={...rule,type:'value',updateEvery:1.5};f.engine.upsert(half,f.source(10));
  f.read(11);f.read(12);assert.deepEqual(f.engine.snapshot().tracking[0].points.map(p=>p.value),[12]);
  const restored=new AlertEngine();restored.startRun(f.engine.serialize());assert.equal(restored.snapshot().rules[0].updateEvery,1.5);
  f.engine.observe([{...f.source(12),failed:true,status:'network'}]);f.read(13);assert.equal(f.engine.snapshot().tracking[0].points.length,0);
  f.read(14);assert.deepEqual(f.engine.snapshot().tracking[0].points.map(p=>p.value),[14]);
});
test('every successful collection has a distinct sequence even within one millisecond',async()=>{
  const monitor=new Monitor({now:()=>1000,collect:async()=>({})});
  monitor.upsert({id:'s',name:'固定',kind:'fixed',fixedValue:10,interval:60});
  await monitor.refresh('s');const first=monitor.snapshot()[0];await monitor.refresh('s');
  assert.equal(monitor.snapshot()[0].updateSequence,first.updateSequence+1);
  monitor.upsert({id:'s',name:'固定',kind:'fixed',fixedValue:11,interval:60});await monitor.refresh('s');
  assert.equal(monitor.snapshot()[0].updateSequence,first.updateSequence+2);
});

test('stopped calculation failures remain visible after restoring the saved graph',()=>{
  let time=1000;const engine=new AlertEngine({now:()=>time});engine.startRun();engine.upsert({...rule,updateEvery:1});
  const source=value=>({id:'s',name:'数值',kind:'fixed',enabled:true,status:'ok',lastSuccess:time,sample:{value,total:null}});
  time++;engine.observe([source(-1e308)]);time++;engine.observe([source(1e308)]);
  engine.upsert({...rule,updateEvery:1,enabled:false});const error=engine.snapshot().tracking[0].error;
  assert.ok(error);const restored=new AlertEngine();restored.startRun(engine.serialize());assert.equal(restored.snapshot().tracking[0].error,error);
});

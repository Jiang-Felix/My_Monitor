import test from 'node:test';
import assert from 'node:assert/strict';
import { AlertEngine, validateAlertRule } from '../core/alerts.js';

function setup(options = {}, overrides = {}) {
  let time = 1000;
  const engine = new AlertEngine({ now: () => time, ...options }); engine.startRun();
  const rule = { id: 'a', name: '变化范围', sourceId: 's', type: 'delta', lower: -5, upper: 5, updateEvery: 1, enabled: true, ...overrides };
  engine.upsert(rule);
  const source = (value, patch = {}) => ({ id: 's', name: '用量', kind: 'fixed', interval:1, unit: 'GB', enabled: true, status: 'ok', failed: false, stale: false, sample: { value, total: null }, lastSuccess: time, ...patch });
  const sample = (value, patch = {}, advance = 1000) => { time += advance; engine.observe([source(value, patch)]); };
  return { engine, rule, sample, source, setTime: value => { time = value; } };
}
const track = engine => engine.snapshot().tracking[0];

test('deleting a data source removes every linked rule, record and receipt while preserving other sources', () => {
  const { engine, sample, rule, source } = setup();
  engine.upsert({...rule,id:'stopped',enabled:false});
  engine.upsert({...rule,id:'other',sourceId:'other-source',type:'value'});
  sample(10);sample(20);
  engine.observe([source(20),source(7,{id:'other-source'})]);
  assert.equal(engine.snapshot().notifications.length,2);
  const otherTrack=engine.snapshot().tracking.find(t=>t.ruleId==='other');
  assert.equal(engine.removeSource('s'),2);
  const saved=engine.serialize();
  assert.deepEqual(saved.rules.map(r=>r.id),['other']);
  assert.deepEqual(saved.tracking,[otherTrack]);
  assert.deepEqual(saved.notifications.map(n=>n.ruleId),['other']);
  assert.equal(engine.acceptAfter.has('a'),false);
  assert.equal(engine.acceptAfter.has('stopped'),false);
  assert.equal(engine.removeSource('missing'),0);
  const restored=new AlertEngine();restored.startRun(saved);
  assert.deepEqual(restored.snapshot().rules.map(r=>r.id),['other']);
});

test('delta compares adjacent checkpoints including signed changes and inclusive boundaries; every outside point notifies', () => {
  const { engine, sample } = setup();
  sample(10); assert.equal(track(engine).measurement, null);
  sample(15); sample(20); assert.equal(engine.snapshot().notifications.length, 0);
  sample(26); assert.equal(track(engine).measurement, 6);
  sample(20); assert.equal(track(engine).measurement, -6);
  assert.equal(engine.snapshot().notifications.length, 2);
  sample(15); sample(9); assert.equal(engine.snapshot().notifications.length, 3);
  assert.deepEqual(track(engine).points.map(p => p.measurement), [null, 5, 5, 6, -6, -5, -6]);
});

test('value evaluates first checkpoint and reminds at every outside checkpoint without waiting to recover', () => {
  const { engine, sample } = setup({}, { type: 'value', lower: 10, upper: 20 });
  sample(9); sample(8); assert.equal(engine.snapshot().notifications.length, 2);
  sample(10); sample(20); assert.equal(track(engine).outside, false);
  sample(21); assert.equal(engine.snapshot().notifications.length, 3);
  assert.equal(track(engine).measurement, 21); assert.equal(track(engine).points.length, 5);
});

test('independent update counts record every N successes without requests or repeated-cache records', () => {
  const { engine, sample, source } = setup({}, { updateEvery: 5 });
  for(let i=0;i<5;i++)sample(10);
  assert.equal(track(engine).points.length,1);
  for(let i=0;i<5;i++)sample(22);
  assert.equal(track(engine).measurement,12);
  for(let i=0;i<5;i++)sample(28);
  assert.equal(track(engine).measurement,6);
  assert.equal(engine.snapshot().notifications.length,2);
  for(let i=0;i<10;i++)engine.observe([source(28)]);
  assert.equal(track(engine).points.length,3);
});

test('invalid bounds and update counts cannot corrupt existing rules; single sided and equal bounds work', () => {
  for (const range of [{ lower: '', upper: '0' }, { lower: '-1', upper: '' }, { lower: 0, upper: 0 }]) {
    const valid = validateAlertRule({ id: 'a', name: '有效', sourceId: 's', type: 'value', intervalSeconds: 1, ...range });
    assert.ok(valid.lower !== null || valid.upper !== null);
  }
  const { engine, rule } = setup();
  for (const patch of [{ lower: '', upper: '' }, { lower: 6, upper: 5 }, { lower: true }, { upper: Infinity }, { type: 'unknown' }, { enabled: 'false' }, { lower: '2GB' }, { updateEvery: 0 }, { updateEvery: true }, { updateEvery: 0.5 }, { updateEvery: 2592001 }]) {
    assert.throws(() => engine.upsert({ ...rule, ...patch })); assert.equal(engine.snapshot().rules[0].lower, -5);
  }
});

test('failed, stale, disabled, invalid, refreshing and older samples do not enter checkpoint records', () => {
  const { engine, sample } = setup(); sample(10);
  for (const patch of [{ failed: true }, { stale: true }, { enabled: false }, { status: 'refreshing',sample:null }, { status: 'auth' }, { sample: { value: NaN } }, { sample: { value: 2, total: 1 } }, { lastSuccess: 1000 }]) sample(99, patch);
  assert.equal(engine.snapshot().tracking.length, 0); assert.equal(engine.snapshot().notifications.length, 0);
  sample(11); assert.equal(track(engine).measurement, null, 'source pause clears the comparison baseline');
  sample(12); assert.equal(track(engine).measurement, 1);
});

test('normal refreshing and idle numeric-edit transitions preserve the active comparison baseline', () => {
  const { engine, sample, rule } = setup(); sample(10); sample(16);
  engine.observe([{id:'s',kind:'fixed',unit:'GB',status:'refreshing',enabled:true,failed:false,stale:false,sample:{value:16,total:null},lastSuccess:3000}]);
  engine.observe([{id:'s',kind:'fixed',unit:'GB',status:'idle',enabled:true,failed:false,stale:false,sample:null,lastSuccess:null}]);
  sample(17);
  assert.deepEqual(track(engine).points.map(p=>p.measurement),[null,6,1]);
  assert.equal(engine.snapshot().notifications.length, 1);
});

test('normal in-flight refreshes retain the baseline without recording the same cached reading',()=>{
  const {engine,sample}=setup();sample(10);
  sample(10,{status:'refreshing',lastSuccess:2000});
  sample(10,{status:'refreshing',lastSuccess:2000});
  sample(15,{},0);
  assert.deepEqual(track(engine).points.map(p=>p.measurement),[null,5]);
});

test('stopping preserves records and starting clears them to create a fresh segment',()=>{
  const {engine,sample,rule}=setup();sample(10);sample(16);
  engine.upsert({...rule,enabled:false});
  const stopped=track(engine);
  assert.equal(engine.snapshot().tracking.length,1);
  assert.equal(engine.snapshot().notifications.length,1);
  sample(90);assert.deepEqual(track(engine),stopped);
  engine.upsert(rule);sample(90);sample(91);
  assert.deepEqual(track(engine).points.map(p=>p.measurement),[null,1]);
});
test('per-rule chart windows accept 10/20/50 and changing only the window preserves the live recording cadence',()=>{
  const {engine,sample,rule}=setup();sample(10);sample(11);
  assert.equal(engine.snapshot().rules[0].chartPoints,20);
  const previous=track(engine);
  for(const chartPoints of [10,20,50]){
    engine.upsert({...rule,chartPoints});
    assert.equal(engine.snapshot().rules[0].chartPoints,chartPoints);
    assert.deepEqual(track(engine),previous);
  }
  for(const chartPoints of [0,15,120,true,'bad'])assert.throws(()=>engine.upsert({...rule,chartPoints}));
});

test('source semantics and detection type edits discard incompatible graphs; fixed numeric edits remain new values', () => {
  const { engine, sample, rule } = setup(); sample(10); sample(16);
  sample(80, { kind: 'web', selector: '#new' }); assert.equal(track(engine).measurement, null); assert.equal(track(engine).points.length, 1);
  engine.upsert({ ...rule, type: 'value' }); assert.equal(engine.snapshot().tracking.length, 0);
  sample(2); assert.equal(track(engine).measurement, 2);
});

test('only latest 50 records are retained and missing a checkpoint starts a fresh segment', () => {
  const { engine, sample, setTime } = setup(); for (let i = 0; i < 140; i++) sample(i);
  assert.deepEqual(track(engine).points.map(p=>p.value),Array.from({length:50},(_,i)=>90+i));
  assert.equal(track(engine).points.length, 50); setTime(1000000000); sample(140);
  assert.equal(track(engine).points.length, 1); assert.equal(track(engine).measurement,null);
  assert.equal(track(engine).points.at(-1).time, 1000001000);
  assert.equal(track(engine).updatesSinceRecord,0);
});

test('normal quit and interrupted restarts clear old graphs and begin with a new baseline', () => {
  for (const quit of [false, true]) {
    const { engine, sample, source, setTime } = setup(); sample(10); sample(16); if (quit) engine.finishRun();
    const next = new AlertEngine({ now: () => time }); let time = 10000000; next.startRun(engine.serialize());
    next.observe([source(90)]); assert.equal(next.snapshot().tracking.length,0);
    time = 10000001; setTime(time); next.observe([source(90)]);
    assert.equal(track(next).points.at(-1).measurement, null); assert.equal(next.snapshot().notifications.length, 1);
    time += 1000; setTime(time); next.observe([source(91)]); assert.equal(track(next).measurement, 1);
    assert.deepEqual(track(next).points.map(p=>p.measurement),[null,1]);
  }
});

test('delivery failures do not stop detection and last notification receipt is shown per rule', () => {
  const { engine, sample } = setup({ onNotify: () => { throw new Error('系统通知不可用'); } }); sample(10); sample(16); sample(17);
  assert.equal(track(engine).current, 17); assert.equal(track(engine).lastAlert.delivery, 'failed');
  engine.updateDelivery(track(engine).lastAlert.id, 'shown'); assert.equal(track(engine).lastAlert.delivery, 'shown');
});

test('legacy period rules migrate to paused delta ranges requiring explicit review', () => {
  const engine = new AlertEngine({ now: () => 1000 });
  engine.startRun({ rules: ['increase', 'decrease', 'change'].map((direction, i) => ({ id: `old-${i}`, name: '旧告警', sourceId: 's', unit: 'hour', threshold: 5, direction, reaction: 'restart', enabled: true })), logs: [{ reason: 'quit' }], notifications: [] });
  const rules = engine.snapshot().rules;
  assert.deepEqual(rules.map(r => [r.lower, r.upper]), [[null, 5], [-5, null], [-5, 5]]);
  assert.ok(rules.every(r => r.type === 'delta' && !r.enabled && r.migrationNote));
  assert.equal(engine.serialize().schemaVersion, 3); assert.equal('logs' in engine.serialize(), false);
  engine.upsert({ ...rules[0], enabled: true }); assert.equal(engine.snapshot().rules[0].migrationNote, undefined);
});

test('overflowing delta is unavailable without a crash or false alert and later recovers', () => {
  const { engine, sample } = setup(); sample(-1e308); sample(1e308);
  assert.equal(track(engine).measurement, null); assert.match(track(engine).error, /范围/); assert.equal(engine.snapshot().notifications.length, 0);
  sample(1e308); assert.equal(track(engine).measurement, 0); assert.equal(track(engine).error, '');
});

test('unknown schemas and corrupt new points are rejected; deleted rules retain no graph', () => {
  const { engine, sample } = setup(); sample(10);
  assert.throws(() => new AlertEngine().startRun({ schemaVersion: 99, rules: [] }));
  const saved = engine.serialize(); saved.tracking[0].points[0].value = 'bad'; assert.throws(() => new AlertEngine().startRun(saved));
  engine.remove('a'); assert.equal(engine.snapshot().tracking.length, 0);
});

test('internal notification receipts are bounded independently of graph samples', () => {
  const { engine, sample } = setup({}, { type: 'value', lower: 0, upper: 1 });
  for (let i = 0; i < 210; i++) sample(2);
  assert.equal(engine.serialize().notifications.length, 200); assert.equal(track(engine).points.length, 50); assert.ok(track(engine).lastAlert);
});
test('backward wall-clock correction clears the discontinuous graph and reanchors checks', () => {
  const { engine,sample,setTime,source }=setup({}, {type:'value',lower:0,upper:1});
  setTime(10000000);sample(2);const original=track(engine).points[0];
  setTime(6400000);sample(2);
  assert.equal(track(engine).points.length,1);assert.equal(engine.snapshot().notifications.length,2);
  assert.notEqual(track(engine).points[0].segment,original.segment);
  const restarted=new AlertEngine({now:()=>6000000});restarted.startRun(engine.serialize());
  setTime(6000000);restarted.observe([source(2)]);
  assert.equal(track(restarted).points.length,1);
  const again=new AlertEngine({now:()=>6001000});assert.doesNotThrow(()=>again.startRun(restarted.serialize()));
});

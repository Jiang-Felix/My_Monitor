import test from 'node:test';
import assert from 'node:assert/strict';
import { Monitor } from '../core/monitor.js';
import { validateFloatingSettings } from '../core/floating-settings.js';
const view = await import('../ui/floating-view.js').catch(() => ({}));
const config = { id:'delta',name:'流量',kind:'http',url:'https://example.com',valuePath:'value',totalPath:'total',interval:60,unit:'GB' };

test('floating change compares successive successful updates, keeps configured cadence, ignores failed reads and resets on pause/identity/restart', async () => {
  let now=1000,value=40,fail=false;
  const monitor=new Monitor({now:()=>now,collect:async()=>{if(fail)throw new Error('bad reading');return {value,total:100};}});
  monitor.upsert(config);await monitor.refresh(config.id);
  assert.equal(monitor.snapshot()[0].change,null,'first reading only establishes a baseline');
  now=3400;value=55;await monitor.refresh(config.id);
  assert.deepEqual(monitor.snapshot()[0].change,{previousValue:40,previousTotal:100,delta:15,intervalSeconds:60});
  now=4000;fail=true;await monitor.refresh(config.id);assert.equal(monitor.snapshot()[0].sample.value,55);
  now=5000;fail=false;value=50;await monitor.refresh(config.id);
  assert.deepEqual(monitor.snapshot()[0].change,{previousValue:55,previousTotal:100,delta:-5,intervalSeconds:60});
  now=6000;await monitor.refresh(config.id);assert.equal(monitor.snapshot()[0].change.delta,0);
  monitor.upsert({...config,enabled:false});monitor.upsert(config);now=7000;await monitor.refresh(config.id);
  assert.equal(monitor.snapshot()[0].change,null);
  const saved=monitor.snapshot();const restored=new Monitor({now:()=>now,collect:async()=>({value:80,total:100})});restored.restore(saved);now=8000;await restored.refresh(config.id);
  assert.equal(restored.snapshot()[0].change,null,'does not measure the offline gap');
  monitor.upsert({...config,unit:'MB'});now=9000;await monitor.refresh(config.id);assert.equal(monitor.snapshot()[0].change,null);
  now=8000;value=60;await monitor.refresh(config.id);assert.equal(monitor.snapshot()[0].change,null,'backward clock correction starts a fresh baseline');
});

test('editing a fixed numeric reading is still a change to the same quantity; replacing a source clears its baseline', async () => {
  let now=1000;
  const monitor=new Monitor({now:()=>now,collect:async()=>({})});
  const fixed={id:'fixed-change',name:'固定数值',kind:'fixed',fixedValue:10,interval:2};
  monitor.upsert(fixed);await monitor.refresh(fixed.id);
  now=2000;monitor.upsert({...fixed,fixedValue:16});await monitor.refresh(fixed.id);
  assert.deepEqual(monitor.snapshot()[0].change,{previousValue:10,previousTotal:null,delta:6,intervalSeconds:2});
  monitor.remove(fixed.id);monitor.upsert(fixed);now=3000;await monitor.refresh(fixed.id);assert.equal(monitor.snapshot()[0].change,null);
});

test('delta bands cover the exact increase/decrease segment and text toggles work independently, including no-total values', () => {
  assert.equal(typeof view.floatingPresentation,'function');
  const settings=validateFloatingSettings({showAmount:true,showUnit:true,showTotal:true,showDeltaBand:true,showDeltaValue:true});
  const source={...config,enabled:true,status:'ok',sample:{value:75,total:100,unit:'GB'},change:{previousValue:50,previousTotal:100,delta:25,intervalSeconds:60}};
  let result=view.floatingPresentation(source,settings);
  assert.equal(result.text,'75/100GB  +25/1分钟');
  assert.deepEqual(result.band,{width:75,capWidth:50,color:settings.increaseColor});
  result=view.floatingPresentation({...source,sample:{value:25,total:100},change:{previousValue:75,previousTotal:100,delta:-50,intervalSeconds:3600}},settings);
  assert.equal(result.text,'25/100GB  -50/1小时');assert.deepEqual(result.band,{width:75,capWidth:25,color:settings.decreaseColor});
  result=view.floatingPresentation({...source,sample:{value:75,total:null}},settings);
  assert.equal(result.band,null);assert.equal(result.text,'75GB  +25/1分钟');
  assert.equal(view.floatingPresentation(source,{...settings,showUnit:false,showTotal:false}).text,'75  +25/1分钟');
  assert.equal(view.floatingPresentation(source,{...settings,showAmount:false}).text,'+25/1分钟');
  assert.equal(view.floatingPresentation(source,{...settings,showDeltaValue:false,showDeltaBand:false}).text,'75/100GB');
  assert.equal(view.floatingPresentation({...source,stale:true},settings).band,null);
  assert.equal(view.floatingPresentation({...source,enabled:false},settings).text,'75/100GB');
  assert.equal(view.floatingPresentation({...source,change:null},{...settings,showAmount:false}).text,'--');
  assert.equal(view.floatingPresentation({...source,change:{previousValue:75,previousTotal:100,delta:0,intervalSeconds:2}},settings).text,'75/100GB');
  assert.equal(view.floatingPresentation({...source,change:{previousValue:74.9,previousTotal:100,delta:0.1+0.2,intervalSeconds:90}},settings).deltaText,'+0.3/90秒');
  assert.equal(view.floatingPresentation({...source,change:{previousValue:70,previousTotal:100,delta:5,intervalSeconds:86400}},settings).deltaText,'+5/1天');
  assert.equal(view.floatingPresentation(source,{...settings,showUnit:false}).deltaText,view.floatingPresentation(source,settings).deltaText);
});

test('delta geometry clamps to the track and unavailable/overflow changes never render misleading colored areas', () => {
  assert.equal(typeof view.floatingPresentation,'function');
  const settings=validateFloatingSettings({showDeltaBand:true,showDeltaValue:true});
  const source={...config,enabled:true,status:'ok',sample:{value:25,total:50},change:{previousValue:100,previousTotal:100,delta:-75,intervalSeconds:60}};
  assert.deepEqual(view.floatingPresentation(source,settings).band,{width:100,capWidth:50,color:settings.decreaseColor});
  for(const patch of [{sample:{value:0,total:0}},{sample:null},{status:'parse'},{change:{previousValue:10,delta:Infinity,intervalSeconds:60}},{change:{previousValue:25,delta:0,intervalSeconds:60}}])assert.equal(view.floatingPresentation({...source,...patch},settings).band,null);
});


test('changing totals connect the actual previous/current fill endpoints; new quotas never invent an unknown prior endpoint', () => {
  const settings=validateFloatingSettings({showDeltaBand:true,showDeltaValue:true});
  const source={...config,enabled:true,status:'ok',sample:{value:60,total:200},change:{previousValue:50,previousTotal:100,delta:10,intervalSeconds:60}};
  assert.deepEqual(view.floatingPresentation(source,settings).band,{width:50,capWidth:30,color:settings.increaseColor});
  assert.equal(view.floatingPresentation({...source,change:{...source.change,previousTotal:null}},settings).band,null);
  assert.equal(view.floatingPresentation({...source,change:{...source.change,previousTotal:0}},settings).band,null);
});

test('recent nonzero bands persist through unchanged reads while instantaneous text becomes zero, and new changes replace them',async()=>{
  let now=1000,value=40,total=100,fail=false;
  const monitor=new Monitor({now:()=>now,collect:async()=>{if(fail)throw new Error('failed');return {value,total};}});
  const settings=validateFloatingSettings({showDeltaBand:true,showDeltaValue:true});
  const read=async()=>{now+=1000;await monitor.refresh(config.id);return monitor.snapshot()[0];};
  monitor.upsert(config);await read();
  value=60;let source=await read();
  const increase=view.floatingPresentation(source,settings).band;
  assert.deepEqual(increase,{width:60,capWidth:40,color:settings.increaseColor});
  for(let i=0;i<3;i++){
    source=await read();assert.equal(source.change.delta,0);
    assert.deepEqual(view.floatingPresentation(source,settings).band,increase);
    assert.equal(view.floatingPresentation(source,settings).deltaText,'+0/1分钟');
  }
  total=200;source=await read();
  assert.deepEqual(view.floatingPresentation(source,settings).band,increase,'total-only changes preserve the actual endpoints of the most recent numeric change');
  value=50;source=await read();
  const decrease={width:30,capWidth:25,color:settings.decreaseColor};
  assert.deepEqual(view.floatingPresentation(source,settings).band,decrease);
  fail=true;source=await read();assert.equal(view.floatingPresentation(source,settings).band,null);
  fail=false;source=await read();assert.deepEqual(view.floatingPresentation(source,settings).band,decrease);
  const snapshot=monitor.snapshot();snapshot[0].recentChange.delta=100;
  assert.equal(monitor.snapshot()[0].recentChange.delta,-10,'snapshots do not mutate retained state');
  monitor.upsert({...config,enabled:false});monitor.upsert(config);source=await read();
  assert.equal(source.recentChange,null);assert.equal(view.floatingPresentation(source,settings).band,null);
  value=60;await read();
  const restored=new Monitor({now:()=>now,collect:async()=>({value,total})});restored.restore(monitor.snapshot());now+=1000;await restored.refresh(config.id);
  assert.equal(restored.snapshot()[0].recentChange,null,'restarts establish a fresh baseline');
  now-=5000;source=await read();assert.equal(source.recentChange,null,'clock correction clears old endpoints');
});

test('successive reads in the same millisecond retain zero-change bands and detect new numeric changes',async()=>{
  let now=1000,value=40;
  const monitor=new Monitor({now:()=>now,collect:async()=>({value,total:100})});
  const settings=validateFloatingSettings({showDeltaBand:true,showDeltaValue:true});
  monitor.upsert(config);await monitor.refresh(config.id);
  now=2000;value=60;await monitor.refresh(config.id);
  const increase=view.floatingPresentation(monitor.snapshot()[0],settings).band;
  await monitor.refresh(config.id);
  assert.equal(monitor.snapshot()[0].change?.delta,0,'same timestamp is still an adjacent successful update');
  assert.deepEqual(view.floatingPresentation(monitor.snapshot()[0],settings).band,increase);
  value=40;await monitor.refresh(config.id);
  assert.equal(monitor.snapshot()[0].change?.delta,-20);
  assert.deepEqual(view.floatingPresentation(monitor.snapshot()[0],settings).band,{width:60,capWidth:40,color:settings.decreaseColor});
});

test('English floating cadence keeps compact units and does not modify user names or units',async()=>{
  const i18n=await import('../core/i18n.js').catch(()=>({}));
  assert.equal(typeof i18n.setLanguage,'function');
  i18n.setLanguage('en');
  try{
    const settings=validateFloatingSettings({showAmount:true,showUnit:true,showDeltaValue:true});
    const source={...config,name:'我的流量',unit:'次',status:'ok',enabled:true,sample:{value:75,total:100},change:{previousValue:50,previousTotal:100,delta:25,intervalSeconds:60}};
    assert.equal(view.floatingPresentation(source,settings).deltaText,'+25/1min');
    assert.match(view.floatingPresentation(source,settings).amountText,/次$/);
    assert.equal(source.name,'我的流量');assert.equal(source.unit,'次');
    for(const [interval,label] of [[3600,'1h'],[86400,'1d'],[90,'90s']])assert.equal(view.floatingPresentation({...source,change:{...source.change,intervalSeconds:interval}},settings).deltaText,`+25/${label}`);
  }finally{i18n.setLanguage('zh-CN');}
});

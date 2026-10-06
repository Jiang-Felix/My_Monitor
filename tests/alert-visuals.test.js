import test from 'node:test';
import assert from 'node:assert/strict';
const visuals = await import('../ui/alert-visuals.js').catch(() => ({}));
test('range axis geometry stays finite for negative, single-sided, equal, tiny and extreme bounds', () => {
  assert.equal(typeof visuals.axisMarkup, 'function');
  for (const [lower, upper, measurement] of [[-5,5,-6],[null,0,1],[-1,null,0],[0,0,0],[-1e308,1e308,1e308],[1e-300,2e-300,1.5e-300]]) {
    const html = visuals.axisMarkup({ type:'delta',lower,upper }, { measurement });
    assert.ok(html.includes('range-axis')); assert.ok(html.includes('range-dot'));
    assert.doesNotMatch(html, /NaN|Infinity/); assert.match(html, /role="img"/);
  }
});
test('delta graph uses signed bars, value graph uses lines and separate restart segments, and all points have exact tooltips', () => {
  assert.equal(typeof visuals.chartMarkup, 'function');
  const points = [null, 6, -6, null, 5].map((measurement,i)=>({ time:1000+i*1000,sourceTime:1000+i*1000,value:10+i,measurement,segment:i<3?'a':'b' }));
  const delta = visuals.chartMarkup({type:'delta',lower:-5,upper:5}, {points});
  assert.equal((delta.match(/class="chart-bar/g)||[]).length, 3); assert.match(delta,/range-band/); assert.match(delta,/下限/);
  const value = visuals.chartMarkup({type:'value',lower:10,upper:null}, {points:points.map(p=>({...p,measurement:p.value}))});
  assert.equal((value.match(/class="chart-line"/g)||[]).length, 2); assert.equal((value.match(/data-point-time=/g)||[]).length, 5);
  assert.match(value,/tabindex="0"/); assert.match(value,/<title>/);
  assert.doesNotMatch(value,/NaN|Infinity/);
});
test('empty graphs and absent current measurements explain first-checkpoint waiting rather than drawing zero', () => {
  assert.equal(typeof visuals.axisMarkup, 'function');
  assert.match(visuals.axisMarkup({type:'delta',lower:-5,upper:5}, {measurement:null}), /等待/);
  assert.match(visuals.chartMarkup({type:'delta',lower:-5,upper:5},{points:[]}), /记录/);
  assert.equal((visuals.axisMarkup({type:'delta',lower:-5,upper:5},{measurement:null}).match(/range-dot/g)||[]).length, 0);
});
test('equal bounds share one chart caption and compressed axis bounds place labels separately', () => {
  assert.equal(typeof visuals.chartMarkup, 'function');
  const equal = visuals.chartMarkup({type:'value',lower:0,upper:0},{points:[{time:1000,sourceTime:1000,value:0,measurement:0,segment:'a'}]});
  assert.equal((equal.match(/class="bound-caption"/g)||[]).length,1);
  assert.match(equal,/上下限/);
  const narrow = visuals.axisMarkup({type:'value',lower:0,upper:1},{measurement:1e308});
  assert.match(narrow,/下限 0/); assert.match(narrow,/上限 1/);
});
test('clock correction segments use the whole real time domain and never draw points outside the plot',()=>{
  assert.equal(typeof visuals.chartMarkup,'function');
  const html=visuals.chartMarkup({type:'value',lower:0,upper:5},{points:[{time:10000000,sourceTime:10000000,value:1,measurement:1,segment:'a'},{time:6400000,sourceTime:6400000,value:2,measurement:2,segment:'b'},{time:6401000,sourceTime:6401000,value:3,measurement:3,segment:'b'}]});
  const xs=[...html.matchAll(/class="chart-point[^>]*?cx="([^"]+)"/g)].map(m=>Number(m[1]));
  assert.equal(xs.length,3);assert.ok(xs.every(x=>x>=68&&x<=555));
  assert.equal((html.match(/data-point-key=/g)||[]).length,3);
});

test('charts show the default latest 20 checkpoint records and discard expired outliers from the scale',()=>{
  const points=Array.from({length:150},(_,i)=>({time:1000+i*1000,sourceTime:1000,value:i,measurement:i<30?-1e6:1,segment:'a'}));
  const html=visuals.chartMarkup({type:'value',lower:0,upper:5},{points});
  assert.deepEqual([...html.matchAll(/data-point-time="(\d+)"/g)].map(m=>Number(m[1])),points.slice(-20).map(p=>p.time));
  assert.doesNotMatch(html,/-1,000,000|-1000000/);
  const invalid=points.map((p,i)=>({...p,measurement:i<30?1:null}));
  assert.match(visuals.chartMarkup({type:'delta',lower:0,upper:5},{points:invalid}),/chart-empty/,'limit checkpoint records before excluding baseline points');
});

test('wide charts use the available width with a fixed logical height and readable text',()=>{
  const points=[1,2,3].map((value,i)=>({time:1000+i*1000,sourceTime:1000,value,measurement:value,segment:'a'}));
  const html=visuals.chartMarkup({type:'value',lower:0,upper:5},{points},{width:1600,height:260});
  assert.match(html,/viewBox="0 0 1600 260"/);
  const xs=[...html.matchAll(/class="chart-point[^>]*?cx="([^"]+)"/g)].map(m=>Number(m[1]));
  assert.ok(xs.at(-1)>1500); assert.doesNotMatch(html,/NaN|Infinity/);
});

test('each selected chart window displays exactly the latest 10/20/50 records',()=>{
  const points=Array.from({length:60},(_,i)=>({time:i*1000,sourceTime:0,value:i,measurement:i,segment:'a'}));
  for(const chartPoints of [10,20,50]){
    const html=visuals.chartMarkup({type:'value',lower:0,upper:100,chartPoints},{points});
    assert.deepEqual([...html.matchAll(/data-point-time="(\d+)"/g)].map(m=>Number(m[1])),points.slice(-chartPoints).map(p=>p.time));
  }
});
test('axis scale uses only the latest five checkpoint measurements and evicts earlier outliers',()=>{
  const rule={type:'value',lower:0,upper:20};
  const track={measurement:15,points:[1e6,11,12,13,14,15].map(measurement=>({measurement}))};
  const html=visuals.axisMarkup(rule,track);
  const withoutOld=visuals.axisMarkup(rule,{...track,points:track.points.slice(-5)});
  assert.equal(html,withoutOld);
  const wide=visuals.axisMarkup(rule,{...track,points:[{measurement:1e6},...track.points.slice(-4)]});
  assert.notEqual(html,wide);
});

test('recent-five axes always include both configured limits in the visible scale',()=>{
  const html=visuals.axisMarkup({type:'value',lower:-1000,upper:1000},{measurement:12,points:[10,11,12,13,14].map(measurement=>({measurement}))});
  assert.equal((html.match(/class="range-bound"/g)||[]).length,2);
  assert.doesNotMatch(html,/←|→/);
});
test('integer coordinate ticks remain proportionate without rounding precise limits or measurements',()=>{
  const rule={type:'value',lower:-0.1256789,upper:5.9876543};
  const track={measurement:2.1234567,points:[{time:1000,sourceTime:1000,value:2.1234567,measurement:2.1234567,segment:'a'}]};
  const axis=visuals.axisMarkup(rule,track),chart=visuals.chartMarkup(rule,track);
  const labels=html=>[...html.matchAll(/class="(?:axis-tick|chart-tick)"[^>]*>([^<]+)<\/text>/g)].map(m=>m[1].replaceAll(',',''));
  assert.ok(labels(axis).length>=2&&labels(chart).length>=2);
  assert.ok([...labels(axis),...labels(chart)].every(text=>/^[-+]?\d+(?:e\d+)?$/.test(text)));
  assert.match(axis,/下限 -0\.1256789/);assert.match(axis,/上限 5\.9876543/);assert.match(axis,/检测 2\.1234567/);
  assert.match(chart,/上限 5\.9876543/);assert.match(chart,/实时数据 2\.1234567/);
  for(const [lower,upper,value] of [[.1,.2,.15],[1e-300,2e-300,1.5e-300],[-1e308,1e308,1e308]]){
    const r={type:'value',lower,upper},t={measurement:value,points:[{...track.points[0],value,measurement:value}]};
    for(const html of [visuals.axisMarkup(r,t),visuals.chartMarkup(r,t)]){assert.doesNotMatch(html,/NaN|Infinity/);assert.ok(labels(html).every(text=>!text.includes('.')));}
  }
});

test('English chart tooltips preserve exact readings and integer coordinate labels',async()=>{
  const i18n=await import('../core/i18n.js').catch(()=>({}));
  assert.equal(typeof i18n.setLanguage,'function');
  i18n.setLanguage('en');
  try{
    const rule={type:'value',lower:-0.1256789,upper:5.9876543};
    const track={measurement:2.1234567,points:[{time:1000,sourceTime:1000,value:2.1234567,measurement:2.1234567,segment:'a'}]};
    const axis=visuals.axisMarkup(rule,track),chart=visuals.chartMarkup(rule,track);
    assert.match(axis,/Lower bound -0\.1256789/);
    assert.match(chart,/Live data 2\.1234567/);
    assert.match(chart,/Recorded value 2\.1234567/);
    assert.doesNotMatch(chart,/[\u3400-\u9fff]/);
    const labels=[...chart.matchAll(/class="chart-tick"[^>]*>([^<]+)<\/text>/g)].map(m=>m[1].replaceAll(',',''));
    assert.ok(labels.length>1&&labels.every(label=>/^[-+]?\d+(?:e\d+)?$/.test(label)));
  }finally{i18n.setLanguage('zh-CN');}
});

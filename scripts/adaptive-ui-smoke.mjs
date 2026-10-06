import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AlertEngine } from '../core/alerts.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const deadline=Date.now()+8000;while(Date.now()<deadline){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runAdaptiveUISmoke({mainWindow,root}){
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  const originalSize=mainWindow.getContentSize();
  // Drain the real app's coalesced updates before publishing a synthetic chart fixture.
  await sleep(100);
  let now=Date.now();
  const engine=new AlertEngine({now:()=>now});engine.startRun();
  const source={id:'adaptive-source',name:'列表样例',kind:'fixed',fixedValue:10,valueMode:'fixed',totalMode:'none',interval:86400,enabled:true,status:'ok',unit:'GB',lastSuccess:now,sample:{value:10,total:null,unit:'GB'}};
  for(const [id,type] of [['adaptive-delta','delta'],['adaptive-value','value']])engine.upsert({id,type,name:type==='delta'?'流量变化':'当前流量',sourceId:source.id,lower:type==='delta'?-5:0,upper:type==='delta'?5:20,updateEvery:1,enabled:true});
  const base=(await run('window.monitor.snapshot()')).data;
  const publish=async()=>{
    await run(`window.__adaptiveState=${JSON.stringify({...base,sources:[source],alerts:engine.snapshot()})};import('./workspace.js').then(module=>module.renderWorkspace(window.__adaptiveState))`);
  };
  const addPoint=()=>{now+=1000;source.lastSuccess=now;source.sample.value=10+Math.sin(now/1000);engine.observe([source]);};
  try{
    for(let i=0;i<125;i++)addPoint();
    await publish();
    mainWindow.show();mainWindow.focus();
    const artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
    for(const width of [760,1260,2400]){
      mainWindow.setContentSize(width,1000);
      const buttons=[];
      for(const page of ['data','alarms','floating']){
        await run(`document.querySelector('[data-page=${page}]').click();window.scrollTo(0,0);true`);
        await sleep(100);
        buttons.push(await run(`(()=>{const n=document.querySelector('#${page}-page .overview-header>.button'),r=n.getBoundingClientRect(),h=document.querySelector('#${page}-page h1').getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,height:r.height,left:h.left};})()`));
        assert.equal(await run('document.documentElement.scrollWidth>innerWidth+1'),false,`${page} has no horizontal overflow at ${width}px`);
      }
      assert.deepEqual(buttons[0],buttons[1],`data and alarm header edges align at ${width}px`);
      assert.deepEqual(buttons[0],buttons[2],`floating header edges align at ${width}px`);
      assert.equal(buttons[0].height,44);
      assert.equal(await run('!!document.querySelector("#date-label")'),false);
      await run('document.querySelector("[data-page=alarms]").click();document.querySelectorAll(".alert-chart-detail").forEach(n=>n.open=true);true');
      await until(()=>run('document.querySelectorAll(".alert-chart").length===2'),'both alert charts open');
      await sleep(100);
      const geometry=await run('(()=>{const list=document.querySelector("#alert-list").getBoundingClientRect();return [...document.querySelectorAll(".alert-entry")].map(n=>{const r=n.getBoundingClientRect(),s=n.querySelector(".alert-chart"),c=s.getBoundingClientRect(),m=n.querySelector(".alert-entry-main").getBoundingClientRect();return {left:r.left,right:r.right,listLeft:list.left,listRight:list.right,height:c.height,viewWidth:s.viewBox.baseVal.width,chartWidth:c.width,rowHeight:m.height,pointCount:n.querySelectorAll("[data-point-time]").length,textHeight:s.querySelector("text").getBoundingClientRect().height};});})()');
      for(const row of geometry){
        assert.equal(row.left,row.listLeft);assert.equal(row.right,row.listRight);
        assert.equal(row.height,260);assert.ok(Math.abs(row.viewWidth-row.chartWidth)<=1);
        assert.ok(row.textHeight<18,`chart typography remains compact at ${width}px`);
        assert.ok(row.rowHeight<205,`alert row is compact at ${width}px: ${row.rowHeight}px`);
        assert.equal(row.pointCount,20);
      }
      await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await writeFile(join(artifacts,`adaptive-alerts-${width}.png`),(await mainWindow.webContents.capturePage()).toPNG());
    }
    await until(()=>run('document.hasFocus()'),'native chart focus');
    await run('document.querySelector("[data-rule-id=adaptive-value] [data-point-time]").focus();true');
    const expiredKey=await run('document.activeElement.dataset.pointKey');
    assert.equal(await run('document.querySelector("[data-rule-id=adaptive-value] .chart-tooltip").hidden'),false);
    for(let i=0;i<5;i++)addPoint();
    await publish();
    await until(()=>run('document.activeElement.dataset.alertAction==="chart"'),'expired keyboard point focuses chart control');
    assert.equal(await run('document.querySelector("[data-rule-id=adaptive-value] .chart-tooltip").hidden'),true,'expired point tooltip is cleared');
    assert.equal(await run(`!!document.querySelector('[data-point-key="${expiredKey}"]')`),false);
    assert.equal(await run('document.querySelectorAll(".alert-chart-detail[open]").length'),2);
    assert.equal(await run('document.querySelectorAll("[data-rule-id=adaptive-value] [data-point-time]").length'),20);
    const rendered=await run('[...document.querySelectorAll("[data-rule-id=adaptive-value] [data-point-time]")].map(n=>Number(n.dataset.pointTime))');
    assert.deepEqual(rendered,engine.snapshot().tracking.find(t=>t.ruleId==='adaptive-value').points.slice(-20).map(p=>p.time));
    for(const count of [10,20,50]){
      const rule=engine.snapshot().rules.find(r=>r.id==='adaptive-value');engine.upsert({...rule,chartPoints:count});await publish();
      assert.equal(await run('document.querySelector("[data-rule-id=adaptive-value] .chart-window").value'),String(count));
      assert.equal(await run('document.querySelectorAll("[data-rule-id=adaptive-value] [data-point-time]").length'),count);
    }
    console.log('PASS adaptive UI: header alignment, compact alert lists, fixed chart height/font at 760/1260/2400px, 10/20/50 checkpoint windows and expired focused tooltip cleanup');
  }finally{
    mainWindow.setContentSize(...originalSize);mainWindow.webContents.reload();
    await until(()=>run('!!document.querySelector("#cards") && !!window.monitor'),'renderer restored');
  }
}

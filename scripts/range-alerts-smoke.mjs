import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { AlertEngine } from '../core/alerts.js';
import { DEFAULT_FLOATING_SETTINGS } from '../core/floating-settings.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
  throw new Error(`Timeout: ${label}`);
}
export async function runRangeAlertsSmoke({ mainWindow, monitor, root, source }) {
  const run = async code => {
    try { return await mainWindow.webContents.executeJavaScript(`{${code}}`, true); }
    catch (error) { throw new Error(`Range smoke script: ${code.slice(0,150)}: ${error.message}`); }
  };
  const invoke = async (method, value) => { const result = await run(`window.monitor.${method}(${JSON.stringify(value)})`); assert.equal(result.ok,true,result.error); return result.data; };
  const state = () => invoke('snapshot');
  const ruleIds = [];
  const setValue=async fixedValue=>{await invoke('save',{...source,fixedValue});await until(()=>monitor.sources.get(source.id)?.status==='ok','source edit collects a fresh value');};
  try {
    assert.equal(await run('!!document.querySelector("#alert-settings") || !!document.querySelector("#notification-history") || !!document.querySelector("#session-history")'), false, 'simplified page has no historical/settings panels');
    await run('document.querySelector("#add-alert").click(); const f=document.querySelector("#alert-form"); f.elements.name.value="相邻变化"; f.elements.sourceId.value="workspace-value"; f.elements.type.value="delta"; f.elements.lower.value="6"; f.elements.upper.value="5"; f.elements.updateEvery.value="3";f.elements.updateEvery.dispatchEvent(new Event("input"));true');
    assert.match(await run('document.querySelector("#alert-interval-note").textContent'),/3分钟/);
    assert.equal(await run('[...document.querySelectorAll("#alert-form [data-test-only]")].every(n=>n.hidden&&n.getClientRects().length===0)'),true,'alert red-box notes hidden in normal mode');
    await run('document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await run('[...document.querySelectorAll("#alert-form [data-test-only]")].every(n=>!n.hidden&&n.getClientRects().length>0)'),true,'test mode restores alert red-box content');
    await run('document.querySelector("#test-mode-toggle").click();document.querySelector("#alert-form [name=updateEvery]").value="1";document.querySelector("#alert-save").click();true');
    await until(()=>run('document.querySelector("#alert-form-error").textContent.includes("下限")'),'invalid range explained');
    assert.equal((await state()).alerts.rules.length,0);
    await run('document.querySelector("#alert-form [name=lower]").value="-5"; document.querySelector("#alert-save").click(); true');
    await until(async()=>(await state()).alerts.rules.length===1,'delta rule saved');await monitor.refresh(source.id);
    await until(async()=>(await state()).alerts.tracking.length===1,'delta obtains baseline');
    const deltaId = (await state()).alerts.rules[0].id; ruleIds.push(deltaId);
    const delta = async()=>(await state()).alerts.tracking.find(t=>t.ruleId===deltaId);
    await monitor.refresh(source.id);
    await until(async()=>(await delta()).points.length>=2,'another actual update records unchanged value');
    assert.equal((await delta()).measurement,0);
    await setValue(16);
    await until(async()=>(await delta()).measurement===6,'first delta outside');
    const first = (await delta()).lastAlert.id;
    await setValue(22);
    await until(async()=>(await delta()).lastAlert?.id!==first && (await delta()).measurement===6,'consecutive outside checkpoint notifies again');
    assert.equal((await delta()).lastAlert.delivery,'test');
    await setValue(15);
    await until(async()=>(await delta()).measurement===-7,'negative delta draws below zero');
    await setValue(22);
    await until(async()=>(await delta()).measurement===7,'positive delta after decrease');
    await run('document.querySelector("#add-alert").click(); const f=document.querySelector("#alert-form"); f.elements.name.value="瞬时用量"; f.elements.sourceId.value="workspace-value"; f.elements.type.value="value"; f.elements.lower.value="12"; f.elements.upper.value="20"; f.elements.updateEvery.value="1"; document.querySelector("#alert-save").click(); true');
    await until(async()=>(await state()).alerts.rules.length===2,'value rule saved');await monitor.refresh(source.id);
    await until(async()=>(await state()).alerts.tracking.length===2,'value obtains first point');
    const valueId=(await state()).alerts.rules.find(r=>r.type==='value').id; ruleIds.push(valueId);
    const value=async()=>(await state()).alerts.tracking.find(t=>t.ruleId===valueId);
    assert.equal((await value()).measurement,22); const valueFirst=(await value()).lastAlert.id;
    await monitor.refresh(source.id);
    await until(async()=>(await value()).lastAlert.id!==valueFirst,'every value outside checkpoint repeats notification');
    await run('document.querySelectorAll(".alert-chart-detail").forEach(n=>n.open=true); true');
    await until(()=>run('!!document.querySelector(".chart-bar") && !!document.querySelector(".chart-line")'),'two chart types');
    const originalCollect=monitor.collect;let displayRequests=0;
    monitor.collect=async s=>{displayRequests++;return originalCollect(s);};
    try{
      const segment=(await delta()).segment;
      for(const count of [10,50,20]){
        await run(`const s=document.querySelector('[data-rule-id="${deltaId}"] .chart-window');s.value='${count}';s.dispatchEvent(new Event('change',{bubbles:true}));true`);
        await until(async()=>(await state()).alerts.rules.find(r=>r.id===deltaId).chartPoints===count,'chart range saved through renderer IPC');
        await until(()=>run(`!document.querySelector('[data-rule-id="${deltaId}"] .chart-window').disabled`),'chart selector ready for another change');
        assert.equal((await delta()).segment,segment,'display changes do not restart recording');
      }
      assert.equal(displayRequests,0,'selecting a chart window does not request source data');
    }finally{monitor.collect=originalCollect;}
    assert.equal(await run('document.querySelectorAll(".range-dot").length'),2);
    await run('document.querySelector("[data-alert-action=edit]").focus(); true');
    const count=(await delta()).points.length;
    await monitor.refresh(source.id);
    await until(async()=>(await delta()).points.length>count,'live point update');
    assert.equal(await run('document.activeElement.dataset.alertAction'),'edit');
    assert.equal(await run('document.querySelectorAll(".alert-chart-detail[open]").length'),2);
    // Native focus is required for actual SVG focus events, not only activeElement changes in a hidden window.
    mainWindow.show(); mainWindow.focus();
    await until(()=>run('document.hasFocus()'),'native window focus for keyboard chart interaction');
    await run('document.querySelector(".chart-bar[data-point-time]").focus(); true');
    const focusedPoint=await run('document.activeElement.dataset.pointTime');
    try { await until(()=>run('document.querySelector(".chart-tooltip:not([hidden])")?.textContent.includes("记录值")'),'keyboard focus shows exact point details'); }
    catch(error) { console.log('Chart keyboard diagnostic:',await run('({ active:document.activeElement.outerHTML.slice(0,300),tooltips:[...document.querySelectorAll(".chart-tooltip")].map(n=>({hidden:n.hidden,text:n.textContent})),open:document.querySelector(".alert-chart-detail").open })'));throw error; }
    const focusedCount=(await delta()).points.length;
    await monitor.refresh(source.id);
    await until(async()=>(await delta()).points.length>focusedCount,'point update while plot is focused');
    assert.equal(await run('document.activeElement.dataset.pointTime'),focusedPoint);
    await until(()=>run('document.querySelector("#toast").hidden'),'transient save feedback clears before page capture');
    const artifacts=join(root,'artifacts'); await mkdir(artifacts,{recursive:true});
    await run('window.scrollTo(0,0); Promise.allSettled(document.getAnimations().map(a=>a.finished)).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    await writeFile(join(artifacts,'range-alerts-expanded.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector(".alert-chart-detail").scrollIntoView({block:"start"}); true');
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,'range-alerts-delta-chart.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelectorAll(".alert-chart-detail")[1].scrollIntoView({block:"center"}); true');
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,'range-alerts-value-chart.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelectorAll(".alert-chart-detail").forEach(n=>n.open=false); true');
    await until(()=>run('[...document.querySelectorAll("[data-alert-action=chart]")].every(n=>n.getAttribute("aria-expanded")==="false")'),'collapsed chart controls update immediately');
    await run('window.scrollTo(0,0); true');
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,'range-alerts-axis.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector("[data-alert-action=toggle]").click(); true');
    await until(async()=>!(await state()).alerts.rules.find(r=>r.id===deltaId).enabled,'delta stopped');
    const frozen=(await delta()).points;
    await until(()=>run(`document.querySelector('[data-rule-id="${deltaId}"] [data-alert-action=toggle]').getAttribute('aria-label')==='开始告警'&&!document.querySelector('[data-rule-id="${deltaId}"] [data-alert-action=toggle]').disabled`),'stop finishes saving and renders the start action');
    assert.ok(await run(`document.querySelectorAll('[data-rule-id="${deltaId}"] [data-point-time]').length>0`),'stopping retains plotted points');
    await setValue(30);assert.deepEqual((await delta()).points,frozen,'stopped rule ignores source updates');
    await run('document.querySelector("[data-alert-action=toggle]").click(); true');
    await until(async()=>(await state()).alerts.rules.find(r=>r.id===deltaId).enabled,'start rule');
    assert.equal(await delta(),undefined,'start clears old chart before any new read');await monitor.refresh(source.id);
    await until(async()=>!!(await delta())?.points.length,'delta starts a new segment');
    assert.equal((await delta()).points.at(-1).measurement,null);
    await setValue(36);
    await until(async()=>(await delta()).measurement===6,'fresh baseline after resume');
    Object.assign(monitor.sources.get(source.id),{status:'network',failed:true,error:'smoke interrupted',nextRun:Date.now()+60000});monitor.notify();
    await until(async()=>(await state()).alerts.tracking.length===0,'collection failure clears both old segments');
    await invoke('save',{...source,fixedValue:36});await monitor.refresh(source.id);
    await until(async()=>!!(await delta())?.points.length,'collection recovery starts a new segment');
    assert.equal((await delta()).points[0].measurement,null);
    await run('document.querySelector("[data-alert-action=edit]").click(); const f=document.querySelector("#alert-form"); f.elements.updateEvery.value="2";f.elements.updateEvery.dispatchEvent(new Event("input"));true');
    assert.match(await run('document.querySelector("#alert-interval-note").textContent'),/2分钟/);
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,'alert-update-count-form.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await run('[...document.querySelectorAll("#alert-form [data-test-only]")].every(n=>!n.hidden&&n.getClientRects().length>0)'),true);
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,'alert-update-count-form-test-mode.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector("#test-mode-toggle").click();true');
    await run('document.querySelector("#alert-save").click();true');
    await until(async()=>(await state()).alerts.rules.find(r=>r.id===deltaId).updateEvery===2,'edit update count');
    await monitor.refresh(source.id);await monitor.refresh(source.id);
    await until(async()=>(await state()).alerts.tracking.length===2,'edited interval obtains its fresh baseline before checking saved records');
    await invoke('floatingSettings',DEFAULT_FLOATING_SETTINGS);
    const saved=JSON.parse(await readFile(join(app.getPath('userData'),'monitor-state.json'),'utf8')).alerts;
    assert.equal(saved.schemaVersion,3); assert.equal(saved.tracking.length,2); assert.equal('logs' in saved,false);
    const restored=new AlertEngine(); restored.startRun(saved); assert.equal(restored.snapshot().tracking.length,0,'restart begins a new continuous segment');
    console.log('PASS range alerts, hidden/test-mode notes, live frequency conversion, successful-update counts, inclusive recent-five axes, chart/focus stability, stop preserves/start clears and schema3 persistence');
  } finally { for(const id of ruleIds) await invoke('alertRemove',id); }
}

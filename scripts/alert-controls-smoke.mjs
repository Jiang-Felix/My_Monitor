import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runAlertControlsSmoke({mainWindow,monitor,root}){
  const run=code=>mainWindow.webContents.executeJavaScript(`{${code}}`,true);
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const source={id:'control-source',name:'检测量',kind:'fixed',fixedValue:10,interval:3600};
  const rules=[['control-active','value',true,true],['control-silent','delta',true,false],['control-stopped','value',false,true],['control-failed','value',true,true]];
  const state=()=>invoke('snapshot'),track=async id=>(await state()).alerts.tracking.find(t=>t.ruleId===id);
  const oldSize=mainWindow.getContentSize(),artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
  const capture=async name=>{await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await writeFile(join(artifacts,name),(await mainWindow.webContents.capturePage()).toPNG());};
  try{
    mainWindow.show();mainWindow.show();mainWindow.focus();
    await invoke('save',source);await monitor.refresh(source.id);
    await invoke('save',{...source,id:'control-blocked',enabled:false});
    for(const [id,type,enabled,notificationsEnabled] of rules)await invoke('alertSave',{id,name:id,sourceId:id==='control-failed'?'control-blocked':source.id,type,lower:-.1256789,upper:5.9876543,updateEvery:1,enabled,notificationsEnabled});
    await monitor.refresh(source.id);await invoke('save',{...source,fixedValue:22});await until(()=>monitor.sources.get(source.id)?.status==='ok','fresh outside checkpoint');
    await run('document.querySelector("[data-page=alarms]").click();true');
    await until(()=>run('JSON.stringify([...document.querySelectorAll("#alert-filters .filter-count")].map(n=>n.textContent))===JSON.stringify(["4","1","1","2"])'),'coalesced alert status reaches renderer');
    assert.equal(await run('!!document.querySelector("[data-alert-filter=all]")'),true,'alerts use category count filters');
    assert.deepEqual(await run('[...document.querySelectorAll("#alert-filters .filter-count")].map(n=>n.textContent)'),['4','1','1','2']);
    assert.equal((await track('control-silent')).lastAlert.delivery,'muted');
    assert.equal((await track('control-active')).lastAlert.delivery,'test');
    for(const [filter,count] of [['active',1],['silent',1],['paused',2],['all',4]]){
      await run(`document.querySelector('[data-alert-filter=${filter}]').click();true`);
      assert.equal(await run('document.querySelectorAll("#alert-list [data-rule-id]").length'),count);
    }
    const boxes=await run('const node=document.querySelector("[data-rule-id=control-active]");[...node.querySelectorAll(".alert-entry-actions button")].map(n=>({action:n.dataset.alertAction,...n.getBoundingClientRect().toJSON()}))');
    assert.deepEqual(boxes.map(b=>b.action),['edit','toggle','chart','notifications']);
    assert.ok(boxes.every(b=>b.width===32&&b.height===32));
    assert.equal(boxes[0].top,boxes[1].top);assert.equal(boxes[2].top,boxes[3].top);assert.equal(boxes[0].left,boxes[2].left);assert.equal(boxes[1].left,boxes[3].left);assert.ok(boxes[2].top>boxes[0].bottom);
    assert.equal(await run('!!document.querySelector("#alert-list [data-alert-action=remove]")'),false,'deletion moved out of the list');
    assert.ok(await run('document.querySelector("[data-rule-id=control-active] [data-alert-action=chart] .icon-line")&&document.querySelector("[data-rule-id=control-silent] [data-alert-action=chart] .icon-bars")'));
    const frozen=await track('control-active');
    await run('document.querySelector("[data-rule-id=control-active] [data-alert-action=notifications]").click();true');
    await until(async()=>(await state()).alerts.rules.find(r=>r.id==='control-active').notificationsEnabled===false,'notification icon saves mute');
    assert.deepEqual((await track('control-active')).points,frozen.points);
    assert.equal((await track('control-active')).segment,frozen.segment);
    await monitor.refresh(source.id);assert.equal((await track('control-active')).lastAlert.delivery,'muted');
    await run('document.querySelector("[data-rule-id=control-active] [data-alert-action=notifications]").click();true');
    await until(async()=>(await state()).alerts.rules.find(r=>r.id==='control-active').notificationsEnabled===true,'notification icon saves enabled');
    await monitor.refresh(source.id);assert.equal((await track('control-active')).lastAlert.delivery,'test');
    await run('document.querySelector("[data-rule-id=control-active] [data-alert-action=chart]").click();document.querySelector("[data-rule-id=control-silent] [data-alert-action=chart]").click();true');
    try{await until(()=>run('document.querySelectorAll(".alert-chart-detail[open]").length===2'),'chart buttons expand both graph types');}
    catch(error){console.log('Chart control diagnostic:',await run('({details:[...document.querySelectorAll(".alert-chart-detail")].map(n=>({id:n.id,open:n.open})),buttons:[...document.querySelectorAll("[data-alert-action=chart]")].map(n=>({expanded:n.getAttribute("aria-expanded"),disabled:n.disabled})),toast:document.querySelector("#toast").textContent})'));throw error;}
    assert.equal(await run('document.querySelector("[data-rule-id=control-active] [data-alert-action=chart]").getAttribute("aria-expanded")'),'true');
    assert.equal(await run('[...document.querySelectorAll(".axis-tick,.chart-tick")].every(n=>!n.textContent.includes("."))'),true);
    assert.match(await run('document.querySelector("[data-rule-id=control-active] .range-axis").textContent'),/5\.9876543/);
    await capture('alert-controls-wide.png');
    mainWindow.setContentSize(760,900);await capture('alert-controls-760.png');
    assert.ok(await run('document.documentElement.scrollWidth<=innerWidth+1'));
    mainWindow.setContentSize(...oldSize);
    const beforeStop=await track('control-active');
    assert.equal(await run('const node=document.querySelector("[data-rule-id=control-active]");node.querySelector("[data-alert-action=toggle]").click();const locked=[...node.querySelectorAll("[data-alert-action=edit],[data-alert-action=toggle],[data-alert-action=notifications],.chart-window")].every(n=>n.disabled);node.querySelector("[data-alert-action=notifications]").click();node.querySelector("[data-alert-action=edit]").click();const select=node.querySelector(".chart-window");select.value="50";select.dispatchEvent(new Event("change",{bubbles:true}));locked&&!document.querySelector("#alert-dialog").open'),true,'stop locks all other configuration controls during its pending save');
    await until(async()=>!(await state()).alerts.rules.find(r=>r.id==='control-active').enabled,'stop button works');
    const stoppedRule=(await state()).alerts.rules.find(r=>r.id==='control-active');
    assert.equal(stoppedRule.notificationsEnabled,true,'rapid mute cannot undo stop');assert.equal(stoppedRule.chartPoints,20,'rapid chart-window change cannot undo stop');
    assert.deepEqual((await track('control-active')).points,beforeStop.points,'rapid actions preserve stopped records');
    await until(()=>run('!document.querySelector("[data-rule-id=control-active] [data-alert-action=toggle]").disabled'),'stop releases configuration controls');
    await run('document.querySelector("[data-alert-filter=paused]").click();true');
    assert.equal(await run('document.querySelectorAll("#alert-list [data-rule-id]").length'),3);
    await run('document.querySelector("[data-rule-id=control-active] [data-alert-action=toggle]").click();true');
    await until(()=>run('!document.querySelector("[data-rule-id=control-active]")'),'starting leaves paused filter');
    assert.equal(await track('control-active'),undefined);
    await run('document.querySelector("[data-alert-filter=all]").click();document.querySelector("[data-rule-id=control-silent] [data-alert-action=edit]").click();true');
    assert.equal(await run('document.querySelector("#alert-delete").hidden'),false);
    assert.equal(await run('document.querySelector("#alert-form [name=notificationsEnabled]").checked'),false);
    await capture('alert-controls-editor.png');
    await run('document.querySelector("#alert-delete").click();true');
    await until(async()=>!(await state()).alerts.rules.some(r=>r.id==='control-silent')&&await run('!document.querySelector("#alert-dialog").open'),'editor deletes the rule and graph and closes after saving');
    assert.equal(await run('document.querySelector("#alert-dialog").open'),false);
    await run('document.querySelector("#add-alert").click();true');assert.equal(await run('document.querySelector("#alert-delete").hidden'),true);
    console.log('PASS alert controls: 2x2 icons, graph types, notification mute with continuous records, serialized rapid actions, all/active/silent/paused counts and filtering, integer axes, editor deletion and narrow layout');
  }finally{
    await run('document.querySelector("#alert-dialog").close();document.querySelector("[data-alert-filter=all]")?.click();document.querySelector("[data-page=data]").click();true');
    for(const id of [source.id,'control-blocked'])if(monitor.sources.has(id))await invoke('remove',id);
    mainWindow.setContentSize(...oldSize);
  }
}

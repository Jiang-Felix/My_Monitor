import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {app} from 'electron';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runDataControlsSmoke({mainWindow,monitor,getFloating,trayEvents,doubleClickTime,root}){
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const settleGesture=()=>sleep(doubleClickTime+180);
  const settings=(await invoke('snapshot')).appSettings;
  const originalView=await run('document.querySelector("#cards").dataset.view');
  if(process.argv.includes('--controls-read')){
    assert.equal(settings.traySingleClick,false);assert.equal(settings.trayDoubleClick,false);
    assert.equal(await run('document.querySelector("#tray-single-click").checked||document.querySelector("#tray-double-click").checked'),false);
    const open=!!getFloating();mainWindow.hide();trayEvents.emit('click');trayEvents.emit('double-click');await settleGesture();
    assert.equal(mainWindow.isVisible(),false);assert.equal(!!getFloating(),open);
    console.log('PASS disabled tray gestures restored and inert after a real restart');return;
  }
  assert.equal(settings.traySingleClick,true);assert.equal(settings.trayDoubleClick,true);
  if(process.argv.includes('--controls-write')){await invoke('appSettings',{traySingleClick:false,trayDoubleClick:false});console.log('PASS explicit tray gesture opt-outs saved for restart');return;}
  const source={id:'controls-source',name:'Controls / 监控按钮',kind:'fixed',fixedValue:42,totalMode:'fixed',fixedTotal:100,unit:'GB',interval:60};
  await invoke('save',source);await invoke('refresh',source.id);mainWindow.show();mainWindow.focus();
  await run('document.querySelector("[data-page=data]").click();true');
  try{
    for(const view of ['card','list']){
      await run(`document.querySelector('[data-view=${view}]').click();true`);
      assert.deepEqual(await run('[...document.querySelectorAll("[data-id=controls-source] .card-actions [data-action]")].map(n=>n.dataset.action)'),['edit','pause']);
      assert.equal(await run('!!document.querySelector(".card-menu,.refresh-card,[data-action=refresh]")'),false);
      assert.ok(await run('[...document.querySelectorAll("[data-id=controls-source] .card-actions button")].every(n=>n.title&&n.getAttribute("aria-label")&&n.getBoundingClientRect().width===32&&n.getBoundingClientRect().height===32)'));
      await run('document.querySelector("[data-id=controls-source] [data-action=edit]").click();true');
      assert.equal(await run('document.querySelector("#source-dialog").open'),true);
      assert.equal(await run('document.querySelector("#source-delete").hidden'),false);
      assert.equal(await run('document.querySelector("#source-login").hidden||document.querySelector("#source-open").hidden'),true);
      await run('document.querySelector("#cancel-dialog").click();true');
    }
    assert.equal(await run('document.querySelector("[data-id=controls-source] [data-action=pause]").textContent'),'■');
    assert.equal(await run('(()=>{const b=document.querySelector("[data-id=controls-source] [data-action=pause]");b.click();const disabled=document.querySelector("[data-id=controls-source] [data-action=pause]").disabled;document.querySelector("[data-id=controls-source] [data-action=edit]").click();return disabled&&!document.querySelector("#source-dialog").open;})()'),true);
    await until(async()=>monitor.sources.get(source.id).enabled===false&&await run('!document.querySelector("[data-id=controls-source] [data-action=pause]").disabled'),'pause saved');
    assert.equal(await run('document.querySelector("[data-id=controls-source] [data-action=pause]").textContent'),'▶');
    await run('document.querySelector("[data-id=controls-source] [data-action=edit]").click();document.querySelector("#source-form").elements.fixedValue.value="50";document.querySelector("#save-button").click();true');
    await until(()=>run('!document.querySelector("#source-dialog").open'),'paused source edited');assert.equal(monitor.sources.get(source.id).enabled,false);
    await run('document.querySelector("[data-id=controls-source] [data-action=pause]").click();true');
    await until(()=>monitor.sources.get(source.id).enabled&&monitor.sources.get(source.id).sample?.value===50,'resume collects updated source');
    await invoke('save',{id:'controls-web',name:'Web controls',kind:'web',url:'https://example.com/dashboard',selector:'#reading',interval:60,enabled:false});
    await run('document.querySelector("[data-id=controls-web] [data-action=edit]").click();true');
    assert.equal(await run('document.querySelector("#source-login").hidden||document.querySelector("#source-open").hidden'),false);
    await run('document.querySelector("#cancel-dialog").click();document.querySelector("#add-button").click();true');
    assert.equal(await run('document.querySelector("#source-actions").hidden'),true);await run('document.querySelector("#cancel-dialog").click();true');
    await invoke('alertSave',{id:'controls-alert',name:'Related alert',sourceId:source.id,type:'value',lower:0,upper:100,updateEvery:1,enabled:false});
    await run('document.querySelector("[data-id=controls-source] [data-action=edit]").click();document.querySelector("#source-delete").click();true');
    assert.ok(await run('document.querySelector("#delete-description").textContent.includes("1")'));
    await run('document.querySelector("#delete-cancel").click();true');assert.equal(await run('document.querySelector("#source-dialog").open'),true);
    await run('document.querySelector("#source-delete").click();document.querySelector("#delete-confirm").click();true');
    await until(()=>run('!document.querySelector("#source-dialog").open&&!document.querySelector("#delete-dialog").open'),'deletion closes both dialogs');
    assert.ok(!monitor.sources.has(source.id));assert.ok(!(await invoke('snapshot')).alerts.rules.some(r=>r.id==='controls-alert'));
    await run('document.querySelector("[data-id=controls-web] [data-action=edit]").click();document.querySelector("#source-delete").click();true');
    assert.equal(await run('document.querySelector("#delete-confirm").disabled'),false,'deleting once never locks the next confirmation');
    await run('document.querySelector("#delete-cancel").click();document.querySelector("#cancel-dialog").click();true');
    await invoke('floating',true);await until(()=>getFloating()&&!getFloating().isDestroyed(),'floating ready');
    const singleStarted=Date.now();trayEvents.emit('click');assert.ok(getFloating());
    await until(()=>!getFloating(),'fast single click closes floating');
    assert.ok(Date.now()-singleStarted<500,'single click no longer waits 540 ms');
    trayEvents.emit('click');await settleGesture();assert.ok(getFloating());
    mainWindow.hide();trayEvents.emit('click');trayEvents.emit('double-click');trayEvents.emit('click');await settleGesture();
    assert.ok(mainWindow.isVisible());assert.ok(getFloating(),'double click never toggles floating');
    if(doubleClickTime>350){
      mainWindow.hide();const start=Date.now();trayEvents.emit('click');
      await until(()=>!getFloating(),'single action before slower double click');
      await sleep(Math.max(0,Math.min(450,doubleClickTime-20)-(Date.now()-start)));
      trayEvents.emit('click');trayEvents.emit('double-click');trayEvents.emit('click');
      await settleGesture();assert.ok(mainWindow.isVisible());assert.ok(getFloating(),'slower double click restores the previously open floating window');
    }
    await run('document.querySelector("[data-page=settings]").click();true');
    for(const id of ['tray-single-click','tray-double-click']){
      assert.equal(await run(`document.querySelector('#${id}').checked`),true);await run(`document.querySelector('#${id}').click();true`);
      await until(()=>run(`!document.querySelector('#${id}').checked&&!document.querySelector('#${id}').disabled`),'gesture preference saved');
    }
    const saved=JSON.parse(await readFile(join(app.getPath('userData'),'monitor-state.json'),'utf8')).appSettings;
    assert.equal(saved.traySingleClick,false);assert.equal(saved.trayDoubleClick,false);assert.equal(saved.floatingOnStartup,true);
    mainWindow.hide();trayEvents.emit('click');trayEvents.emit('double-click');await settleGesture();assert.equal(mainWindow.isVisible(),false);assert.ok(getFloating());mainWindow.show();mainWindow.focus();
    await invoke('language','en');await until(()=>run('document.documentElement.lang==="en"'),'new settings translate');
    assert.ok(await run('document.querySelector("#tray-single-click").closest("label").textContent.includes("Single")'));
    const artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
    mainWindow.setSize(1260,1050);await run('window.scrollTo(0,document.body.scrollHeight);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await sleep(180);
    await writeFile(join(artifacts,'tray-gesture-settings.png'),(await mainWindow.webContents.capturePage()).toPNG());
    console.log('PASS direct edit, editor-only delete/login/open, serialized pause/resume icons and cascading deletion; tray single/double arbitration, default-on switches, bilingual saved opt-outs and native window actions');
  }finally{
    for(const id of [source.id,'controls-web'])if(monitor.sources.has(id))await invoke('remove',id);
    await invoke('language','zh-CN');await invoke('appSettings',{traySingleClick:true,trayDoubleClick:true});await invoke('floating',false);
    await run(`document.querySelector("#source-dialog").close();document.querySelector("[data-page=data]").click();document.querySelector('[data-view=${originalView}]').click();true`);mainWindow.setSize(1260,820);
  }
}

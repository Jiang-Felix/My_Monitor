import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {app} from 'electron';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw Error(`Timeout: ${label}`);}
export async function runLowUsageSmoke({mainWindow,web,store,root}) {
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${input===undefined?'':JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  await until(()=>run('!!document.querySelector("#low-usage-mode")&&!!document.querySelector("#web-limits-form input")'),'resource controls');
  const reading=process.argv.includes('--low-usage-read');
  assert.equal((await invoke('snapshot')).appSettings.lowUsageMode,reading);
  assert.equal(web.lowUsageMode,reading);
  assert.equal(await run('document.querySelector("#web-limits-form").hidden'),true);
  await run('document.querySelector("[data-page=settings]").click();true');
  if(reading){
    assert.equal(web.requestLimit,300);assert.equal(web.maxRendererMemoryKiB,512*1024);
    await run('document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await run('document.querySelector("#web-limits-form input[name=requestLimit]").value'),'300');
    console.log('PASS low usage mode and thresholds restored after a real restart');return;
  }
  assert.equal(web.queue.concurrency,6);
  assert.equal(await run('document.querySelector("#low-usage-mode").checked'),false);
  await run('document.querySelector("#test-mode-toggle").click();true');
  assert.equal(await run('document.querySelector("#web-limits-form").hidden'),false);
  await run('document.querySelector("#low-usage-mode").click();true');
  await until(()=>run('document.querySelector("#low-usage-mode").checked&&!document.querySelector("#low-usage-mode").disabled'),'mode save');
  assert.equal(web.lowUsageMode,true);assert.equal(web.queue.concurrency,2);
  await run('(()=>{const form=document.querySelector("#web-limits-form");for(const [key,value] of Object.entries({requestLimit:300,rendererMemoryMiB:512,cooldownSeconds:0})){form.elements[key].value=value;form.elements[key].dispatchEvent(new Event("input",{bubbles:true}));}form.requestSubmit();})()');
  await until(async()=>web.requestLimit===300&&await run('!document.querySelector("#web-limits-save").disabled'),'threshold committed and UI ready');
  assert.equal(web.requestLimit,300);assert.equal(web.maxRendererMemoryKiB,512*1024);assert.equal(web.resourceCooldownMs,0);
  const saved=JSON.parse(await readFile(join(app.getPath('userData'),'monitor-state.json'),'utf8'));
  assert.equal(saved.appSettings.lowUsageMode,true);assert.equal(saved.appSettings.webLimits.requestLimit,300);
  const actualSave=store.save;store.save=()=>Promise.reject(Error('isolated disk failure'));
  try{const result=await run('window.monitor.appSettings({lowUsageMode:false})');assert.equal(result.ok,false);assert.equal(web.lowUsageMode,true);}finally{store.save=actualSave;}
  for(const webLimits of [{requestLimit:0},{rendererMemoryMiB:Infinity},{unknown:1}])assert.equal((await run(`window.monitor.appSettings(${JSON.stringify({webLimits})})`)).ok,false);
  await invoke('appSettings',{lowUsageMode:false});assert.equal(web.lowUsageMode,false);
  assert.equal(web.queue.concurrency,6);assert.equal((await invoke('snapshot')).appSettings.webLimits.requestLimit,300);
  await run('document.querySelector("#test-mode-toggle").click();true');assert.equal(await run('document.querySelector("#web-limits-form").hidden'),true);
  await invoke('language','en');await run('document.querySelector("#test-mode-toggle").click();true');
  assert.equal(await run('/[\\u4e00-\\u9fff]/.test(document.querySelector("#web-limits-form").textContent)'),false);
  mainWindow.show();const artifacts=join(root,'artifacts','low-usage');await mkdir(artifacts,{recursive:true});
  for(const width of [1260,760]){
    mainWindow.setSize(width,900);await run('document.querySelector("#web-limits-form").scrollIntoView();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.equal(await run('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true,'thresholds fit narrow and wide windows');
    await writeFile(join(artifacts,`settings-${width}.png`),(await mainWindow.webContents.capturePage()).toPNG());
  }
  await invoke('language','zh-CN');await invoke('appSettings',{lowUsageMode:true});
  console.log('PASS opt-in resource mode, live thresholds, failed-save rollback, bilingual test-only controls and disk persistence');
}

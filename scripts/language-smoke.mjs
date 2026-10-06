import assert from 'node:assert/strict';
import http from 'node:http';
import {app} from 'electron';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runLanguageSmoke({mainWindow,monitor,web,getFloating,root}) {
  const run=code=>mainWindow.webContents.executeJavaScript(`{${code}}`,true);
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${input===undefined?'':JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const toggle=async expected=>{await run('document.querySelector("#language-toggle").click();true');await until(()=>run(`document.documentElement.lang===${JSON.stringify(expected)}&&!document.querySelector('#language-toggle').disabled`),'language toggle completes');};
  const icons=async()=>assert.deepEqual(await run('[...document.querySelectorAll("button.icon-button,button.icon-control,summary.icon-control")].filter(n=>n.getBoundingClientRect().width).filter(n=>!n.title.trim()||!n.getAttribute("aria-label")?.trim()).map(n=>n.id||n.dataset.alertAction||n.className)'),[],'every visible icon control has a localized title and accessible name');
  if(process.argv.includes('--language-write')) {
    assert.equal(await run('document.querySelector("#language-toggle").textContent'),'English');await toggle('en');
    console.log('PASS language persisted for restart');return;
  }
  if(process.argv.includes('--language-read')) {
    await until(()=>run('document.documentElement.lang==="en"'),'persisted English restored');
    assert.equal(await run('document.querySelector("#language-toggle").textContent'),'中文');assert.equal(await run('document.body.classList.contains("test-mode")'),false);
    assert.equal((await invoke('snapshot')).language,'en');console.log('PASS English restored after restart while test mode remains off');return;
  }
  const server=http.createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<html><body><script>const shadow=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){const root=shadow.call(this,options);if(this.id==="__my_monitor_picker__")window.pickerRoot=root;return root;};</script><p id="value">42 GB</p></body></html>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const source={id:'locale-source',kind:'fixed',name:'自定义监控',unit:'GB',fixedValue:36.5,fixedTotal:100,totalMode:'fixed',interval:60};
  const rule={id:'locale-rule',sourceId:source.id,name:'自定义告警',type:'value',lower:0,upper:50,updateEvery:1,chartPoints:10};
  try {
    assert.equal(await run('document.querySelector("#language-toggle").textContent'),'English');
    assert.equal(await run('document.querySelector("#language-toggle").compareDocumentPosition(document.querySelector("#test-mode-toggle"))&Node.DOCUMENT_POSITION_FOLLOWING'),4);
    await invoke('save',source);await monitor.refresh(source.id);await invoke('alertSave',rule);await monitor.refresh(source.id);
    await toggle('en');assert.equal(await run('document.querySelector("#heading").textContent'),'Live data');
    mainWindow.setSize(760,820);
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.equal(await run('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true,'English filters fit the minimum window width');
    mainWindow.setSize(1260,820);
    assert.equal(await run('document.querySelector(".metric-card h2").textContent'),source.name,'user name is not translated');await icons();
    assert.equal(JSON.parse(await readFile(join(app.getPath('userData'),'monitor-state.json'),'utf8')).language,'en');
    assert.equal((await run('window.monitor.language("fr")')).ok,false,'unsupported locale is rejected');
    await run('document.querySelector("#add-button").click();document.querySelector("#source-form").elements.name.value="Unsaved source";true');
    assert.equal(await run('document.querySelector("#pick-value").textContent'),'Select live data');await icons();
    await toggle('zh-CN');assert.equal(await run('document.querySelector("#source-form").elements.name.value'),'Unsaved source');
    assert.equal(await run('document.querySelector("#pick-value").textContent'),'选取实时数据');
    await toggle('en');await run('document.querySelector("#close-dialog").click();document.querySelector("[data-page=alarms]").click();document.querySelector("[data-alert-action=chart]").click();true');
    await until(()=>run('document.querySelector(".alert-chart-detail").open'),'expanded chart');
    const count=await run('document.querySelectorAll(".chart-holder [data-point-key]").length');
    await run('document.querySelector("[data-alert-action=edit]").click();const f=document.querySelector("#alert-form");f.elements.name.value="Unsaved alert";f.elements.lower.value="-2.5";true');
    await toggle('zh-CN');assert.equal(await run('document.querySelector("#alert-form").elements.lower.value'),'-2.5');
    await toggle('en');assert.equal(await run('document.querySelector("#alert-form").elements.name.value'),'Unsaved alert');
    await run('document.querySelector("#alert-close").click();true');assert.equal(await run('document.querySelector(".alert-chart-detail").open'),true);
    assert.equal(await run('document.querySelectorAll(".chart-holder [data-point-key]").length'),count);await icons();
    await run('document.querySelector("[data-page=floating]").click();const f=document.querySelector("#floating-settings");f.elements.barWidth.value="310";f.elements.showDeltaValue.checked=true;f.dispatchEvent(new Event("input",{bubbles:true}));true');
    await toggle('zh-CN');await toggle('en');assert.equal(await run('document.querySelector("#floating-settings").elements.barWidth.value'),'310','dirty floating settings survive language changes');
    await invoke('floating',true);await until(()=>getFloating()&&!getFloating().isDestroyed(),'native floating window');
    await until(()=>getFloating().webContents.executeJavaScript('document.documentElement.lang==="en"'),'floating language synchronized');
    const normalStyle=await run('getComputedStyle(document.querySelector(".sidebar")).borderRightColor');
    await run('document.querySelector("#test-mode-toggle").click();true');assert.equal(await run('document.body.classList.contains("test-mode")'),true);
    assert.notEqual(await run('getComputedStyle(document.querySelector(".sidebar")).borderRightColor'),normalStyle);assert.equal(await run('document.querySelector("#mode-indicator").textContent'),'Test mode');
    await toggle('zh-CN');assert.equal(await run('document.body.classList.contains("test-mode")'),true);await toggle('en');
    await run('document.querySelector("#add-button").click();true');assert.equal(await run('document.querySelector("[data-kind=http]").hidden'),false);
    const untranslated=await run('const walker=document.createTreeWalker(document.querySelector("#source-dialog"),NodeFilter.SHOW_TEXT),texts=[];let n;while(n=walker.nextNode()){if(n.parentElement.getBoundingClientRect().width&&/[\\u4e00-\\u9fff]/.test(n.data))texts.push(n.data.trim());}texts');assert.deepEqual(untranslated,[],'all normal and test source copy is English');
    await run('document.querySelector("#close-dialog").click();document.querySelector("#test-mode-toggle").click();true');
    await run(`window.localePick=null;window.monitor.pick({id:'locale-picker',url:'http://127.0.0.1:${server.address().port}'}).then(result=>window.localePick=result);true`);
    await until(()=>web.windows.get('locale-picker')?.webContents.executeJavaScript('!!window.pickerRoot'),'English picker panel');
    const remote=web.windows.get('locale-picker');assert.equal(await remote.webContents.executeJavaScript('window.pickerRoot.querySelector("#cancel").textContent'),'Cancel');
    await toggle('zh-CN');await until(()=>remote.webContents.executeJavaScript('window.pickerRoot.querySelector("#cancel").textContent==="取消"'),'open picker updates its language');
    await toggle('en');await remote.webContents.executeJavaScript('window.pickerRoot.querySelector("#cancel").click();true');await until(()=>remote.isDestroyed(),'English picker cancel closes');
    const artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
    await run('document.querySelector("[data-page=alarms]").click();window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await sleep(180);await writeFile(join(artifacts,'language-en-alerts.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector("#test-mode-toggle").click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await writeFile(join(artifacts,'language-en-test.png'),(await mainWindow.webContents.capturePage()).toPNG());
    console.log('PASS languages: bilingual copy, persistent toggle, icon titles, intact dirty source/alert/floating forms and charts, synchronized native floating/picker, test-mode visual distinction');
  } finally {
    await web.clear('locale-picker');await invoke('floating',false);
    await run('for(const dialog of document.querySelectorAll("dialog[open]"))dialog.close();if(document.body.classList.contains("test-mode"))document.querySelector("#test-mode-toggle").click();true');
    await invoke('language','zh-CN');await invoke('remove',source.id);await run('document.querySelector("#floating-reset").click();document.querySelector("[data-page=data]").click();true');
    await until(()=>run('!document.querySelector("#floating-reset").disabled'),'reset floating preferences');await new Promise(r=>server.close(r));
  }
}

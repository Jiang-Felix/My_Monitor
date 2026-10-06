import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import {join} from 'node:path';
import {app,nativeImage} from 'electron';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runSettingsSmoke({mainWindow,getFloating,root}) {
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${input===undefined?'':JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  await until(()=>run('!!document.querySelector("#floating-on-startup")'),'settings initialized');
  if(process.argv.includes('--settings-read')){
    assert.equal((await invoke('snapshot')).appSettings.floatingOnStartup,false);
    assert.equal(!!getFloating(),false,'disabled startup preference prevents floating window after a real restart');
    assert.equal(await run('document.querySelector("#floating-on-startup").checked'),false);
    console.log('PASS startup floating preference restored after restart');return;
  }
  await until(()=>getFloating()&&!getFloating().isDestroyed(),'default startup opens native floating window');
  await until(()=>run('document.querySelector("#brand-icon").src.endsWith("mini-c.png")'),'colored logo with floating window');
  assert.equal((await invoke('snapshot')).launchAtLogin,false,'startup defaults off');
  if(process.argv.includes('--settings-write')){await invoke('appSettings',{floatingOnStartup:false});console.log('PASS startup preference saved for restart');return;}
  for(const name of ['ICON','mini-c','mini-w'])assert.equal(nativeImage.createFromPath(join(root,'ui','assets',`${name}.ico`)).isEmpty(),false,`${name} Windows icon loads`);
  await invoke('floating',false);
  await until(()=>run('document.querySelector("#brand-icon").src.endsWith("mini-w.png")'),'white logo with floating window closed');
  assert.equal((await invoke('snapshot')).appSettings.floatingOnStartup,true,'manual closing does not change startup preference');
  await run('document.querySelector("[data-page=settings]").click();true');
  assert.equal(await run('document.querySelector("#settings-page").hidden'),false);
  assert.equal(await run('!!document.querySelector(".sidebar #language-toggle,.sidebar #test-mode-toggle")'),false,'preference controls moved out of sidebar');
  assert.equal(await run('document.querySelector("#repository-link").href'),'https://github.com/Jiang-Felix/My_Monitor');
  await until(()=>run('[...document.querySelectorAll("#settings-page img")].every(n=>n.complete&&n.naturalWidth>0)'),'profile and developer logos load');
  for(const input of [{floatingOnStartup:'false'},null,{launchAtLogin:true}])assert.equal((await run(`window.monitor.appSettings(${JSON.stringify(input)})`)).ok,false);
  assert.equal((await run('window.monitor.launchAtLogin("true")')).ok,false);
  await run('document.querySelector("#floating-on-startup").click();true');
  await until(()=>run('!document.querySelector("#floating-on-startup").checked&&!document.querySelector("#floating-on-startup").disabled'),'startup checkbox saves');
  assert.equal(JSON.parse(await readFile(join(app.getPath('userData'),'monitor-state.json'),'utf8')).appSettings.floatingOnStartup,false);
  await run('document.querySelector("#launch-at-login").click();true');
  await until(()=>run('document.querySelector("#launch-at-login").checked&&!document.querySelector("#launch-at-login").disabled'),'isolated startup registration enabled');
  await run('document.querySelector("#launch-at-login").click();true');
  await until(()=>run('!document.querySelector("#launch-at-login").checked&&!document.querySelector("#launch-at-login").disabled'),'isolated startup registration removed');
  mainWindow.show();mainWindow.focus();
  const artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
  for(const width of [1260,760]){
    mainWindow.setSize(width,900);await sleep(180);
    assert.equal(await run('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true,'settings fit window');
    const lefts=[];
    for(const page of ['data','alarms','floating','settings']){await run(`document.querySelector('[data-page=${page}]').click();true`);lefts.push(await run(`document.querySelector('#${page}-page h1').getBoundingClientRect().left`));}
    assert.ok(lefts.every(left=>left===lefts[0]),'all four header left edges align');
    await run('window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,`settings-${width}.png`),(await mainWindow.webContents.capturePage()).toPNG());
  }
  mainWindow.setSize(1260,900);
  assert.equal(await run('document.querySelector(".version").getBoundingClientRect().bottom>innerHeight-50'),true,'sidebar version stays near bottom');
  await run('document.querySelector("#language-toggle").click();true');await until(()=>run('document.documentElement.lang==="en"'),'English settings');
  const untranslated=await run('(()=>{const texts=[];const walker=document.createTreeWalker(document.querySelector("#settings-page"),NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode())if(node.parentElement.getBoundingClientRect().width&&/[\\u4e00-\\u9fff]/.test(node.data)&&!node.parentElement.closest("[data-i18n-dynamic],[data-i18n-ignore]"))texts.push(node.data);return texts;})()');
  assert.deepEqual(untranslated,[],'English settings copy is complete');
  await writeFile(join(artifacts,'settings-en.png'),(await mainWindow.webContents.capturePage()).toPNG());
  await run('document.querySelector("#test-mode-toggle").click();true');assert.equal(await run('document.body.classList.contains("test-mode")'),true);await sleep(180);
  await writeFile(join(artifacts,'settings-test.png'),(await mainWindow.webContents.capturePage()).toPNG());
  await run('document.querySelector("#test-mode-toggle").click();true');
  await invoke('language','zh-CN');await invoke('appSettings',{floatingOnStartup:true});await invoke('floating',true);
  await until(()=>run('document.querySelector("#brand-icon").src.endsWith("mini-c.png")'),'opening floating window restores colored icon');
  await invoke('floating',false);await run('document.querySelector("[data-page=data]").click();true');mainWindow.setSize(1260,820);
  console.log('PASS settings: four aligned pages, artwork and status icons, bilingual controls, startup toggles and validation; Windows login registration isolated');
}

import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DEFAULT_FLOATING_SETTINGS} from '../core/floating-settings.js';
import {runFloatingCompositorSmoke} from './floating-compositor-smoke.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await sleep(60);}throw new Error(`Timeout: ${label}`);}
export async function runFloatingDisplaySmoke({mainWindow,monitor,getFloating,root}){
  const run=code=>mainWindow.webContents.executeJavaScript(`{${code}}`,true).catch(error=>{console.error('Floating display script failed:',code);throw error;});
  const invoke=async(name,data)=>{const result=await run(`window.monitor.${name}(${JSON.stringify(data)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const native=code=>getFloating().webContents.executeJavaScript(`{${code}}`,true);
  if(process.argv.includes('--floating-display-write')){
    await invoke('floatingSettings',{...DEFAULT_FLOATING_SETTINGS,showName:false,showPercent:false,showDeltaBand:false,showUnit:false,showSmooth:false,showAmount:true,showDeltaValue:true,showZeroDelta:true,textAlign:'right',barHeight:4,barWidth:410});
    console.log('PASS floating alignment, zero preference and normalized text height saved for restart');return;
  }
  if(process.argv.includes('--floating-display-read')){
    const state=(await run('window.monitor.snapshot()')).data;
    assert.equal(state.floatingSettings.showZeroDelta,true);assert.equal(state.floatingSettings.textAlign,'right');assert.equal(state.floatingSettings.barHeight,16);assert.equal(state.floatingSettings.barWidth,410);
    for(const key of ['showName','showPercent','showDeltaBand','showUnit','showSmooth'])assert.equal(state.floatingSettings[key],false,'saved off choices survive new default-on settings');
    await run('document.querySelector("[data-page=floating]").click();true');
    assert.equal(await run('document.querySelector("[name=showZeroDelta]").checked'),true);
    assert.equal(await run('document.querySelector("#floating-text-options [data-choice-value=right]").getAttribute("aria-pressed")'),'true');
    assert.equal(await run('document.querySelector("[name=barHeight]").min'),'16');
    console.log('PASS floating preferences and slider limits restored in a new process');return;
  }
  try{
    await run('document.querySelector("[data-page=floating]").click(); true');
    assert.equal(await run('document.querySelectorAll("#floating-settings input[type=checkbox]:not(.setting-switch)").length'),0);
    assert.equal(await run('document.querySelector("[name=showZeroDelta]").disabled'),false);
    assert.deepEqual(await run('Object.fromEntries([...document.querySelectorAll("#floating-settings input[type=checkbox]")].map(n=>[n.name,n.checked]))'),Object.fromEntries(Object.entries(DEFAULT_FLOATING_SETTINGS).filter(([key])=>key.startsWith('show'))));
    assert.equal(await run('document.querySelector("[name=barWidth]").value'),'300');
    assert.equal(await run('document.querySelector("[name=textAlign]").value'),'distributed');
    assert.deepEqual(await run('["barHeight","barWidth"].map(k=>document.querySelector("#floating-settings").elements[k].type)'),['range','range']);
    await run('const f=document.querySelector("#floating-settings");f.elements.showAmount.checked=false;f.elements.showDeltaValue.checked=false;f.dispatchEvent(new Event("input"));f.elements.barHeight.value="4";f.dispatchEvent(new Event("input"));true');
    assert.equal(await run('getComputedStyle(document.querySelector("#floating-preview .floating-track")).height'),'4px');
    await run('document.querySelector("[name=showAmount]").click();true');
    assert.equal(await run('document.querySelector("[name=barHeight]").value'),'16');
    await run('document.querySelector("[name=showDeltaValue]").click();true');
    assert.equal(await run('document.querySelector("[name=showZeroDelta]").disabled'),false);
    assert.equal(await run('document.querySelector("#floating-preview .floating-amount").textContent'),'36.5/100GB');
    await run('document.querySelector("[name=showZeroDelta]").click();true');
    assert.equal(await run('document.querySelector("#floating-preview .floating-amount").textContent'),'36.5/100GB  +0/1分钟');
    for(const [value,justify] of [['left','flex-start'],['center','center'],['right','flex-end'],['distributed','space-between']]){
      await run(`document.querySelector('#floating-text-options [data-choice-value=${value}]').click();true`);
      assert.equal(await run('getComputedStyle(document.querySelector("#floating-preview .floating-amount")).justifyContent'),justify);
    }
    const placement=await run('const p=document.querySelector(".floating-preview-area").getBoundingClientRect(),b=document.querySelector(".settings-actions").getBoundingClientRect(),v=document.querySelector("#floating-preview").getBoundingClientRect();({below:b.top>=v.bottom,bottom:p.bottom-b.bottom})');
    assert.equal(placement.below,true);assert.ok(placement.bottom>=20 && placement.bottom<=24);
    assert.equal(await run('getComputedStyle(document.querySelector("[name=showZeroDelta]")).appearance'),'none');
    monitor.upsert({id:'display-zero',name:'测试',kind:'fixed',fixedValue:50,fixedTotal:100,totalMode:'fixed',interval:60});
    await monitor.refresh('display-zero');await monitor.refresh('display-zero');
    await invoke('floatingSettings',{...DEFAULT_FLOATING_SETTINGS,barHeight:4,showAmount:true,showDeltaValue:true});
    await invoke('floating',true);
    await until(()=>getFloating()?.isVisible(),'native glass window');
    await until(()=>native('document.querySelector(".floating-amount")?.textContent==="50/100"'),'zero hidden in native window');
    assert.equal(await native('getComputedStyle(document.querySelector(".floating-track")).height'),'16px');
    assert.equal(await native('getComputedStyle(document.querySelector(".floating-track")).backgroundColor'),'rgba(20, 21, 23, 0.48)');
    assert.equal(await native('getComputedStyle(document.querySelector(".floating-panel")).backdropFilter'),'none');
    assert.match(await run('getComputedStyle(document.querySelector("#floating-preview")).backdropFilter'),/blur\(24px\)/);
    assert.equal((await getFloating().webContents.capturePage()).toBitmap()[3],0,'transparent corners stay transparent');
    const styles=(await run('window.monitor.snapshot()')).data.floatingSettings;
    await runFloatingCompositorSmoke({getFloating,settings:styles,setSettings:settings=>invoke('floatingSettings',settings),root});
    await invoke('floatingSettings',{...styles,showZeroDelta:true,textAlign:'right'});
    await until(()=>native('document.querySelector(".floating-amount").textContent==="50/100  +0/1分钟"'),'zero enabled in native window');
    assert.equal(await native('getComputedStyle(document.querySelector(".floating-amount")).justifyContent'),'flex-end');
    await run('document.querySelector("#language-toggle").click();true');
    await until(()=>run('document.documentElement.lang==="en"'),'English');
    assert.equal(await run('document.querySelector("[name=showZeroDelta]").nextElementSibling.firstChild.textContent'),'Show zero change');
    assert.equal(await run('document.querySelector("#floating-text-options [data-choice-value=distributed]").textContent'),'Distributed');
    await run('document.querySelector("#language-toggle").click();true');
    await until(()=>run('document.documentElement.lang==="zh-CN"'),'Chinese restored');
    await invoke('floatingSettings',{...DEFAULT_FLOATING_SETTINGS,barWidth:410,showName:false,showAmount:false,showUnit:false,showTotal:false,showPercent:false,showDeltaBand:false,showDeltaValue:false,showSmooth:false,showZeroDelta:true});
    await run('document.querySelector("#floating-reset").click();true');
    await until(async()=>(await run('window.monitor.snapshot()')).data.floatingSettings.barWidth===300,'reset');
    await until(()=>run('document.querySelector("[name=barHeight]").value==="20"'),'reset form');
    assert.deepEqual((await run('window.monitor.snapshot()')).data.floatingSettings,DEFAULT_FLOATING_SETTINGS);
    assert.ok(await run('[...document.querySelectorAll("#floating-settings input[type=checkbox]")].every(n=>n.checked===(n.name!=="showZeroDelta"))'));
    assert.equal(await run('document.querySelector("[name=textAlign]").value'),'distributed');
    assert.equal(await run('document.querySelector("[name=barHeight]").value'),'20');
    await run('const f=document.querySelector("#floating-settings"); for(const key of ["showAmount","showDeltaValue","showUnit","showPercent","showDeltaBand"])f.elements[key].checked=true;f.dispatchEvent(new Event("input"));true');
    await run('document.querySelector("[data-page=floating]").click();window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await mkdir(join(root,'artifacts'),{recursive:true});
    await writeFile(join(root,'artifacts/floating-display-settings.png'),(await mainWindow.webContents.capturePage()).toPNG());
    console.log('PASS floating translucent styling, zero-change toggle, four text alignments, thin-bar limits, switches, preview actions, native rendering and bilingual reset');
  }finally{
    await invoke('floating',false);await invoke('floatingSettings',DEFAULT_FLOATING_SETTINGS);monitor.remove('display-zero');
    await run('document.querySelector("[data-page=data]").click();true');
  }
}

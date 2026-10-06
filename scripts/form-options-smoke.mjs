import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runFormOptionsSmoke({mainWindow,monitor,root}){
  const run=code=>mainWindow.webContents.executeJavaScript(`{${code}}`,true);
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const source={id:'options-source',name:'按钮与倍率',kind:'fixed',fixedValue:10,interval:60},oldSize=mainWindow.getContentSize();
  const shown=selector=>run(`document.querySelector(${JSON.stringify(selector)})?.getClientRects().length>0`);
  const capture=async name=>{await run('Promise.allSettled([...document.querySelectorAll(".choice-button,.cadence-tick")].flatMap(n=>n.getAnimations()).map(a=>a.finished)).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');await mkdir(join(root,'artifacts'),{recursive:true});await writeFile(join(root,'artifacts',name),(await mainWindow.webContents.capturePage()).toPNG());};
  try{
    mainWindow.show();mainWindow.show();mainWindow.focus();await invoke('save',source);await monitor.refresh(source.id);
    await run('document.querySelector("[data-page=alarms]").click();document.querySelector("#add-alert").click();true');
    assert.equal(await shown('#alert-multiplier-slider'),true,'ordinary alert uses a multiplier slider');
    assert.equal(await shown('#alert-form [name=updateEvery]'),false);assert.equal(await shown('#alert-form [name=type]'),false);
    assert.equal(await run('document.querySelector("#alert-multiplier-slider").step'),'0.5');
    assert.equal(await run('document.querySelector("#alert-multiplier-slider").min'),'1');assert.equal(await run('document.querySelector("#alert-multiplier-slider").max'),'12');
    for(let value=1;value<=12;value+=.5){await run(`const slider=document.querySelector('#alert-multiplier-slider');slider.value='${value}';slider.dispatchEvent(new Event('input',{bubbles:true}));true`);assert.equal(await run('Number(document.querySelector("#alert-form [name=updateEvery]").value)'),value);}
    await run('document.querySelector("#alert-form [data-choice-for=type] [data-choice-value=value]").click();const slider=document.querySelector("#alert-multiplier-slider");slider.value="1.5";slider.dispatchEvent(new Event("input",{bubbles:true}));true');
    assert.equal(await run('document.querySelector("#alert-form [name=type]").value'),'value');assert.match(await run('document.querySelector("#alert-interval-note").textContent'),/1分钟30秒/);
    await capture('alert-multiplier-options.png');
    await run('document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await shown('#alert-multiplier-slider'),false);assert.equal(await shown('#alert-form [name=updateEvery]'),true);assert.equal(await shown('#alert-form [name=type]'),true);
    await run('const f=document.querySelector("#alert-form");f.elements.updateEvery.value="30";f.elements.updateEvery.dispatchEvent(new Event("input",{bubbles:true}));f.elements.type.value="delta";f.elements.type.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await run('document.querySelector("#alert-form [name=updateEvery]").value'),'30','mode changes preserve custom counts');assert.match(await run('document.querySelector("#alert-multiplier-value").textContent'),/30/);
    assert.equal(await run('document.querySelector("#alert-form [data-choice-value=delta]").getAttribute("aria-pressed")'),'true');
    await run('const f=document.querySelector("#alert-form"),slider=document.querySelector("#alert-multiplier-slider");slider.value="1.5";slider.dispatchEvent(new Event("input",{bubbles:true}));f.elements.name.value="半档告警";f.elements.upper.value="20";document.querySelector("#alert-save").click();true');
    await until(()=>run('!document.querySelector("#alert-dialog").open'),'multiplier form saves');assert.equal((await invoke('snapshot')).alerts.rules[0].updateEvery,1.5);
    await run('document.querySelector("[data-page=data]").click();document.querySelector("[data-id=options-source] [data-action=edit]").click();true');
    for(const name of ['valueMode','totalMode']){assert.equal(await shown(`#source-form [name=${name}]`),false);assert.equal(await shown(`#source-form [data-choice-for=${name}]`),true);}
    await run('document.querySelector("#source-form [data-choice-for=valueMode] [data-choice-value=web]").click();document.querySelector("#source-form [data-choice-for=totalMode] [data-choice-value=web]").click();true');
    assert.equal(await shown('#pick-value'),true);assert.equal(await shown('#pick-total'),true);
    await run('document.querySelector("#source-form [data-choice-for=valueMode] [data-choice-value=fixed]").click();document.querySelector("#source-form [data-choice-for=totalMode] [data-choice-value=fixed]").click();true');
    assert.equal(await shown('#value-fixed-field'),true);assert.equal(await shown('#total-fixed-field'),true);assert.equal(await shown('#url-field'),false);
    await run('document.querySelector("#test-mode-toggle").click();true');
    for(const name of ['valueMode','totalMode']){assert.equal(await shown(`#source-form [name=${name}]`),true);assert.equal(await shown(`#source-form [data-choice-for=${name}]`),false);}
    await run('const f=document.querySelector("#source-form");f.elements.totalMode.value="none";f.elements.totalMode.dispatchEvent(new Event("change",{bubbles:true}));document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await run('document.querySelector("#source-form [data-choice-for=totalMode] [data-choice-value=none]").getAttribute("aria-pressed")'),'true');
    mainWindow.setContentSize(760,900);await capture('source-button-options-760.png');assert.ok(await run('document.querySelector("#source-dialog").scrollWidth<=document.querySelector("#source-dialog").clientWidth+1'));
    await run('document.querySelector("#save-button").click();true');await until(()=>run('!document.querySelector("#source-dialog").open'),'source button choices save');assert.equal(monitor.sources.get(source.id).kind,'fixed');
    console.log('PASS form options: 1–12x half-step multiplier and real frequency, custom count preservation, clickable type/current/total buttons, raw test-mode controls, save and narrow layout');
  }finally{
    await run('document.querySelector("#alert-dialog").close();document.querySelector("#source-dialog").close();if(document.body.classList.contains("test-mode"))document.querySelector("#test-mode-toggle").click();document.querySelector("[data-page=data]").click();true');
    if(monitor.sources.has(source.id))await invoke('remove',source.id);mainWindow.setContentSize(...oldSize);
  }
}

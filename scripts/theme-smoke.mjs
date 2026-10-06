import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {app} from 'electron';
import {THEMES} from '../core/themes.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runThemeSmoke({mainWindow,getFloating,root}) {
  const run=code=>mainWindow.webContents.executeJavaScript(code,true).catch(error=>{throw new Error(`${error.message}\nRenderer probe: ${code}`);});
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${input===undefined?'':JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  await until(()=>run('document.querySelectorAll(".theme-option").length===6'),'theme controls initialized');
  if(process.argv.includes('--theme-read')){
    await until(()=>run('document.documentElement.dataset.theme==="cloud"'),'saved palette restored');
    const saved=await invoke('snapshot');assert.equal(saved.appSettings.theme,'cloud');assert.equal(saved.appSettings.floatingOnStartup,false);
    assert.equal(!!getFloating(),false,'user preference remains off after restart');
    assert.equal(await run('document.querySelector("#floating-on-startup").checked'),false);
    console.log('PASS palette and user startup choice restored together after restart');return;
  }
  await until(()=>getFloating()&&!getFloating().isDestroyed(),'first launch opens floating window by default');
  assert.equal(await run('document.querySelector("#floating-on-startup").checked'),true,'default toggle matches default functionality');
  if(process.argv.includes('--theme-write')){await invoke('appSettings',{theme:'cloud',floatingOnStartup:false});console.log('PASS palette and user startup choice saved for restart');return;}
  assert.equal(await run('document.querySelector("#mode-indicator").textContent'),'常规模式');
  assert.deepEqual(await run('[...document.querySelectorAll(".nav-label")].map(n=>n.textContent)'),['数据','告警','浮窗','设置']);
  assert.equal(await run('document.querySelectorAll("nav .nav-icon").length'),4);
  for(const input of [{theme:'nope'},{theme:null},{theme:'cloud',script:'bad'}])assert.equal((await run(`window.monitor.appSettings(${JSON.stringify(input)})`)).ok,false);
  await invoke('floating',false);await run('document.querySelector("[data-page=settings]").click();true');mainWindow.show();mainWindow.focus();mainWindow.setSize(1260,980);
  const source={id:'palette-source',kind:'fixed',name:'Palette reading',fixedValue:42,totalMode:'fixed',fixedTotal:100,unit:'GB',interval:60};
  await invoke('save',source);await invoke('refresh',source.id);
  for(const [id,type,lower,upper] of [['palette-delta','delta',0,1],['palette-value','value',40,43]])await invoke('alertSave',{id,name:type==='delta'?'Change / 变化量':'Reading / 实时数据',sourceId:source.id,type,lower,upper,updateEvery:1,enabled:true,notificationsEnabled:false});
  await invoke('refresh',source.id);
  for(const fixedValue of [45,43,44]){await invoke('save',{...source,fixedValue});await invoke('refresh',source.id);}
  await run('document.querySelector("[data-page=alarms]").click();true');
  await until(()=>run('document.querySelector("[data-rule-id=palette-delta] .range-dot")'),'palette alert checkpoints');
  await run('document.querySelector("[data-page=settings]").click();true');
  const artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
  const paletteErrors=[];
  const record=(actual,expected,label)=>{if(actual!==expected)paletteErrors.push(`${label}: expected ${expected}, received ${actual}`);};
  // Chromium does not expose the rendered native range track/thumb through
  // getComputedStyle(pseudo). Sample their actual pixels after painting instead.
  const sliderPixel=async part=>{
    await run('document.querySelector("#cadence-slider").scrollIntoView({block:"center"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await sleep(180);
    const box=await run('document.querySelector("#cadence-slider").getBoundingClientRect().toJSON()');
    const x=box.left+(part==='thumb'?8:box.width*.04);
    const pixel=(await mainWindow.webContents.capturePage({x:Math.round(x),y:Math.round(box.top+box.height/2),width:1,height:1})).resize({width:1,height:1}).toBitmap();
    return `rgb(${pixel[2]}, ${pixel[1]}, ${pixel[0]})`;
  };
  try{
    for(const theme of THEMES){
      await run(`document.querySelector('.theme-option[data-theme=${theme.id}]').click();true`);
      await until(()=>run(`document.documentElement.dataset.theme==='${theme.id}'&&!document.querySelector('.theme-option[data-theme=${theme.id}]').disabled`),'palette saved');
      assert.equal((await invoke('snapshot')).appSettings.floatingOnStartup,true,'palette preserves startup switch');
      assert.equal(await run('document.querySelectorAll(".theme-option[aria-pressed=true]").length'),1);
      const surfaces=await run('(()=>{const styles=n=>getComputedStyle(document.querySelector(n));return {body:styles("body").backgroundColor,sidebar:styles(".sidebar").backgroundColor,panel:styles(".metric-card").backgroundColor,field:styles("#source-form input").backgroundColor,scheme:getComputedStyle(document.documentElement).colorScheme};})()');
      const rgb=hex=>`rgb(${hex.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')})`;
      assert.equal(surfaces.body,rgb(theme.colors.bg));assert.equal(surfaces.sidebar,rgb(theme.colors.sidebar));assert.equal(surfaces.panel,rgb(theme.colors.panel));assert.equal(surfaces.field,rgb(theme.colors.field));assert.equal(surfaces.scheme,theme.scheme);
      const saved=JSON.parse(await readFile(join(app.getPath('userData'),'monitor-state.json'),'utf8'));assert.equal(saved.appSettings.theme,theme.id);
      await run('window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await sleep(180);
      await writeFile(join(artifacts,`palette-${theme.id}.png`),(await mainWindow.webContents.capturePage()).toPNG());
      await run('document.querySelector("[data-page=data]").click();document.querySelector("[data-view=list]").click();true');
      const view=await run('(()=>{const n=document.querySelector(".view-switch .selected"),s=getComputedStyle(n);return {background:s.backgroundColor,color:s.color};})()');
      record(view.background,rgb(theme.colors.selected),`${theme.id} selected view background`);record(view.color,rgb(theme.colors.text),`${theme.id} selected view text`);
      record(await run('getComputedStyle(document.querySelector("#data-page .tabs .selected")).backgroundColor'),rgb(theme.colors.selected),`${theme.id} data filter background`);
      await run('document.querySelector("#add-button").click();true');
        assert.equal(await run('document.querySelector("#source-dialog").open'),true);
        const fills=theme.scheme==='light'?{teal:theme.id==='cloud'?'#318c77':'#458675',amber:'#b7791f'}:{teal:theme.colors.teal,amber:theme.colors.amber};
        record(await sliderPixel('track'),rgb(fills.teal),`${theme.id} lightweight cadence track fill`);
        await run('document.querySelector(\'[data-cadence-index="0"]\').click();true');
        record(await sliderPixel('thumb'),rgb(fills.teal),`${theme.id} lightweight thumb`);
        record(await run('getComputedStyle(document.querySelector("#cadence-status")).color'),rgb(theme.colors.teal),`${theme.id} lightweight status text`);
        await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await sleep(180);
        await writeFile(join(artifacts,`palette-${theme.id}-form.png`),(await mainWindow.webContents.capturePage()).toPNG());
      await run('document.querySelector("#close-dialog").click();document.querySelector("[data-page=alarms]").click();for(const n of document.querySelectorAll("[data-alert-action=chart]"))if(n.getAttribute("aria-expanded")!=="true")n.click();true');
      await until(()=>run('!!document.querySelector(".chart-bar.outside")&&!!document.querySelector(".chart-point.outside")'),'both graph types have outside points');
      const graph=await run('(()=>{const s=selector=>getComputedStyle(document.querySelector(selector));return {bar:s(".chart-bar.outside").fill,point:s(".chart-point.outside").fill,dot:s(".range-dot.outside").fill,normal:s(".chart-bar:not(.outside)").fill,label:s(".last-alert").color};})()');
      record(await run('getComputedStyle(document.querySelector("#alert-filters .selected")).backgroundColor'),rgb(theme.colors.selected),`${theme.id} alert filter background`);
      for(const key of ['bar','point','dot'])record(graph[key],rgb(fills.amber),`${theme.id} ${key} outside fill`);
      record(graph.normal,rgb(fills.teal),`${theme.id} within-range bar fill`);record(graph.label,rgb(theme.colors.amber),`${theme.id} outside text`);
      await run('window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await sleep(180);
      await writeFile(join(artifacts,`palette-${theme.id}-alerts.png`),(await mainWindow.webContents.capturePage()).toPNG());
      await run('document.querySelector("[data-page=settings]").click();true');
      await run('document.querySelector("#test-mode-toggle").click();document.querySelector("[data-page=data]").click();true');
      const testSelection=await run('(()=>{const reference=document.createElement("span");reference.style.backgroundColor="color-mix(in srgb,var(--test-accent) 14%,var(--panel))";document.body.append(reference);const expected=getComputedStyle(reference).backgroundColor;reference.remove();return {expected,data:getComputedStyle(document.querySelector("#data-page .tabs .selected")).backgroundColor,view:getComputedStyle(document.querySelector(".view-switch .selected")).backgroundColor,alerts:getComputedStyle(document.querySelector("#alert-filters .selected")).backgroundColor};})()');
      for(const key of ['data','view','alerts'])record(testSelection[key],testSelection.expected,`${theme.id} test-mode ${key} selection`);
      await run('document.querySelector("[data-page=settings]").click();document.querySelector("#test-mode-toggle").click();true');
    }
    assert.deepEqual(paletteErrors,[],'all palette control states and semantic graphic fills must match');
    await invoke('appSettings',{floatingOnStartup:false});assert.equal((await invoke('snapshot')).appSettings.theme,'sand','startup update preserves palette');
    await invoke('appSettings',{theme:'cloud'});assert.equal((await invoke('snapshot')).appSettings.floatingOnStartup,false,'palette update preserves explicit user opt-out');
    await run('document.querySelector("#test-mode-toggle").click();true');assert.equal(await run('document.querySelector("#mode-indicator").textContent'),'测试模式');
    await writeFile(join(artifacts,'palette-cloud-test.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector("#language-toggle").click();true');await until(()=>run('document.documentElement.lang==="en"&&!document.querySelector("#language-toggle").disabled'),'English palette labels');
    assert.deepEqual(await run('[...document.querySelectorAll(".theme-name")].map(n=>n.textContent)'),['Ocean','Graphite','Pine','Twilight','Cloud','Sand']);
    assert.equal(await run('document.querySelector(".nav-label").textContent'),'Data');
    await run('document.querySelector("#test-mode-toggle").click();true');assert.equal(await run('document.querySelector("#mode-indicator").textContent'),'Regular mode');
    mainWindow.setSize(760,980);await sleep(180);assert.equal(await run('document.documentElement.scrollWidth<=document.documentElement.clientWidth'),true,'English palette selection fits narrow window');
    const shapes=await run('[...document.querySelectorAll(".theme-option")].map(n=>{const r=n.getBoundingClientRect();return {w:r.width,h:r.height,title:n.title};})');for(const shape of shapes){assert.equal(shape.w,shape.h);assert.ok(shape.title);}
    await writeFile(join(artifacts,'palette-cloud-narrow-en.png'),(await mainWindow.webContents.capturePage()).toPNG());
    console.log('PASS palettes: all six schemes, regular/test filter and view selections, real slider track/thumb pixels, in-range and outside bar/point/axis fills, readable status text, persisted preferences and bilingual narrow layout');
  }finally{
    await invoke('remove',source.id);await invoke('language','zh-CN');await invoke('appSettings',{theme:'ocean',floatingOnStartup:true});
    await run('if(document.body.classList.contains("test-mode"))document.querySelector("#test-mode-toggle").click();document.querySelector("[data-page=data]").click();true');mainWindow.setSize(1260,820);
  }
}

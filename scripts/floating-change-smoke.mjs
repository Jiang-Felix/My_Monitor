import assert from 'node:assert/strict';
import { app } from 'electron';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_FLOATING_SETTINGS } from '../core/floating-settings.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await predicate())return;await sleep(50);}throw new Error(`Timeout: ${label}`);}
export async function runFloatingChangeSmoke({mainWindow,monitor,getFloating,root}) {
  const run=code=>mainWindow.webContents.executeJavaScript(`{${code}}`,true);
  const invoke=async(method,value)=>{const r=await run(`window.monitor.${method}(${value===undefined?'':JSON.stringify(value)})`);assert.equal(r.ok,true,r.error);return r.data;};
  const native=code=>getFloating().webContents.executeJavaScript(`{${code}}`,true);
  const examples=[
    {id:'change-normal',name:'流量',fixedValue:36.5,fixedTotal:100,unit:'GB',interval:60},
    {id:'change-single',name:'余额',fixedValue:125.5,unit:'credits',interval:60},
    {id:'change-plus',name:'增加',fixedValue:60,fixedTotal:100,unit:'¥',interval:60},
    {id:'change-minus',name:'减少',fixedValue:60,fixedTotal:100,unit:'次',interval:3600},
  ];
  const update=async(id,value,options={})=>{await sleep(10);monitor.upsert({...monitor.sources.get(id),fixedValue:value,...options});await monitor.refresh(id);};
  try {
    for(const source of examples){monitor.upsert({...source,kind:'fixed',totalMode:source.fixedTotal===undefined?'none':'fixed'});await monitor.refresh(source.id);}
    await run('document.querySelector("[data-page=floating]").click(); true');
    assert.equal(await run('document.querySelector("[name=showDeltaBand]").nextElementSibling.firstChild.textContent'),'最近变化量可视化');
    assert.equal(await run('document.querySelector("[name=showDeltaValue]").nextElementSibling.firstChild.textContent'),'瞬时变化量数值');
    assert.equal(await run('document.querySelector("[name=showTotal]").disabled'),false,'default amount text enables the total choice');
    await run('const f=document.querySelector("#floating-settings"); for(const key of ["showName","showAmount","showPercent","showUnit","showDeltaBand","showDeltaValue","showZeroDelta"])f.elements[key].checked=true; f.elements.barWidth.value="340"; f.elements.increaseColor.value="#20c875"; f.elements.decreaseColor.value="#f14b67"; f.dispatchEvent(new Event("input",{bubbles:true})); true');
    assert.equal(await run('document.querySelectorAll("#floating-preview .floating-row").length'),4);
    assert.equal(await run('document.querySelector("[name=showTotal]").disabled'),false);
    const previewText=await run('[...document.querySelectorAll("#floating-preview .floating-amount")].map(n=>n.textContent)');
    assert.deepEqual(previewText.slice(0,2),['36.5/100GB  +0/1分钟','125.5credits  +5.5/1分钟']);
    assert.match(previewText[2],/^\d+\/100¥  [+-]\d+\/1分钟$/);
    assert.match(previewText[3],/^\d+\/100次  [+-]\d+\/1小时$/);
    assert.equal(await run('document.querySelector("[data-id=preview-single] .floating-delta").hidden'),true);
    await run('const f=document.querySelector("#floating-settings"); f.elements.backgroundOpacity.value=""; f.elements.showAmount.checked=false; f.elements.showDeltaBand.checked=false; f.dispatchEvent(new Event("input",{bubbles:true})); true');
    assert.equal(await run('document.querySelector("[name=showTotal]").disabled'),true,'dependent controls update even while a size input is invalid');
    assert.deepEqual(await run('["increaseColor","decreaseColor"].map(key=>document.querySelector("#floating-settings").elements[key].disabled)'),[true,true]);
    await run('const f=document.querySelector("#floating-settings"); f.elements.backgroundOpacity.value="0.62"; f.elements.barHeight.value="20"; f.elements.showAmount.checked=true; f.elements.showDeltaBand.checked=true; f.dispatchEvent(new Event("input",{bubbles:true})); true');
    await run('const f=document.querySelector("#floating-settings"); f.elements.showAmount.checked=false; f.dispatchEvent(new Event("input",{bubbles:true})); true');
    assert.equal(await run('document.querySelector("[name=showTotal]").disabled'),true);
    assert.match(await run('document.querySelector("[data-id=preview-increase] .floating-amount").textContent'),/^[+-]\d+\/1分钟$/,'delta text works without amount text');
    await run('const f=document.querySelector("#floating-settings"); f.elements.showAmount.checked=true; f.dispatchEvent(new Event("input",{bubbles:true})); f.querySelector("[type=submit]").click(); true');
    await until(async()=>(await invoke('snapshot')).floatingSettings.showDeltaBand,'settings saved from form');
    await invoke('floating',true);
    await until(()=>!!getFloating()&&!getFloating().isDestroyed(),'floating created');
    await until(()=>native('document.querySelectorAll(".floating-row").length===4'),'four native rows');
    assert.equal(await native('document.querySelector("[data-id=change-plus] .floating-delta").hidden'),true,'first sample has no fabricated delta');
    await update('change-plus',75);await update('change-minus',30);await update('change-single',130);
    await until(()=>native('document.querySelector("[data-id=change-plus] .floating-amount").textContent==="75/100¥  +15/1分钟"'),'real increase text and configured interval');
    assert.equal(await native('document.querySelector("[data-id=change-minus] .floating-amount").textContent'),'30/100次  -30/1小时');
    const bands=await native('[...document.querySelectorAll(".floating-delta")].map(n=>({hidden:n.hidden,left:getComputedStyle(n).left,width:n.style.width,capWidth:n.nextElementSibling.style.width,color:n.style.backgroundColor}))');
    assert.deepEqual(bands.slice(2),[{hidden:false,left:'0px',width:'75%',capWidth:'60%',color:'rgba(32, 200, 117, 0.45)'},{hidden:false,left:'0px',width:'60%',capWidth:'30%',color:'rgba(241, 75, 103, 0.45)'}]);
    assert.deepEqual(await native('const n=document.querySelector("[data-id=change-plus]"); [".floating-fill",".floating-delta",".floating-cap",".floating-amount"].map(s=>getComputedStyle(n.querySelector(s)).zIndex)'),['1','2','3','4']);
    assert.equal(await native('getComputedStyle(document.querySelector(".floating-delta")).borderTopWidth'),'0px');
    assert.equal(await native('getComputedStyle(document.querySelector(".floating-track")).height'),'20px');
    assert.equal(bands[1].hidden,true,'no-total value has delta text but no percentage band');
    assert.equal(await native('document.querySelector("[data-id=change-single] .floating-amount").textContent'),'130credits  +4.5/1分钟');
    await until(()=>getFloating().isVisible(),'floating visible');
    await native('Promise.allSettled(document.getAnimations().map(a=>a.finished)).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
    for(const [id,fraction,color] of [['change-plus',.675,'green'],['change-minus',.45,'red']]){
      const rect=await native(`const r=document.querySelector('[data-id=${id}]').getBoundingClientRect(); ({x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)})`);
      const image=await getFloating().webContents.capturePage(rect),size=image.getSize(),pixels=image.toBitmap();
      const at=(x,y)=>{const offset=(Math.floor(y*size.height)*size.width+Math.floor(x*size.width))*4;return {b:pixels[offset],g:pixels[offset+1],r:pixels[offset+2]};};
      const white=at(.15,.1),tint=at(fraction,.1);
      assert.ok(white.r>240&&white.g>240&&white.b>240,'foreground white capsule fully covers the colored layer');
      assert.ok(color==='green'?tint.g>tint.r+20&&tint.g>tint.b+10:tint.r>tint.g+40&&tint.r>tint.b+40,`${color} region is visible in actual captured pixels`);
    }
    const artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
    await writeFile(join(artifacts,'floating-change.png'),(await getFloating().webContents.capturePage()).toPNG());
    await run('window.scrollTo(0,0); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,'floating-change-settings.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector("[name=showDeltaBand]").scrollIntoView({block:"center"}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await writeFile(join(artifacts,'floating-change-options.png'),(await mainWindow.webContents.capturePage()).toPNG());
    // Closing and recreating the floating window must use monitoring updates, not start its own comparison history.
    await invoke('floating',false);await invoke('floating',true);
    await until(()=>native('document.querySelector("[data-id=change-plus] .floating-amount")?.textContent==="75/100¥  +15/1分钟"'),'reopening retains last successful change');
    await run('const f=document.querySelector("#floating-settings"); f.elements.showDeltaBand.checked=false; f.elements.showUnit.checked=false; f.elements.showTotal.checked=false; f.dispatchEvent(new Event("input",{bubbles:true})); f.querySelector("[type=submit]").click(); true');
    await until(async()=>(await invoke('snapshot')).floatingSettings.showDeltaBand===false,'band independently disabled');
    await until(()=>native('document.querySelector("[data-id=change-plus] .floating-amount").textContent==="75  +15/1分钟"'),'native window applies unit and total settings');
    assert.equal(await native('document.querySelector("[data-id=change-plus] .floating-amount").textContent'),'75  +15/1分钟');
    assert.equal(await native('document.querySelector("[data-id=change-plus] .floating-delta").hidden'),true);
    const saved=JSON.parse(await readFile(join(app.getPath('userData'),'monitor-state.json'),'utf8')).floatingSettings;
    assert.equal(saved.increaseColor,'#20c875');assert.equal(saved.decreaseColor,'#f14b67');assert.equal(saved.showTotal,false);assert.equal(saved.showDeltaValue,true);
    await update('change-plus',75);
    await until(()=>native('document.querySelector("[data-id=change-plus] .floating-amount").textContent==="75  +0/1分钟"'),'unchanged refresh replaces old delta with zero');
    await invoke('floatingSettings',{...saved,showDeltaBand:true});
    await until(()=>native('!document.querySelector("[data-id=change-plus] .floating-delta").hidden'),'re-enabling band restores latest nonzero change after a zero update');
    assert.deepEqual(await native('const n=document.querySelector("[data-id=change-plus] .floating-delta"); ({width:n.style.width,capWidth:n.nextElementSibling.style.width,color:n.style.backgroundColor})'),{width:'75%',capWidth:'60%',color:'rgba(32, 200, 117, 0.45)'});
    await update('change-plus',75);
    assert.equal(await native('document.querySelector("[data-id=change-plus] .floating-delta").hidden'),false,'another zero update preserves the latest band');
    await invoke('floating',false);await invoke('floating',true);
    await until(()=>native('document.querySelector("[data-id=change-plus] .floating-amount")?.textContent==="75  +0/1分钟"'),'reopening retains instantaneous zero text');
    assert.equal(await native('document.querySelector("[data-id=change-plus] .floating-delta").style.width'),'75%','reopening retains nonzero band independently');
    await update('change-plus',60,{fixedTotal:200});
    await until(()=>native('document.querySelector("[data-id=change-plus] .floating-amount").textContent==="60  -15/1分钟"'),'changing total retains numeric comparison');
    assert.deepEqual(await native('const n=document.querySelector("[data-id=change-plus] .floating-delta"); ({hidden:n.hidden,width:n.style.width,capWidth:n.nextElementSibling.style.width})'),{hidden:false,width:'75%',capWidth:'30%'});
    await update('change-plus',60);
    await until(()=>native('document.querySelector("[data-id=change-plus] .floating-amount").textContent==="60  +0/1分钟"'),'instantaneous text returns to zero after a decrease');
    await native('Promise.allSettled(document.querySelector("[data-id=change-plus]").getAnimations({subtree:true}).map(a=>a.finished))');
    assert.deepEqual(await native('const n=document.querySelector("[data-id=change-plus] .floating-delta"); ({hidden:n.hidden,width:n.style.width,capWidth:n.nextElementSibling.style.width,color:n.style.backgroundColor})'),{hidden:false,width:'75%',capWidth:'30%',color:'rgba(241, 75, 103, 0.45)'});
    console.log('PASS floating changes: renamed options, recent nonzero increase/decrease bands retained across zero updates/toggle/reopening, instantaneous zero text, four unit previews, changing totals, cadence, independent toggles and persistence');
  } finally {
    await invoke('floating',false);await invoke('floatingSettings',DEFAULT_FLOATING_SETTINGS);
    for(const source of examples)await invoke('remove',source.id);
    await run('document.querySelector("[data-page=data]").click(); true');
  }
}

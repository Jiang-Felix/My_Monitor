import assert from 'node:assert/strict';
import {DEFAULT_FLOATING_SETTINGS} from '../core/floating-settings.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runFloatingMotionSmoke({mainWindow,monitor,getFloating}){
  const run=code=>mainWindow.webContents.executeJavaScript(`{${code}}`,true);
  const invoke=async(method,value)=>{const r=await run(`window.monitor.${method}(${JSON.stringify(value)})`);assert.equal(r.ok,true,r.error);return r.data;};
  const native=code=>getFloating().webContents.executeJavaScript(`{${code}}`,true);
  const source={id:'motion-source',name:'动画',kind:'fixed',fixedValue:20,fixedTotal:100,totalMode:'fixed',interval:3600};
  const render=async(previous,current,band=true,smooth=true)=>native(`const source={id:'motion-source',name:'动画',enabled:true,status:'ok',sample:{value:${current},total:100},recentChange:{previousValue:${previous},previousTotal:100,currentValue:${current},currentTotal:100,delta:${current-previous},intervalSeconds:3600}};window.motionModule.renderFloatingRow(document.querySelector('[data-id=motion-source]').parentElement,source,{...window.motionSettings,showDeltaBand:${band},showSmooth:${smooth}});true`);
  const players=()=>native('const track=document.querySelector("[data-id=motion-source]");track.getAnimations({subtree:true}).map(a=>({layer:a.effect.target.className,timing:a.effect.getTiming(),frames:a.effect.getKeyframes().map(f=>({offset:f.offset,width:f.width,visibility:f.visibility,easing:f.easing}))}))');
  const finish=()=>native('document.querySelector("[data-id=motion-source]").getAnimations({subtree:true}).forEach(a=>a.finish());new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const positions=()=>native('const t=document.querySelector("[data-id=motion-source]"),w=t.getBoundingClientRect().width;Object.fromEntries(["fill","delta","cap","red"].map(key=>{const n=t.querySelector(`.floating-${key}`);return [key,{width:n.getBoundingClientRect().width/w*100,hidden:n.hidden||getComputedStyle(n).visibility==="hidden"}]}))');
  const visibleRed=async()=>{
    await native('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const rect=await native('const r=document.querySelector("[data-id=motion-source]").getBoundingClientRect();({x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)})');
    const image=await getFloating().webContents.capturePage(rect),size=image.getSize(),pixels=image.toBitmap();
    const offset=(Math.floor(size.height*.5)*size.width+Math.floor(size.width*.85))*4;
    assert.ok(pixels[offset+2]>pixels[offset+1]+40&&pixels[offset+2]>pixels[offset]+40,'bottom red is visibly painted during the direction change');
  };
  try{
    await invoke('save',source);await monitor.refresh(source.id);
    await run('document.querySelector("[data-page=floating]").click();true');
    assert.equal(await run('!!document.querySelector("#floating-settings [name=showSmooth]")'),true,'floating page exposes smooth motion switch');
    assert.equal(await run('document.querySelector("[name=showSmooth]").checked'),true,'smooth motion is enabled by default');
    const initialPreview=await run('[...document.querySelectorAll("#floating-preview .floating-track")].map(n=>n.getAttribute("aria-valuenow"))');
    await until(()=>run(`const rows=[...document.querySelectorAll('#floating-preview .floating-track')];rows[2].getAttribute('aria-valuenow')!==${JSON.stringify(initialPreview[2])}&&rows[3].getAttribute('aria-valuenow')!==${JSON.stringify(initialPreview[3])}`),'increase and decrease previews update automatically');
    await run('const f=document.querySelector("#floating-settings");for(const key of ["showDeltaBand","showDeltaValue","showAmount","showUnit"])f.elements[key].checked=true;f.dispatchEvent(new Event("input",{bubbles:true}));true');
    await until(()=>run('document.querySelector("#floating-preview").getAnimations({subtree:true}).some(a=>a.effect.target.className==="floating-delta")'),'dynamic preview animates colored bands');
    assert.ok((await run('document.querySelector("#floating-preview").getAnimations({subtree:true}).map(a=>a.effect.getTiming().duration)')).every(duration=>duration===300));
    assert.match(await run('document.querySelector("[data-id=preview-increase] .floating-amount").textContent'),/^\d+\/100¥  [+-]\d+\/1分钟$/,'preview text follows the current dynamic sample');
    await until(()=>run('document.querySelector("[data-id=preview-increase] .floating-amount").textContent.includes("  -")'),'preview demonstrates a direction change');
    assert.equal(await run('document.querySelector("[data-id=preview-increase]").parentElement.querySelector(".floating-name").textContent'),"减",'dynamic preview label follows its current direction');
    assert.equal(await run('document.querySelector("[data-id=preview-normal]").getAttribute("aria-valuenow")'),initialPreview[0],'normal example remains stable');
    await run('document.querySelector("[data-page=data]").click();true');
    const hiddenPreview=await run('document.querySelector("[data-id=preview-increase]").getAttribute("aria-valuenow")');
    await sleep(1750);
    assert.equal(await run('document.querySelector("[data-id=preview-increase]").getAttribute("aria-valuenow")'),hiddenPreview,'hidden preview stops updating');
    await run('document.querySelector("[data-page=floating]").click();true');
    await until(()=>run(`document.querySelector('[data-id=preview-increase]').getAttribute('aria-valuenow')!==${JSON.stringify(hiddenPreview)}`),'preview resumes after returning to its page');
    await run('const f=document.querySelector("#floating-settings");f.elements.showSmooth.checked=true;f.dispatchEvent(new Event("input",{bubbles:true}));f.requestSubmit();true');
    await until(()=>run('document.querySelector("#floating-settings button[type=submit]").disabled===false'),'smooth settings save');
    assert.equal((await invoke('snapshot')).floatingSettings.showSmooth,true);
    await invoke('floating',true);await until(()=>native('!!document.querySelector("[data-id=motion-source]")'),'animated floating row');
    await native('Promise.all([import("./floating-row.js"),window.monitor.snapshot()]).then(([module,snapshot])=>{window.motionModule=module;window.motionSettings=snapshot.data.floatingSettings;return true;})');
    await render(20,20,false);await render(20,60,false);
    let animations=await players();assert.equal(animations.length,1,'plain fill animates instead of jumping');assert.equal(animations[0].timing.duration,300);assert.equal(animations[0].timing.easing,'ease-in-out');
    await native('document.querySelector(".floating-fill").getAnimations().forEach(a=>{a.pause();a.currentTime=150;});true');assert.ok(Math.abs((await positions()).fill.width-40)<.2,'plain fill moves smoothly through its midpoint');await finish();
    await render(60,80);await finish();await render(80,90);
    animations=await players();assert.deepEqual(animations.find(a=>a.layer==='floating-cap').frames.map(f=>f.width),['60%','80%']);assert.deepEqual(animations.find(a=>a.layer==='floating-delta').frames.map(f=>f.width),['80%','90%']);assert.deepEqual(animations.find(a=>a.layer==='floating-fill').frames.map(f=>f.width),['80%','90%']);await finish();
    await render(90,70);animations=await players();assert.deepEqual(animations.find(a=>a.layer==='floating-fill').frames.map(f=>f.width),['90%','80%','70%']);assert.ok(animations.every(a=>a.timing.duration===300));
    let p=await positions();assert.equal(p.red.hidden,false);assert.ok(Math.abs(p.red.width-90)<.2,'red appears immediately beneath the other capsules');
    await native('document.querySelector("[data-id=motion-source]").getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=170;});true');p=await positions();assert.equal(p.delta.hidden,true);assert.equal(p.cap.hidden,true);assert.equal(p.fill.hidden,false);await visibleRed();await finish();
    await render(70,50);animations=await players();assert.deepEqual(animations.find(a=>a.layer==='floating-delta').frames.map(f=>f.width),['90%','70%']);assert.deepEqual(animations.find(a=>a.layer==='floating-cap').frames.map(f=>f.width),['70%','50%']);await finish();
    await render(50,65);animations=await players();assert.deepEqual(animations.find(a=>a.layer==='floating-red').frames.map(f=>f.width),['70%','0%']);assert.deepEqual(animations.find(a=>a.layer==='floating-fill').frames.map(f=>f.width),['50%','65%']);p=await positions();assert.ok(Math.abs(p.cap.width-50)<.2);await finish();
    await render(65,45);await finish();await render(45,60);await native('document.querySelector("[data-id=motion-source]").getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=50;});true');
    const interruptedIncrease=await positions();await render(60,75);animations=await players();
    assert.ok(Math.abs(parseFloat(animations.find(a=>a.layer==='floating-delta').frames[0].width)-interruptedIncrease.delta.width)<.2,'interrupted red withdrawal continues from green width, not shrinking red width');
    assert.ok(Math.abs(parseFloat(animations.find(a=>a.layer==='floating-red').frames[0].width)-interruptedIncrease.red.width)<.2,'interrupted increase retains the remaining red withdrawal');await finish();
    await render(75,85);await native('window.oldMotionPlayers=document.querySelector("[data-id=motion-source]").getAnimations({subtree:true});window.oldMotionPlayers.forEach(a=>{a.pause();a.currentTime=150;});true');const interrupted=(await positions()).fill.width;
    await render(85,55);animations=await players();assert.ok(Math.abs(parseFloat(animations.find(a=>a.layer==='floating-fill').frames[0].width)-interrupted)<.2,'new updates continue from the on-screen width');assert.equal(await native('window.oldMotionPlayers.every(a=>a.playState==="idle")'),true);
    await native('window.currentMotionPlayers=document.querySelector("[data-id=motion-source]").getAnimations({subtree:true});true');await render(85,55);assert.equal(await native('window.currentMotionPlayers.every(a=>document.querySelector("[data-id=motion-source]").getAnimations({subtree:true}).includes(a))'),true,'unchanged broadcasts do not restart animation');
    await render(85,55,true,false);assert.equal((await players()).length,0,'disabling motion cancels all animation immediately');await sleep(350);p=await positions();assert.ok(Math.abs(p.cap.width-55)<.2);assert.equal(p.red.hidden,true,'cancelled completion cannot restore old transition layers');
    console.log('PASS floating motion: default/saved switch, dynamic preview values/text/bands and page lifecycle, 300ms easing, plain/increase/decrease movement, both directional transitions, phase visibility, interruption continuity, duplicate broadcast stability and immediate disable');
  }finally{
    await invoke('floating',false);await invoke('floatingSettings',DEFAULT_FLOATING_SETTINGS);if(monitor.sources.has(source.id))await invoke('remove',source.id);await run('document.querySelector("[data-page=data]").click();true');
  }
}

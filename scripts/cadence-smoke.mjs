import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runCadenceSmoke({mainWindow,monitor,root}){
  let pageRequests=0;
  const server=http.createServer((req,res)=>{pageRequests++;res.setHeader('Content-Type','text/html');res.end('<p id="value">42 GB</p>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const run=code=>mainWindow.webContents.executeJavaScript(`{${code}}`,true);
  const invoke=async(method,input)=>{const result=await run(`window.monitor.${method}(${JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const source={id:'cadence-web',name:'频率测试',kind:'web',url:`http://127.0.0.1:${server.address().port}`,selector:'#value',interval:75,waitSeconds:1,webUpdateMode:'reload'};
  const oldSize=mainWindow.getContentSize(),artifacts=join(root,'artifacts');await mkdir(artifacts,{recursive:true});
  const capture=async name=>{await run('Promise.allSettled([...document.querySelectorAll(".cadence-tick")].flatMap(n=>n.getAnimations()).map(a=>a.finished)).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');await writeFile(join(artifacts,name),(await mainWindow.webContents.capturePage()).toPNG());};
  const edit=()=>run('document.querySelector("[data-id=cadence-web] [data-action=edit]").click();true');
  try{
    mainWindow.show();mainWindow.focus();
    await invoke('save',source);await monitor.refresh(source.id);await edit();
    assert.equal(await run('!!document.querySelector("#cadence-slider")'),true,'normal mode provides the requested slider');
    assert.equal(await run('document.querySelector("#cadence-controls").hidden'),false);
    assert.equal(await run('document.querySelector("#raw-refresh-fields").getClientRects().length'),0);
    assert.equal(await run('document.querySelector("#web-update-field").getClientRects().length'),0);
    assert.equal(await run('document.querySelector("[name=interval]").value'),'75','opening preserves a custom period');
    assert.match(await run('document.querySelector("#cadence-value").textContent'),/75秒/);
    await run('document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await run('document.querySelector("#cadence-controls").hidden'),true);
    assert.ok(await run('document.querySelector("#raw-refresh-fields").getClientRects().length>0&&document.querySelector("#web-update-field").getClientRects().length>0'));
    await run('const f=document.querySelector("#source-form");f.elements.interval.value="137";f.elements.webUpdateMode.value="live";f.elements.interval.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#test-mode-toggle").click();true');
    assert.equal(await run('document.querySelector("[name=interval]").value'),'137','switching presentation does not round custom periods');
    assert.equal(await run('document.querySelector("[name=webUpdateMode]").value'),'live','existing custom live mode is retained');
    const presets=[['1s',1],['30s',30],['1min',60],['10min',600],['30min',1800],['1h',3600],['5h',18000],['12h',43200],['1d',86400],['1w',604800],['1m',2592000]];
    assert.deepEqual(await run('[...document.querySelectorAll("#cadence-ticks .cadence-tick")].map(n=>n.textContent)'),presets.map(p=>p[0]));
    for(const [index,[label,seconds]] of presets.entries()){
      await run(`const slider=document.querySelector('#cadence-slider');slider.value='${index}';slider.dispatchEvent(new Event('input',{bubbles:true}));true`);
      assert.equal(await run('Number(document.querySelector("[name=interval]").value)'),seconds,label);
      assert.equal(await run('document.querySelector("[name=webUpdateMode]").value'),index<2?'live':'reload',label);
      assert.match(await run('document.querySelector("#cadence-status").textContent'),index<2?/网页自主更新/:/重新加载/);
      assert.equal(await run('document.querySelector("#cadence-controls").classList.contains("lightweight")'),index<2);
    }
    await run('document.querySelector("#cadence-controls").scrollIntoView({block:"center"});true');
    await capture('source-cadence-month.png');
    await run('const slider=document.querySelector("#cadence-slider");slider.value="0";slider.dispatchEvent(new Event("input",{bubbles:true}));slider.focus();true');
    await until(()=>{mainWindow.show();mainWindow.focus();return run('document.hasFocus()');},'keyboard slider native focus');
    for(const type of ['keyDown','keyUp'])mainWindow.webContents.sendInputEvent({type,keyCode:'Right'});
    await until(()=>run('document.querySelector("[name=interval]").value==="30"'),'keyboard moves one preset');
    await run('const slider=document.querySelector("#cadence-slider");slider.value="0";slider.dispatchEvent(new Event("input",{bubbles:true}));true');
    await capture('source-cadence-1s.png');
    mainWindow.setContentSize(760,900);await capture('source-cadence-760.png');
    assert.ok(await run('const d=document.querySelector("#source-dialog");d.scrollWidth<=d.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1'),'all slider labels fit a narrow window');
    mainWindow.setContentSize(...oldSize);
    await run('document.querySelector("#save-button").click();true');
    await until(()=>monitor.sources.get(source.id)?.webUpdateMode==='live'&&monitor.sources.get(source.id)?.interval===1&&monitor.sources.get(source.id)?.status==='ok','fast preset saves live configuration');
    const before=pageRequests;await monitor.refresh(source.id);await monitor.refresh(source.id);
    assert.equal(pageRequests,before,'fast live reads reuse the page without reload requests');
    await until(()=>run('!document.querySelector("#source-dialog").open'),'save closes form');await edit();
    await run('document.querySelector("#test-mode-toggle").click();document.querySelector("#raw-refresh-fields").scrollIntoView({block:"end"});true');await capture('source-cadence-test-mode.png');
    await run('const f=document.querySelector("#source-form");f.elements.interval.value="137";f.elements.webUpdateMode.value="reload";f.elements.interval.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#save-button").click();true');
    await until(()=>monitor.sources.get(source.id)?.interval===137&&monitor.sources.get(source.id)?.status==='ok','raw test-mode frequency saves and collects');
    await until(()=>run('!document.querySelector("#source-dialog").open'),'raw save closes form');
    await run('document.querySelector("#test-mode-toggle").click();true');await edit();
    assert.equal(await run('document.querySelector("[name=interval]").value'),'137');
    assert.equal(await run('document.querySelector("[name=webUpdateMode]").value'),'reload');
    await run('const slider=document.querySelector("#cadence-slider");slider.value="10";slider.dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#save-button").click();true');
    await until(()=>monitor.sources.get(source.id)?.interval===2592000&&monitor.sources.get(source.id)?.status==='ok','monthly preset saves and collects');
    assert.equal(monitor.sources.get(source.id).webUpdateMode,'reload');
    console.log('PASS refresh slider: 11 presets, lightweight fast modes without reload requests, long periods, custom values and test-mode switching, keyboard and narrow layout');
  }finally{
    await run('document.querySelector("#source-dialog").close();if(document.body.classList.contains("test-mode"))document.querySelector("#test-mode-toggle").click();true');
    if(monitor.sources.has(source.id))await invoke('remove',source.id);
    mainWindow.setContentSize(...oldSize);server.closeAllConnections();await new Promise(r=>server.close(r));
  }
}

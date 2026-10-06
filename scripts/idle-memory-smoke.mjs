import assert from 'node:assert/strict';
import http from 'node:http';
import {app} from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const end=Date.now()+12000;while(Date.now()<end){if(await check())return;await sleep(50);}throw Error(`Timeout: ${label}`);}
export async function runIdleMemorySmoke({mainWindow,monitor,web,getFloating,root}){
  const baseline=process.argv.includes('--memory-baseline'),report={mode:baseline?'baseline':'optimized',samples:[]};
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  const invoke=async(method,value)=>{const result=await run(`window.monitor.${method}(${JSON.stringify(value)})`);assert.equal(result.ok,true,result.error);return result.data;};
  let liveValue=10,scheduler;const requests=new Map();
  const server=http.createServer((req,res)=>{
    requests.set(req.url,(requests.get(req.url)||0)+1);
    if(req.url==='/live-value'){res.end(String(++liveValue));return;}
    res.setHeader('Content-Type','text/html');res.setHeader('Set-Cookie','fixture=local; HttpOnly; SameSite=Lax; Path=/');
    res.end(`<html><body><div id="balance">10</div><div id="total">1000</div>${'<p>Local fixture content</p>'.repeat(1500)}${req.url==='/live'?'<script>setInterval(async()=>document.querySelector("#balance").textContent=await (await fetch("/live-value")).text(),200)</script>':''}</body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const capture=async(label)=>{
    const values=[];
    for(let i=0;i<5;i++){
      const metrics=app.getAppMetrics();
      values.push({workingMiB:metrics.reduce((n,m)=>n+(m.memory?.workingSetSize||0),0)/1024,privateMiB:metrics.reduce((n,m)=>n+(m.memory?.privateBytes||0),0)/1024,processes:metrics.map(m=>({type:m.type,pid:m.pid,workingMiB:(m.memory?.workingSetSize||0)/1024,privateMiB:(m.memory?.privateBytes||0)/1024}))});await sleep(150);
    }
    const sample={label,workingMiB:values.reduce((n,s)=>n+s.workingMiB,0)/values.length,privateMiB:values.reduce((n,s)=>n+s.privateMiB,0)/values.length,windows:web.windows.size,processCount:values.at(-1).processes.length,processes:values.at(-1).processes};
    report.samples.push(sample);console.log('Memory sample:',JSON.stringify({...sample,processes:undefined}));
  };
  try{
    mainWindow.show();await until(()=>run('!!document.querySelector("#empty-add")'),'UI ready');await sleep(1000);await capture('empty-visible');
    const sources=Array.from({length:4},(_,i)=>({id:`memory-reload-${i}`,name:`Reload ${i}`,kind:'web',url:base+'/reload',selector:'#balance',totalSelector:'#total',totalMode:'web',interval:60,waitSeconds:1,webUpdateMode:'reload'}));
    sources.push({id:'memory-live',name:'Live',kind:'web',url:base+'/live',selector:'#balance',totalSelector:'#total',totalMode:'web',interval:1,waitSeconds:1,webUpdateMode:'live'});
    for(const source of sources)monitor.upsert(source);
    await monitor.refreshAll();scheduler=setInterval(()=>monitor.tick(),250);
    await invoke('alertSave',{id:'memory-alert',name:'Silent fixture',sourceId:'memory-live',type:'value',lower:0,upper:1000,updateEvery:1,notificationsEnabled:false});
    await until(()=>run('document.querySelectorAll("#cards [data-id]").length===5'),'five monitored cards');
    await sleep(1000);await capture('five-webpages-visible');
    await run('document.querySelector("#add-button").click();document.querySelector("#source-form").elements.name.value="Unsaved local draft";true');
    await run('window.__idleMutations=0;window.__idleObserver=new MutationObserver(list=>window.__idleMutations+=list.length);window.__idleObserver.observe(document.querySelector("#cards"),{subtree:true,childList:true,characterData:true,attributes:true});true');
    const liveBefore=monitor.sources.get('memory-live').updateSequence;
    mainWindow.hide();await sleep(18000);await capture('five-webpages-hidden-idle');
    report.hiddenMutations=await run('window.__idleMutations');report.liveUpdates=monitor.sources.get('memory-live').updateSequence-liveBefore;
    console.log('Hidden activity:',JSON.stringify({mutations:report.hiddenMutations,liveUpdates:report.liveUpdates,residentWebWindows:web.windows.size}));
    assert.ok(report.liveUpdates>=10,'autonomous web updates continue while the main UI is hidden');
    if(!baseline){assert.equal(report.hiddenMutations,0,'hidden dashboard does not rebuild cards');assert.equal(web.windows.size,1,'only the autonomous webpage remains resident');}
    mainWindow.show();await sleep(250);
    assert.equal(await run('document.querySelector("#source-dialog").open'),true);assert.equal(await run('document.querySelector("#source-form").elements.name.value'),'Unsaved local draft','editor draft survives hiding');
    await until(()=>run(`document.querySelector('[data-id="memory-live"] .metric-value').textContent.includes(${JSON.stringify(String(monitor.sources.get('memory-live').sample.value))})`),'shown UI catches up');
    if(!baseline){assert.ok((await invoke('snapshot')).alerts.tracking[0].points.length>=10,'alert records continue while hidden');}
    if(!baseline){
      const floatingState=await getFloating().webContents.executeJavaScript('window.monitor.snapshot()');
      assert.equal(floatingState.ok,true);assert.equal(floatingState.data.sources.length,5);
      assert.equal(Object.hasOwn(floatingState.data,'alerts'),false,'floating IPC does not allocate graph history');
      assert.equal(floatingState.data.sources.some(source=>Object.hasOwn(source,'url')),false,'floating IPC does not copy account URLs');
      await run('window.__idleMutations=0;true');mainWindow.minimize();await sleep(1500);
      assert.equal(await run('window.__idleMutations'),0,'minimized UI also skips background DOM work');
      mainWindow.restore();await sleep(200);
      assert.equal(await run('document.querySelector("#source-form").elements.name.value'),'Unsaved local draft','minimize/restore also retains the draft');
    }
    const page=web.getWindow('memory-reload-0',true);await web.login(sources[0]);
    if(!baseline)await sleep(1100);
    assert.equal(page.isVisible(),true,'an explicitly opened webpage remains open');
    page.hide();await monitor.refresh('memory-reload-0');assert.equal(monitor.sources.get('memory-reload-0').sample.value,10,'recycled webpage reloads correctly');
    assert.ok((await web.profile('memory-reload-0').profile.cookies.get({url:base})).some(cookie=>cookie.name==='fixture'),'login cookies survive renderer release');
    await invoke('floating',false);await capture('floating-closed');
    console.log('PASS idle memory functional checks: hidden monitoring, drafts, reopen, webpage reload and session retention');
  }finally{
    clearInterval(scheduler);await web.closeAll();await new Promise(resolve=>server.close(resolve));
    await mkdir(join(root,'artifacts','memory'),{recursive:true});await writeFile(join(root,'artifacts','memory',`${report.mode}.json`),JSON.stringify(report,null,2));
  }
}

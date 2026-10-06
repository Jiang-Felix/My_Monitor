import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {app} from 'electron';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const end=Date.now()+10000;while(Date.now()<end){if(await predicate())return;await sleep(50);}throw Error(`Timeout: ${label}`);}
export async function runSecurityHardeningSmoke({mainWindow,monitor,web,persist,store,provisionalIds}){
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/page')){res.setHeader('Content-Type','text/html');res.end('<p id="value">4</p><script>localStorage.setItem("fixture","kept");document.cookie="fixture=kept;path=/";</script>');}
    else{res.setHeader('Content-Type','application/json');res.end('{"value":4}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  const call=(method,input)=>run(`window.monitor.${method}(${JSON.stringify(input)})`);
  const invoke=async(method,input)=>{const result=await call(method,input);assert.equal(result.ok,true,result.error);return result.data;};
  const file=join(app.getPath('userData'),'monitor-state.json');
  const actualSave=store.save.bind(store);
  async function failSave(operation){store.save=()=>Promise.reject(Error('isolated disk fault'));try{return await operation();}finally{store.save=actualSave;}}
  try{
    await until(()=>run('!!window.monitor && !!document.querySelector("#empty-add")'),'renderer');
    const source={id:'security-fixed',name:'fixture',kind:'fixed',fixedValue:4,interval:60,enabled:true};
    const failedCreate=await failSave(()=>call('save',source));assert.equal(failedCreate.ok,false);assert.equal(monitor.sources.has(source.id),false);
    await invoke('save',source);await monitor.refresh(source.id);
    const failedEdit=await failSave(()=>call('save',{...source,name:'changed',fixedValue:99}));assert.equal(failedEdit.ok,false);assert.equal(monitor.sources.get(source.id).name,'fixture');assert.equal(monitor.sources.get(source.id).sample.value,4);
    await invoke('alertSave',{id:'security-alert',sourceId:source.id,name:'fixture alert',type:'value',lower:0,upper:10,updateEvery:1});
    const failedDelete=await failSave(()=>call('remove',source.id));assert.equal(failedDelete.ok,false);assert.equal(monitor.sources.has(source.id),true);assert.equal((await invoke('snapshot')).alerts.rules.length,1);
    const failedPreference=await failSave(()=>call('appSettings',{floatingOnStartup:false}));assert.equal(failedPreference.ok,false);assert.equal((await invoke('snapshot')).appSettings.floatingOnStartup,true);
    const normalized=await invoke('alertSave',{sourceId:source.id,name:'generated ID',type:'value',lower:0,upper:10});
    const generated=normalized.alerts.rules.find(rule=>rule.name==='generated ID');
    assert.equal(JSON.parse(await readFile(file,'utf8')).alerts.rules.find(rule=>rule.name==='generated ID').id,generated.id);
    await invoke('alertRemove',generated.id);
    console.log('PASS actual IPC disk failures retain sources, values, linked alerts and preferences');

    const secretSource={id:'security-http',kind:'http',name:'secret fixture',url:`${base}/api?access_token=FAKE_QUERY_CREDENTIAL`,valuePath:'value',interval:60,enabled:true,token:'FAKE_HEADER_CREDENTIAL'};
    await invoke('save',secretSource);await monitor.refresh(secretSource.id);
    await invoke('alertSave',{id:'secret-alert',sourceId:secretSource.id,name:'secret alert',type:'value',lower:0,upper:10,updateEvery:1});
    await monitor.refresh(secretSource.id);await persist();await persist();
    for(const path of [file,`${file}.bak`]){const raw=await readFile(path,'utf8');assert.equal(raw.includes('FAKE_QUERY_CREDENTIAL'),false);assert.equal(raw.includes('FAKE_HEADER_CREDENTIAL'),false);}
    await until(()=>run('!!document.querySelector("[data-id=security-http] [data-action=edit]")'),'secret source card');
    await run('document.querySelector("[data-id=security-http] [data-action=edit]").click();true');
    assert.equal(await run('document.querySelector("[name=url]").type'),'password');
    await run('document.querySelector("#source-dialog").close();true');
    console.log('PASS OS-encrypted URL and Token never appear in primary or backup, including alert identities');

    const webpage={id:'security-web',name:'web fixture',kind:'web',url:`${base}/page`,selector:'#value',interval:1,webUpdateMode:'live',waitSeconds:1,enabled:true};
    await invoke('save',webpage);await monitor.refresh(webpage.id);assert.ok(web.windows.has(webpage.id));
    await invoke('save',{...webpage,enabled:false});await web.profiles.get(webpage.id).stopping;
    assert.equal(web.windows.has(webpage.id),false);assert.equal(web.profiles.get(webpage.id).blocked,true);
    assert.equal((await web.profiles.get(webpage.id).profile.cookies.get({name:'fixture'}))[0]?.value,'kept');
    await invoke('save',webpage);await monitor.refresh(webpage.id);
    assert.equal(await web.windows.get(webpage.id).webContents.executeJavaScript('localStorage.getItem("fixture")'),'kept');
    console.log('PASS actual data pause destroys web window and blocks requests while preserving login storage');

    await invoke('preview',{...webpage,id:'security-provisional'});assert.equal(provisionalIds.has('security-provisional'),true);
    const temporary=web.profiles.get('security-provisional').profile;
    await invoke('discard','security-provisional');assert.equal(provisionalIds.has('security-provisional'),false);assert.equal(web.windows.has('security-provisional'),false);
    assert.equal((await temporary.cookies.get({name:'fixture'})).length,0);
    assert.equal(await invoke('discard',webpage.id),null);assert.equal(monitor.sources.has(webpage.id),true);
    const raced={...webpage,id:'security-race'};await invoke('preview',raced);
    const actualDiscard=web.discard.bind(web);let release,started;
    const startedPromise=new Promise(resolve=>{started=resolve;});
    web.discard=async id=>{if(id===raced.id){await new Promise(resolve=>{release=resolve;started();});}return actualDiscard(id);};
    try{
      const disposal=call('discard',raced.id);await startedPromise;const save=call('save',raced);
      await sleep(50);assert.equal(monitor.sources.has(raced.id),false,'save cannot activate during login cleanup');
      release();assert.equal((await disposal).ok,true);assert.equal((await save).ok,true);
      await monitor.refresh(raced.id);assert.equal(web.profiles.get(raced.id).blocked,false);await invoke('remove',raced.id);
    }finally{web.discard=actualDiscard;release?.();}
    console.log('PASS abandoned preview clears only its temporary credentials; saved source is protected');

    const removed=await invoke('remove',source.id);assert.equal(removed.removedAlertCount,1);assert.equal(removed.alerts.rules.some(rule=>rule.sourceId===source.id),false);
    await invoke('remove',secretSource.id);await invoke('remove',webpage.id);
    assert.equal(monitor.sources.size,0);
    console.log('PASS deletion commits first and removes linked alerts and owned login storage');
  }finally{store.save=actualSave;web.closeAll();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

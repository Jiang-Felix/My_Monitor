import assert from 'node:assert/strict';
import http from 'node:http';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const end=Date.now()+3000;while(Date.now()<end){if(await check())return;await sleep(20);}throw Error(`Timeout: ${label}`);}
export async function runWebIdleSmoke(web){
  const server=http.createServer((req,res)=>{
    if(req.url==='/worker.js'){res.setHeader('Content-Type','application/javascript');res.end('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));');return;}
    res.setHeader('Content-Type','text/html');res.end(`<html><body><span id="value">42</span>${req.url==='/session'?'<script>sessionStorage.setItem("fixture-login","local-auth-state")</script>':req.url==='/frame'?'<iframe src="/session"></iframe>':req.url==='/worker'?'<script>navigator.serviceWorker.register("/worker.js")</script>':''}</body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const source=(id,path='/',mode='reload')=>({id,name:id,url:base+path,kind:'web',selector:'#value',valueMode:'web',totalMode:'none',webUpdateMode:mode,waitSeconds:1,interval:mode==='live'?1:60});
  web.idleWindowDelayMs=80;
  try{
    for(const [id,path] of [['idle-session','/session'],['idle-frame','/frame']]){
      await web.collect(source(id,path));const window=web.windows.get(id);await sleep(300);
      assert.equal(window.isDestroyed(),false,'page-session authentication state must never be discarded');
      assert.equal(web.windows.get(id),window);
    }
    web.configureResources({lowUsageMode:true});
    await web.collect(source('idle-worker','/worker'));const workerWindow=web.windows.get('idle-worker');await sleep(300);
    assert.equal(workerWindow.isDestroyed(),false,'active workers keep their owning window and resource protection');
    assert.ok(Object.keys(web.profile('idle-worker').profile.serviceWorkers.getAllRunning()).length);
    web.configureResources({lowUsageMode:false});
    await web.collect(source('idle-plain'));await until(()=>!web.windows.has('idle-plain'),'idle renderer released');
    assert.equal((await web.collect(source('idle-plain'))).value,'42','released page reads again');
    const shown=web.getWindow('idle-plain',true);await sleep(300);assert.equal(shown.isDestroyed(),false,'opening a page cancels its pending release');
    await web.collect(source('idle-live','/','live'));const live=web.windows.get('idle-live');await sleep(300);
    assert.equal(live.isDestroyed(),false,'autonomous pages remain resident');assert.equal((await web.collect(source('idle-live','/','live'))).value,'42');
    await web.collect(source('idle-close'));await web.close('idle-close');await sleep(200);
    assert.equal(web.idleWindows.has('idle-close'),false,'pause/deletion cancels idle release');
    console.log('PASS idle webpage release: plain reload, repeat reads, visible/login windows, autonomous updates, main/frame sessionStorage retention, worker protection and close cleanup');
  }finally{await web.closeAll();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

// Small synthetic localhost fixtures; never touches a production profile or sends notifications.
const { app, session } = require('electron');
const { pathToFileURL } = require('node:url');
const { join, resolve } = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {mkdir,writeFile,access,symlink}=require('node:fs/promises');
const {createHash}=require('node:crypto');
const sockets=new Set();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, web;
const guard = setTimeout(() => app.exit(2), 50000);
app.on('window-all-closed', () => {});
(async () => {
  assert.ok(process.argv[2]); app.setPath('userData', process.argv[2]); await app.whenReady();
  const { WebSources } = await import(pathToFileURL(join(resolve(__dirname, '..'), 'desktop/web-source.js')).href);
  let polls = 0;
  server = http.createServer((req, res) => {
    if(req.url==='/hang')return;
    if (req.url === '/poll') { polls++; res.end('{}'); return; }
    if (req.url === '/large') { res.setHeader('Content-Length', 8192); res.end('x'.repeat(8192)); return; }
    if (req.url === '/chunked') { res.setHeader('Content-Type','text/html');res.write('<p id="value">42</p>');setTimeout(()=>res.end('x'.repeat(8192)),40);return; }
    if(req.url==='/medium'){res.setHeader('Content-Type','text/html');res.end('<p id="value">42</p>'+' '.repeat(3000));return;}
    if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');res.end('setInterval(()=>fetch("/poll").catch(()=>{}),100);self.addEventListener("install",()=>self.skipWaiting());');return;}
    if(req.url==='/byte-worker.js'){res.setHeader('Content-Type','text/javascript');res.end('setTimeout(()=>fetch("/chunked").then(r=>r.text()).catch(()=>{}),200);self.addEventListener("install",()=>self.skipWaiting());');return;}
    res.setHeader('Content-Type', 'text/html'); res.end('<p id="value">42</p><script>if(location.pathname==="/polling")setInterval(()=>fetch("/poll").catch(()=>{}),100)</script>');
  });
  server.on('upgrade',(req,socket)=>{
    sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    setTimeout(()=>{if(!socket.destroyed){const payload=Buffer.from('x'.repeat(8192)),header=Buffer.from([0x81,126,32,0]);socket.write(Buffer.concat([header,payload]));}},120);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const source = id => ({ id, url: base+'/', selector:'#value', valueMode:'web', totalMode:'none', webUpdateMode:'live', waitSeconds:0, interval:1 });
  const test = async (name, run) => { try { await run(); console.log('PASS '+name); } catch (e) { console.error('FAIL '+name, e.stack); process.exitCode = 1; } finally { await web?.closeAll(); } };
  await test('default compatibility mode permits polling, larger responses and high synthetic resource usage',async()=>{
    web=new WebSources({requestLimit:1,maxResponseBytes:4096,maxRendererMemoryKiB:1,maxTotalRendererMemoryKiB:1});
    const win=web.getWindow('compatible');await web.navigate(win,base+'/polling');await sleep(250);
    assert.equal(win.isDestroyed(),false,'normal page polling is not stopped by the low-usage budget');
    assert.equal(win.webContents.debugger.isAttached(),false,'compatibility mode does not intercept resource traffic');
    web.checkResources([{pid:win.webContents.getOSProcessId(),cpu:{percentCPUUsage:999},memory:{workingSetSize:9999999}}]);
    assert.equal(win.isDestroyed(),false);
    await web.navigate(win,base+'/chunked');assert.equal(win.isDestroyed(),false);
    for(let i=0;i<9;i++)web.getWindow('compatible-'+i);
    assert.equal(web.windows.size,10,'capacity is no longer limited to eight windows');
  });
  await test('runtime mode changes attach/detach guards, clear cooldown and keep login state',async()=>{
    web=new WebSources();const win=web.getWindow('switch-mode');await web.navigate(win,base+'/');
    await win.webContents.session.cookies.set({url:base,name:'mode-fixture',value:'kept'});
    assert.equal(web.configureResources({lowUsageMode:true,webLimits:{requestLimit:1,requestWindowSeconds:1}}),true);
    assert.equal(win.webContents.debugger.isAttached(),true);
    await web.navigate(win,base+'/polling');await sleep(250);
    assert.equal(win.isDestroyed(),true);
    web.configureResources({lowUsageMode:false,webLimits:{requestLimit:1}});
    assert.equal((await web.collect(source('switch-mode'))).value,'42','switching off clears resource cooldown');
    const reopened=web.windows.get('switch-mode');
    assert.equal(reopened.webContents.debugger.isAttached(),false);
    assert.equal((await reopened.webContents.session.cookies.get({name:'mode-fixture'}))[0].value,'kept');
    web.configureResources({lowUsageMode:true});web.configureResources({lowUsageMode:false});
    await sleep(50);assert.equal(reopened.isDestroyed(),false,'intentional guard detach does not stop the page');
  });
  await test('one download hook after repeated recreation', async () => {
    web = new WebSources({lowUsageMode:true}); const profile=web.getWindow('hooks').webContents.session;
    web.close('hooks'); web.getWindow('hooks');
    assert.equal(profile.listenerCount('will-download'),1);
  });
  await test('resident capacity rejects ninth without destroying active pages', async () => {
    web = new WebSources({lowUsageMode:true}); const original=web.getWindow('resident-0');
    for(let i=1;i<8;i++)web.getWindow('resident-'+i);
    assert.throws(()=>web.getWindow('resident-8'),e=>e.code==='resource');
    assert.equal(original.isDestroyed(),false);
  });
  await test('discard releases in-flight selection and permits reuse', async () => {
    web = new WebSources({lowUsageMode:true}); const selected=web.pick(base+'/', 'discard').catch(e=>{assert.ok(['cancelled','locator'].includes(e.code));return null;});
    await sleep(180); await web.discard('discard');
    await Promise.race([selected.catch(e=>assert.ok(['cancelled','locator'].includes(e.code))),sleep(500).then(()=>{throw Error('selection not released');})]);
    assert.equal(web.picking.has('discard'),false);
    assert.equal((await web.collect(source('discard'))).value,'42');
  });
  await test('AbortSignal releases a hanging DOM read', async () => {
    web = new WebSources({lowUsageMode:true}); const config=source('cancel'); await web.collect(config);
    const window=web.windows.get('cancel');
    // A promise instead of renderer CPU work safely models a stuck IPC execution.
    window.webContents.executeJavaScript=()=>new Promise(()=>{});
    const controller=new AbortController(); const result=web.collect(config,{signal:controller.signal});
    setTimeout(()=>controller.abort(),30);
    await Promise.race([assert.rejects(result,e=>['cancelled','ABORT_ERR'].includes(e.code)||e.name==='AbortError'),sleep(500).then(()=>{throw Error('read not cancelled');})]);
    assert.equal(window.isDestroyed(),true);
  });
  await test('selection timeout destroys its page and removes handlers', async () => {
    web = new WebSources({lowUsageMode:true}); web.pickTimeoutMs=120;
    await assert.rejects(web.pick(base+'/', 'pick-timeout'),/超时/);
    assert.equal(web.windows.has('pick-timeout'),false);
    assert.equal(web.picking.has('pick-timeout'),false);
  });
  await test('paused session rejects background requests but preserves login', async () => {
    web = new WebSources({lowUsageMode:true}); const win=web.getWindow('paused'); const profile=win.webContents.session;
    await profile.cookies.set({url:base,name:'fixture',value:'fake-login'});
    await web.navigate(win,base+'/polling'); await sleep(230); assert.ok(polls>=1);
    await web.close('paused'); const before=polls; await sleep(250); assert.equal(polls,before);
    await assert.rejects(profile.fetch(base+'/poll'));
    assert.equal((await profile.cookies.get({name:'fixture'}))[0].value,'fake-login');
    await web.clear('paused'); assert.equal((await profile.cookies.get({name:'fixture'})).length,0);
  });
  await test('declared oversized responses stop source with resource failure', async () => {
    web = new WebSources({lowUsageMode:true,maxResponseBytes:4096});
    await assert.rejects(web.collect({...source('large'),url:base+'/large'}),e=>e.code==='resource');
    assert.equal(web.windows.has('large'),false);
  });
  await test('rolling request limit stops small background polling', async () => {
    web = new WebSources({lowUsageMode:true,requestLimit:4,requestWindowMs:1000});
    const window=web.getWindow('rate'); await web.navigate(window,base+'/polling');
    await sleep(650); assert.equal(window.isDestroyed(),true);
    await assert.rejects(web.collect({...source('rate'),url:base+'/polling'}),e=>e.code==='resource');
  });
  await test('chunked responses enforce received byte limit',async()=>{
    web=new WebSources({lowUsageMode:true,maxResponseBytes:4096});
    await assert.rejects(web.collect({...source('chunked'),url:base+'/chunked'}),e=>e.code==='resource');
    assert.equal(web.windows.has('chunked'),false);
  });
  await test('prolonged renderer CPU stops only offender and retains readable cooldown',async()=>{
    web=new WebSources({lowUsageMode:true});const win=web.getWindow('cpu'),other=web.getWindow('other');
    await web.navigate(win,base+'/');await web.navigate(other,base+'/');
    const metrics=[{pid:win.webContents.getOSProcessId(),cpu:{percentCPUUsage:80},memory:{workingSetSize:1024}}];
    for(let i=0;i<3;i++)web.checkResources(metrics);
    assert.equal(win.isDestroyed(),true);assert.equal(other.isDestroyed(),false);
    await assert.rejects(web.collect(source('cpu')),e=>e.code==='resource');
  });
  await test('received byte accounting enforces aggregate budget across sources',async()=>{
    web=new WebSources({lowUsageMode:true,maxTotalBytes:4000});
    assert.equal((await web.collect({...source('total-first'),url:base+'/medium'})).value,'42');
    await assert.rejects(web.collect({...source('total-second'),url:base+'/medium'}),e=>e.code==='resource');
    assert.equal(web.windows.has('total-first'),true);assert.equal(web.windows.has('total-second'),false);
  });
  await test('synthetic aggregate renderer memory budget stops largest source',async()=>{
    web=new WebSources({lowUsageMode:true,maxTotalRendererMemoryKiB:300000});
    const largest=web.getWindow('memory-large'),smaller=web.getWindow('memory-small');
    await web.navigate(largest,base+'/');await web.navigate(smaller,base+'/');
    web.checkResources([{pid:largest.webContents.getOSProcessId(),memory:{workingSetSize:200000}},{pid:smaller.webContents.getOSProcessId(),memory:{workingSetSize:150000}}]);
    assert.equal(largest.isDestroyed(),true);assert.equal(smaller.isDestroyed(),false);
  });
  await test('pause unregisters its worker and keeps local login data',async()=>{
    web=new WebSources({lowUsageMode:true});const win=web.getWindow('worker'),profile=win.webContents.session;
    await web.navigate(win,base+'/');
    await win.webContents.executeJavaScript('localStorage.setItem("login","fake");navigator.serviceWorker.register("/worker.js").then(()=>true)');
    await sleep(220);assert.ok(Object.keys(profile.serviceWorkers.getAllRunning()).length>0);
    await web.close('worker');await sleep(120);
    assert.equal(Object.keys(profile.serviceWorkers.getAllRunning()).length,0);
    const revived=web.getWindow('worker');await web.navigate(revived,base+'/');
    assert.equal(await revived.webContents.executeJavaScript('localStorage.getItem("login")'),'fake');
  });
  await test('worker chunked responses are included in source byte protection',async()=>{
    web=new WebSources({lowUsageMode:true,maxResponseBytes:4096});const win=web.getWindow('byte-worker');
    await web.navigate(win,base+'/');
    await win.webContents.executeJavaScript('navigator.serviceWorker.register("/byte-worker.js").then(()=>true)');
    await sleep(550);assert.equal(win.isDestroyed(),true);
    await assert.rejects(web.collect(source('byte-worker')),e=>e.code==='resource');
  });
  await test('WebSocket received frames count toward source byte protection',async()=>{
    web=new WebSources({lowUsageMode:true,maxResponseBytes:4096});const win=web.getWindow('socket');
    await web.navigate(win,base+'/');
    await win.webContents.executeJavaScript(`window.fixtureSocket=new WebSocket(${JSON.stringify(base.replace('http:','ws:')+'/socket')});true`);
    await sleep(300);assert.equal(win.isDestroyed(),true);
    await assert.rejects(web.collect(source('socket')),e=>e.code==='resource');
  });
  await test('small collection batch runs at most two browser reads and queued cancellation never starts',async()=>{
    web=new WebSources({lowUsageMode:true});let active=0,peak=0,started=[];
    web.read=async (config,signal)=>{
      const {bounded}=await import(pathToFileURL(join(resolve(__dirname,'..'),'desktop/web-limits.js')).href);
      started.push(config.id);active++;peak=Math.max(peak,active);
      try{await bounded(()=>sleep(100),{signal});return {value:'42'};}finally{active--;}
    };
    const controller=new AbortController();
    const requests=[web.collect(source('queue-a')),web.collect(source('queue-b')),web.collect(source('queue-c'),{signal:controller.signal}).catch(e=>assert.equal(e.code,'cancelled')),web.collect(source('queue-d'))];
    setTimeout(()=>controller.abort(),30);await Promise.all(requests);
    assert.equal(peak,2);assert.equal(started.includes('queue-c'),false);assert.equal(web.jobs.pending.size,0);
  });
  await test('startup orphan cleanup excludes saved/unrelated directories and junction targets',async()=>{
    web=new WebSources({lowUsageMode:true});const base=join(process.argv[2],'orphan-fixture'),partitions=join(base,'Partitions'),outside=join(base,'outside');
    for(const path of [join(partitions,'source-saved'),join(partitions,'source-orphan'),join(partitions,'other-profile'),outside])await mkdir(path,{recursive:true});
    await writeFile(join(outside,'keep.txt'),'fixture');await symlink(outside,join(partitions,'source-link'),'junction');
    const removed=await web.cleanupOrphans(['saved'],base);assert.deepEqual(removed,['orphan']);
    await access(join(partitions,'source-saved'));await access(join(partitions,'other-profile'));await access(join(outside,'keep.txt'));
    await assert.rejects(access(join(partitions,'source-orphan')));
  });
  await test('renderer fault cancels active DOM read without waiting for timeout',async()=>{
    web=new WebSources({lowUsageMode:true}); const config=source('fault'); await web.collect(config); const win=web.windows.get(config.id);
    win.webContents.executeJavaScript=()=>new Promise(()=>{});
    const reading=web.collect(config);setTimeout(()=>win.webContents.emit('render-process-gone',{}, {reason:'crashed'}),20);
    await Promise.race([assert.rejects(reading,e=>e.code==='network'),sleep(500).then(()=>{throw Error('fault did not release read');})]);
    assert.equal(win.isDestroyed(),true);
  });
  await test('stalled cache clearing is bounded and releases its page',async()=>{
    web=new WebSources({lowUsageMode:true});web.readTimeoutMs=50;
    const win=web.getWindow('cache-hang'),profile=win.webContents.session,original=profile.clearCache;
    profile.clearCache=()=>new Promise(()=>{});
    try{await assert.rejects(web.collect(source('cache-hang')),e=>e.code==='network');assert.equal(win.isDestroyed(),true);}
    finally{profile.clearCache=original;}
  });
  await test('navigation timeout stops source window and permits fresh retry',async()=>{
    web=new WebSources({lowUsageMode:true});web.navigationTimeoutMs=50;
    await assert.rejects(web.collect({...source('nav-hang'),url:base+'/hang'}),e=>e.code==='network');
    assert.equal(web.windows.has('nav-hang'),false);
    web.navigationTimeoutMs=2000;assert.equal((await web.collect(source('nav-hang'))).value,'42');
  });
  await test('picker reinstallation removes old page handlers and native close cancels normally',async()=>{
    web=new WebSources({lowUsageMode:true});const win=web.getWindow('repeat-picker');await web.navigate(win,base+'/');
    const {pickerScript}=await import(pathToFileURL(join(resolve(__dirname,'..'),'desktop/picker.js')).href);
    const first=win.webContents.executeJavaScript(pickerScript());await sleep(30);
    const second=win.webContents.executeJavaScript(pickerScript());await sleep(30);
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#__my_monitor_picker__").length'),1);
    await win.webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}));true');
    assert.equal(await first,null);assert.equal(await second,null);
    const native=web.pick(base+'/','repeat-picker');await sleep(40);win.destroy();assert.equal(await native,null);
  });
  await test('loss of byte protection stops a live page and retains resource cooldown',async()=>{
    web=new WebSources({lowUsageMode:true});const win=web.getWindow('detach');await web.navigate(win,base+'/');
    win.webContents.debugger.detach();await sleep(30);
    assert.equal(win.isDestroyed(),true);await assert.rejects(web.collect(source('detach')),e=>e.code==='resource');
  });
  await test('temporary profile lifetime cap rejects new identities and unknown closes retain no metadata',async()=>{
    web=new WebSources({lowUsageMode:true,maxProfiles:2});
    web.getWindow('profile-one');await web.discard('profile-one');
    web.getWindow('profile-two');await web.discard('profile-two');
    await assert.rejects(web.collect(source('profile-three')),e=>e.code==='resource'&&/重启/.test(e.message));
    assert.throws(()=>web.getWindow('profile-four'),e=>e.code==='resource');
    const count=web.epochs.size;
    for(const id of ['unknown-fixed-one','unknown-fixed-two','unknown-fixed-three'])await web.close(id);
    assert.equal(web.profiles.size,2);assert.equal(web.epochs.size,count);assert.equal(web.tasks.size,0);
    assert.equal(web.resourceErrors.size,0);
  });
  await test('aborted orphan cleanup never deletes owned partition directories',async()=>{
    web=new WebSources({lowUsageMode:true});const base=join(process.argv[2],'abort-orphans');
    await mkdir(join(base,'Partitions','source-keep'),{recursive:true});
    const controller=new AbortController();controller.abort();
    await assert.rejects(web.cleanupOrphans([],base,{signal:controller.signal}),e=>e.code==='cancelled'||e.name==='AbortError');
    await access(join(base,'Partitions','source-keep'));
  });
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{
  clearTimeout(guard);await web?.closeAll();for(const socket of sockets)socket.destroy(); if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  app.exit(process.exitCode||0);
});

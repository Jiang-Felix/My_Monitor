import assert from 'node:assert/strict';
import http from 'node:http';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){if(await predicate())return;await sleep(40);}
  throw new Error(`Timeout: ${label}`);
}
export async function runPickerCloseSmoke({mainWindow,web}){
  const failures=[],handle=failure=>failures.push(failure);
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html;charset=utf-8');
    const send=()=>res.end('<button id="page-action" style="position:fixed;right:30px;top:25px">页面操作</button><p id="value">42 GB</p><script>window.pageClicks=0;document.querySelector("#page-action").onclick=()=>{window.pageClicks++;location.hash="website-page";};document.addEventListener("click",event=>{if(event.target.id==="__my_monitor_picker__")location.hash="panel-click";});</script>');
    if(req.url==='/slow')setTimeout(send,1200);else send();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  let id;
  process.on('uncaughtException',handle);
  try{
    await run('document.querySelector("#add-button").click();true');
    assert.equal(await run('document.querySelector("[data-kind=http]").getClientRects().length'),0,'HTTP tab hidden outside test mode');
    await run('document.querySelector("#source-dialog").close();document.querySelector("#test-mode-toggle").click();document.querySelector("#add-button").click();true');
    assert.equal(await run('document.querySelector("[data-kind=http]").disabled'),false);
    assert.equal(await run('!!document.querySelector("[data-kind=fixed]")'),false);
    await run('document.querySelector("[data-kind=http]").click();true');
    assert.equal(await run('document.querySelector("#http-fields").hidden'),false,'HTTP tab is selectable');
    assert.equal(await run('document.querySelector("[data-kind=http]").classList.contains("selected")'),true);
    await run('document.querySelector("#source-dialog").close();document.querySelector("#test-mode-toggle").click();true');
    await run(`document.querySelector('#add-button').click();document.querySelector('[data-kind=web]').click();document.querySelector('[name=url]').value=${JSON.stringify(base+'/ready')};document.querySelector('#pick-value').click();true`);
    await until(()=>[...web.windows.values()].some(w=>!w.isDestroyed()),'picker window opens');
    id=[...web.picking][0];
    await until(()=>web.windows.get(id)?.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'),'picker installed');
    web.windows.get(id).close();await sleep(120);
    assert.equal(failures.length,0,`closing picker must not throw: ${failures[0]?.message}`);
    await until(()=>run('!document.querySelector("#pick-value").disabled'),'capture button enabled after close');
    assert.equal(web.picking.has(id),false);assert.equal(await run('document.querySelector("#form-error").textContent'),'');
    await run(`document.querySelector('[name=url]').value=${JSON.stringify(base+'/slow')};document.querySelector('#pick-value').click();true`);
    await until(()=>web.windows.get(id)&&!web.windows.get(id).isDestroyed(),'picker reopens while loading');
    web.windows.get(id).close();
    await until(()=>run('!document.querySelector("#pick-value").disabled'),'cancel during loading releases capture button');
    assert.equal(await run('document.querySelector("#form-error").textContent'),'','native close during loading is a normal cancellation');
    await run(`document.querySelector('[name=url]').value=${JSON.stringify(base+'/ready')};document.querySelector('#pick-value').click();true`);
    await until(()=>web.windows.get(id)?.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'),'picker usable again');
    const remote=web.windows.get(id);remote.focus();
    await until(()=>remote.webContents.executeJavaScript('document.hasFocus()'),'picker focus');
    await remote.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const click=async(x,y)=>{
      for(const type of ['mouseDown','mouseUp'])remote.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
      await sleep(90);
    };
    let rect=await remote.webContents.executeJavaScript('document.querySelector("#__my_monitor_picker__").getBoundingClientRect().toJSON()');
    const original={...rect};
    remote.webContents.sendInputEvent({type:'mouseDown',x:Math.round(rect.x+80),y:Math.round(rect.y+22),button:'left',clickCount:1});
    remote.webContents.sendInputEvent({type:'mouseMove',x:Math.round(rect.x-300),y:Math.round(rect.y+160),movementX:-380,movementY:138});
    remote.webContents.sendInputEvent({type:'mouseUp',x:Math.round(rect.x-300),y:Math.round(rect.y+160),button:'left',clickCount:1});
    await sleep(100);rect=await remote.webContents.executeJavaScript('document.querySelector("#__my_monitor_picker__").getBoundingClientRect().toJSON()');
    assert.ok(rect.x<original.x-100&&rect.y>original.y+50,'picker instruction panel can be dragged away from website actions');
    const pageButton=await remote.webContents.executeJavaScript('document.querySelector("#page-action").getBoundingClientRect().toJSON()');await click(pageButton.x+20,pageButton.y+10);
    assert.equal(await remote.webContents.executeJavaScript('window.pageClicks'),1,'website remains interactive before capture begins');
    await click(rect.x+140,rect.bottom-36);
    await until(()=>remote.isDestroyed(),'cancel button destroys selection window');
    await until(()=>run('!document.querySelector("#pick-value").disabled'),'cancel button releases capture');assert.equal(web.picking.has(id),false);
    await run('document.querySelector("#pick-value").click();true');
    await until(()=>web.windows.get(id)?.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'),'reopen after cancel button');
    const next=web.windows.get(id);next.focus();
    await next.webContents.executeJavaScript('document.querySelector("#page-action").click();true');await sleep(80);
    rect=await next.webContents.executeJavaScript('document.querySelector("#__my_monitor_picker__").getBoundingClientRect().toJSON()');
    for(const type of ['mouseDown','mouseUp'])next.webContents.sendInputEvent({type,x:Math.round(rect.x+60),y:Math.round(rect.bottom-36),button:'left',clickCount:1});await sleep(100);
    const collapsed=await next.webContents.executeJavaScript('document.querySelector("#__my_monitor_picker__").getBoundingClientRect().toJSON()');assert.ok(collapsed.height<rect.height,'starting capture reduces obstruction by collapsing instructions');
    rect=await next.webContents.executeJavaScript('document.querySelector("#value").getBoundingClientRect().toJSON()');
    for(const type of ['mouseDown','mouseUp'])next.webContents.sendInputEvent({type,x:Math.round(rect.x+20),y:Math.round(rect.y+10),button:'left',clickCount:1});
    await until(()=>run('!document.querySelector("#pick-value").disabled'),'selection completes after cancellation');
    assert.equal(await run('document.querySelector("[name=selector]").value'),'#value');
    assert.match(await run('document.querySelector("#source-form [name=url]").value'),/#website-page$/,'SPA navigation keeps the selection promise valid');
    await run('document.querySelector("#pick-value").click();true');await until(()=>web.windows.get(id)?.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'),'reopen after SPA selection');
    const escapeWindow=web.windows.get(id);escapeWindow.show();escapeWindow.focus();await until(()=>escapeWindow.webContents.executeJavaScript('document.hasFocus()'),'Escape picker focus');
    for(const type of ['keyDown','keyUp'])escapeWindow.webContents.sendInputEvent({type,keyCode:'Escape'});
    await until(()=>escapeWindow.isDestroyed(),'Escape closes the selection window');await until(()=>run('!document.querySelector("#pick-value").disabled'),'Escape releases capture');
    assert.equal(failures.length,0);
    console.log('PASS picker close: ready/loading cancellation, draggable/collapsible instructions, website interaction, SPA selection/cancellation, cancel/Escape close window and release capture, successful reselection');
  }finally{
    if(id)await web.clear(id);
    await run('document.querySelector("#source-dialog").close();true');
    process.removeListener('uncaughtException',handle);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
}

import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {screen,BrowserWindow,nativeImage} from 'electron';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await sleep(30);}throw Error(`Timeout: ${label}`);}
export async function runFloatingStabilitySmoke({mainWindow,monitor,getFloating,root}) {
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  const invoke=async(name,data)=>{const result=await run(`window.monitor.${name}(${JSON.stringify(data)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const sources=Array.from({length:6},(_,index)=>({id:`stable-${index}`,name:`fixture ${index}`,kind:'fixed',fixedValue:40+index,fixedTotal:100,totalMode:'fixed',interval:1,unit:'GB'}));
  if(process.argv.includes('--plain-floating'))await invoke('floatingSettings',{barWidth:300,barHeight:20,showName:false,showPercent:false,showAmount:false,showDeltaValue:false,showDeltaBand:false,showSmooth:false});
  for(const source of sources){monitor.upsert(source);await monitor.refresh(source.id);}
  await invoke('floating',true);await until(()=>getFloating()?.isVisible(),'floating visible');
  const floating=getFloating(),native=code=>floating.webContents.executeJavaScript(code,true);
  await until(()=>native('document.querySelectorAll(".floating-row").length===6'),'six floating rows');
  await sleep(400);
  const calls=[],original=floating.setBounds;
  const messages=[],titleEvents=[];
  const onTitle=(_event,title)=>titleEvents.push(title);
  floating.on('page-title-updated',onTitle);
  const watched={setText:0x000c,size:0x0005,positionChanging:0x0046,positionChanged:0x0047,nonClientSize:0x0083,nonClientPaint:0x0085,styleChanged:0x007d};
  if(process.platform==='win32')for(const [name,message] of Object.entries(watched))floating.hookWindowMessage(message,()=>messages.push({name,bounds:floating.getBounds()}));
  floating.setBounds=function(bounds,...args){calls.push(bounds);return original.call(this,bounds,...args);};
  await native('window.__rowMoves=0;window.__rowObserver=new MutationObserver(list=>{window.__rowMoves+=list.reduce((n,item)=>n+item.addedNodes.length+item.removedNodes.length,0);});window.__rowObserver.observe(document.querySelector("#floating-rows"),{childList:true});true');
  const samples=[];
  try{
    for(let index=0;index<24;index++){
      const source=sources[index%6];monitor.upsert({...source,fixedValue:40+(index%3)*12});await monitor.refresh(source.id);
      await sleep(100);
      const geometry=await native('(()=>{const panel=document.querySelector(".floating-panel").getBoundingClientRect();return {width:innerWidth,height:innerHeight,panelBottom:panel.bottom,panelHeight:panel.height,scrollTop:document.querySelector("#floating-rows").scrollTop}})()');
      const picture=await floating.webContents.capturePage(),size=picture.getSize(),pixels=picture.toBitmap();
      const stripHeight=Math.ceil(12*size.height/geometry.height),edge=pixels.subarray((size.height-stripHeight)*size.width*4);
      samples.push({bounds:floating.getBounds(),geometry,edge:createHash('sha256').update(edge).digest('hex')});
    }
    const report={displays:screen.getAllDisplays().map(display=>({scaleFactor:display.scaleFactor,workArea:display.workArea})),calls,samples,messages,titleEvents,rowMoves:await native('window.__rowMoves')};
    await mkdir(join(root,'artifacts','floating-stability'),{recursive:true});
    await writeFile(join(root,'artifacts','floating-stability','report.json'),JSON.stringify(report,null,2));
    console.log('Floating stability diagnostic:',JSON.stringify({scales:report.displays.map(d=>d.scaleFactor),resizeCalls:calls.length,bounds:new Set(samples.map(sample=>JSON.stringify(sample.bounds))).size,geometry:new Set(samples.map(sample=>JSON.stringify(sample.geometry))).size,edges:new Set(samples.map(sample=>sample.edge)).size,rowMoves:report.rowMoves}));
    console.log('Native update diagnostic:',JSON.stringify({titleEvents:titleEvents.length,messages:Object.fromEntries(Object.keys(watched).map(name=>[name,messages.filter(m=>m.name===name).length]))}));
    assert.equal(calls.length,0,'numeric updates must not resize the native window');
    assert.equal(new Set(samples.map(sample=>JSON.stringify(sample.bounds))).size,1,'native bounds must stay fixed');
    assert.equal(new Set(samples.map(sample=>JSON.stringify(sample.geometry))).size,1,'panel dimensions must stay fixed');
    assert.equal(new Set(samples.map(sample=>sample.edge)).size,1,'bottom-edge pixels must stay fixed while progress animates');
    assert.equal(report.rowMoves,0,'value updates must keep progress rows attached in place');
    if(process.argv.includes('--native-edge-probe'))await probeNativeEdge({floating,monitor,sources,root});
    // One-pixel slider steps must resize once, but subsequent data updates must
    // not start the coupled width/height rounding loop again.
    for(const settings of [
      {barWidth:301,barHeight:21,showName:false,showPercent:false,showAmount:false,showDeltaValue:false,showDeltaBand:false,showSmooth:false},
      {barWidth:410,barHeight:4,showName:false,showPercent:false,showAmount:false,showDeltaValue:false,showDeltaBand:false,showSmooth:false},
      {barWidth:300,barHeight:20},
    ]){
      const before=floating.getBounds();await invoke('floatingSettings',settings);await sleep(200);
      const settled=floating.getBounds(),callCount=calls.length;
      assert.notDeepEqual(settled,before,'a real layout change still adjusts the native window');
      for(let update=0;update<3;update++){await monitor.refresh(sources[0].id);await sleep(100);}
      assert.deepEqual(floating.getBounds(),settled,'updated layouts retain their native size during numeric updates');
      assert.equal(calls.length,callCount,'new layouts do not keep correcting native rounding');
    }
    await native('window.__stableRow=document.querySelector("[data-id=stable-1]").parentElement;true');
    monitor.remove(sources[0].id);
    await until(()=>native('document.querySelectorAll(".floating-row").length===5'),'remove a row');
    assert.equal(await native('document.querySelector(".floating-row")===window.__stableRow'),true,'remaining rows retain their identity and order');
    monitor.upsert(sources[0]);await monitor.refresh(sources[0].id);
    await until(()=>native('document.querySelectorAll(".floating-row").length===6'),'append a new row');
    assert.equal(await native('document.querySelector(".floating-row:last-child .floating-track").dataset.id'),'stable-0','new sources append in source order');
    for(const source of sources)monitor.remove(source.id);
    await until(()=>native('!!document.querySelector(".floating-placeholder")'),'empty placeholder');
    await native('window.__stablePlaceholder=document.querySelector(".floating-placeholder");true');
    monitor.notify();await sleep(150);
    assert.equal(await native('document.querySelector(".floating-placeholder")===window.__stablePlaceholder'),true,'empty updates also keep the placeholder attached');
    monitor.upsert(sources[0]);await monitor.refresh(sources[0].id);
    await until(()=>native('document.querySelectorAll(".floating-row").length===1&&!document.querySelector(".floating-placeholder")'),'first row replaces placeholder');
    console.log('PASS floating boundary remains stable during repeated numeric updates and smooth animations');
  }finally{floating.setBounds=original;floating.removeListener('page-title-updated',onTitle);if(process.platform==='win32')for(const message of Object.values(watched))floating.unhookWindowMessage(message);await invoke('floating',false);}
}

async function probeNativeEdge({floating,monitor,sources,root}) {
  const area=screen.getDisplayMatching(floating.getBounds()).workArea,bounds=floating.getBounds();
  const back=new BrowserWindow({x:area.x+20,y:area.y+20,width:bounds.width+40,height:bounds.height+40,frame:false,show:false,backgroundColor:'#156abc'});
  try{
    await back.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;height:100vh;background:#156abc"></body>'));
    back.setAlwaysOnTop(true,'screen-saver');back.show();back.focus();back.moveTop();
    floating.setPosition(area.x+40,area.y+40);floating.setAlwaysOnTop(true,'screen-saver');floating.moveTop();await sleep(350);
    const rect=screen.dipToScreenRect(floating,floating.getBounds()),directory=join(root,'artifacts','floating-stability');
    // Only our floating fixture, fully covered by its blue backdrop, is captured.
    const x=rect.x,y=rect.y,width=rect.width,height=rect.height,frames=120;
    const capture=execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      `Add-Type -AssemblyName System.Drawing;$image=New-Object System.Drawing.Bitmap(${width},${height});$graphics=[System.Drawing.Graphics]::FromImage($image);try{for($frame=0;$frame -lt ${frames};$frame++){$graphics.CopyFromScreen(${x},${y},0,0,$image.Size);$image.Save((Join-Path '${directory.replaceAll("'","''")}' ("native-edge-"+$frame+".png")),[System.Drawing.Imaging.ImageFormat]::Png);Start-Sleep -Milliseconds 10}}finally{$graphics.Dispose();$image.Dispose()}`],{windowsHide:true,timeout:15000});
    for(let index=0;index<60;index++){
      const source=sources[index%6];monitor.upsert({...source,fixedValue:20+(index%4)*15});await monitor.refresh(source.id);await sleep(75);
    }
    await capture;
    const hashes=[];
    for(let frame=0;frame<frames;frame++){
      const bitmap=nativeImage.createFromPath(join(directory,`native-edge-${frame}.png`)).toBitmap(),hash=createHash('sha256');
      // Hash the whole exterior on all four sides, leaving changing bars/text out.
      const edge=Math.floor(20*rect.width/bounds.width);
      for(let row=0;row<height;row++){
        const start=row*width*4,end=start+width*4;
        if(row<edge||row>=height-edge)hash.update(bitmap.subarray(start,end));
        else {hash.update(bitmap.subarray(start,start+edge*4));hash.update(bitmap.subarray(end-edge*4,end));}
      }
      hashes.push(hash.digest('hex'));
    }
    await writeFile(join(directory,'native-edges.json'),JSON.stringify({rect,strip:{x,y,width,height},hashes},null,2));
    console.log('Native desktop edge diagnostic:',JSON.stringify({frames:hashes.length,distinctEdges:new Set(hashes).size}));
    assert.equal(new Set(hashes).size,1,'actual Windows desktop boundaries stay stable during updates and animations');
  }finally{back.destroy();floating.setAlwaysOnTop(true,'pop-up-menu');}
}

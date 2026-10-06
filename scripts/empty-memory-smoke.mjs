import assert from 'node:assert/strict';
import {app} from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runEmptyMemorySmoke({mainWindow,monitor,root,showMain,getMain}){
  const report=[];
  const run=code=>mainWindow.webContents.executeJavaScript(code,true);
  async function capture(label){
    await sleep(1800);
    const processes=app.getAppMetrics().map(m=>({type:m.type,pid:m.pid,privateMiB:m.memory.privateBytes/1024,workingMiB:m.memory.workingSetSize/1024}));
    const item={label,privateMiB:processes.reduce((n,m)=>n+m.privateMiB,0),workingMiB:processes.reduce((n,m)=>n+m.workingMiB,0),processes};report.push(item);console.log(JSON.stringify(item));
  }
  for(let i=0;i<100&&!await run('!!document.querySelector("#empty-add")');i++)await sleep(50);
  assert.equal(monitor.sources.size,0);
  await run('window.monitor.floating(false)');mainWindow.show();await capture('empty-visible');
  mainWindow.hide();if(process.argv.includes('--real-idle-delay'))await sleep(16000);await capture('empty-hidden');
  if(process.argv.includes('--real-idle-delay')){
    assert.equal(mainWindow.isDestroyed(),true,'production 15-second delay releases the idle dashboard');
    showMain();mainWindow=getMain();await sleep(700);assert.equal(await run('!!document.querySelector("#empty-add")'),true);
    await mkdir(join(root,'artifacts','memory'),{recursive:true});await writeFile(join(root,'artifacts','memory','empty-real-delay.json'),JSON.stringify(report,null,2));
    console.log('PASS production 15-second standby delay and reopening');return;
  }
  if(process.argv.includes('--empty-memory-check')){
    assert.equal(mainWindow.isDestroyed(),true,'clean empty dashboard releases its renderer while in the tray');
    showMain();mainWindow=getMain();
    for(let i=0;i<100&&!await run('!!window.dashboardLifecycle');i++)await sleep(50);
    await run('document.querySelector("[data-page=settings]").click();document.querySelector("#test-mode-toggle").click();true');
    mainWindow.setBounds({x:90,y:90,width:1100,height:750});const geometry=mainWindow.getBounds();mainWindow.hide();await sleep(2200);
    assert.equal(mainWindow.isDestroyed(),true);showMain();mainWindow=getMain();await sleep(700);
    assert.equal(await run('document.querySelector("[data-page=settings]").classList.contains("active")'),true);
    assert.equal(await run('document.body.classList.contains("test-mode")'),true);
    for(let i=0;i<3;i++){
      for(const key of Object.keys(geometry))assert.ok(Math.abs(mainWindow.getBounds()[key]-geometry[key])<=3,'window placement stays within native DPI rounding');
      mainWindow.hide();await sleep(2200);showMain();mainWindow=getMain();await sleep(700);
    }
    await run('document.querySelector("#add-button").click();document.querySelector("#source-form").elements.name.value="Preserve draft";true');
    mainWindow.hide();await sleep(2200);assert.equal(mainWindow.isDestroyed(),false,'an unfinished source editor remains resident');
    showMain();assert.equal(await run('document.querySelector("#source-form").elements.name.value'),'Preserve draft');
    await run('document.querySelector("#cancel-dialog").click();document.querySelector("[data-page=floating]").click();document.querySelector("#floating-settings").elements.barWidth.value=310;document.querySelector("#floating-settings").dispatchEvent(new Event("input"));true');
    mainWindow.hide();await sleep(2200);assert.equal(mainWindow.isDestroyed(),false,'unsaved floating settings remain resident');
    showMain();await run('document.querySelector("#floating-reset").click();true');await sleep(400);
    await run('window.monitor.save({id:"idle-paused",name:"Stopped",kind:"fixed",fixedValue:10,totalMode:"none",interval:60,enabled:false})');
    mainWindow.hide();await sleep(2200);assert.equal(mainWindow.isDestroyed(),true,'all manually paused sources also allow standby reclamation');
    showMain();mainWindow=getMain();await sleep(700);
    assert.equal(await run('document.querySelectorAll("#cards [data-id]").length'),1,'paused data still renders after reopening');
    console.log('PASS empty idle: renderer released, page/mode/geometry restored, source and floating drafts retained');
    await mkdir(join(root,'artifacts','memory'),{recursive:true});await writeFile(join(root,'artifacts','memory','empty-optimized.json'),JSON.stringify(report,null,2));return;
  }
  if(!mainWindow.isDestroyed())mainWindow.destroy();await capture('empty-renderer-destroyed');await sleep(12000);await capture('empty-renderer-destroyed-settled');
  await mkdir(join(root,'artifacts','memory'),{recursive:true});await writeFile(join(root,'artifacts','memory','empty-baseline.json'),JSON.stringify(report,null,2));
}

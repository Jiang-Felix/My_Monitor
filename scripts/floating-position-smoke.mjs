import assert from 'node:assert/strict';
import { app,screen } from 'electron';
import { readFile,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const deadline=Date.now()+6000;while(Date.now()<deadline){if(await predicate())return;await sleep(40);}throw new Error(`Timeout: ${label}`);}
export async function runFloatingPositionSmoke({mainWindow,getFloating,persist}){
  const invoke=async(method,input)=>{const result=await mainWindow.webContents.executeJavaScript(`window.monitor.${method}(${JSON.stringify(input)})`);assert.equal(result.ok,true,result.error);return result.data;};
  const toggle=async(open)=>{const result=await mainWindow.webContents.executeJavaScript(`window.monitor.floating(${open})`);assert.equal(result.ok,true,result.error);};
  const stateFile=join(app.getPath('userData'),'monitor-state.json'),probe=join(app.getPath('userData'),'position-probe.json');
  await toggle(true);await until(()=>getFloating()?.isVisible(),'floating opens');
  if(process.argv.includes('--position-write')){
    const source={id:'restart-source',name:'停止图表恢复',kind:'fixed',fixedValue:10,interval:60};
    const rule={id:'restart-rule',name:'停止图表',sourceId:source.id,type:'delta',lower:-5,upper:5,updateEvery:1};
    await invoke('save',source);await invoke('alertSave',rule);await invoke('refresh',source.id);
    await invoke('save',{...source,fixedValue:16});
    await until(async()=>(await invoke('snapshot')).alerts.tracking[0]?.measurement===6,'outside measurement before stopping');
    await invoke('alertSave',{...rule,enabled:false});
    await writeFile(join(app.getPath('userData'),'stopped-alert-probe.json'),JSON.stringify((await invoke('snapshot')).alerts.tracking[0].points));
    const area=screen.getPrimaryDisplay().workArea,window=getFloating();
    window.setPosition(area.x+160,area.y+180);window.emit('moved');await sleep(150);
    const {x,y}=window.getBounds();await writeFile(probe,JSON.stringify({x,y}));
    await toggle(false);await persist(true);
    assert.deepEqual(JSON.parse(await readFile(stateFile,'utf8')).floatingPosition,{x,y});
    await toggle(true);await until(()=>getFloating()?.isVisible(),'same-session floating reopens');
    const restored=getFloating().getBounds();assert.ok(Math.abs(restored.x-x)<=1&&Math.abs(restored.y-y)<=1);
    // Move again while the float is open, then let the actual app before-quit hook save it.
    getFloating().setPosition(area.x+210,area.y+230);getFloating().emit('moved');
    const final=getFloating().getBounds();await writeFile(probe,JSON.stringify({x:final.x,y:final.y}));
    console.log('PASS floating position: native movement, close/reopen and local position persistence; exiting for restart');
  }else{
    const state=await invoke('snapshot'),frozen=state.alerts.tracking.find(track=>track.ruleId==='restart-rule');
    assert.deepEqual(frozen.points,JSON.parse(await readFile(join(app.getPath('userData'),'stopped-alert-probe.json'),'utf8')));
    assert.equal(frozen.outside,true);assert.equal(state.alerts.rules.find(rule=>rule.id==='restart-rule').enabled,false);
    await mainWindow.webContents.executeJavaScript('document.querySelector("[data-page=alarms]").click();document.querySelector(".alert-chart-detail").open=true;true');
    await until(()=>mainWindow.webContents.executeJavaScript('!!document.querySelector(".chart-bar")'),'frozen plot visible after restart');
    assert.match(await mainWindow.webContents.executeJavaScript('document.querySelector(".range-state").textContent'),/超出范围/);
    console.log('PASS stopped alert: actual process shutdown and restart preserves the frozen graph and outside state');
    const expected=JSON.parse(await readFile(probe,'utf8')),actual=getFloating().getBounds();
    assert.ok(Math.abs(actual.x-expected.x)<=1&&Math.abs(actual.y-expected.y)<=1,`floating restores across process restart: ${JSON.stringify({expected,actual})}`);
    assert.deepEqual(JSON.parse(await readFile(stateFile,'utf8')).floatingPosition,expected,'shutdown saved the last open floating position');
    console.log('PASS floating position: actual process shutdown and restart restores the last open-window coordinates');
  }
}

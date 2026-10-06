import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TrayInteractions,systemDoubleClickTime} from '../desktop/tray-interactions.js';

function fixture(settings={traySingleClick:true,trayDoubleClick:true}){
  let now=0,nextId=0,open=false;const jobs=new Map(),events=new EventEmitter(),calls=[];
  const controls=new TrayInteractions(events,{getSettings:()=>settings,toggleFloating:()=>{const before=open;open=!open;calls.push('floating');return()=>{open=before;calls.push('restore');};},showMain:()=>calls.push('main'),doubleClickTime:600,now:()=>now,setTimer:(fn,delay)=>{const id=++nextId;jobs.set(id,{fn,time:now+delay});return id;},clearTimer:id=>jobs.delete(id)});
  const tick=ms=>{now+=ms;for(const [id,job] of jobs)if(job.time<=now){jobs.delete(id);job.fn();}};
  return {events,calls,controls,tick,settings,get open(){return open;}};
}
test('tray single click responds within 300 ms while a second deliberate click can still toggle',()=>{
  const f=fixture();f.events.emit('click');f.tick(299);assert.deepEqual(f.calls,[]);f.tick(1);assert.deepEqual(f.calls,['floating']);
  f.tick(650);f.events.emit('click');f.tick(300);assert.deepEqual(f.calls,['floating','floating']);
});
test('tray double click cancels single clicks before and after its native event',()=>{
  for(const trailingClick of [false,true]){
    const f=fixture();f.events.emit('click');f.tick(550);f.events.emit('click');f.events.emit('double-click');if(trailingClick)f.events.emit('click');f.tick(700);assert.deepEqual(f.calls,['floating','restore','main']);assert.equal(f.open,false);
    f.events.emit('click');f.tick(700);assert.deepEqual(f.calls,['floating','restore','main','floating']);
  }
});
test('a slower OS-recognized double click restores the prior floating state and opens the main window',()=>{
  const f=fixture();f.events.emit('click');f.tick(300);assert.equal(f.open,true);
  f.tick(150);f.events.emit('click');f.events.emit('double-click');f.events.emit('click');f.tick(500);
  assert.equal(f.open,false);assert.deepEqual(f.calls,['floating','restore','main']);
  f.events.emit('click');f.tick(300);assert.equal(f.open,true);
});
test('each tray gesture can be disabled independently, including a disabled double click with singles enabled',()=>{
  for(const single of [true,false])for(const double of [true,false]){
    const f=fixture({traySingleClick:single,trayDoubleClick:double});f.events.emit('click');f.tick(700);assert.deepEqual(f.calls,single?['floating']:[]);
    f.calls.length=0;f.events.emit('click');f.events.emit('double-click');f.tick(700);assert.deepEqual(f.calls,double?['main']:[]);
  }
});
test('settings changes, context menus and disposal prevent delayed tray actions',()=>{
  const f=fixture();f.events.emit('click');f.settings.traySingleClick=false;f.tick(700);assert.deepEqual(f.calls,[]);
  f.settings.traySingleClick=true;f.events.emit('click');f.events.emit('right-click');f.tick(700);assert.deepEqual(f.calls,[]);
  f.events.emit('click');f.controls.cancel();f.tick(700);assert.deepEqual(f.calls,[]);
  f.events.emit('click');f.controls.dispose();f.tick(700);f.events.emit('double-click');assert.deepEqual(f.calls,[]);assert.equal(f.events.listenerCount('click'),0);
});
test('Windows double-click timing is queried without a visible window and invalid native results fall back safely',()=>{
  let options;
  assert.equal(systemDoubleClickTime({platform:'win32',execute:(exe,args,opts)=>{assert.equal(exe,'powershell.exe');assert.ok(args.includes('-NonInteractive'));assert.ok(args.at(-1).includes('GetDoubleClickTime'));options=opts;return '900\r\n';}}),900);
  assert.equal(options.windowsHide,true);assert.ok(options.timeout<=5000);
  for(const execute of [()=>{throw new Error('unavailable');},()=>'-1',()=>'',()=>'5001',()=>'invalid'])assert.equal(systemDoubleClickTime({platform:'win32',execute}),500);
  assert.equal(systemDoubleClickTime({platform:'linux',execute:()=>{throw new Error('must not execute');}}),500);
});

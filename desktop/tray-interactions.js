import {execFileSync} from 'node:child_process';

// Query only the OS mouse timing; no registry or user preference is modified.
export function systemDoubleClickTime({platform=process.platform,execute=execFileSync}={}){
  if(platform!=='win32')return 500;
  try{
    const command='Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class MonitorMouseTiming { [DllImport("user32.dll")] public static extern uint GetDoubleClickTime(); }\'; [MonitorMouseTiming]::GetDoubleClickTime()';
    const value=Number(String(execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,encoding:'utf8',timeout:3000})).trim());
    if(Number.isInteger(value)&&value>=1&&value<=5000)return value;
  }catch{}
  return 500;
}

export class TrayInteractions{
  constructor(events,{getSettings,toggleFloating,showMain,doubleClickTime=500,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
    this.events=events;this.clearTimer=clearTimer;this.pending=null;this.suppressUntil=0;this.lastSingle=null;
    const systemWindow=Math.max(1,Math.min(5000,doubleClickTime)),delay=Math.min(300,systemWindow);
    this.click=()=>{
      if(now()<this.suppressUntil)return;
      this.cancel();
      if(!getSettings().traySingleClick)return;
      const clickedAt=now();
      this.pending=setTimer(()=>{
        this.pending=null;
        if(getSettings().traySingleClick)this.lastSingle={at:clickedAt+delay,restore:toggleFloating()};
      },delay);
    };
    this.doubleClick=()=>{
      this.cancel();this.suppressUntil=now()+100;
      // Respond quickly to singles; an OS-recognized slower double click can
      // still undo that action before opening the main window.
      const single=this.lastSingle;
      if(single && now()-single.at>=0 && now()-single.at<=systemWindow-delay+40 && typeof single.restore==='function')single.restore();
      this.lastSingle=null;
      if(getSettings().trayDoubleClick)showMain();
    };
    this.rightClick=()=>this.cancel();
    events.on('click',this.click);events.on('double-click',this.doubleClick);events.on('right-click',this.rightClick);
  }
  cancel(){if(this.pending!==null){this.clearTimer(this.pending);this.pending=null;}}
  dispose(){this.cancel();this.lastSingle=null;this.events.off('click',this.click);this.events.off('double-click',this.doubleClick);this.events.off('right-click',this.rightClick);}
}

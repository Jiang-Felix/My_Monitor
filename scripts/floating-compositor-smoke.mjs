import assert from 'node:assert/strict';
import {BrowserWindow,screen,nativeImage} from 'electron';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const execute=promisify(execFile),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// capturePage only captures Chromium's alpha surface, not the Windows compositor.
// Capture a small area entirely covered by our own synthetic backdrop instead.
export async function runFloatingCompositorSmoke({getFloating,settings,setSettings,root}){
  if(process.platform!=='win32')return;
  const initial=getFloating().getBounds(),area=screen.getPrimaryDisplay().workArea;
  const output=join(root,'artifacts');await mkdir(output,{recursive:true});
  const back=new BrowserWindow({x:area.x+20,y:area.y+20,width:initial.width+40,height:initial.height+40,frame:false,show:false,backgroundColor:'#156abc'});
  try{
    await back.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;height:100vh;background:#156abc"></body>'));
    for(const opacity of [.62,.2,.9]){
      await setSettings({...settings,backgroundOpacity:opacity});
      const samples=[];
      for(const [name,color,rgb] of [['blue','#156abc',[21,106,188]],['red','#ac261a',[172,38,26]]]){
        const floating=getFloating();
        floating.setPosition(area.x+40,area.y+40);
        const bounds=floating.getBounds();back.setSize(bounds.width+40,bounds.height+40);
        await back.webContents.executeJavaScript(`document.body.style.background=${JSON.stringify(color)}`);
        back.setAlwaysOnTop(true,'screen-saver');back.show();back.focus();back.moveTop();
        floating.setAlwaysOnTop(true,'screen-saver');floating.show();floating.moveTop();
        // Keep the floating window unfocused, as it normally is during desktop use.
        await sleep(450);
        const rect=screen.dipToScreenRect(floating,bounds);
        const file=join(output,`floating-compositor-${opacity}-${name}.png`);
        await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',
          `Add-Type -AssemblyName System.Drawing;$image=New-Object System.Drawing.Bitmap(${rect.width},${rect.height});$graphics=[System.Drawing.Graphics]::FromImage($image);try{$graphics.CopyFromScreen(${rect.x},${rect.y},0,0,$image.Size);$image.Save('${file.replaceAll("'","''")}',[System.Drawing.Imaging.ImageFormat]::Png)}finally{$graphics.Dispose();$image.Dispose()}`],{windowsHide:true,timeout:10000});
        const captured=nativeImage.createFromPath(file),bitmap=captured.toBitmap(),size=captured.getSize();
        const pixel=(x,y)=>{const index=(Math.floor(y*size.height/bounds.height)*size.width+Math.floor(x*size.width/bounds.width))*4;return [...bitmap.subarray(index,index+3)].reverse();};
        for(const [x,y] of [[2,2],[bounds.width-3,2],[2,bounds.height-3],[bounds.width-3,bounds.height-3]]){
          const corner=pixel(x,y);
          assert.ok(corner.every((c,i)=>Math.abs(c-rgb[i])<=3),`Native exterior must be transparent: ${name} ${corner}, expected ${rgb}`);
        }
        const track=await floating.webContents.executeJavaScript('(()=>{const r=document.querySelector(".floating-track").getBoundingClientRect();return {x:r.right-6,y:r.top+r.height/2}})()');
        samples.push({panel:pixel(18,bounds.height/2),track:pixel(track.x,track.y)});
      }
      for(let channel=0;channel<3;channel++){
        const expected=([172,38,26][channel]-[21,106,188][channel])*(1-opacity);
        const panel=samples[1].panel[channel]-samples[0].panel[channel];
        assert.ok(Math.abs(panel-expected)<=12,`Panel opacity ${opacity}: channel ${channel}, delta ${panel}, expected ${expected}`);
        const track=samples[1].track[channel]-samples[0].track[channel];
        assert.ok(Math.abs(track-expected*.52)<=12,`Track must preserve 48% tint: delta ${track}, expected ${expected*.52}`);
      }
    }
    console.log('PASS actual Windows desktop composite: transparent exterior on four corners, unfocused window, three panel opacities and translucent tracks');
  }finally{
    back.destroy();await setSettings(settings);
    if(getFloating()&&!getFloating().isDestroyed()){getFloating().setAlwaysOnTop(true,'pop-up-menu');getFloating().setBounds(initial);}
  }
}

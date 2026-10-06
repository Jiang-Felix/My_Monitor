import assert from 'node:assert/strict';
import { screen } from 'electron';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){const deadline=Date.now()+2000;while(Date.now()<deadline){if(await predicate())return;await sleep(25);}throw new Error(`Timeout: ${label}`);}
const inside=(b,areas)=>areas.some(a=>[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].every(([x,y])=>x>=a.x+15&&y>=a.y+15&&x<=a.x+a.width-15&&y<=a.y+a.height-15));
export async function runFloatingBoundsSmoke({mainWindow,getFloating}){
  const toggle=async(open)=>{const result=await mainWindow.webContents.executeJavaScript(`window.monitor.floating(${open})`);assert.equal(result.ok,true,result.error);};
  try{
    await toggle(true);await until(()=>getFloating()?.isVisible(),'floating window visible');
    const window=getFloating(),areas=screen.getAllDisplays().map(d=>d.workArea),original=window.getBounds();
    const left=Math.min(...areas.map(a=>a.x))-1000,top=Math.min(...areas.map(a=>a.y))-1000;
    const right=Math.max(...areas.map(a=>a.x+a.width))+1000,bottom=Math.max(...areas.map(a=>a.y+a.height))+1000;
    for(const [x,y] of [[left,top],[right,bottom],[left,bottom],[right,top]]){
      window.setBounds({...original,x,y});
      await until(()=>inside(window.getBounds(),areas),'all corners recover without a data refresh');
    }
    // Exercise the same lifecycle delivered by Windows dragging, using real native bounds.
    window.emit('will-move',{}, {...original,x:left,y:top});
    window.setBounds({...original,x:left,y:top});
    window.emit('moved');
    await until(()=>inside(window.getBounds(),areas),'completed drag recovers all corners');
    window.emit('will-move',{}, {...original,x:right,y:bottom});
    window.setBounds({...original,x:right,y:bottom});
    screen.emit('display-metrics-changed',{},screen.getPrimaryDisplay(),['workArea']);
    await until(()=>inside(window.getBounds(),areas),'display changes recover an offscreen window');
    await sleep(200);
    const safe=window.getBounds();await sleep(150);
    assert.deepEqual(window.getBounds(),safe,'a safely placed window stays still');
    console.log('PASS floating bounds: native move/drop/display events recover all four corners with margins without data updates; safe placement stays still');
  }finally{await toggle(false);}
}

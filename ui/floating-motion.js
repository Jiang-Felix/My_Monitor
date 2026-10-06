import {rgba} from './floating-view.js';

const states=new WeakMap(),DURATION=300;
const percent=value=>`${Number(value.toFixed(6))}%`;
export function renderFloatingMotion(track,view,settings,source){
  const fill=track.querySelector('.floating-fill'),band=track.querySelector('.floating-delta'),cap=track.querySelector('.floating-cap'),red=track.querySelector('.floating-red');
  const recent=source.recentChange===undefined?source.change:source.recentChange;
  const kind=view.band?(recent?.delta>0?'increase':'decrease'):'plain';
  const key=JSON.stringify([view.percent,view.known,view.band,kind,!!settings.showSmooth]),old=states.get(track);
  if(old?.key===key)return;
  const start={fill:old?.view.percent??view.percent,band:old?.view.band?.width??old?.view.percent??view.percent,cap:old?.view.band?.capWidth??old?.view.percent??view.percent,red:0,redColor:red.style.backgroundColor};
  if(old?.animations.length){
    const width=track.getBoundingClientRect().width,style=node=>track.ownerDocument.defaultView.getComputedStyle(node);
    const measured=node=>width?parseFloat(style(node).width)/width*100:parseFloat(node.style.width)||0;
    start.fill=measured(fill);start.band=measured(old.kind==='decrease'&&!red.hidden?red:band);start.cap=measured(style(cap).visibility==='hidden'?fill:cap);start.red=!red.hidden?measured(red):0;
  }
  for(const animation of old?.animations||[])animation.cancel();
  const state={key,kind,view,smooth:!!settings.showSmooth,animations:[]};states.set(track,state);
  function settle(){
    fill.style.width=percent(view.percent);band.hidden=cap.hidden=!view.band;red.hidden=true;red.style.width='0%';
    for(const node of [fill,band,cap,red])node.style.visibility='visible';
    if(view.band){band.style.width=percent(view.band.width);band.style.backgroundColor=rgba(view.band.color,.45);cap.style.width=percent(view.band.capWidth);}
  }
  settle();
  if(!settings.showSmooth||!old?.smooth||!old.view.known||!view.known||typeof fill.animate!=='function')return;
  const add=(node,frames,easing='ease-in-out')=>{
    const animation=node.animate(frames,{duration:DURATION,easing,fill:'both'});
    const timeline=track.ownerDocument.timeline.currentTime;if(Number.isFinite(timeline))animation.startTime=timeline;
    state.animations.push(animation);
  };
  const move=(node,from,to)=>{if(Math.abs(from-to)>.000001)add(node,[{width:percent(from)},{width:percent(to)}]);};
  if(kind==='plain')move(fill,start.fill,view.percent);
  else if(old.kind==='increase'&&kind==='decrease'){
    // Red appears immediately below all capsules; both old increase layers collapse
    // to the top white capsule in the first half, then only one white capsule moves.
    red.hidden=false;red.style.width=percent(view.band.width);red.style.backgroundColor=rgba(view.band.color,.45);
    band.style.backgroundColor=rgba(old.view.band.color,.45);band.hidden=cap.hidden=false;
    add(fill,[{width:percent(start.fill),offset:0,easing:'ease-in-out'},{width:percent(start.cap),offset:.5,easing:'ease-in-out'},{width:percent(view.percent),offset:1}],'linear');
    add(band,[{width:percent(start.band),visibility:'visible',offset:0,easing:'ease-in-out'},{width:percent(start.cap),visibility:'hidden',offset:.5},{width:percent(start.cap),visibility:'hidden',offset:1}],'linear');
    add(cap,[{width:percent(start.cap),visibility:'visible',offset:0},{width:percent(start.cap),visibility:'hidden',offset:.5},{width:percent(start.cap),visibility:'hidden',offset:1}],'linear');
  }else if(old.kind==='decrease'&&kind==='increase'){
    // Preserve the previous top white capsule while green and bottom white grow;
    // the copied red capsule retreats to zero behind them on the same timeline.
    red.hidden=false;red.style.backgroundColor=rgba(old.view.band.color,.45);red.style.width='0%';
    move(red,start.band,0);move(fill,start.fill,view.percent);move(band,start.cap,view.band.width);move(cap,start.cap,view.band.capWidth);
  }else{
    if(kind==='increase'&&start.red>0){red.hidden=false;red.style.backgroundColor=start.redColor;move(red,start.red,0);}
    move(fill,start.fill,view.percent);
    move(band,old.view.band?start.band:kind==='increase'?start.fill:view.band.width,view.band.width);
    move(cap,start.cap,view.band.capWidth);
  }
  if(!state.animations.length){settle();return;}
  Promise.all(state.animations.map(animation=>animation.finished)).then(()=>{
    if(states.get(track)!==state)return;
    for(const animation of state.animations)animation.cancel();state.animations=[];settle();
  }).catch(()=>{}); // Replaced updates cancel promises; only the newest state may settle.
}

import { applyFloatingStyle, createFloatingRow, renderFloatingRow } from './floating-row.js';
import {t} from '../core/i18n.js';

export function createFloatingPreview(panel) {
  const document=panel.ownerDocument;
  const sources=[
    {id:'preview-normal',name:'流量',unit:'GB',sample:{value:36.5,total:100},change:{previousValue:36.5,previousTotal:100,delta:0,intervalSeconds:60}},
    {id:'preview-single',name:'余额',unit:'credits',sample:{value:125.5,total:null},change:{previousValue:120,previousTotal:null,delta:5.5,intervalSeconds:60}},
    {id:'preview-increase',name:'增加',unit:'¥',sample:{value:75,total:100},change:{previousValue:60,previousTotal:100,delta:15,intervalSeconds:60}},
    {id:'preview-decrease',name:'减少',unit:'次',sample:{value:30,total:100},change:{previousValue:60,previousTotal:100,delta:-30,intervalSeconds:3600}},
  ].map(source=>({...source,status:'ok',enabled:true}));
  const rows=sources.map(source=>{const row=createFloatingRow(document,source);panel.append(row);return row;});
  // Same-direction updates and both direction changes repeat without a reset jump.
  const values=[[85,55,40,70,75],[20,50,65,35,30]];
  let settings,active=false,timer=null,step=0;
  function render(nextSettings) {
    settings=nextSettings;
    applyFloatingStyle(panel,settings);
    panel.style.width=`${settings.barWidth+38+(settings.showName?28:0)+(settings.showPercent?48:0)}px`;
    sources.forEach((source,index)=>renderFloatingRow(rows[index],{...source,name:t(source.name),unit:source.id==='preview-decrease'?t('次'):source.unit},settings));
  }
  function schedule() {
    if(timer!==null)clearTimeout(timer);
    timer=null;
    if(!active||document.hidden||!settings)return;
    timer=setTimeout(()=>{
      timer=null;
      for(let index=0;index<2;index++) {
        const source=sources[index+2],previous=source.sample.value,value=values[index][step];
        source.name=value>previous?'增加':'减少';
        source.sample={...source.sample,value};
        source.change={...source.change,previousValue:previous,delta:value-previous};
      }
      step=(step+1)%values[0].length;
      render(settings);schedule();
    },1500);
  }
  document.addEventListener('visibilitychange',schedule);
  return {
    render(nextSettings){render(nextSettings);if(timer===null)schedule();},
    setActive(value){active=value;schedule();},
    refreshLanguage(){if(settings)render(settings);},
  };
}

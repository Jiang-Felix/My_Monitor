import { t } from '../core/i18n.js';

const presets=[
  ['1s',1,'1秒'],['30s',30,'30秒'],['1min',60,'1分钟'],['10min',600,'10分钟'],
  ['30min',1800,'30分钟'],['1h',3600,'1小时'],['5h',18000,'5小时'],
  ['12h',43200,'12小时'],['1d',86400,'1天'],['1w',604800,'1周'],['1m',2592000,'1个月（30天）']
];

export function initializeSourceCadence({form,isTestMode,needsWeb,onChange}){
  const panel=document.querySelector('#cadence-controls'),slider=document.querySelector('#cadence-slider');
  const ticks=document.querySelector('#cadence-ticks');
  ticks.innerHTML=presets.map(([label],index)=>`<button type="button" class="cadence-tick${index<2?' fast':''}" data-cadence-index="${index}">${label}</button>`).join('');
  ticks.querySelectorAll('[data-cadence-index]').forEach(button=>button.style.left=`${Number(button.dataset.cadenceIndex)*10}%`);
  function select(index){
    form.elements.interval.value=presets[index][1];
    if(needsWeb())form.elements.webUpdateMode.value=index<2?'live':'reload';
    onChange();
  }
  slider.addEventListener('input',()=>select(Number(slider.value)));
  ticks.addEventListener('click',event=>{const button=event.target.closest('[data-cadence-index]');if(button)select(Number(button.dataset.cadenceIndex));});
  function sync({preserveConfig=false}={}){
      const interval=Number(form.elements.interval.value),web=needsWeb();
      panel.hidden=isTestMode();
      // The fast presets always reuse the site's own updates in ordinary mode.
      if(!preserveConfig&&!isTestMode()&&web&&interval>=1&&interval<=30)form.elements.webUpdateMode.value='live';
      const live=web&&form.elements.webUpdateMode.value==='live';
      const exact=presets.findIndex(p=>p[1]===interval);
      const index=exact>=0?exact:presets.reduce((best,p,i)=>Math.abs(Math.log(p[1]/interval))<Math.abs(Math.log(presets[best][1]/interval))?i:best,0);
      slider.value=index;
      const value=exact>=0?t(presets[exact][2]):Number.isInteger(interval)&&interval>0?t('{seconds}秒（自定义）').replace('{seconds}',interval):t('请选择更新频率');
      document.querySelector('#cadence-value').textContent=value;
      slider.setAttribute('aria-valuetext',`${value}${live?t('，网页自主更新'):''}`);
      panel.classList.toggle('lightweight',live);
      panel.classList.toggle('non-web',!web);
      document.querySelector('#cadence-legend').hidden=!web;
      ticks.querySelectorAll('[data-cadence-index]').forEach(button=>{
        const selected=Number(button.dataset.cadenceIndex)===exact;
        const description=t(presets[Number(button.dataset.cadenceIndex)][2]);
        const label=t('每{interval}更新一次').replace('{interval}',description);
        button.setAttribute('title',label);button.setAttribute('aria-label',label);
        button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
      });
      document.querySelector('#cadence-status').textContent=t(live?'网页自主更新 · 轻量':web?'定时重新加载网页':'定时采集');
      document.querySelector('#cadence-hint').textContent=t(live
        ?'读取网页自身更新的数值，不主动刷新网页；网站需要自行更新数据。'
        :web?'按所选周期重新加载网页，读取最新数值。':'按所选周期读取数据。');
      document.querySelector('#cadence-custom-note').hidden=exact>=0;
  }
  return {sync,refresh:()=>sync({preserveConfig:true})};
}

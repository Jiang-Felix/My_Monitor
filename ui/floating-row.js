import { floatingPresentation, rgba } from './floating-view.js';
import {renderFloatingMotion} from './floating-motion.js';
import {t,getLanguage} from '../core/i18n.js';
import {floatingRowHeight} from '../core/floating-settings.js';

export function applyFloatingStyle(element, settings) {
  for(const [key,value] of Object.entries({
    '--panel-background':rgba(settings.backgroundColor,settings.backgroundOpacity),
    '--track-color':rgba(settings.trackColor,0.48),'--fill-color':settings.fillColor,
    '--row-height':`${floatingRowHeight(settings)}px`,
    '--bar-height':`${settings.barHeight}px`,'--bar-width':`${settings.barWidth}px`,
  }))element.style.setProperty(key,value);
}
export function createFloatingRow(document, source) {
  const row=document.createElement('div');row.className='floating-row';
  const name=document.createElement('span');name.className='floating-name';
  const track=document.createElement('div');track.className='floating-track';track.dataset.id=source.id;track.setAttribute('role','progressbar');
  const fill=document.createElement('div');fill.className='floating-fill';
  const red=document.createElement('div');red.className='floating-red';red.hidden=true;red.setAttribute('aria-hidden','true');
  const band=document.createElement('div');band.className='floating-delta';band.hidden=true;band.setAttribute('aria-hidden','true');
  const cap=document.createElement('div');cap.className='floating-cap';cap.hidden=true;cap.setAttribute('aria-hidden','true');
  const amount=document.createElement('span');amount.className='floating-amount';
  const current=document.createElement('span');current.className='floating-current';
  const delta=document.createElement('span');delta.className='floating-change';
  amount.append(current,delta);
  const percentage=document.createElement('span');percentage.className='floating-percent';
  track.append(red,fill,band,cap,amount);row.append(name,track,percentage);
  return row;
}
export function renderFloatingRow(row, source, settings) {
  const view=floatingPresentation(source,settings),track=row.querySelector('.floating-track');
  renderFloatingMotion(track,view,settings,source);
  const name=row.querySelector('.floating-name');name.hidden=!settings.showName;name.textContent=Array.from(source.name||'')[0]||'';name.title=source.name||'';
  const amount=row.querySelector('.floating-amount');amount.hidden=!view.text;amount.title=view.text;amount.dataset.align=settings.textAlign || 'distributed';
  amount.querySelector('.floating-current').textContent=view.displayAmount || (!view.displayDelta?view.text:'');
  amount.querySelector('.floating-change').textContent=(view.displayAmount && view.displayDelta?'  ':'')+view.displayDelta;
  amount.dataset.paired=String(!!view.displayAmount && !!view.displayDelta);
  const percentage=row.querySelector('.floating-percent');percentage.hidden=!settings.showPercent;percentage.textContent=view.percentageText;
  track.setAttribute('aria-label',source.name||'');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
  if(view.known)track.setAttribute('aria-valuenow',String(view.percent));else track.removeAttribute('aria-valuenow');
  const separator=getLanguage()==='en'?', ':'，';
  track.setAttribute('aria-valuetext',`${view.known?`${Math.round(view.percent)}%`:t('未设置可用总量数据')}${source.stale?separator+t('上次有效值'):''}${view.text?separator+view.text:''}`);
}

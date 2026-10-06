import { progress } from '../core/metrics.js';
import { getLanguage } from '../core/i18n.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const clamp = value => Math.max(0, Math.min(100, value));
export function rgba(hex, opacity) {
  return `rgba(${[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)).join(', ')}, ${opacity})`;
}
function cadence(seconds) {
  if(getLanguage()==='en'){
    if(seconds%86400===0)return `${seconds/86400}d`;
    if(seconds%3600===0)return `${seconds/3600}h`;
    if(seconds%60===0)return `${seconds/60}min`;
    return `${seconds}s`;
  }
  if (seconds % 86400 === 0) return `${seconds/86400}天`;
  if (seconds % 3600 === 0) return `${seconds/3600}小时`;
  if (seconds % 60 === 0) return `${seconds/60}分钟`;
  return `${seconds}秒`;
}
export function floatingPresentation(source, settings) {
  const sample=source.sample, ratio=progress(sample), known=ratio!==null && finite(ratio);
  const percent=known?clamp(ratio):0, unit=settings.showUnit?(source.unit||sample?.unit||''):'';
  const hasValue=finite(sample?.value), hasTotal=finite(sample?.total);
  const amountText=hasValue?`${sample.value}${settings.showTotal && hasTotal?`/${sample.total}`:''}${unit}`:'--';
  const change=source.change;
  const active=hasValue && source.enabled!==false && !source.stale && !source.failed && ['ok','refreshing'].includes(source.status);
  const hasChange=active && finite(change?.previousValue) && finite(change?.delta) && finite(change?.intervalSeconds) && change.intervalSeconds>0;
  const deltaText=hasChange?`${change.delta<0?'-':'+'}${Number(Math.abs(change.delta).toPrecision(12))}/${cadence(change.intervalSeconds)}`:'';
  let band=null;
  const recent=source.recentChange===undefined?change:source.recentChange;
  if (settings.showDeltaBand && known && active && finite(recent?.previousValue) && finite(recent?.delta) && recent.delta!==0 && finite(recent?.intervalSeconds) && recent.intervalSeconds>0) {
    const previousRatio=progress({value:recent.previousValue,total:recent.previousTotal});
    const currentRatio=progress({value:recent.currentValue ?? sample.value,total:recent.currentTotal===undefined?sample.total:recent.currentTotal});
    if(finite(previousRatio) && finite(currentRatio)) {
      const previous=clamp(previousRatio),current=clamp(currentRatio),width=Math.abs(current-previous);
      if(width>0)band={width:Math.max(current,previous),capWidth:Math.min(current,previous),color:recent.delta>0?settings.increaseColor:settings.decreaseColor};
    }
  }
  const displayAmount=settings.showAmount?amountText:'';
  const displayDelta=settings.showDeltaValue && (settings.showZeroDelta || change?.delta!==0)?deltaText:'';
  const text=[displayAmount,displayDelta].filter(Boolean).join('  ') || (settings.showDeltaValue && !hasChange?'--':'');
  return {percent,known,amountText,deltaText,displayAmount,displayDelta,text,band,percentageText:known?`${Number(percent.toFixed(1))}%`:'--'};
}

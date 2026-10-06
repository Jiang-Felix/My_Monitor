import {t,localeCode} from '../core/i18n.js';
import { chartPointCount } from '../core/alert-points.js';
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e9)) return value.toExponential(3);
  return value.toLocaleString(localeCode(), { maximumFractionDigits: 4 });
}
export function rangeText(rule) {
  if (rule.lower === null) return `≤ ${rule.upper}`;
  if (rule.upper === null) return `≥ ${rule.lower}`;
  return `${rule.lower} ～ ${rule.upper}`;
}
const outside = (rule, value) => (rule.lower !== null && value < rule.lower) || (rule.upper !== null && value > rule.upper);
function scaleFor(rule, values, intervals=4) {
  const data = [rule.lower, rule.upper, ...values, ...(rule.type === 'delta' ? [0] : [])].filter(Number.isFinite);
  const magnitude = Math.max(...data.map(Math.abs), 1);
  const scaled = data.map(v => v / magnitude);
  const min = Math.min(...scaled), max = Math.max(...scaled), padding = Math.max((max - min) * 0.15, 0.08);
  const rawLow = min - padding, rawHigh = max + padding;
  const ideal = Math.max(1,Math.min(Number.MAX_VALUE,(rawHigh-rawLow)/intervals*magnitude));
  const base = 10 ** Math.floor(Math.log10(ideal));
  const step = [1,2,5,10].map(m=>m*base).find(n=>Number.isFinite(n)&&n>=ideal)||base;
  const normalizedStep=step/magnitude,first=Math.floor(rawLow/normalizedStep),last=Math.ceil(rawHigh/normalizedStep);
  const limit=Number.MAX_VALUE/magnitude,low=Math.max(-limit,first*normalizedStep),high=Math.min(limit,last*normalizedStep);
  const ticks=Array.from({length:last-first+1},(_,i)=>(first+i)*step).filter(Number.isFinite);
  return { ticks, fraction: value => (value / magnitude - low) / (high - low) };
}
function integerLabel(value){
  if(Math.abs(value)<1e8)return Math.round(value).toLocaleString(localeCode(),{maximumFractionDigits:0});
  const [mantissa,exponent]=value.toExponential(10).split('e'),[whole,fraction='']=mantissa.replace(/0+$/,'').replace(/\.$/,'').split('.');
  return `${whole}${fraction}e${Number(exponent)-fraction.length}`;
}
const tr=(message,values)=>t(message).replace(/\{(\w+)\}/g,(_,key)=>String(values[key]));
const fixed = value => Number(value.toFixed(3));
const date = time => new Date(time).toLocaleString(localeCode(), { month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit' });

export function axisMarkup(rule, track, { width = 640 } = {}) {
  width=Math.max(140,Number.isFinite(width)?width:640);
  const start=24,end=width-24;
  const value = track?.measurement, hasValue = Number.isFinite(value);
  const recent=(track?.points||[]).slice(-5).map(p=>p.measurement).filter(Number.isFinite);
  const values=recent.length?recent:hasValue?[value]:[rule.lower,rule.upper].filter(Number.isFinite);
  const scale = scaleFor({...rule,type:'value'},values.length?values:[0],width<360?2:4);
  const x = value => fixed(start + Math.max(0,Math.min(1,scale.fraction(value))) * (end-start));
  const left = rule.lower === null ? start : x(rule.lower), right = rule.upper === null ? end : x(rule.upper);
  const compressed = rule.lower !== null && rule.upper !== null && rule.lower !== rule.upper && right-left < 80;
  const label = t(rule.type === 'delta' ? '相邻变化量' : '实时数据');
  const title = tr('{label} {value}；范围 {range}，包含边界',{label,value:hasValue?String(value):t('等待记录'),range:rangeText(rule)});
  let bounds = '';
  for (const [value, caption] of [[rule.lower,'下限'],[rule.upper,'上限']]) if (value !== null) {
    if (rule.lower === rule.upper && caption === '上限') continue;
    const labelX = compressed ? Math.max(start,Math.min(end,(left+right)/2+(caption==='下限'?-40:40))) : x(value);
    const fraction=scale.fraction(value),visible=fraction>=0&&fraction<=1;
    bounds += `${visible?`<line class="range-bound" x1="${x(value)}" x2="${x(value)}" y1="42" y2="62"/>`:''}<text x="${labelX}" y="34" text-anchor="middle"><title>${t(caption)} ${escape(value)}</title>${rule.lower === rule.upper ? `${t('上下限')} ` : `${t(caption)} `}${escape(value)}${visible?'':fraction<0?' ←':' →'}</text>`;
  }
  const ticks=scale.ticks.map(value=>`<text class="axis-tick" x="${x(value)}" y="82" text-anchor="middle">${integerLabel(value)}</text>`).join('');
  return `<svg class="range-axis" viewBox="0 0 ${width} 92" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><text class="axis-current" x="${hasValue?x(value):width/2}" y="14" text-anchor="middle">${hasValue?`${t('检测')} ${escape(value)}`:t('等待有效记录')}</text><line class="axis-base" x1="${start}" x2="${end}" y1="52" y2="52"/><line class="range-span" x1="${left}" x2="${right}" y1="52" y2="52"/>${rule.lower === null ? `<text class="axis-arrow" x="${start-10}" y="56">←</text>` : ''}${rule.upper === null ? `<text class="axis-arrow" x="${end}" y="56">→</text>` : ''}${bounds}${ticks}${hasValue ? `<circle class="range-dot${outside(rule,value) ? ' outside' : ''}" cx="${x(value)}" cy="52" r="7"><title>${escape(label)} ${escape(value)}</title></circle>` : ''}</svg>`;
}

export function chartMarkup(rule, track, { width = 640, height = 260 } = {}) {
  // Retain checkpoint records before excluding delta baselines; obsolete values must not
  // influence either the time domain or the vertical scale.
  const points = (track?.points || []).slice(-chartPointCount(rule.chartPoints)).filter(p => Number.isFinite(p.measurement));
  if (!points.length) return `<p class="chart-empty">${t('等待有效记录。变量检测需两个记录值才能计算变化量。')}</p>`;
  width = Math.max(320, Number.isFinite(width) ? width : 640);
  height = Math.max(180, Number.isFinite(height) ? height : 260);
  const left = 68, right = width - 85, plotWidth = right - left;
  const plotTop = 24, plotBottom = height - 46, plotHeight = plotBottom - plotTop;
  const scale = scaleFor(rule, points.map(p => p.measurement));
  const first = Math.min(...points.map(p=>p.time)), last = Math.max(...points.map(p=>p.time)), span = last - first;
  const x = time => fixed(span ? left + (time - first) / span * plotWidth : (left + right) / 2);
  const y = value => fixed(plotBottom - scale.fraction(value) * plotHeight);
  const top = rule.upper === null ? plotTop : y(rule.upper), bottom = rule.lower === null ? plotBottom : y(rule.lower);
  let markup = `<rect class="range-band" x="${left}" y="${top}" width="${plotWidth}" height="${Math.max(1,bottom-top)}"/>`;
  for (const value of scale.ticks) {
    const py = y(value);
    markup += `<line class="chart-grid" x1="${left}" x2="${right}" y1="${py}" y2="${py}"/><text class="chart-tick" x="${left-9}" y="${py+4}" text-anchor="end">${integerLabel(value)}</text>`;
  }
  const closeBounds = rule.lower !== null && rule.upper !== null && Math.abs(y(rule.lower)-y(rule.upper)) < 15;
  for (const [value,caption] of [[rule.lower,'下限'],[rule.upper,'上限']]) if (value !== null) {
    if (rule.lower===rule.upper && caption==='上限') continue;
    markup += `<line class="chart-bound" x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/>`;
    if (!closeBounds || caption==='下限') markup += `<text class="bound-caption" x="${right+8}" y="${y(value)+4}"><title>${escape(rangeText(rule))}</title>${rule.lower===rule.upper?t('上下限')+' '+escape(value):closeBounds?t('范围见上方'):t(caption)+' '+escape(value)}</text>`;
  }
  if (rule.type === 'value') {
    const segments = [];
    for (const point of points) {
      if (segments.at(-1)?.[0].segment !== point.segment) segments.push([]);
      segments.at(-1).push(point);
    }
    markup += segments.map(group => `<polyline class="chart-line" points="${group.map(p=>`${x(p.time)},${y(p.measurement)}`).join(' ')}"/>`).join('');
  } else markup += `<line class="chart-zero" x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}"/>`;
  const barWidth = Math.min(14,plotWidth / points.length * 0.7);
  for (const point of points) {
    const px=x(point.time), py=y(point.measurement), alert=outside(rule,point.measurement);
    const caption=tr('{time} · {label} {measurement} · 记录值 {value} · 数据读取 {sourceTime}',{time:date(point.time),label:t(rule.type==='delta'?'变化量':'实时数据'),measurement:point.measurement,value:point.value,sourceTime:date(point.sourceTime)})+(alert?` · ${t('超出范围')}`:'');
    const attrs=`data-point-time="${point.time}" data-point-key="${escape(point.segment)}-${point.time}-${point.sequence??0}" tabindex="0" role="img" aria-label="${escape(caption)}"`;
    markup += rule.type==='delta' ? `<rect class="chart-bar${alert?' outside':''}" x="${fixed(px-barWidth/2)}" y="${Math.min(py,y(0))}" width="${fixed(barWidth)}" height="${Math.max(1,Math.abs(py-y(0)))}" ${attrs}><title>${escape(caption)}</title></rect>` : `<circle class="chart-point${alert?' outside':''}" cx="${px}" cy="${py}" r="3.5" ${attrs}><title>${escape(caption)}</title></circle>`;
  }
  markup += `<text x="${left}" y="${height-18}">${date(first)}</text><text x="${right}" y="${height-18}" text-anchor="end">${date(last)}</text>`;
  return `<svg class="alert-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${t(rule.type==='delta'?'相邻变化量柱状图，范围条带包含边界':'实时数据折线图，范围条带包含边界')}"><title>${t(rule.type==='delta'?'每个柱表示一个相邻记录变化量；悬停或聚焦查看数值':'每个点表示一个记录实时数据；悬停或聚焦查看数值')}</title>${markup}</svg>`;
}

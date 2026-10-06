import { t, translateMessage, localeCode, getLanguage } from '../core/i18n.js';
import { resourceCategory } from '../core/resource-status.js';
import { parseFixed } from '../core/metrics.js';
import { DEFAULT_FLOATING_SETTINGS, validateFloatingSettings, floatingTextHeight } from '../core/floating-settings.js';
import {initializeFormChoices} from './form-choices.js';
import { createFloatingPreview } from './floating-preview.js';
import { escape, formatNumber as number, axisMarkup, chartMarkup } from './alert-visuals.js';
import { chartPointCount } from '../core/alert-points.js';
import { frequencyText } from './alert-frequency.js';
import { alertCategory } from '../core/alert-status.js';
import { chartIcon, speakerIcon } from './alert-icons.js';
import {initializeAlertFormControls} from './alert-form-controls.js';

const $ = selector => document.querySelector(selector);
const time = value => Number.isFinite(value) ? new Date(value).toLocaleString(localeCode(), { month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit' }) : '—';
const tr = (message, values = {}) => t(message).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
const deliveries = { pending:'准备发送',requested:'已请求系统通知',shown:'已接收',failed:'通知发送失败',unsupported:'系统不支持通知',test:'测试模式',muted:'已静默' };
let latest = {}, services, ruleId = null, floatingDirty = false, alertFilter='all';
let alertFormControls, floatingPreview, floatingChoices;
const savingRules=new Set();
function syncRuleControls(node) {
  const busy=savingRules.has(node.dataset.ruleId);
  for(const control of node.querySelectorAll('[data-alert-action=edit],[data-alert-action=toggle],[data-alert-action=notifications],.chart-window'))control.disabled=busy;
}
async function submitRule(button,errorElement,id,operation) {
  if(button.disabled||savingRules.has(id))return;
  savingRules.add(id);button.disabled=true;if(errorElement)errorElement.textContent='';
  const sync=()=>{
    for(const node of document.querySelectorAll('#alert-list [data-rule-id]'))syncRuleControls(node);
    if(ruleId===id)for(const control of [$('#alert-save'),$('#alert-delete')])control.disabled=savingRules.has(id);
  };
  sync();
  try{await operation();}catch(failure){if(errorElement)errorElement.textContent=translateMessage(errorElement._message=failure.message);else services.toast(translateMessage(failure.message));}
  finally{savingRules.delete(id);button.disabled=false;sync();}
}

export function showPage(page) {
  if (!['data','alarms','floating','settings'].includes(page)) return;
  for (const name of ['data','alarms','floating','settings']) $(`#${name}-page`).hidden = name !== page;
  for (const button of document.querySelectorAll('[data-page]')) {
    button.classList.toggle('active',button.dataset.page===page);
    if (button.dataset.page===page) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  }
  floatingPreview?.setActive(page==='floating');
  if (page==='alarms' && latest.sources) renderWorkspace(latest);
}
function fill(form, values) {
  for (const [key,value] of Object.entries(values||{})) if (form.elements[key]) {
    if (form.elements[key].type==='checkbox') form.elements[key].checked=value;
    else form.elements[key].value=value ?? '';
  }
}
const fields = form => Object.fromEntries(new FormData(form));
function floatingInput() {
  const form=$('#floating-settings');
  return validateFloatingSettings(Object.fromEntries(Object.keys(DEFAULT_FLOATING_SETTINGS).map(key=>[key,form.elements[key].type==='checkbox'?form.elements[key].checked:form.elements[key].value])));
}
function floatingControls() {
  const form=$('#floating-settings');
  form.elements.showTotal.disabled=!form.elements.showAmount.checked;
  form.elements.showZeroDelta.disabled=!form.elements.showDeltaValue.checked;
  const minimum=floatingTextHeight({showAmount:form.elements.showAmount.checked,showDeltaValue:form.elements.showDeltaValue.checked});
  form.elements.barHeight.min=String(minimum);
  if(Number(form.elements.barHeight.value)<minimum)form.elements.barHeight.value=String(minimum);
  for(const [key,id] of [['barHeight','bar-height-label'],['barWidth','bar-width-label']]){
    const input=form.elements[key];$(`#${id}`).textContent=`${input.value}px`;
    input.style.setProperty('--size-position',`${100*(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))}%`);
  }
  $('#bar-height-hint').textContent=t(minimum===16?'显示文字时，高度至少为 16px':'关闭条内文字时，最低可设为 4px');
  floatingChoices?.sync();
  for(const key of ['increaseColor','decreaseColor'])form.elements[key].disabled=!form.elements.showDeltaBand.checked;
}
function preview(settings) {
  floatingControls();
  floatingPreview.render(settings);
}
function setMarkup(node, html) {
  if (node._markup===html) return;
  const focused=node.contains(document.activeElement) ? document.activeElement.dataset.pointKey : null;
  node.innerHTML=html; node._markup=html;
  if (focused) (node.querySelector(`[data-point-key="${CSS.escape(focused)}"]`) || node.closest('[data-rule-id]')?.querySelector('[data-alert-action=chart]'))?.focus({preventScroll:true});
}
function createEntry(rule) {
  const node=document.createElement('article'); node.className='alert-entry range-entry'; node.dataset.ruleId=rule.id;
  node.innerHTML='<div class="alert-entry-main"><div class="alert-entry-heading"><div class="rule-heading-text"><span class="detection-tag"></span><h3></h3><p class="rule-subtitle"></p></div></div><div class="alert-entry-visual"><div class="axis-holder"></div><p class="range-state"></p></div><span class="tracking-status"></span><div class="alert-entry-actions"><button class="icon-control" data-alert-action="edit" title="编辑告警" aria-label="编辑告警">•••</button><button class="icon-control" data-alert-action="toggle"></button><button class="icon-control" data-alert-action="chart" aria-expanded="false"></button><button class="icon-control" data-alert-action="notifications"></button></div></div><p class="migration-note" hidden></p><p class="last-alert" aria-live="polite"></p><details class="alert-chart-detail"><summary hidden>图表</summary><label class="chart-window-label">图表范围<select class="chart-window" aria-label="图表记录范围"><option value="10">最近10次</option><option value="20">最近20次</option><option value="50">最近50次</option></select></label><div class="chart-holder"></div><p class="chart-tooltip" role="status" hidden></p></details>';
  const details=node.querySelector('details');details.id=`alert-chart-${rule.id}`;
  node.querySelector('[data-alert-action=chart]').setAttribute('aria-controls',details.id);
  node.querySelector('details').addEventListener('toggle',()=>renderWorkspace(latest));
  return node;
}
function renderEntry(node,rule,track,source,blocked) {
  const edit=node.querySelector('[data-alert-action=edit]');edit.title=t('编辑告警');edit.setAttribute('aria-label',edit.title);
  node.querySelector('summary').textContent=t('图表');
  node.querySelector('.chart-window-label').firstChild.textContent=t('图表范围');
  const chartWindow=node.querySelector('.chart-window');chartWindow.setAttribute('aria-label',t('图表记录范围'));
  for(const option of chartWindow.options)option.textContent=tr('最近{count}次',{count:option.value});
  syncRuleControls(node);
  const category=source?resourceCategory(source,Date.now(),!!blocked):'failed';
  const waiting=!track?.live;
  const status=!rule.enabled?'已停止':!source?'数据已删除，请编辑':category==='paused'?'数据源已暂停':category==='failed'?'数据采集失败，等待恢复':waiting?'等待新读数':track.error?'计算失败':track.measurement===null?'已建立基准，等待下次检查':'正在检测';
  node.dataset.type=rule.type; node.classList.toggle('is-outside',!!track?.outside && rule.enabled);
  node.querySelector('h3').textContent=rule.name;
  node.querySelector('.detection-tag').textContent=t(rule.type==='delta'?'变量检测':'定量检测');
  node.querySelector('.rule-subtitle').textContent=tr(getLanguage()==='en'&&rule.updateEvery===1?'每次数据更新 · {frequency}':'每 {updates} 次数据更新 · {frequency}',{updates:rule.updateEvery,frequency:frequencyText(rule.updateEvery,source?.interval,{compact:true})});
  node.querySelector('.tracking-status').textContent=t(status);
  const migration=node.querySelector('.migration-note'); migration.hidden=!(rule.migrationNote||rule.cadenceNote); migration.textContent=translateMessage(rule.migrationNote||rule.cadenceNote||'');
  node.querySelector('.range-state').textContent=translateMessage(track?.error || (!track?.live || track.measurement===null?'等待有效检查':track.outside?rule.notificationsEnabled===false?'超出范围 · 通知静默':'超出范围 · 每次检查均提醒':'在范围内'));
  const axis=node.querySelector('.axis-holder');
  setMarkup(axis,axisMarkup(rule,track,{width:axis.clientWidth}));
  const lastAlert=node.querySelector('.last-alert'); lastAlert.hidden=!track?.lastAlert;
  lastAlert.textContent=track?.lastAlert?tr('最近越界 {time} · 检测值 {value} · {delivery}',{time:time(track.lastAlert.time),value:track.lastAlert.measurement,delivery:t(deliveries[track.lastAlert.delivery]||'未知投递状态')})+(track.lastAlert.error?` · ${translateMessage(track.lastAlert.error)}`:''):'';
  const toggle=node.querySelector('[data-alert-action=toggle]');toggle.textContent=rule.enabled?'■':'▶';toggle.classList.toggle('stop-action',rule.enabled);toggle.classList.toggle('start-action',!rule.enabled);
  const toggleLabel=t(rule.enabled?'停止告警':rule.migrationNote?'确认旧规则':'开始告警');toggle.title=toggleLabel;toggle.setAttribute('aria-label',toggleLabel);
  const notifications=node.querySelector('[data-alert-action=notifications]'),notifying=rule.notificationsEnabled!==false;
  setMarkup(notifications,speakerIcon(notifying));notifications.classList.toggle('is-silent',!notifying);notifications.setAttribute('aria-pressed',String(notifying));
  notifications.title=t(notifying?'关闭通知':'开启通知');notifications.setAttribute('aria-label',notifications.title);
  node.querySelector('.chart-window').value=chartPointCount(rule.chartPoints);
  const details=node.querySelector('details'),chartButton=node.querySelector('[data-alert-action=chart]');
  setMarkup(chartButton,chartIcon(rule.type));chartButton.setAttribute('aria-expanded',String(details.open));chartButton.classList.toggle('is-expanded',details.open);
  chartButton.title=t(details.open?'收起图表':'展开图表');chartButton.setAttribute('aria-label',chartButton.title);
  const holder=node.querySelector('.chart-holder'),tooltip=node.querySelector('.chart-tooltip');
  if (details.open) {
    const style=getComputedStyle(holder);
    const width=holder.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    setMarkup(holder,chartMarkup(rule,track,{width,height:260}));
    const point=tooltip.dataset.pointKey && holder.querySelector(`[data-point-key="${CSS.escape(tooltip.dataset.pointKey)}"]`);
    if(point)tooltip.textContent=point.getAttribute('aria-label');
    else {tooltip.hidden=true;tooltip.textContent='';delete tooltip.dataset.pointKey;}
  } else {if(!track)setMarkup(holder,chartMarkup(rule,null));tooltip.hidden=true;tooltip.textContent='';delete tooltip.dataset.pointKey;}
}
export function renderWorkspace(state) {
  latest=state;
  if($('#alert-dialog').open)updateNotes();
  const alerts=state.alerts||{rules:[],tracking:[]};
  const tracks=new Map(alerts.tracking.map(t=>[t.ruleId,t])),sources=new Map(state.sources.map(s=>[s.id,s]));
  const groups=new Map(alerts.rules.map(rule=>[rule.id,alertCategory(rule,sources.get(rule.sourceId),tracks.get(rule.id),Date.now(),!!state.monitoringBlocked)]));
  $('#alarm-total-count').textContent=alerts.rules.length;
  for(const group of ['active','silent','paused'])$(`#alarm-${group}-count`).textContent=alerts.rules.filter(r=>groups.get(r.id)===group).length;
  for(const button of document.querySelectorAll('[data-alert-filter]')){const selected=button.dataset.alertFilter===alertFilter;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  $('#alert-count').textContent=alerts.rules.filter(r=>r.enabled).length;
  $('#tracking-count').textContent=tr('{enabled} 个启用 / {total} 个条目',{enabled:alerts.rules.filter(r=>r.enabled).length,total:alerts.rules.length});
  if (!floatingDirty) {const settings=validateFloatingSettings(state.floatingSettings);fill($('#floating-settings'),settings);preview(settings);}
  $('#floating-page-toggle').textContent=t(state.floatingOpen?'关闭浮窗':'打开浮窗'); $('#floating-page-toggle').setAttribute('aria-pressed',String(!!state.floatingOpen));
  if ($('#alarms-page').hidden) return;
  const list=$('#alert-list'),visible=alerts.rules.filter(rule=>alertFilter==='all'||groups.get(rule.id)===alertFilter);
  const existing=new Map([...list.querySelectorAll('[data-rule-id]')].map(n=>[n.dataset.ruleId,n]));
  for (const [id,node] of existing) if (!visible.some(r=>r.id===id)) node.remove();
  if (!visible.length) {setMarkup(list,alerts.rules.length?`<div class="page-empty">${escape(t('此分类暂无告警条目。'))}</div>`:`<div class="page-empty">${escape(t('还没有告警条目。点击“新增告警”，选择检测类型、范围和更新次数。'))}</div>`);return;}
  list.querySelector('.page-empty')?.remove(); list._markup=null;
  for (const [index,rule] of visible.entries()) {
    const node=existing.get(rule.id)||createEntry(rule); if (list.children[index]!==node) list.insertBefore(node,list.children[index]||null);
    renderEntry(node,rule,tracks.get(rule.id),sources.get(rule.sourceId),state.monitoringBlocked);
  }
}
async function submit(button,errorElement,operation) {
  if (button.disabled) return; button.disabled=true; if(errorElement) errorElement.textContent='';
  try {await operation();} catch(failure) {if(errorElement)errorElement.textContent=translateMessage(errorElement._message=failure.message);else services.toast(translateMessage(failure.message));} finally {button.disabled=false;}
}
function openRule(rule=null) {
  const form=$('#alert-form');form.reset();ruleId=rule?.id||crypto.randomUUID();
  const options=latest.sources.map(s=>`<option value="${escape(s.id)}">${escape(s.name)}${s.kind==='demo'?escape(t('（演示数据）')):''}</option>`);
  if(rule&&!latest.sources.some(s=>s.id===rule.sourceId)) options.unshift(`<option value="${escape(rule.sourceId)}">${escape(t('原数据已删除，请重新选择'))}</option>`);
  form.elements.sourceId.innerHTML=options.join(''); fill(form,rule||{type:'delta',lower:'',upper:'',updateEvery:1,notificationsEnabled:true});
  $('#alert-delete').hidden=!rule;
  for(const control of [$('#alert-save'),$('#alert-delete')])control.disabled=savingRules.has(ruleId);
  $('#alert-form-error').textContent='';$('#alert-dialog-title').textContent=t(rule?'编辑告警':'新增告警');$('#alert-dialog').showModal();form.elements.name.focus();updateNotes();
}
function updateNotes() {
  alertFormControls?.sync();
  const form=$('#alert-form'),source=latest.sources.find(s=>s.id===form.elements.sourceId.value);
  $('#alert-type-note').textContent=t(form.elements.type.value==='delta'?'变化量 = 本次检查记录值 − 上次检查记录值，保留正负方向；首次检查只建立基准。':'直接检测本次检查记录值，首次有效检查即可提醒。');
  $('#alert-unit-note').textContent=source?.unit?tr('单位：{unit}。',{unit:source.unit}):t('单位与数据一致。');
  $('#alert-interval-note').textContent=frequencyText(Number(form.elements.updateEvery.value),source?.interval);
}
function ruleInput(form) {
  const data=fields(form);data.updateEvery=parseFixed(data.updateEvery,'更新次数');
  data.notificationsEnabled=form.elements.notificationsEnabled.checked;
  const parseBound=(raw,label)=>raw.trim()?parseFixed(raw,label):null;
  data.lower=parseBound(data.lower,'范围下限');data.upper=parseBound(data.upper,'范围上限');
  if(data.lower===null&&data.upper===null)throw new Error('请至少填写范围下限或上限');
  if(data.lower!==null&&data.upper!==null&&data.lower>data.upper)throw new Error('范围下限不能大于上限');
  return data;
}
export function initializeWorkspace(api) {
  window.addEventListener('language-change',()=>{
    if(latest.sources)renderWorkspace(latest);
    if($('#alert-dialog').open){
      $('#alert-dialog-title').textContent=t(latest.alerts?.rules.some(rule=>rule.id===ruleId)?'编辑告警':'新增告警');
      for(const option of $('#alert-form').elements.sourceId.options){
        const source=latest.sources?.find(source=>source.id===option.value);
        option.textContent=source?source.name+(source.kind==='demo'?t('（演示数据）'):''):t('原数据已删除，请重新选择');
      }
      updateNotes();
    }
    for(const id of ['alert-form-error','floating-settings-error']){const node=$(`#${id}`);if(node.textContent&&node._message)node.textContent=translateMessage(node._message);}
    if(floatingDirty){try{preview(floatingInput());}catch{floatingPreview.refreshLanguage();}}
  });
  floatingPreview=createFloatingPreview($('#floating-preview'));
  floatingChoices=initializeFormChoices($('#floating-settings'));
  $('#floating-settings').addEventListener('change',event=>{if(event.target.name==='textAlign')event.currentTarget.dispatchEvent(new Event('input'));});
  alertFormControls=initializeAlertFormControls($('#alert-form'),updateNotes);
  services=api;for(const button of document.querySelectorAll('[data-page]'))button.addEventListener('click',()=>showPage(button.dataset.page));window.monitor?.onPage(showPage);
  $('#add-alert').addEventListener('click',()=>{if(!latest.sources?.length)return services.toast(t('请先在“数据”页添加数据源'));openRule();});
  $('#alert-filters').addEventListener('click',event=>{const button=event.target.closest('[data-alert-filter]');if(button){alertFilter=button.dataset.alertFilter;renderWorkspace(latest);}});
  $('#alert-delete').addEventListener('click',()=>submitRule($('#alert-delete'),$('#alert-form-error'),ruleId,async()=>{services.update(await services.request('alertRemove',ruleId));$('#alert-dialog').close();services.toast(t('告警条目及其记录已删除'));}));
  for(const id of ['alert-close','alert-cancel'])$(`#${id}`).addEventListener('click',()=>$('#alert-dialog').close());
  for(const key of ['sourceId','type'])$('#alert-form').elements[key].addEventListener('change',updateNotes);
  $('#alert-form').elements.updateEvery.addEventListener('input',updateNotes);
  $('#alert-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;submitRule($('#alert-save'),$('#alert-form-error'),ruleId,async()=>{
    if(!form.checkValidity())throw new Error('请填写告警名称、检测数据和有效的记录倍率或更新次数');
    const old=latest.alerts.rules.find(r=>r.id===ruleId),data=await services.request('alertSave',{...ruleInput(form),id:ruleId,enabled:old?.enabled!==false,chartPoints:old?.chartPoints??20});
    services.update(data);$('#alert-dialog').close();services.toast(t(old?.enabled===false?'告警已保存，当前停止；点击开始启用':'告警已保存，等待有效记录'));
  });});
  $('#alert-list').addEventListener('click',event=>{const button=event.target.closest('[data-alert-action]');if(!button||button.disabled)return;const rule=latest.alerts.rules.find(r=>r.id===button.closest('[data-rule-id]').dataset.ruleId);if(!rule)return;
    if(button.dataset.alertAction==='edit'||(button.dataset.alertAction==='toggle'&&rule.migrationNote))return openRule(rule);
    if(button.dataset.alertAction==='chart'){const details=button.closest('[data-rule-id]').querySelector('details');details.open=!details.open;return renderWorkspace(latest);}
    const change=button.dataset.alertAction==='notifications'?{notificationsEnabled:rule.notificationsEnabled===false}:{enabled:!rule.enabled};
    submitRule(button,null,rule.id,async()=>services.update(await services.request('alertSave',{...rule,...change})));
  });
  const list=$('#alert-list');
  list.addEventListener('change',event=>{
    const select=event.target.closest('.chart-window');if(!select)return;
    const rule=latest.alerts.rules.find(r=>r.id===select.closest('[data-rule-id]').dataset.ruleId);
    if(!rule)return;
    submitRule(select,null,rule.id,async()=>{
      try{services.update(await services.request('alertSave',{...rule,chartPoints:Number(select.value)}));}
      catch(failure){select.value=chartPointCount(rule.chartPoints);throw failure;}
    });
  });
  let listWidth=0;
  new ResizeObserver(entries=>{
    const width=entries[0].contentRect.width;
    if(width>0&&width!==listWidth){listWidth=width;if(latest.sources&&!$('#alarms-page').hidden)renderWorkspace(latest);}
  }).observe(list);
  const showPoint=event=>{
    const point=event.target.closest('[data-point-time]');if(!point)return;
    const tooltip=point.closest('details').querySelector('.chart-tooltip');tooltip.hidden=false;tooltip.textContent=point.getAttribute('aria-label');tooltip.dataset.pointKey=point.dataset.pointKey;
  };
  const hidePoint=event=>{
    const point=event.target.closest('[data-point-time]');if(!point)return;
    const focused=point.closest('details').querySelector('[data-point-time]:focus');
    const tooltip=point.closest('details').querySelector('.chart-tooltip');tooltip.hidden=!focused;
    if(focused){tooltip.textContent=focused.getAttribute('aria-label');tooltip.dataset.pointKey=focused.dataset.pointKey;}
    else{tooltip.textContent='';delete tooltip.dataset.pointKey;}
  };
  list.addEventListener('focusin',showPoint);list.addEventListener('mouseover',showPoint);
  list.addEventListener('focusout',hidePoint);list.addEventListener('mouseout',hidePoint);
  $('#floating-settings').addEventListener('input',()=>{floatingDirty=true;floatingControls();try{preview(floatingInput());$('#floating-settings-error').textContent='';}catch(failure){$('#floating-settings-error').textContent=translateMessage($('#floating-settings-error')._message=failure.message);}});
  $('#floating-settings').addEventListener('submit',event=>{event.preventDefault();submit(event.currentTarget.querySelector('[type=submit]'),$('#floating-settings-error'),async()=>{const data=await services.request('floatingSettings',floatingInput());floatingDirty=false;services.update(data);services.toast(t('浮窗设置已保存'));});});
  $('#floating-reset').addEventListener('click',()=>submit($('#floating-reset'),$('#floating-settings-error'),async()=>{const data=await services.request('floatingSettings',DEFAULT_FLOATING_SETTINGS);floatingDirty=false;services.update(data);services.toast(t('浮窗已恢复默认'));}));
  $('#floating-page-toggle').addEventListener('click',()=>submit($('#floating-page-toggle'),null,()=>services.request('floating',!latest.floatingOpen)));
}

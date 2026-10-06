import { t, getLanguage, setLanguage, translateMessage, localeCode } from '../core/i18n.js';
import { initializeStaticLanguage } from './localized-dom.js';
import { parseFixed, progress } from '../core/metrics.js';
import { resourceCategory } from '../core/resource-status.js';
import { initializeWorkspace, renderWorkspace } from './workspace.js';
import { cardLayout } from './card-layout.js';
import { initializeSourceCadence } from './source-cadence.js';
import { initializeFormChoices } from './form-choices.js';
import {applyTheme,initializeThemes} from './themes.js';
import {hasSensitiveUrl} from '../core/sensitive-url.js';

document.documentElement.lang = getLanguage();
const staticLanguage = initializeStaticLanguage(document);
staticLanguage.refresh();
const api = window.monitor;
const $ = selector => document.querySelector(selector);
let state = { sources: [], storageError: '' }, filter = 'all', kind = 'web', editingId = null, deleteId = null;
let viewMode = 'card';
let testMode = false;
let savingAppSettings=false;
let pendingTheme=null;
const pendingSources=new Set();
const preferenceControls=[['floating-on-startup','floatingOnStartup'],['tray-single-click','traySingleClick'],['tray-double-click','trayDoubleClick']];
try{applyTheme(localStorage.getItem('monitorTheme'));}catch{applyTheme();}
const themeSelector=initializeThemes($('#theme-options'),theme=>saveStartupPreference('appSettings',{theme}));
try { const saved = localStorage.getItem('resourceViewMode'); if (['card', 'list'].includes(saved)) viewMode = saved; } catch {}
let toastTimer;
const localizedMessages = new Map();
let previewSample = null;
function messageText(message, values = {}) {
  return t(message).replace(/\{([^{}]+)\}/g, (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
function setMessage(selector, message, values = {}) {
  const node = typeof selector === 'string' ? $(selector) : selector;
  localizedMessages.set(node, { message, values });
  node.textContent = messageText(message, values);
}
function setError(selector, message) {
  const node = $(selector);
  node._originalError = message;
  node.textContent = translateMessage(message);
}

let formGeneration = 0;
const form = $('#source-form'), dialog = $('#source-dialog');
const discardingIds=new Set();
function discardUnsaved(id){
  if(!id||state.sources.some(source=>source.id===id)||discardingIds.has(id))return;
  discardingIds.add(id);
  void request('discard',id).catch(error=>toast(error.message)).finally(()=>discardingIds.delete(id));
}
function closeSourceDialog(){const id=editingId;formGeneration++;dialog.close();discardUnsaved(id);}
function protectUrlDisplay(){form.elements.url.type=hasSensitiveUrl(form.elements.url.value)?'password':'url';}
const needsWeb = () => kind === 'web' && (form.elements.valueMode.value === 'web' || form.elements.totalMode.value === 'web');
const sourceCadence=initializeSourceCadence({form,isTestMode:()=>testMode,needsWeb,onChange:()=>{updateInterval();$('#form-error').textContent='';$('#preview-output').hidden=true;}});
const sourceChoices=initializeFormChoices(form);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const number = value => Number(value).toLocaleString(localeCode(), { maximumFractionDigits: 4 });
const labels = { idle: '等待读取', refreshing: '正在更新', ok: '正常', auth: '需重新授权', rate: '请求受限', locator: '元素定位失败', parse: '数值解析失败', range: '实时数据大于总量数据', network: '连接失败' };

function toast(message) {
  setError('#toast', message); $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
async function request(action, ...args) {
  if (typeof api?.[action] !== 'function') throw new Error('桌面连接不可用，请重新打开应用');
  const result = await api[action](...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function age(time) {
  if (!time) return t('尚未成功读取');
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return t('刚刚更新');
  if (seconds < 3600) return messageText('{minutes} 分钟前更新', { minutes: Math.floor(seconds / 60) });
  return messageText('{hours} 小时前更新', { hours: Math.floor(seconds / 3600) });
}
function isStale(source) {
  return source.sample && (source.stale || Date.now() - source.lastSuccess > source.interval * 2000);
}
function category(source) { return resourceCategory(source, Date.now(), !!state.monitoringBlocked) === 'normal' ? 'normal' : 'abnormal'; }
function attention(source) { return category(source) === 'abnormal'; }
function resizeCards(){
  const container=$('#cards');
  if(container.dataset.view!=='card'||!container.clientWidth)return;
  const {columns,cardWidth}=cardLayout(container.clientWidth,container.children.length);
  container.style.setProperty('--card-columns',columns);
  container.style.setProperty('--card-width',`${cardWidth}px`);
}
function card(source) {
  const sample = source.sample, stale = isStale(source), ratio = progress(sample);
  const group = category(source);
  const explicitFailure = !['idle', 'ok', 'refreshing'].includes(source.status);
  const reason = source.enabled === false ? '已暂停' : state.monitoringBlocked ? '配置读取受阻' : source.failed && source.status === 'refreshing' ? '正在重试' : explicitFailure ? labels[source.status] || '采集失败' : stale ? '数据已过期' : labels[source.status] || '等待读取';
  const status = group === 'abnormal' ? messageText('监控异常 · {reason}', { reason: t(reason) }) : t(source.status === 'refreshing' ? '正在更新' : '正常');
  const kindLabel = t({ http: '接口', web: '网页', fixed: '固定数值', demo: '演示数据' }[source.kind] || source.kind);
  const statusClass = group === 'abnormal' ? 'attention' : source.status;
  const value = sample ? number(sample.value) : '—';
  const locked=pendingSources.has(source.id)||state.monitoringBlocked;
  const toggleLabel=t(source.enabled?'暂停监控':'恢复监控');
  const actions = `<div class="card-actions"><button data-action="edit" class="edit-card icon-control" aria-label="${escape(messageText('编辑：{name}',{name:source.name}))}" title="${t('编辑配置')}" ${locked?'disabled':''}>•••</button><button data-action="pause" class="monitor-toggle icon-control ${source.enabled?'stop-action':'start-action'}" aria-label="${escape(`${toggleLabel}：${source.name}`)}" title="${toggleLabel}" aria-pressed="${source.enabled!==false}" ${locked?'disabled':''}>${source.enabled?'■':'▶'}</button></div>`;
  return `<article class="metric-card ${stale ? 'stale' : ''}" data-id="${escape(source.id)}">
    <div class="card-top"><div class="source-symbol ${escape(source.kind)}" aria-hidden="true">${source.kind === 'web' ? '◈' : source.kind === 'http' ? '⌁' : '▥'}</div><span class="source-kind ${source.kind === 'demo' ? 'demo-tag' : ''}">${kindLabel}</span></div>
    <h2 title="${escape(source.name)}">${escape(source.name)}</h2>
    <div class="metric-value" title="${escape(`${value} ${source.unit || ''}`)}">${value}<span>${escape(source.unit)}</span></div>
    ${sample?.total !== null && sample?.total !== undefined ? `<div class="quota-meta"><span class="quota-total" title="${escape(messageText('总量数据 {value} {unit}', { value: number(sample.total), unit: source.unit || '' }))}"><span class="total-label">${t('总量数据')} </span><span class="total-value">${number(sample.total)}</span><span class="total-unit"> ${escape(source.unit)}</span></span><strong>${ratio === null ? t('比例不可用') : `${number(ratio)}%`}</strong></div><progress max="100" value="${ratio === null ? 0 : Math.min(100, ratio)}" aria-label="${escape(messageText('{name}占总量数据比例', { name: source.name }))}"></progress>` : `<div class="single-value-note">${t(sample ? '独立数值' : '尚无有效数据')}</div>`}
    <div class="card-error" ${!source.error ? 'hidden' : ''}><p>${escape(translateMessage(source.error))}</p>${source.kind !== 'demo' ? `<button data-action="edit" class="repair-button">${t('修改配置')}</button>` : ''}</div>
    <div class="card-bottom"><div><span class="status ${statusClass}"><span aria-hidden="true"></span>${status}${stale && source.status !== 'ok' ? t(' · 旧数据') : ''}</span><small data-last-success></small></div></div>
    ${actions}
  </article>`;
}
function render() {
  const theme=pendingTheme||state.appSettings?.theme;
  applyTheme(theme);themeSelector.render(theme,savingAppSettings||!!state.monitoringBlocked);
  $('#brand-icon').src=state.floatingOpen?'assets/mini-c.png':'assets/mini-w.png';
  $('#app-version').textContent=state.version||'0.1.0';
  if(!savingAppSettings){
    for(const [id,key] of preferenceControls)$('#'+id).checked=state.appSettings?.[key]!==false;
    $('#launch-at-login').checked=!!state.launchAtLogin;
  }
  for(const [id] of preferenceControls)$('#'+id).disabled=savingAppSettings||!!state.monitoringBlocked;
  $('#launch-at-login').disabled=savingAppSettings||!!state.monitoringBlocked||state.startupAvailable===false;
  $('#startup-availability').hidden=state.startupAvailable!==false;
  const sources = state.sources, issues = sources.filter(attention).length;
  $('#source-count').textContent = sources.length;
  $('#nav-count').textContent = sources.length;
  $('#healthy-count').textContent = sources.filter(s => category(s) === 'normal').length;
  $('#issue-count').textContent = issues;
  const visible = sources.filter(s => filter === 'all' || category(s) === filter);
  const container = $('#cards'); container.dataset.view = viewMode;
  for (const button of document.querySelectorAll('[data-view]')) { button.classList.toggle('selected', button.dataset.view === viewMode); button.setAttribute('aria-pressed', String(button.dataset.view === viewMode)); }
  const existing = new Map([...container.children].map(node => [node.dataset.id, node]));
  const wanted = new Set(visible.map(source => source.id));
  for (const [id, node] of existing) if (!wanted.has(id)) node.remove();
  visible.forEach((source, index) => {
    const html = card(source); let node = existing.get(source.id);
    if (!node || node._resourceHTML !== html) {
      const template = document.createElement('template'); template.innerHTML = html; const replacement = template.content.firstElementChild;
      replacement._resourceHTML = html;
      if (node) node.replaceWith(replacement); node = replacement;
    }
    if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null);
    const stamp = node.querySelector('[data-last-success]'); const success = source.lastSuccess;
    stamp.textContent = age(success); stamp.title = Number.isFinite(success) ? new Date(success).toLocaleString(localeCode()) : '';
  });
  resizeCards();
  $('#empty').hidden = visible.length > 0;
  $('#empty h2').textContent = t(sources.length ? '当前视图没有数据源' : '从第一个数据源开始');
  $('#empty p').textContent = t(sources.length ? '切换筛选查看其他数据源，或添加一个新的连接。' : '连接一个返回 JSON 的接口，或在登录后的网页里点击选择你关心的数值。');
  $('#empty-demo').hidden = sources.some(s => s.kind === 'demo');
  $('#storage-banner').hidden = !state.storageError;
  $('#storage-banner').textContent = translateMessage(state.storageError);
  const successes = sources.map(s => s.lastSuccess || 0);
  const latest = Math.max(0, ...successes);
  $('#updated-label').textContent = latest ? messageText('最近成功读取 {time}', { time: new Date(latest).toLocaleTimeString(localeCode(), { hour: '2-digit', minute: '2-digit' }) }) : t('尚未成功读取');
  renderWorkspace(state);
}
function refreshLanguage() {
  staticLanguage.refresh();
  for (const [node, { message, values }] of localizedMessages) node.textContent = messageText(message, values);
  for (const selector of ['#form-error', '#toast', '#app-settings-error']) {
    const node = $(selector);
    if (node._originalError && node.textContent) node.textContent = translateMessage(node._originalError);
  }
  for (const selector of ['#selected-value', '#selected-total']) {
    const node = $(selector);
    if (Object.hasOwn(node.dataset, 'selectionRaw')) node.textContent = node.dataset.selectionRaw;
  }
  sourceChoices.sync();
  sourceCadence.refresh();
  refreshModeText();
  if (previewSample && !$('#preview-output').hidden) renderPreview();
  window.dispatchEvent(new Event('language-change'));
}
function refreshLanguageToggle() {
  const button = $('#language-toggle');
  if (!button) return;
  button.textContent = getLanguage() === 'en' ? '中文' : 'English';
  const label = t('切换语言');
  button.title = label; button.setAttribute('aria-label', label);
}
function update(data) {
  const previousLanguage = getLanguage();
  if (data.language) setLanguage(data.language);
  document.documentElement.lang = getLanguage();
  state = data;
  if (getLanguage() !== previousLanguage) refreshLanguage();
  refreshLanguageToggle();
  render();
}
function refreshModeText() {
  const button = $('#test-mode-toggle');
  const label = t(testMode ? '退出测试模式' : '测试模式');
  button.textContent = label; button.title = label; button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(testMode));
  const indicator = $('#mode-indicator');
  if (indicator) { const mode = t(testMode ? '测试模式' : '常规模式'); indicator.textContent = mode; indicator.title = mode; }
}
refreshLanguageToggle();
$('#language-toggle')?.addEventListener('click', async () => {
  const button = $('#language-toggle');
  if (button.disabled) return;
  button.disabled = true;
  try { update(await request('language', getLanguage() === 'en' ? 'zh-CN' : 'en')); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
function applyTestMode(){
  refreshModeText();
  document.body.classList.toggle('test-mode',testMode);
  for(const node of document.querySelectorAll('[data-test-only]'))node.hidden=!testMode;
  updateInterval();
  sourceChoices.sync();window.dispatchEvent(new Event('test-mode-change'));
}
applyTestMode();
$('#test-mode-toggle').addEventListener('click',()=>{
  testMode=!testMode;
  applyTestMode();
});
async function saveStartupPreference(action,value) {
  if(savingAppSettings)return;
  if(action==='appSettings'&&value.theme){pendingTheme=value.theme;applyTheme(pendingTheme);}
  savingAppSettings=true;setError('#app-settings-error','');
  for(const [id] of preferenceControls)$('#'+id).disabled=true;$('#launch-at-login').disabled=true;
  themeSelector.render(pendingTheme||state.appSettings?.theme,true);
  try{update(await request(action,value));}
  catch(error){setError('#app-settings-error',error.message);}
  finally{savingAppSettings=false;pendingTheme=null;render();}
}
for(const [id,key] of preferenceControls)$('#'+id).addEventListener('change',event=>saveStartupPreference('appSettings',{[key]:event.target.checked}));
$('#launch-at-login').addEventListener('change',event=>saveStartupPreference('launchAtLogin',event.target.checked));
$('#repository-link').addEventListener('click',event=>{event.preventDefault();request('repository').catch(error=>toast(error.message));});
function setKind(next) {
  const previous = kind;
  kind = next;
  for (const button of document.querySelectorAll('[data-kind]')) button.classList.toggle('selected', button.dataset.kind === kind);
  if (kind === 'fixed') {
    form.elements.valueMode.value = 'fixed';
    if (form.elements.totalMode.value === 'web') form.elements.totalMode.value = 'none';
  } else if (kind === 'web' && previous === 'fixed') form.elements.valueMode.value = 'web';
  updateMetricFields();
  protectUrlDisplay();
  form.elements.url.placeholder = kind === 'http' ? 'https://example.com/api/usage' : 'https://example.com/dashboard';
  $('#preview-output').hidden = true; $('#form-error').textContent = '';
}
function updateMetricFields() {
  const metric = kind === 'web' || kind === 'fixed';
  const valueWeb = metric && kind === 'web' && form.elements.valueMode.value === 'web';
  const totalWeb = metric && kind === 'web' && form.elements.totalMode.value === 'web';
  const valueFixed = metric && !valueWeb, totalFixed = metric && form.elements.totalMode.value === 'fixed';
  const needsWeb = valueWeb || totalWeb, needsUrl = kind === 'http' || needsWeb;
  $('#http-fields').hidden = kind !== 'http'; $('#web-fields').hidden = !metric;
  $('#url-field').hidden = !needsUrl; $('#web-wait-fields').hidden = !needsWeb;
  $('#web-update-field').hidden = !needsWeb;
  form.elements.webUpdateMode.disabled = !needsWeb;
  updateInterval();
  $('#value-web-fields').hidden = !valueWeb; $('#total-web-fields').hidden = !totalWeb;
  $('#value-fixed-field').hidden = !valueFixed; $('#total-fixed-field').hidden = !totalFixed;
  form.elements.valueMode.querySelector('[value=web]').disabled = kind === 'fixed';
  form.elements.totalMode.querySelector('[value=web]').disabled = kind === 'fixed';
  for (const [name, active, required] of [
    ['url', needsUrl, needsUrl], ['valuePath', kind === 'http', kind === 'http'], ['totalPath', kind === 'http', false], ['token', kind === 'http', false], ['clearToken', kind === 'http', false],
    ['selector', valueWeb, valueWeb], ['totalSelector', totalWeb, totalWeb], ['fixedValue', valueFixed, valueFixed], ['fixedTotal', totalFixed, totalFixed], ['waitSeconds', needsWeb, needsWeb],
    ['valueMode', metric, false], ['totalMode', metric, false]
  ]) { form.elements[name].disabled = !active; form.elements[name].required = required; }
  sourceChoices.sync();
  $('#preview-output').hidden = true;
}
function updateInterval() {
  sourceCadence.sync();
  form.elements.interval.min = needsWeb() && form.elements.webUpdateMode.value !== 'live' ? '30' : '1';
  $('#fast-refresh-note').hidden = Number(form.elements.interval.value) >= 30;
}
function openForm(source = null) {
  if(!dialog.open)discardUnsaved(editingId);
  formGeneration++;
  for (const button of form.querySelectorAll('button')) button.disabled = false;
  form.reset(); editingId = source?.id || crypto.randomUUID();
  $('#source-actions').hidden=!source;
  $('#source-delete').hidden=!source;
  $('#source-login').hidden=source?.kind!=='web';
  $('#source-open').hidden=!source?.url;
  $('#source-form .kind-switch').hidden=source?.kind==='demo';
  // reset() skips disabled default options left by a fixed-value editor.
  form.elements.valueMode.value = 'web'; form.elements.totalMode.value = 'none';
  setMessage('#dialog-title', source ? '编辑数据源' : '添加数据源');
  setKind(source?.kind === 'fixed' ? 'web' : source?.kind || 'web');
  if (source) {
    for (const key of ['name', 'url', 'unit', 'valuePath', 'totalPath', 'selector', 'totalSelector', 'fixedValue', 'fixedTotal', 'interval', 'waitSeconds', 'webUpdateMode']) if (form.elements[key]) form.elements[key].value = source[key] ?? (key === 'waitSeconds' ? 3 : key === 'webUpdateMode' ? 'reload' : '');
    form.elements.valueMode.value = source.valueMode ?? (source.kind === 'fixed' ? 'fixed' : 'web');
    form.elements.totalMode.value = source.totalMode ?? (source.totalSelector ? 'web' : 'none');
  }
  updateMetricFields();protectUrlDisplay();
  setMessage('#token-note', source?.hasToken ? '已保存 · 留空保持不变' : '可选 · 本机加密保存');
  delete $('#selected-value').dataset.selectionRaw;
  setMessage('#selected-value', source?.selector ? '已保存元素' : '尚未选择');
  delete $('#selected-total').dataset.selectionRaw;
  setMessage('#selected-total', source?.totalSelector ? '已保存总量数据元素' : '未设置总量数据');
  $('#preview-output').hidden = true; $('#form-error').textContent = '';
  dialog.showModal(); form.elements.name.focus();
}
function inputConfig() {
  const data = Object.fromEntries(new FormData(form));
  const existing = state.sources.find(s => s.id === editingId);
  return { ...data, ...(kind==='demo'?{demoValue:existing?.demoValue,demoTotal:existing?.demoTotal}:{}),id: editingId, kind, interval: Number(data.interval), enabled: existing?.enabled !== false, clearToken: form.elements.clearToken.checked };
}
function validateForm() {
  $('#form-error').textContent = '';
  try {
    for (const [key, label] of [['fixedValue', '实时数据'], ['fixedTotal', '总量数据']]) if (!form.elements[key].disabled) parseFixed(form.elements[key].value, label);
    for (const [key, label] of [['selector', '实时数据'], ['totalSelector', '总量数据']]) {
      const field = form.elements[key];
      if (field.disabled) continue;
      if (!field.value.trim()) throw new Error(`${label}尚未选取，请选择网页数值元素或改为固定数值`);
      try { document.createElement('div').querySelector(field.value); }
      catch { throw new Error(`${label}选择器格式无效。请通过“网页选取”选择元素，或切换为固定数值；这里不能直接填写数字`); }
    }
    if (!form.checkValidity()) {
      const invalid = [...form.elements].find(field => field.willValidate && !field.validity.valid);
      const validity = invalid?.validity;
      const message = validity?.valueMissing ? '请填写此项' : validity?.typeMismatch ? '请输入有效网址' : validity?.badInput ? '请输入有效数字' : validity?.rangeUnderflow ? `请输入不小于 ${invalid.min} 的数值` : validity?.rangeOverflow ? `请输入不大于 ${invalid.max} 的数值` : validity?.stepMismatch ? '请输入符合步长的数值' : '请检查输入';
      const fieldLabels = { name: '名称', unit: '显示单位', url: '数据源网址', valuePath: '数值字段路径', totalPath: '总量数据字段路径', interval: '刷新周期（秒）', waitSeconds: '网页等待时间（秒）', fixedValue: '固定实时数据', fixedTotal: '固定总量数据', selector: '实时数据元素选择器', totalSelector: '总量数据元素选择器' };
      throw new Error(`${fieldLabels[invalid?.name] || '配置'}：${message}`);
    }
    return true;
  } catch (failure) { setError('#form-error', failure.message); return false; }
}
form.elements.url.addEventListener('input', () => {
  protectUrlDisplay();
  const source = state.sources.find(s => s.id === editingId);
  if (!source?.hasToken) return;
  try {
    setMessage('#token-note', new URL(form.elements.url.value).origin === new URL(source.url).origin ? '已保存 · 留空保持不变' : '网址来源已变化 · 需要重新填写');
  } catch { setMessage('#token-note', '已保存 · 仅用于原网址来源'); }
});
function busy(button, operation, isCurrent = () => true) {
  if (button.disabled) return;
  button.disabled = true;
  const generation = formGeneration, inDialog = dialog.open && button.closest('dialog')===dialog;
  return operation().catch(error => {
    if (inDialog) { if (dialog.open && formGeneration === generation && isCurrent()) setError('#form-error', error.message); }
    else toast(error.message);
  }).finally(() => { if (!inDialog || formGeneration === generation) button.disabled = false; });
}
dialog.addEventListener('close', () => {
  if(dialog.open)return;
  formGeneration++;
  discardUnsaved(editingId);
});
dialog.addEventListener('cancel',event=>{event.preventDefault();closeSourceDialog();});
for (const button of [$('#add-button'), $('#empty-add')]) button.addEventListener('click', () => openForm());
for (const button of [$('#close-dialog'), $('#cancel-dialog')]) button.addEventListener('click', closeSourceDialog);
for (const button of document.querySelectorAll('[data-kind]')) button.addEventListener('click', () => setKind(button.dataset.kind));
for (const key of ['valueMode', 'totalMode', 'webUpdateMode']) form.elements[key].addEventListener('change', () => { updateMetricFields(); $('#form-error').textContent = ''; });
form.addEventListener('input', () => { updateInterval(); $('#form-error').textContent = ''; $('#preview-output').hidden = true; });
form.addEventListener('submit', event => {
  event.preventDefault();
  if (!validateForm()) return;
  const generation = formGeneration, config = inputConfig();
  busy($('#save-button'), async () => { const next = await request('save', config); update(next); if (generation === formGeneration && dialog.open) closeSourceDialog(); toast('数据源已保存，正在读取'); });
});
$('#preview-button').addEventListener('click', () => {
  if (!validateForm()) return;
  const config = inputConfig();
  busy($('#preview-button'), async () => {
    const generation = formGeneration;
    $('#form-error').textContent = ''; $('#preview-output').hidden = true;
    const sample = await request('preview', config);
    if (!dialog.open || generation !== formGeneration || JSON.stringify(config) !== JSON.stringify(inputConfig())) return;
    previewSample = sample; renderPreview();
    $('#preview-output').hidden = false;
  }, () => JSON.stringify(config) === JSON.stringify(inputConfig()));
});
function renderPreview() {
  const sample = previewSample;
  $('#preview-output').textContent = messageText(sample.total === null ? '读取成功：{value} {unit}' : '读取成功：{value} {unit} / 总量数据 {total} {unit}', { value: number(sample.value), total: number(sample.total), unit: sample.unit || '' });
}
async function pick(total) {
  const button = total ? $('#pick-total') : $('#pick-value');
  if (!form.elements.url.reportValidity()) return;
  return busy(button, async () => {
    const generation = formGeneration, id = editingId, originalKind = kind, mode = form.elements[total ? 'totalMode' : 'valueMode'].value;
    $('#form-error').textContent = '';
    const url = form.elements.url.value;
    const result = await request('pick', { url, id });
    if (!dialog.open || generation !== formGeneration || editingId !== id || kind !== originalKind || form.elements.url.value !== url || form.elements[total ? 'totalMode' : 'valueMode'].value !== mode) return;
    if (!result) return;
    if (result.url !== url && (total ? form.elements.valueMode.value === 'web' && form.elements.selector.value : form.elements.totalMode.value === 'web' && form.elements.totalSelector.value)) throw new Error('实时数据和总量数据需要来自同一页面，请返回已选数值所在页面再选取');
    editingId = result.id;
    form.elements.url.value = result.url;
    protectUrlDisplay();
    form.elements[total ? 'totalSelector' : 'selector'].value = result.selector;
    const selected = $(total ? '#selected-total' : '#selected-value');
    localizedMessages.delete(selected); selected.dataset.selectionRaw = result.raw; selected.textContent = result.raw;
  });
}
$('#pick-value').addEventListener('click', () => pick(false));
$('#pick-total').addEventListener('click', () => pick(true));
$('#clear-total').addEventListener('click', () => { form.elements.totalSelector.value = ''; form.elements.totalMode.value = 'none'; updateMetricFields(); delete $('#selected-total').dataset.selectionRaw; setMessage('#selected-total', '未设置总量数据'); });
$('#empty-demo').addEventListener('click', () => busy($('#empty-demo'), async () => { update(await request('demo')); toast('已载入演示数据，数值为模拟示例'); }));
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  viewMode = button.dataset.view; try { localStorage.setItem('resourceViewMode', viewMode); } catch {} render();
});
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => {
  filter = button.dataset.filter;
  for (const item of document.querySelectorAll('[data-filter]')) { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); }
  render();
});
$('#cards').addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const source = state.sources.find(s => s.id === button.closest('[data-id]').dataset.id); if (!source) return;
  const action = button.dataset.action;
  if(pendingSources.has(source.id)||button.disabled)return;
  if (action === 'edit') return openForm(source);
  if(action==='pause'){
    pendingSources.add(source.id);render();
    request('save',{...source,enabled:!source.enabled}).then(update).catch(error=>toast(error.message)).finally(()=>{pendingSources.delete(source.id);render();});
  }
});
$('#source-delete').addEventListener('click',()=>{
  const source=state.sources.find(s=>s.id===editingId);if(!source)return;
  deleteId=source.id;setMessage('#delete-title','删除“{name}”？',{name:source.name});
  const count=state.alerts.rules.filter(rule=>rule.sourceId===source.id).length;
  setMessage('#delete-description',count?'该数据源的配置、缓存和授权信息将删除。同时删除关联的 {count} 条告警及其记录、图表和提醒回执。':'该数据源的配置、缓存和授权信息将删除。该数据源没有关联告警。',{count});
  $('#delete-dialog').showModal();
});
for(const [id,action] of [['source-login','login'],['source-open','open']])$('#'+id).addEventListener('click',()=>{
  const source=state.sources.find(s=>s.id===editingId);if(!source)return;
  busy($('#'+id),async()=>{await request(action,source.id);if(action==='login')toast('请在网页窗口完成登录，然后保存配置或使用托盘“刷新全部”。');});
});
$('#delete-cancel').addEventListener('click', () => $('#delete-dialog').close());
$('#delete-confirm').addEventListener('click', () => busy($('#delete-confirm'), async () => {
  const removedId=deleteId,next=await request('remove',removedId); update(next); $('#delete-dialog').close();
  if(dialog.open&&editingId===removedId)closeSourceDialog();
  toast(next.cleanupWarning|| (next.removedAlertCount?`数据源及关联的 ${next.removedAlertCount} 条告警已删除`:'数据源已删除'));
}));
new ResizeObserver(resizeCards).observe($('#cards'));
initializeWorkspace({ request, update, toast });
if (api) {
  api.onUpdate(update);
  request('snapshot').then(update).catch(error => toast(error.message));
  setInterval(render, 30000);
} else {
  state.storageError = '请通过桌面应用打开：在项目目录运行 npm start。'; render();
}

import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, safeStorage, shell, powerMonitor, globalShortcut, screen } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Monitor } from '../core/monitor.js';
import { Store } from '../core/storage.js';
import { validateSource, validateUrl } from '../core/config.js';
import { extractSample, parseValue } from '../core/metrics.js';
import { WebSources } from './web-source.js';
import { selectToken } from '../core/credentials.js';
import { AlertEngine, sourceIdentity } from '../core/alerts.js';
import { DEFAULT_FLOATING_SETTINGS, validateFloatingSettings, floatingRowHeight } from '../core/floating-settings.js';
import { DesktopNotifications } from './notifications.js';
import { HttpSources } from '../core/http-sources.js';
import { CheckpointWriter } from '../core/checkpoint.js';
import { placeFloating } from './floating-bounds.js';
import { savedFloatingPosition, floatingPlacement } from './floating-position.js';
import {t,getLanguage,setLanguage,LANGUAGES} from '../core/i18n.js';
import { appSettings as restoreAppSettings, validateAppSettings } from '../core/app-settings.js';
import { StartupPreference } from './startup.js';
import {themeById} from '../core/themes.js';
import {EventEmitter} from 'node:events';
import {TrayInteractions,systemDoubleClickTime} from './tray-interactions.js';
import {StateTransactions} from '../core/state-transactions.js';
import {hasSensitiveUrl} from '../core/sensitive-url.js';
import {floatingSnapshot as displaySnapshot} from '../core/floating-snapshot.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const uiFile = join(root, 'ui', 'index.html');
const uiUrl = pathToFileURL(uiFile).href;
const floatingFile = join(root, 'ui', 'floating.html');
const floatingUrl = pathToFileURL(floatingFile).href;
const uiUrls = new Set([uiUrl, floatingUrl]);
const smoke = process.argv.includes('--smoke');
if (smoke) {
  const index = process.argv.indexOf('--smoke-data');
  if (index >= 0 && process.argv[index + 1]) app.setPath('userData', process.argv[index + 1]);
}
const localWindows = new Set();
let mainWindow, floatingWindow, tray, monitor, store, web, scheduler;
let dashboardActive=true;
let dashboardIdleTimer,dashboardView=null,dashboardGeometry=null;
const dashboardIdleDelay=smoke&&process.argv.includes('--empty-memory-only')&&!process.argv.includes('--real-idle-delay')?1000:15000;
function cancelDashboardIdle(){clearTimeout(dashboardIdleTimer);dashboardIdleTimer=null;}
function scheduleDashboardIdle(){
  cancelDashboardIdle();
  const window=mainWindow;
  const eligible=()=>window&&!window.isDestroyed()&&!window.isVisible()&&!window.isMinimized()&&!quitting&&!mutationBusy&&![...monitor.sources.values()].some(source=>source.enabled!==false)&&!floatingWindow&&!provisionalIds.size&&web.windows.size===0;
  if(!eligible())return;
  dashboardIdleTimer=setTimeout(async()=>{
    dashboardIdleTimer=null;
    if(!eligible())return;
    try{
      const view=await withDeadline(window.webContents.executeJavaScript('window.dashboardLifecycle?.capture()'),1000,'Dashboard state unavailable');
      if(!eligible()||!view?.clean)return;
      dashboardView=view;
      const bounds=window.getNormalBounds();
      // Do not accumulate native frame/DPI rounding on successive recreations.
      if(!dashboardGeometry||Object.keys(bounds).some(key=>Math.abs(bounds[key]-dashboardGeometry.bounds[key])>3))dashboardGeometry={bounds,maximized:window.isMaximized()};
      else dashboardGeometry.maximized=window.isMaximized();
      dashboardActive=false;window.destroy();
    }catch{/* Keep the window if state capture is unavailable; never lose a draft. */}
  },dashboardIdleDelay);
}
let tokens = Object.create(null), ready = false, quitting = false, readOnly = false, storageError = '';
let transactions,mutationBusy=false,broadcastTimer,resourceTimer;
const provisionalIds=new Set();
let floatingDragging=false, fittingFloating=false, floatingMoveTimer;
let floatingLayoutKey=null;
let floatingPosition=null;
let appSettings=restoreAppSettings(), launchAtLogin=false, startupPreference;
let trayEvents,trayInteractions;
const iconFile = name => join(root,'ui','assets',`${name}.ico`);
const statusIcon = () => iconFile(floatingWindow&&!floatingWindow.isDestroyed()?'mini-c':'mini-w');
function updateIcons() {
  const icon=statusIcon();
  for(const window of localWindows)if(!window.isDestroyed())window.setIcon(icon);
  web?.updateIcons();
  if(tray&&!tray.isDestroyed())tray.setImage(nativeImage.createFromPath(icon).resize({width:16,height:16}));
}
let alerts, notificationService, httpSources, checkpoint, notificationInfo = '', floatingSettings = { ...DEFAULT_FLOATING_SETTINGS };

function snapshot() {
  return { sources: monitor.snapshot().map(source => ({ ...source, hasToken: Object.hasOwn(tokens,source.id)&&typeof tokens[source.id]==='string'&&!!tokens[source.id] })), language:getLanguage(), appSettings, launchAtLogin, startupAvailable:app.isPackaged||smoke, version:app.getVersion(), storageError, monitoringBlocked: readOnly, floatingOpen: !!floatingWindow && !floatingWindow.isDestroyed(), floatingSettings, alerts: alerts.snapshot(), notificationInfo };
}
function broadcast() {
  if(quitting||broadcastTimer)return;
  broadcastTimer=setTimeout(()=>{broadcastTimer=null;broadcastNow();},40);
}
function broadcastNow() {
  if(quitting)return;
  fitFloating();
  for (const window of localWindows) if (!window.isDestroyed()) {
    if(window===floatingWindow)window.webContents.send('monitor:update',floatingSnapshot());
    else if(dashboardActive)window.webContents.send('monitor:update',snapshot());
  }
}
function floatingSnapshot(){return displaySnapshot(monitor.snapshot(),floatingSettings,getLanguage());}
async function persist(throwOnError = false) {
  if (!ready || readOnly) return;
  if(mutationBusy){checkpoint?.schedule();return;}
  try { await store.save({ sources: monitor.snapshot(), tokens, alerts: alerts.serialize(), floatingSettings, floatingPosition, appSettings, language:getLanguage() }); if (storageError) { storageError = ''; broadcast(); } }
  catch { storageError = '配置保存失败，请检查磁盘空间与系统凭证存储。'; broadcast(); if (throwOnError) throw new Error(storageError); }
}
function storedState(overrides={}) {
  return {sources:monitor.snapshot(),tokens,alerts:alerts.serialize(),floatingSettings,floatingPosition,appSettings,language:getLanguage(),...overrides};
}
function applyWebResourceSettings() {
  const retry=[...web.resourceErrors.keys()];
  if(!web.configureResources(appSettings))return;
  clearInterval(resourceTimer);resourceTimer=null;
  if(!smoke&&appSettings.lowUsageMode)resourceTimer=setInterval(()=>{
    if(!quitting)web.checkResources(app.getAppMetrics());
  },web.checkIntervalMs);
  // Release a resource cooldown without disturbing paused or healthy sources.
  if(ready&&!readOnly&&!quitting)for(const id of retry)void monitor.refresh(id);
}
function requireSecretStorage() {
  if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw new Error('系统加密不可用，无法安全保存 Token');
}
function linkedTokens(){return Object.assign(Object.create(null),tokens);}
async function withDeadline(work,milliseconds,message){
  let timer;
  try{return await Promise.race([work,new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error(message)),milliseconds);})]);}
  finally{clearTimeout(timer);}
}
function sourceRecord(previous,source){
  const keys=['kind','url','valuePath','totalPath','selector','totalSelector','valueMode','totalMode','fixedValue','fixedTotal','waitSeconds','webUpdateMode','unit','demoValue','demoTotal'];
  const unchanged=previous&&keys.every(key=>previous[key]===source[key]);
  return unchanged?{...previous,...source}:source;
}
async function cleanupSource(id,createProfile=false){
  let timer;
  try{await Promise.race([createProfile?web.clear(id):web.discard(id),new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('数据已删除，但登录信息清理未完成；请退出软件后重试清理')),5000);})]);return '';}
  catch(error){return error.message;}
  finally{clearTimeout(timer);}
}
function createWindow(floating = false) {
  if(floating)floatingLayoutKey=null;
  const area = floating ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea : null;
  const size = floating ? floatingSize() : null;
  const placement = floating ? floatingPlacement(floatingPosition,size,screen.getAllDisplays().map(display=>display.workArea),area) : null;
  const window = new BrowserWindow({
    ...(floating ? {
      ...placement, minWidth: 1, minHeight: 1, frame: false, transparent: true,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      hasShadow: false, roundedCorners: true, thickFrame: false, skipTaskbar: true
    } : { ...(dashboardGeometry?.bounds||{width:1260,height:820}), minWidth: 760, minHeight: 520 }),
    title: floating ? t('My Monitor · 浮窗') : 'My Monitor',
    icon:statusIcon(),
    backgroundColor: floating ? '#00000000' : themeById(appSettings.theme).colors.bg, show: floating ? false : !smoke, alwaysOnTop: floating,
    autoHideMenuBar: true,
    webPreferences: { preload: join(root, 'desktop', 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  let closing = false;
  window.once('close', () => { closing = true; });
  localWindows.add(window);
  if (floating) {
    window.once('ready-to-show', () => {
      if(window.isDestroyed() || closing)return;
      fitFloating(); window.show(); window.focus(); pinFloating(window);
    });
    window.on('will-move', () => { floatingDragging=true; clearTimeout(floatingMoveTimer); });
    window.on('moved', () => { floatingDragging=false; clearTimeout(floatingMoveTimer); fitFloating(); rememberFloatingPosition(window); });
    window.on('move', () => {
      if(floatingDragging || fittingFloating)return;
      clearTimeout(floatingMoveTimer);floatingMoveTimer=setTimeout(()=>{fitFloating();rememberFloatingPosition(window);},80);
    });
    window.on('close',()=>{fitFloating(true);rememberFloatingPosition(window);});
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== (floating ? floatingUrl : uiUrl)) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.on('closed', () => {
    localWindows.delete(window);
    if(!floating&&mainWindow===window)mainWindow=null;
    if (floating && floatingWindow === window) { clearTimeout(floatingMoveTimer); floatingDragging=false; floatingLayoutKey=null; floatingWindow = null; updateTrayMenu(); if (!quitting) {broadcast();scheduleDashboardIdle();} }
  });
  window.webContents.on('render-process-gone',()=>{
    if(window.isDestroyed()||quitting)return;
    window.destroy();
  });
  if(!floating){
    dashboardActive=true;
    const activity=active=>{
      if(window.isDestroyed()||quitting)return;
      dashboardActive=active;window.webContents.send('monitor:activity',active);
      if(active)window.webContents.send('monitor:update',snapshot());
    };
    window.on('hide',()=>{activity(false);scheduleDashboardIdle();});window.on('minimize',()=>{cancelDashboardIdle();activity(false);});
    window.on('show',()=>{cancelDashboardIdle();activity(true);});window.on('restore',()=>{cancelDashboardIdle();activity(true);});
    window.on('close',event=>{if(!quitting&&tray){event.preventDefault();window.hide();}});
  }
  void window.loadFile(floating ? floatingFile : uiFile).catch(error => { if (!closing && !window.isDestroyed()) console.error('窗口加载失败:', error.message); });
  return window;
}
function rememberFloatingPosition(window=floatingWindow){
  if(!window || window.isDestroyed())return;
  const position=savedFloatingPosition(window.getBounds());
  if(position && (position.x!==floatingPosition?.x || position.y!==floatingPosition?.y)){
    floatingPosition=position;if(ready&&!readOnly)checkpoint?.schedule();
  }
}
function showMain(page) {
  cancelDashboardIdle();
  const target=['data','alarms','floating','settings'].includes(page)?page:null;
  const restoring=!mainWindow||mainWindow.isDestroyed();
  if(restoring&&target)dashboardView={...dashboardView,page:target};
  if (!mainWindow || mainWindow.isDestroyed()) {mainWindow = createWindow();if(dashboardGeometry){mainWindow.setBounds(dashboardGeometry.bounds);if(dashboardGeometry.maximized)mainWindow.maximize();}}
  mainWindow.show(); if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus();
  if(!restoring&&target)mainWindow.webContents.send('monitor:page',target);
}
function pinFloating(window) {
  // Electron's default Windows level moves the window behind the taskbar. If the taskbar
  // isn't topmost, Windows also removes our topmost flag; this level avoids that demotion.
  window.setAlwaysOnTop(true, process.platform === 'win32' ? 'pop-up-menu' : 'floating');
}
function showFloating() {
  if (!floatingWindow || floatingWindow.isDestroyed()) floatingWindow = createWindow(true);
  else { floatingWindow.show(); floatingWindow.focus(); pinFloating(floatingWindow); }
  updateTrayMenu(); broadcast();
}
function floatingSize() {
  const rows = Math.max(1, monitor.sources.size);
  const width = 54 + floatingSettings.barWidth + (floatingSettings.showName ? 28 : 0) + (floatingSettings.showPercent ? 48 : 0);
  return { width, height: Math.min(600, 54 + rows * floatingRowHeight(floatingSettings) + (rows - 1) * 12) };
}
function fitFloating(force=false) {
  if(force){floatingDragging=false;clearTimeout(floatingMoveTimer);}
  if (!floatingWindow || floatingWindow.isDestroyed() || floatingDragging || fittingFloating) return;
  const bounds = floatingWindow.getBounds();
  const size=floatingSize(),displays=screen.getAllDisplays();
  const layoutKey=JSON.stringify([size,screen.getDisplayMatching(bounds).id,displays.map(display=>[display.id,display.scaleFactor,display.workArea])]);
  const layoutChanged=layoutKey!==floatingLayoutKey;
  // Native DIP/pixel conversion can round BOTH dimensions whenever one changes.
  // Remember the requested layout, never feed a partly rounded native size back
  // as the next resize target. Numeric updates preserve the existing native size.
  const next=placeFloating(layoutChanged?{...bounds,...size}:bounds,displays.map(display=>display.workArea));
  if (Object.keys(next).some(key => Math.abs(next[key]-bounds[key])>(layoutChanged?0:1))) {
    fittingFloating=true;
    try{
      if(next.width===bounds.width && next.height===bounds.height)floatingWindow.setPosition(next.x,next.y);
      else floatingWindow.setBounds(next);
    }finally{fittingFloating=false;}
  }
  floatingLayoutKey=layoutKey;
}
function setFloating(open) {
  if (open) showFloating();
  else if (floatingWindow && !floatingWindow.isDestroyed()) {
    // This display-only window has no unsaved editor state. Record its placement
    // before destroying so a tray close cannot wait for an initializing compositor.
    fitFloating(true);rememberFloatingPosition(floatingWindow);floatingWindow.destroy();
  }
  return !!floatingWindow && !floatingWindow.isDestroyed();
}
function updateTrayMenu() {
  updateIcons();
  if (!tray || tray.isDestroyed()) return;
  const open = !!floatingWindow && !floatingWindow.isDestroyed();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('打开主界面'), click: showMain }, { label: t(open ? '关闭浮窗' : '打开浮窗'), click: () => setFloating(!open) },
    { label: t('刷新全部'), click: () => { void monitor.refreshAll(); } }, { type: 'separator' },
    { label: t('退出'), click: () => { app.quit(); } }
  ]));
}
function requireWritable() { if(quitting)throw new Error('软件正在退出，请稍后重试');if (readOnly) throw new Error('现有配置无法读取，已停止写入以保留原文件。请查看使用说明中的恢复步骤。'); }
function requireSource(id) { const source = monitor.sources.get(id); if (!source) throw new Error('数据源不存在'); return source; }
function handle(channel, action) {
  ipcMain.handle(`monitor:${channel}`, async (event, input) => {
    const url = event.senderFrame?.url;
    const authorized = [...localWindows].some(window => !window.isDestroyed() && window.webContents === event.sender);
    if (!authorized || event.senderFrame !== event.sender.mainFrame || !uiUrls.has(url)) return { ok: false, error: '不允许此请求' };
    try { return { ok: true, data: await action(input,event) }; }
    catch (error) { return { ok: false, error: error.message || '操作失败，请重试' }; }
  });
}
async function addDemo() {
  requireWritable();
  return transactions.run(()=>{
    const additions=[
    { id: 'demo-traffic', name: '套餐流量', unit: 'GB', demoValue: 36.5, demoTotal: 100 },
    { id: 'demo-credit', name: 'API 可用余额', unit: 'USD', demoValue: 24.8, demoTotal: null },
    { id: 'demo-budget', name: '本月预算已用', unit: 'USD', demoValue: 76, demoTotal: 100 }
    ].filter(item=>!monitor.sources.has(item.id)).map(item=>validateSource({...item,kind:'demo',interval:60,enabled:true}));
    return {additions,state:storedState({sources:[...monitor.snapshot(),...additions]})};
  },candidate=>{for(const item of candidate.additions)monitor.upsert(item);void monitor.refreshAll();return snapshot();});
}
function registerHandlers() {
  handle('snapshot', (_input,event) => event.sender===floatingWindow?.webContents?floatingSnapshot():{...snapshot(),dashboardView});
  handle('appSettings', async input => {
    requireWritable();return transactions.run(()=>{const settings=validateAppSettings(input,appSettings);return {settings,state:storedState({appSettings:settings})};},candidate=>{
      appSettings=candidate.settings;trayInteractions?.cancel();
      applyWebResourceSettings();
      if(mainWindow&&!mainWindow.isDestroyed())mainWindow.setBackgroundColor(themeById(appSettings.theme).colors.bg);
      broadcast();return snapshot();
    });
  });
  handle('launchAtLogin', value => {
    requireWritable();launchAtLogin=startupPreference.set(value);broadcast();return snapshot();
  });
  handle('repository', () => shell.openExternal('https://github.com/Jiang-Felix/My_Monitor'));
  handle('language', async value => {
    requireWritable();
    if(!LANGUAGES.includes(value))throw new Error('Unsupported language');
    return transactions.run(()=>({state:storedState({language:value})}),()=>{
      setLanguage(value);updateTrayMenu();web.updateLanguage();
      if(floatingWindow&&!floatingWindow.isDestroyed())floatingWindow.setTitle(t('My Monitor · 浮窗'));
      broadcast();return snapshot();
    });
  });
  handle('save', async input => {
    requireWritable();
    return transactions.run(()=>{
      const source=validateSource(input),previous=monitor.sources.get(source.id);
      if(!previous&&monitor.sources.size>=100)throw new Error('最多支持100个数据源');
      if(input.token!==undefined&&(typeof input.token!=='string'||input.token.length>8192||/[\r\n]/.test(input.token)))throw new Error('Token 格式无效');
      const token=source.kind==='http'?selectToken(source,previous,Object.hasOwn(tokens,source.id)?tokens[source.id]:'',input.token,input.clearToken):'';
      if(token||hasSensitiveUrl(source.url))requireSecretStorage();
      const nextTokens=linkedTokens();if(token)nextTokens[source.id]=token;else delete nextTokens[source.id];
      const draft=alerts.fork();if(previous&&sourceIdentity(previous)!==sourceIdentity(source))draft.resetSource(source.id);
      const sources=monitor.snapshot();const index=sources.findIndex(item=>item.id===source.id);
      if(index>=0)sources[index]=sourceRecord(previous,source);else sources.push(sourceRecord(previous,source));
      return {source,previous,nextTokens,state:storedState({sources,tokens:nextTokens,alerts:draft.serialize()})};
    },candidate=>{
      const {source,previous}=candidate;
      if(previous&&sourceIdentity(previous)!==sourceIdentity(source))alerts.resetSource(source.id);
      if(!source.enabled||source.kind!=='web'||(previous&&sourceIdentity(previous)!==sourceIdentity(source)))web.close(source.id);
      httpSources.clear(source.id);tokens=candidate.nextTokens;provisionalIds.delete(source.id);
      monitor.upsert(source);void monitor.refresh(source.id);return snapshot();
    });
  });
  handle('remove', async id => {
    requireWritable();return transactions.run(()=>{
      const source=requireSource(id),draft=alerts.fork(),removedAlertCount=draft.removeSource(id),nextTokens=linkedTokens();delete nextTokens[id];
      return {removedAlertCount,nextTokens,clearProfile:source.kind==='web',state:storedState({sources:monitor.snapshot().filter(source=>source.id!==id),tokens:nextTokens,alerts:draft.serialize()})};
    },async candidate=>{
      alerts.removeSource(id);monitor.remove(id);tokens=candidate.nextTokens;httpSources.clear(id);provisionalIds.delete(id);
      const cleanupWarning=await cleanupSource(id,candidate.clearProfile);return {...snapshot(),removedAlertCount:candidate.removedAlertCount,cleanupWarning};
    });
  });
  handle('refresh', async id => { requireWritable();if (id) { requireSource(id); await monitor.refresh(id); } else await monitor.refreshAll(); return snapshot(); });
  handle('preview', async input => {
    requireWritable();
    const source = validateSource(input);
    if(!monitor.sources.has(source.id)){if(provisionalIds.size>=16&&!provisionalIds.has(source.id))throw new Error('临时选取任务过多，请关闭未完成的窗口');provisionalIds.add(source.id);}
    const token = selectToken(source, monitor.sources.get(source.id), Object.hasOwn(tokens,source.id)?tokens[source.id]:'', input.token, input.clearToken);
    const payload = source.kind === 'http' ? await httpSources.collect(source, token) : source.kind === 'demo' ? { value: source.demoValue, total: source.demoTotal } : source.kind === 'fixed' ? {} : await web.collect(source);
    return extractSample(source, payload);
  });
  handle('pick', async input => {
    requireWritable();
    const id = input.id || randomUUID();
    if (typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('账户标识无效');
    if(!monitor.sources.has(id)){if(provisionalIds.size>=16&&!provisionalIds.has(id))throw new Error('临时选取任务过多，请关闭未完成的窗口');provisionalIds.add(id);}
    const result = await web.pick(validateUrl(input.url), id);
    if (!result) return null;
    parseValue(result.raw);
    return { ...result, id };
  });
  handle('discard', async id=>{
    return transactions.runExclusive(async()=>{
      if(monitor.sources.has(id)||!provisionalIds.has(id))return null;
      httpSources.clear(id);const warning=await cleanupSource(id);
      if(warning)throw new Error(warning);provisionalIds.delete(id);return null;
    });
  });
  handle('login', id => web.login(requireSource(id)));
  handle('open', id => shell.openExternal(validateUrl(requireSource(id).url)));
  handle('floating', input => {
    if (input !== undefined && typeof input !== 'boolean') throw new Error('悬浮窗开关无效');
    return setFloating(input ?? !snapshot().floatingOpen);
  });
  handle('demo', addDemo);
  handle('alertSave', async input => {
    requireWritable(); requireSource(input.sourceId);
    return transactions.run(()=>{const draft=alerts.fork(),rule=draft.upsert(input,requireSource(input.sourceId));return {rule,state:storedState({alerts:draft.serialize()})};},candidate=>{alerts.upsert(candidate.rule,requireSource(candidate.rule.sourceId));broadcast();return snapshot();});
  });
  handle('alertRemove', async id => { requireWritable();return transactions.run(()=>{const draft=alerts.fork();draft.remove(id);return {state:storedState({alerts:draft.serialize()})};},()=>{alerts.remove(id);broadcast();return snapshot();}); });
  handle('floatingSettings', async input => {
    requireWritable();return transactions.run(()=>{const settings=validateFloatingSettings(input);return {settings,state:storedState({floatingSettings:settings})};},candidate=>{floatingSettings=candidate.settings;broadcast();return snapshot();});
  });
  handle('notificationTest', () => notificationService.test());
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    web = new WebSources({getIcon:statusIcon});
    // Native smoke runs never change the user's Windows startup registration.
    let smokeRegistration=false;
    const startupApp=smoke?{isPackaged:true,getLoginItemSettings:()=>({openAtLogin:smokeRegistration}),setLoginItemSettings:options=>{smokeRegistration=options.openAtLogin;}}:app;
    startupPreference=new StartupPreference(startupApp,process.execPath);
    notificationService = new DesktopNotifications({ enabled: !smoke, onDelivery: (id, status, message) => {
      alerts.updateDelivery(id, status, message); if (ready && !quitting) { broadcast(); checkpoint?.schedule(); }
    }, onClick: () => {
      showMain('alarms');
    } });
    notificationInfo = await notificationService.init();
    // Read registration after notification initialization establishes our Windows app identity.
    launchAtLogin=startupPreference.get();
    alerts = new AlertEngine({ onNotify: item => notificationService.send(item) });
    httpSources = new HttpSources();
    store = new Store(join(app.getPath('userData'), 'monitor-state.json'), {
      encrypt: value => {requireSecretStorage();return safeStorage.encryptString(value).toString('base64');},
      decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64'))
    });
    monitor = new Monitor({
      collect: (source,options) => source.kind === 'http' ? httpSources.collect(source, Object.hasOwn(tokens,source.id)?tokens[source.id]:'',options) : source.kind === 'web' ? web.collect(source,options) : source.kind === 'fixed' ? Promise.resolve({}) : Promise.resolve({ value: source.demoValue, total: source.demoTotal }),
      onChange: sources => { if (ready) { if (!readOnly && !quitting) alerts.observe(sources); broadcast(); if (!readOnly && !quitting) checkpoint.schedule(); } }
    });
    checkpoint = new CheckpointWriter({ write: () => persist() });
    transactions=new StateTransactions({write:(candidate,options)=>store.save(candidate.state,options),onBusy:busy=>{mutationBusy=busy;if(!busy&&!quitting){checkpoint.schedule();clearTimeout(broadcastTimer);broadcastTimer=null;broadcastNow();}},onUncertain:()=>{
      readOnly=true;storageError='配置提交状态无法确认，已暂停监控和保存；请退出软件后检查磁盘并重新打开';
      monitor.cancelAll();httpSources.closeAll();web.closeAll();broadcast();
    }});
    try {
      const state = await withDeadline(store.load(),8000,'配置读取超时'); tokens = state.tokens; monitor.restore(state.sources);
      setLanguage(state.language||'zh-CN');
      appSettings=restoreAppSettings(state.appSettings);
      floatingSettings = validateFloatingSettings(state.floatingSettings); floatingPosition=savedFloatingPosition(state.floatingPosition); alerts.startRun(state.alerts,monitor.snapshot());
    }
    catch { readOnly = true; storageError = '配置或凭证读取失败，已保留原文件并暂停保存。请查看 README 的恢复步骤。'; alerts.startRun(); }
    if(!readOnly){
      const cleanupController=new AbortController();
      await withDeadline(web.cleanupOrphans([...monitor.sources.keys()],app.getPath('userData'),{signal:cleanupController.signal}),5000,'临时登录信息清理超时').catch(()=>{cleanupController.abort();storageError='临时登录信息清理未完成，请退出软件后重试';});
    }
    applyWebResourceSettings();
    ready = true;
    if (!readOnly) await transactions.run(()=>({state:storedState()}),()=>{}).catch(()=>{storageError='配置保存失败，请检查磁盘空间与系统凭证存储。';});
    registerHandlers();
    mainWindow = createWindow();
    powerMonitor.on('resume', () => { fitFloating(true); if (!readOnly && !quitting) monitor.tick(); });
    for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,()=>fitFloating(true));
    if (!smoke) {
      tray = new Tray(nativeImage.createFromPath(statusIcon()).resize({width:16,height:16}));
      tray.setToolTip('My Monitor');
      updateTrayMenu();
      globalShortcut.register('CommandOrControl+Alt+M', showMain);
      scheduler = setInterval(() => { if (!readOnly) monitor.tick(); }, 250);
      if (!readOnly) void monitor.refreshAll();
    }
    trayEvents=smoke?new EventEmitter():tray;
    const doubleClickTime=systemDoubleClickTime();
    trayInteractions=new TrayInteractions(trayEvents,{getSettings:()=>appSettings,toggleFloating:()=>{
      const previous=snapshot().floatingOpen,next=setFloating(!previous);
      return ()=>{if(snapshot().floatingOpen===next)setFloating(previous);};
    },showMain,doubleClickTime});
    if(appSettings.floatingOnStartup)showFloating();
    if (smoke) {
      const { runSmoke } = await import('../scripts/electron-smoke.mjs');
      await runSmoke({ mainWindow, monitor, web, persist, snapshot, showFloating, getFloating: () => floatingWindow, addDemo, root,trayEvents,doubleClickTime,store,httpSources,transactions,provisionalIds,showMain,getMain:()=>mainWindow });
      app.quit();
    }
  }).catch(error => { console.error('启动失败:', smoke ? error.stack : error.message); app.exit(1); });
  app.on('before-quit', event => {
    if (!quitting) {
      event.preventDefault(); quitting = true;cancelDashboardIdle();clearInterval(scheduler);clearInterval(resourceTimer);clearTimeout(broadcastTimer);globalShortcut.unregisterAll();
      trayInteractions?.dispose();
      transactions?.close();monitor?.cancelAll();httpSources?.closeAll();notificationService?.dispose();
      fitFloating(true); rememberFloatingPosition();
      web?.closeAll();
      alerts?.finishRun();
      let exitTimer;const flush=(async()=>{await transactions?.queue.catch(()=>{});checkpoint?.schedule();await (checkpoint?checkpoint.flush():persist());})();
      void Promise.race([flush,new Promise(resolve=>{exitTimer=setTimeout(resolve,4000);})]).catch(()=>{}).finally(()=>{clearTimeout(exitTimer);app.quit();});
    }
  });
  app.on('window-all-closed', () => { if (!tray && !(smoke&&process.argv.includes('--empty-memory-only'))) app.quit(); });
}

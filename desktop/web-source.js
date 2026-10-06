import { BrowserWindow, session } from 'electron';
import { validateUrl } from '../core/config.js';
import { pickerScript, pickerCopy, readScript } from './picker.js';
import { t } from '../core/i18n.js';
import { SourceJobs } from '../core/jobs.js';
import { safeWebNavigation, canPickPage } from '../core/web-navigation.js';
import { extractSample } from '../core/metrics.js';
import { BoundedQueue } from '../core/collection-queue.js';
import { bounded, cancelled, RollingBytes } from './web-limits.js';
import { readdir, lstat, realpath, rm } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const error = (message, code) => Object.assign(new Error(message), { code });

export class WebSources {
  updateIcons() {
    const icon=this.getIcon?.();if(!icon)return;
    for(const window of this.windows.values())if(!window.isDestroyed())window.setIcon(icon);
    for(const children of this.popups.values())for(const window of children)if(!window.isDestroyed())window.setIcon(icon);
  }
  updateLanguage() {
    for(const window of this.windows.values())if(!window.isDestroyed()) {
      window.setTitle(t('My Monitor · 登录与选取'));
      // Updates only our isolated shadow panel, never website content or account data.
      void window.webContents.executeJavaScript(`document.dispatchEvent(new CustomEvent('__my_monitor_language__',{detail:${JSON.stringify(pickerCopy())}}));true`).catch(()=>{});
    }
    for(const children of this.popups.values())for(const window of children)if(!window.isDestroyed())window.setTitle(t('My Monitor · 网站登录'));
  }
  constructor({getIcon, maxResponseBytes=16*1024*1024, requestLimit=120, requestWindowMs=60000,
    maxSourceBytes=64*1024*1024, maxTotalBytes=128*1024*1024, resourceCooldownMs=60000, maxRendererMemoryKiB=256*1024,
    maxTotalRendererMemoryKiB=1024*1024,maxRendererCPU=60,cpuSamples=3,maxProfiles=128}={}) {
    this.getIcon=getIcon;
    this.windows = new Map(); this.jobs = new SourceJobs(); this.picking = new Set(); this.epochs = new Map();
    this.popups = new Map(); this.activity = new Map();
    this.livePages = new Map();
    this.readTimeoutMs = 8000;
    this.pickTimeoutMs = 10*60*1000;
    this.navigationTimeoutMs = 20000;
    this.queue = new BoundedQueue({concurrency:2,maxQueued:100});
    this.profiles=new Map();this.tasks=new Map();this.resourceErrors=new Map();this.shutdown=false;
    this.maxResponseBytes=maxResponseBytes;this.requestLimit=requestLimit;this.requestWindowMs=requestWindowMs;
    this.maxSourceBytes=maxSourceBytes;this.maxTotalBytes=maxTotalBytes;this.resourceCooldownMs=resourceCooldownMs;this.maxRendererMemoryKiB=maxRendererMemoryKiB;
    this.maxTotalRendererMemoryKiB=maxTotalRendererMemoryKiB;this.maxRendererCPU=maxRendererCPU;this.cpuSamples=cpuSamples;this.highCPU=new Map();
    this.totalBytes=new RollingBytes(requestWindowMs);
    this.maxProfiles=maxProfiles;
  }
  async task(id, externalSignal, operation) {
    if(this.shutdown)throw cancelled();
    this.checkProfileCapacity(id);
    const epoch=this.epochs.get(id)||0, controller=new AbortController();
    let tasks=this.tasks.get(id);if(!tasks){tasks=new Set();this.tasks.set(id,tasks);}tasks.add(controller);
    const abort=()=>this.close(id,cancelled());
    externalSignal?.addEventListener('abort',abort,{once:true});
    if(externalSignal?.aborted)abort();
    try {
      if((this.epochs.get(id)||0)!==epoch||controller.signal.aborted)throw controller.signal.reason||cancelled();
      return await operation(controller.signal,epoch);
    } finally {
      externalSignal?.removeEventListener('abort',abort);tasks.delete(controller);
      if(!tasks.size&&this.tasks.get(id)===tasks)this.tasks.delete(id);
      if(!this.profiles.has(id)&&!this.tasks.has(id)&&!this.jobs.pending.has(id))this.epochs.delete(id);
    }
  }
  checkProfileCapacity(id) {
    if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw error('数据源标识无效','locator');
    if(!this.profiles.has(id)&&this.profiles.size>=this.maxProfiles)throw error('本次运行创建的网页登录会话已达到上限，请重启应用后再添加或打开新网页；已保存的登录信息会保留','resource');
  }
  profile(id) {
    this.checkProfileCapacity(id);
    let state=this.profiles.get(id);if(state)return state;
    const profile=session.fromPartition(`persist:source-${id}`);
    state={profile,blocked:true,requests:[],bytes:new RollingBytes(this.requestWindowMs),stopping:Promise.resolve(),clearing:null};
    this.profiles.set(id,state);
    profile.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    profile.setPermissionCheckHandler(()=>false);
    profile.on('will-download',event=>event.preventDefault());
    profile.webRequest.onBeforeRequest((details,callback)=>{
      let allowed=false;try{const url=new URL(details.url);allowed=['https:','wss:','data:','blob:','about:'].includes(url.protocol)||(['http:','ws:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));}catch{}
      if(state.blocked||!allowed){callback({cancel:true});return;}
      const now=Date.now();state.requests=state.requests.filter(time=>time>now-this.requestWindowMs);
      if(state.requests.length>=this.requestLimit){callback({cancel:true});this.stopResource(id,'网页请求过于频繁，已停止该页面；请降低刷新频率或更换页面');return;}
      state.requests.push(now);
      const activity=this.activity.get(id);
      if(activity?.collecting&&details.resourceType==='xhr'){activity.pending.add(details.id);activity.lastChange=now;}
      callback({});
    });
    profile.webRequest.onHeadersReceived((details,callback)=>{
      const lengths=Object.entries(details.responseHeaders||{}).filter(([key])=>key.toLowerCase()==='content-length').flatMap(([,values])=>values);
      if(state.blocked||lengths.some(value=>Number(value)>this.maxResponseBytes)){
        callback({cancel:true});if(!state.blocked)this.stopResource(id,'网页响应超过资源上限，已停止该页面');return;
      }
      callback({});
    });
    const complete=details=>{const activity=this.activity.get(id);if(activity?.pending.delete(details.id))activity.lastChange=Date.now();};
    profile.webRequest.onCompleted(complete);profile.webRequest.onErrorOccurred(complete);
    return state;
  }
  stopResource(id,message) {
    const failure=error(message,'resource');
    this.resourceErrors.set(id,{failure,until:Date.now()+this.resourceCooldownMs});
    void this.close(id,failure);
  }
  checkResource(id) {
    const entry=this.resourceErrors.get(id);
    if(entry&&Date.now()<entry.until)throw entry.failure;
    if(entry)this.resourceErrors.delete(id);
  }
  watchBytes(id,contents) {
    const resources=new Map(),debuggerApi=contents.debugger;
    try{debuggerApi.attach('1.3');}catch{this.stopResource(id,'无法启用网页资源保护，请重新打开页面');return;}
    const failedProtection=()=>{
      if(contents.isDestroyed()||this.profiles.get(id)?.blocked)return;
      const current=[this.windows.get(id),...(this.popups.get(id)||[])].some(window=>window&&!window.isDestroyed()&&window.webContents===contents);
      if(current)this.stopResource(id,'无法启用网页资源保护，请重新打开页面');
    };
    const message=(_event,method,params,sessionId)=>{
      if(method==='Target.attachedToTarget'){
        void debuggerApi.sendCommand('Network.enable',{},params.sessionId).catch(failedProtection);
        return;
      }
      const requestKey=`${sessionId||''}:${params.requestId}`;
      if(method==='Network.dataReceived'||method==='Network.loadingFinished'||method==='Network.webSocketFrameReceived') {
        const previous=resources.get(requestKey)||0;
        // Chromium may report small/cached document bodies only on loadingFinished.
        const bytes=method==='Network.webSocketFrameReceived'?Buffer.byteLength(params.response?.payloadData||'',params.response?.opcode===1?'utf8':'base64'):
          method==='Network.dataReceived'?Math.max(Number(params.dataLength)||0,Number(params.encodedDataLength)||0):Math.max(0,(Number(params.encodedDataLength)||0)-previous);
        const size=previous+bytes;resources.set(requestKey,size);
        const state=this.profiles.get(id);if(!state||state.blocked)return;
        const sourceBytes=state.bytes.add(bytes),totalBytes=this.totalBytes.add(bytes);
        if(size>this.maxResponseBytes||sourceBytes>this.maxSourceBytes||totalBytes>this.maxTotalBytes||resources.size>256)this.stopResource(id,'网页接收数据超过资源上限，已停止该页面；请降低刷新频率或更换页面');
        if(method==='Network.loadingFinished')resources.delete(requestKey);
      } else if(method==='Network.loadingFailed'||method==='Network.webSocketClosed')resources.delete(requestKey);
    };
    let detachTimer;
    const detached=()=>{clearTimeout(detachTimer);detachTimer=setTimeout(failedProtection,0);};
    debuggerApi.on('message',message);
    debuggerApi.on('detach',detached);
    void debuggerApi.sendCommand('Network.enable').catch(failedProtection);
    // Related workers and frames use the same source budgets. Never pause page execution.
    void debuggerApi.sendCommand('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true}).catch(failedProtection);
    contents.once('destroyed',()=>{clearTimeout(detachTimer);debuggerApi.removeListener('message',message);debuggerApi.removeListener('detach',detached);resources.clear();});
  }
  secureWindow(id, window, popup = false) {
    const contents = window.webContents;
    this.watchBytes(id,contents);
    const failed=()=>{const failure=error('网页进程异常，已关闭页面，请稍后重新刷新','network');void this.close(id,failure);};
    contents.on('render-process-gone',failed);window.on('unresponsive',failed);
    contents.setWindowOpenHandler(({ url }) => {
      const parent = this.windows.get(id);
      // Background collection cannot create visible windows; login/selection can.
      const resident=this.windows.size+[...this.popups.values()].reduce((sum,children)=>sum+children.size,0);
      if (!parent || parent.isDestroyed() || !parent.isVisible() || !safeWebNavigation(url, true) || (this.popups.get(id)?.size || 0) >= 4 || resident>=8) return { action: 'deny' };
      return {
        action: 'allow', outlivesOpener: false,
        overrideBrowserWindowOptions: {
          width: 600, height: 760, minWidth: 400, minHeight: 500, show: true,
          parent, modal: false, title: t('My Monitor · 网站登录'), autoHideMenuBar: true,
          ...(this.getIcon?{icon:this.getIcon()}:{}),
          webPreferences: { partition: `persist:source-${id}`, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck:false }
        }
      };
    });
    for (const eventName of ['will-navigate', 'will-redirect']) contents.on(eventName, (event, url) => {
      if (!safeWebNavigation(url, popup)) event.preventDefault();
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('did-create-window', child => {
      let children = this.popups.get(id);
      if (!children) { children = new Set(); this.popups.set(id, children); }
      children.add(child);
      this.secureWindow(id, child, true);
      contents.once('destroyed', () => { if (!child.isDestroyed()) child.destroy(); });
      child.on('closed', () => {
        children.delete(child);
        if (!children.size) this.popups.delete(id);
      });
    });
  }
  getWindow(id, show = false) {
    if(this.shutdown)throw cancelled();
    this.checkResource(id);
    let window = this.windows.get(id);
    if (!window || window.isDestroyed()) {
      let resident=this.windows.size;
      for(const children of this.popups.values())resident+=children.size;
      if(resident>=8)throw error('最多同时打开 8 个网页窗口，请暂停或关闭其他网页后重试','resource');
      const partition = `persist:source-${id}`;
      const state=this.profile(id),profile=state.profile;
      if(state.clearing)throw error('正在清理该数据源的登录信息，请稍后重试','resource');
      state.blocked=false;
      window = new BrowserWindow({ ...(this.getIcon?{icon:this.getIcon()}:{}), width: 1100, height: 780, show, title: t('My Monitor · 登录与选取'), autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck:false } });
      // Each source owns its session. Track fetch/XHR without injecting hooks into the website.
      const activity = { pending: new Set(), lastChange: 0, collecting: false };
      this.activity.set(id, activity);
      this.windows.set(id, window);
      this.secureWindow(id, window);
      window.on('closed', () => {
        this.closePopups(id);
        if (this.windows.get(id) === window) {
          this.windows.delete(id); this.activity.delete(id); this.livePages.delete(id);
          if(!state.blocked){
            // A picker window's close handler resolves cancellation as null. Do not race
            // that result with an unrelated abort rejection when the native window closes.
            if(this.picking.has(id)){state.blocked=true;void this.stopProfile(state);}
            else void this.close(id);
          }
        }
      });
    }
    if (show) { window.show(); window.focus(); }
    return window;
  }
  async navigate(window, url, fresh = false, signal) {
    validateUrl(url);
    const timeout=error('网页加载超时，请检查网络和网址','network');
    try {
      const options = fresh ? { extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n' } : undefined;
      await bounded(()=>window.loadURL(url,options),{signal,timeoutMs:this.navigationTimeoutMs,failure:timeout,onTimeout:()=>this.stopWindow(window,timeout)});
    }
    catch (failure) { if (['network','cancelled','resource'].includes(failure.code)) throw failure; throw error('网页加载失败，请检查网络和网址', 'network'); }
  }
  async pick(url, id) {
    return this.task(id,undefined,signal=>this.pickPage(url,id,signal));
  }
  async pickPage(url,id,signal) {
    validateUrl(url);
    if (this.picking.has(id)) throw new Error('该页面已有选取任务，请先完成或关闭窗口');
    const epoch = this.epochs.get(id) || 0;
    this.picking.add(id);
    let window,pickerCancelled=false;
    try {
      await bounded(()=>this.jobs.current(id)?.catch(() => {}),{signal,timeoutMs:100000});
      await bounded(()=>this.profile(id).stopping,{signal,timeoutMs:this.readTimeoutMs});
      if ((this.epochs.get(id) || 0) !== epoch) throw error('数据源已删除，选取已取消', 'locator');
      window = this.getWindow(id, true);
      const contents = window.webContents;
      // Reinstall the picker after normal login/navigation, without exposing IPC to the page.
      return await new Promise((resolve, reject) => {
        let settled = false, generation = 0, loading = true;
        const timer = setTimeout(() => {const failure=error('选取超时，请重新打开选取窗口','locator');finish(failure);void this.close(id,failure);}, this.pickTimeoutMs);
        const finish = (failure, value) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          // BrowserWindow.webContents is inaccessible after native close. Retain the emitter
          // so cancellation always resolves and releases the source's picking lock.
          contents.removeListener('did-finish-load', install);
          contents.removeListener('did-start-navigation', navigating);
          window.removeListener('close', closed);
          window.removeListener('closed', closed);
          signal.removeEventListener('abort',aborted);
          pickerCancelled=!failure&&value==null;
          failure ? reject(failure) : resolve(value);
        };
        const closed = () => finish(null, null);
        const aborted=()=>finish(signal.reason instanceof Error?signal.reason:cancelled());
        // Hash/history navigation keeps the same document and its active picker promise.
        // Invalidating it here would discard both selection and cancellation forever.
        const navigating = (_event, _url, inPlace, mainFrame) => { if (mainFrame&&!inPlace) generation++; };
        const install = () => {
          if (settled || loading || window.isDestroyed() || contents.isDestroyed()) return;
          const current = ++generation;
          if (!canPickPage(contents.getURL(), url)) return;
          contents.executeJavaScript(pickerScript(), true).then(value => {
            if (current !== generation || settled) return;
            if (value) { validateUrl(value.url); if (typeof value.selector !== 'string' || value.selector.length > 2000) throw new Error('选取结果无效'); }
            finish(null, value);
          }).catch(failure => {
            if (settled || current !== generation || window.isDestroyed()) return;
            finish(error(`网页选取失败：${failure.message}，请重新打开选取窗口`, 'locator'));
          });
        };
        contents.on('did-finish-load', install);
        contents.on('did-start-navigation', navigating);
        window.once('close', closed);
        window.once('closed', closed);
        signal.addEventListener('abort',aborted,{once:true});
        // Register cancellation before navigating, including slow pages closed while loading.
        void (async () => {
          if (contents.getURL() !== url) await this.navigate(window, url,false,signal);
          loading = false;
          install();
        })().catch(failure => finish(failure));
      });
    } finally {
      this.picking.delete(id);
      if (window && !window.isDestroyed()) { this.closePopups(id);if(pickerCancelled)window.destroy();else window.hide(); }
    }
  }
  async collect(source,{signal}={}) {
    this.checkResource(source.id);
    if (this.picking.has(source.id)) throw error('正在选取元素，完成后再刷新', 'locator');
    if (this.popups.get(source.id)?.size) throw error('网站正在完成登录授权，请返回原窗口后手动刷新', 'auth');
    const epoch = this.epochs.get(source.id) || 0;
    return this.task(source.id,signal,(taskSignal)=>this.jobs.run(source.id, source, () => {
      if ((this.epochs.get(source.id) || 0) !== epoch) throw error('数据源已删除', 'locator');
      return this.queue.run(()=>this.read(source,taskSignal),{signal:taskSignal}).catch(failure=>{
        throw taskSignal.aborted&&taskSignal.reason instanceof Error?taskSignal.reason:failure;
      });
    }));
  }
  async read(source,signal) {
    await bounded(()=>this.profile(source.id).stopping,{signal,timeoutMs:this.readTimeoutMs});
    if (source.webUpdateMode === 'live') return this.readLive(source,signal);
    this.livePages.delete(source.id);
    const window = this.getWindow(source.id, false);
    const activity = this.activity.get(source.id);
    activity.pending.clear(); activity.lastChange = Date.now(); activity.collecting = true;
    try {
      // Reloading HTML alone leaves cached fetch/XHR responses intact. This source has its own profile;
      // clear only its HTTP cache, preserving cookies, local storage and login credentials.
      await this.clearPageCache(window,signal);
      await this.navigate(window, source.url, true,signal);
      if (!canPickPage(window.webContents.getURL(), source.url)) throw error('网页已跳转至外部登录页，请打开登录窗口完成授权后刷新', 'auth');
      let result, lastValue, stableSince = Date.now(), parseFailure;
      const earliestRead = Date.now() + (source.waitSeconds ?? 3) * 1000;
      const deadline = earliestRead + 12000;
      do {
        if (window.isDestroyed()) throw error('采集窗口已关闭，请重新刷新', 'network');
        try {
          result = await this.readDOM(window,source,signal);
        } catch (failure) {
          throw failure.code ? failure : error('网页数值读取失败，请重新选取元素或修改配置', 'locator');
        }
        const value = JSON.stringify(result);
        if (value !== lastValue) { lastValue = value; stableSince = Date.now(); }
        parseFailure = null;
        if (!result.error) {
          try {
            extractSample(source, result);
            const quietSince = Math.max(stableSince, activity.lastChange);
            if (Date.now() >= earliestRead && !activity.pending.size && Date.now() - quietSince >= 800) return result;
          } catch (failure) { parseFailure = failure; }
        }
        if (result.code === 'auth' || result.terminal) break;
        // Give asynchronous page data the configured wait and a quiet period, then report
        // invalid targets immediately instead of leaving the card spinning until the deadline.
        if (Date.now() >= earliestRead && !activity.pending.size && Date.now() - Math.max(stableSince, activity.lastChange) >= 800 && (result.error || parseFailure)) break;
        await bounded(()=>sleep(200),{signal});
      } while (Date.now() < deadline);
      // Some sites keep unrelated streams or telemetry running indefinitely. Network quiet is a
      // readiness hint, not a requirement forever: after the bounded wait, accept a stable numeric DOM.
      if (!result.error && !parseFailure && Date.now() - stableSince >= 800) return result;
      throw error(result.error || parseFailure?.message || '网页数值或数据请求仍在更新，请稍后刷新或增加网页等待时间', result.code || parseFailure?.code || 'network');
    } finally { activity.collecting = false; }
  }
  async readLive(source,signal) {
    const window = this.getWindow(source.id, false);
    const signature = JSON.stringify([source.url, source.selector, source.totalSelector, source.valueMode, source.totalMode, source.waitSeconds]);
    const page = this.livePages.get(source.id);
    if (page?.window !== window || page.signature !== signature) {
      await this.clearPageCache(window,signal);
      await this.navigate(window, source.url, true,signal);
      if (!canPickPage(window.webContents.getURL(), source.url)) throw error('网页已跳转至外部登录页，请打开登录窗口完成授权后刷新', 'auth');
      await bounded(()=>sleep((source.waitSeconds ?? 3) * 1000),{signal});
      this.livePages.set(source.id, { window, signature });
    }
    if (window.isDestroyed()) throw error('采集窗口已关闭，请重新刷新', 'network');
    if (!canPickPage(window.webContents.getURL(), source.url)) throw error('网页已跳转至外部登录页，请打开登录窗口完成授权后刷新', 'auth');
    try {
      const result = await this.readDOM(window,source,signal);
      if (result.error) throw error(result.error, result.code || 'locator');
      extractSample(source, result);
      return result;
    } catch (failure) {
      throw failure.code ? failure : error('网页数值读取失败，请重新选取元素或修改配置', 'locator');
    }
  }
  readDOM(window,source,signal) {
    const failure=error('网页数值读取超时，请检查页面状态后重新刷新或修改配置','network');
    return bounded(()=>window.webContents.executeJavaScript(readScript(source.valueMode==='fixed'?'':source.selector,source.totalMode==='fixed'||source.totalMode==='none'?'':source.totalSelector)),
      {signal,timeoutMs:this.readTimeoutMs,failure,onTimeout:()=>{void this.close(source.id,failure);}});
  }
  stopWindow(window,failure) {
    for(const [id,parent] of this.windows)if(parent===window||this.popups.get(id)?.has(window)){void this.close(id,failure);return;}
    if(!window.isDestroyed())window.destroy();
  }
  clearPageCache(window,signal) {
    const failure=error('网页缓存清理超时，请重新刷新','network');
    return bounded(()=>window.webContents.session.clearCache(),{signal,timeoutMs:this.readTimeoutMs,failure,onTimeout:()=>this.stopWindow(window,failure)});
  }
  async login(source) {
    return this.task(source.id,undefined,async signal=>{
      await bounded(()=>this.profile(source.id).stopping,{signal,timeoutMs:this.readTimeoutMs});
      const window = this.getWindow(source.id, true);
      if (!window.webContents.getURL()) await this.navigate(window, source.url,false,signal);
    });
  }
  closePopups(id) {
    const children = this.popups.get(id);
    this.popups.delete(id);
    for (const child of children || []) if (!child.isDestroyed()) child.destroy();
  }
  close(id,failure=cancelled()) {
    if(!this.profiles.has(id)&&!this.tasks.has(id)&&!this.windows.has(id)&&!this.picking.has(id)&&!this.jobs.pending.has(id))return Promise.resolve();
    this.epochs.set(id,(this.epochs.get(id)||0)+1);
    const state=this.profiles.get(id);if(state)state.blocked=true;
    for(const controller of this.tasks.get(id)||[])controller.abort(failure);
    this.highCPU.delete(id);
    this.closePopups(id); const window = this.windows.get(id); if (window && !window.isDestroyed()) window.destroy();
    if(!state)return Promise.resolve();
    return this.stopProfile(state);
  }
  stopProfile(state) {
    // There is no public terminate-worker API. Unregister only workers, block future requests,
    // and close current sockets. Cookies, localStorage and indexedDB remain intact during pause.
    state.stopping=state.stopping.catch(()=>{}).then(()=>bounded(()=>Promise.all([
      state.profile.clearStorageData({storages:['serviceworkers']}),state.profile.closeAllConnections()
    ]),{timeoutMs:this.readTimeoutMs})).catch(()=>{});
    return state.stopping;
  }
  async clear(id) {
    const state=this.profile(id);
    if(state.clearing)return state.clearing;
    const closing=this.close(id);
    state.clearing=(async()=>{
      await closing;
      await bounded(()=>state.profile.clearStorageData(),{timeoutMs:this.readTimeoutMs});
      await bounded(()=>state.profile.clearCache(),{timeoutMs:this.readTimeoutMs});
      this.resourceErrors.delete(id);state.requests=[];state.bytes=new RollingBytes(this.requestWindowMs);
    })().finally(()=>{state.clearing=null;});
    return state.clearing;
  }
  discard(id) {
    // An unsaved identity with no browser activity owns no current-session partition.
    if(!this.profiles.has(id))return this.close(id);
    return this.clear(id);
  }
  closeAll() {
    this.shutdown=true;
    this.queue.close();
    return Promise.allSettled([...new Set([...this.windows.keys(),...this.tasks.keys(),...this.profiles.keys()])].map(id=>this.close(id)));
  }
  checkResources(metrics) {
    const processes=new Map((metrics||[]).map(metric=>[metric.pid,metric]));
    const sourceUsage=[];
    for(const [id,parent] of this.windows){
      let memory=0,cpu=0,maxMemory=0;const pids=new Set();
      for(const window of [parent,...(this.popups.get(id)||[])])if(!window.isDestroyed()){
        const pid=window.webContents.getOSProcessId();if(pids.has(pid))continue;pids.add(pid);
        const metric=processes.get(pid),used=metric?.memory?.workingSetSize||0;
        memory+=used;maxMemory=Math.max(maxMemory,used);cpu+=metric?.cpu?.percentCPUUsage||0;
      }
      if(maxMemory>this.maxRendererMemoryKiB){this.stopResource(id,'网页内存占用超过上限，已停止该页面；请更换较轻的页面');continue;}
      const streak=cpu>this.maxRendererCPU?(this.highCPU.get(id)||0)+1:0;this.highCPU.set(id,streak);
      if(streak>=this.cpuSamples){this.stopResource(id,'网页持续占用过多 CPU，已停止该页面；请更换较轻的页面');continue;}
      sourceUsage.push({id,memory});
    }
    let total=sourceUsage.reduce((sum,entry)=>sum+entry.memory,0);
    for(const entry of sourceUsage.sort((a,b)=>b.memory-a.memory)){
      if(total<=this.maxTotalRendererMemoryKiB)break;
      total-=entry.memory;this.stopResource(entry.id,'监控网页总内存占用超过上限，已停止占用较大的页面；请暂停部分网页');
    }
  }
  async cleanupOrphans(savedIds,userData,{signal}={}) {
    const checkAbort=()=>{if(signal?.aborted)throw cancelled();};
    checkAbort();
    if(this.profiles.size||this.windows.size)throw error('孤立会话清理只能在启动时执行','resource');
    // Canonicalize short Windows TEMP paths before checking descendants.
    let base;try{base=await realpath(resolve(userData));}catch(failure){if(failure.code==='ENOENT')return [];throw failure;}
    const partitions=join(base,'Partitions'),saved=new Set([...savedIds].map(id=>id.toLowerCase()));
    let entries;try{
      const stat=await lstat(partitions);if(!stat.isDirectory()||stat.isSymbolicLink()||(await realpath(partitions)).toLowerCase()!==partitions.toLowerCase())return [];
      entries=await readdir(partitions,{withFileTypes:true});
    }catch(failure){if(failure.code==='ENOENT')return [];throw failure;}
    const removed=[];
    for(const entry of entries){
      checkAbort();
      if(!entry.isDirectory()||!/^source-[a-zA-Z0-9-]{1,80}$/.test(entry.name))continue;
      const id=entry.name.slice(7);if(saved.has(id.toLowerCase()))continue;
      const target=resolve(partitions,entry.name),within=relative(partitions,target);
      if(!within||within.startsWith('..'+sep)||within==='..'||within.includes(sep))continue;
      const stat=await lstat(target);if(!stat.isDirectory()||stat.isSymbolicLink()||(await realpath(target)).toLowerCase()!==target.toLowerCase())continue;
      checkAbort();
      await rm(target,{recursive:true,force:true,maxRetries:2,retryDelay:100});removed.push(id);
    }
    return removed;
  }
}

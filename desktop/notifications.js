import { app, Notification, shell } from 'electron';
import { mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {t,localeCode} from '../core/i18n.js';
import {NotificationBatch} from '../core/notification-batch.js';

const APP_ID = 'local.MyMonitor.Desktop';
const ACTIVATOR = '{D91BD71C-6C94-4C95-AC37-A7978DA37936}';
const errorText = error => String(error?.message ?? error ?? '').slice(0, 500);

export class DesktopNotifications {
  constructor({ enabled = true, onDelivery = () => {}, onClick = () => {} } = {}) {
    this.enabled = enabled;
    this.onDelivery = onDelivery;
    this.onClick = onClick;
    this.active = new Set();
    this.lifetimes=new Map();
    this.batch=new NotificationBatch({onBatch:batch=>this.sendBatch(batch)});
  }

  async init() {
    if (process.platform !== 'win32') return '';
    try {
      app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.Development`);
      if (!app.isPackaged || !this.enabled) return '';
      if (!process.env.APPDATA) return '通知身份初始化失败：缺少 APPDATA';
      const programs = join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      await mkdir(programs, { recursive: true });
      // Match the packaged executable product name used by Electron's activator.
      // Its built-in registration reads this CLSID and configures COM activation.
      const shortcut = join(programs, 'MyMonitor.lnk');
      let exists = true;
      try { await access(shortcut); } catch { exists = false; }
      if (!shell.writeShortcutLink(shortcut, exists ? 'update' : 'create', {
        target: process.execPath, cwd: dirname(process.execPath), args: '',
        description: t('MyMonitor 本地数据监控'), appUserModelId: APP_ID,
        toastActivatorClsid: ACTIVATOR,
      })) return '通知身份初始化失败：无法写入开始菜单快捷方式';
      return '';
    } catch (error) {
      return `通知身份初始化失败：${errorText(error)}`;
    }
  }

  deliver(id, status, error = '') {
    try { this.onDelivery(id, status, errorText(error)); } catch { /* Consumer callbacks cannot interrupt monitoring. */ }
  }

  send(item) {
    if(!this.enabled){this.deliver(item?.id,'test','测试模式：未发送系统通知');return;}
    this.batch.push(item);
  }
  track(notification){
    while(this.active.size>=3)this.release(this.active.values().next().value,true);
    this.active.add(notification);
    const timer=setTimeout(()=>this.release(notification,true),20000);
    this.lifetimes.set(notification,timer);
    notification.on('close',()=>this.release(notification));
  }
  release(notification,close=false){
    clearTimeout(this.lifetimes.get(notification));this.lifetimes.delete(notification);this.active.delete(notification);
    if(close)try{notification.close();}catch{/* OS notification may already be closed. */}
  }
  dispose(){this.batch.dispose();for(const notification of this.active)this.release(notification,true);}
  sendBatch({items,count}) {
    const item=items.at(-1);if(!item)return;
    const deliverAll=(status,error='')=>{for(const record of items)this.deliver(record.id,status,error);};
    let id;
    let notification;
    try {
      id = item?.id;
      if (!this.enabled) {
        this.deliver(id, 'test', '测试模式：未发送系统通知');
        return;
      }
      if (!Notification.isSupported()) {
        deliverAll('unsupported', '当前系统不支持桌面通知');
        return;
      }
      const unit = item.unit ? ` ${item.unit}` : '';
      const label = t(item.type === 'delta' ? '相邻变化量' : '实时数据');
      const range = item.lower == null ? `≤ ${item.upper}` : item.upper == null ? `≥ ${item.lower}` : `${item.lower} ～ ${item.upper}`;
      const time = Number.isFinite(item.time) ? new Date(item.time).toLocaleString(localeCode()) : t('未知');
      notification = new Notification({
        title: count>1?`MyMonitor · ${t('{count} 条告警提醒').replace('{count}',String(count))}`:`MyMonitor · ${item.name || t('范围告警')}`,
        body: count>1?`${t('最近2秒检测到 {count} 次越界，全部记录已保留。').replace('{count}',String(count))}\n${[...new Set(items.map(record=>record.name))].slice(0,3).join(' · ')}\n${t('最新：{name}，检测值 {value}').replace('{name}',item.name).replace('{value}',String(item.measurement))}`:`${item.sourceName || t('数据源')}\n${t('{label} {measurement}{unit}，超出范围 {range}{unit2}').replace('{label}',label).replace('{measurement}',String(item.measurement)).replace('{unit}',unit).replace('{range}',range).replace('{unit2}',unit)}\n${t('记录值 {value}{unit}；检查时间 {time}').replace('{value}',String(item.value)).replace('{unit}',unit).replace('{time}',time)}`,
      });
      this.track(notification);
      notification.on('show', () => deliverAll('shown'));
      notification.on('failed', (_event, error) => {
        this.release(notification);
        deliverAll('failed', error);
      });
      notification.on('close', () => this.active.delete(notification));
      notification.on('click', () => {
        try { this.onClick(); } catch { /* Keep event dispatch safe. */ }
      });
      deliverAll('requested');
      notification.show();
    } catch (error) {
      if (notification) this.release(notification,true);
      deliverAll('failed', error);
    }
  }

  async test() {
    if(!this.enabled)return {delivery:'test',error:'测试模式：未发送系统通知'};
    let notification;
    try {
      if (!Notification.isSupported()) return { delivery: 'unsupported', error: '当前系统不支持桌面通知' };
      return await new Promise(resolve => {
        let settled = false;
        let timer;
        const finish = (delivery, error = '') => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ delivery, error: errorText(error) });
        };
        try {
          notification = new Notification({ title: `MyMonitor · ${t('通知测试')}`, body: t('这是一条桌面通知测试。点击可打开主页面。') });
          this.track(notification);
          notification.on('show', () => finish('shown'));
          notification.on('failed', (_event, error) => {
            this.release(notification);
            finish('failed', error);
          });
          notification.on('close', () => this.active.delete(notification));
          notification.on('click', () => {
            try { this.onClick(); } catch { /* Keep event dispatch safe. */ }
          });
          timer = setTimeout(() => finish('requested', '已请求系统通知，5 秒内未收到展示确认；请检查系统通知设置或免打扰模式'), 5000);
          notification.show();
        } catch (error) {
          if (notification) this.release(notification,true);
          finish('failed', error);
        }
      });
    } catch (error) {
      if (notification) this.release(notification,true);
      return { delivery: 'failed', error: errorText(error) };
    }
  }
}

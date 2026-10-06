import { randomUUID } from 'node:crypto';
import { pathParts, parseFixed } from './metrics.js';

export function validateUrl(input) {
  if(typeof input!=='string'||input.length>8192)throw new Error('网址需为不超过8192字符的完整网址');
  let url;
  try { url = new URL(input); } catch { throw new Error('请输入完整的网址'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('只支持 HTTPS，或本机回环 HTTP');
  if (url.username || url.password) throw new Error('请勿在网址中保存账号密码');
  return url.href;
}

export function validateSource(input) {
  if (!input || typeof input !== 'object') throw new Error('配置无效');
  const name = String(input.name || '').trim();
  if (!name || name.length > 60) throw new Error('名称需要 1–60 个字符');
  if (!['http', 'web', 'fixed', 'demo'].includes(input.kind)) throw new Error('不支持此采集方式');
  const interval = parseFixed(input.interval, '刷新周期');
  if (!Number.isInteger(interval) || interval < 1 || interval > 2592000) throw new Error('刷新周期需为 1–2592000 秒的整数（最长 30 天）');
  const id = input.id || randomUUID();
  if (typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('数据源标识无效');
  if(input.enabled!==undefined&&typeof input.enabled!=='boolean')throw new Error('监控开关无效');
  const source = { id, name, kind: input.kind, interval, unit: String(input.unit || '').trim().slice(0, 16), enabled: input.enabled !== false };
  if (input.kind === 'http') {
    source.url = validateUrl(input.url);
    pathParts(input.valuePath);
    if (input.totalPath) pathParts(input.totalPath);
    source.valuePath = input.valuePath;
    source.totalPath = input.totalPath || '';
  }
  if (input.kind === 'web' || input.kind === 'fixed') {
    source.valueMode = input.kind === 'fixed' ? 'fixed' : (input.valueMode ?? 'web');
    source.totalMode = input.totalMode ?? (input.totalSelector ? 'web' : input.kind === 'fixed' && input.fixedTotal != null ? 'fixed' : 'none');
    if (!['web', 'fixed'].includes(source.valueMode) || !['none', 'web', 'fixed'].includes(source.totalMode) || (input.kind === 'fixed' && source.totalMode === 'web')) throw new Error('请选择有效的数值来源');
    if (source.valueMode === 'fixed') source.fixedValue = parseFixed(input.fixedValue, '当前量');
    if (source.totalMode === 'fixed') source.fixedTotal = parseFixed(input.fixedTotal, '总量');
    const selector = (key, label) => {
      if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 2000) throw new Error(`${label}请选择网页元素，或改为固定数值；选择器不能填写数字`);
      return input[key].trim();
    };
    if (source.valueMode === 'web') source.selector = selector('selector', '当前量');
    if (source.totalMode === 'web') source.totalSelector = selector('totalSelector', '总量');
    if (source.valueMode === 'web' || source.totalMode === 'web') {
      source.webUpdateMode = input.webUpdateMode ?? 'reload';
      if (!['reload', 'live'].includes(source.webUpdateMode)) throw new Error('网页更新方式无效');
      if (source.webUpdateMode === 'reload' && interval < 30) throw new Error('整页重载周期至少 30 秒；需要更快更新时请选择“读取页面实时变化”');
      source.url = validateUrl(input.url);
      source.waitSeconds = Number(input.waitSeconds ?? 3);
      if (!Number.isInteger(source.waitSeconds) || source.waitSeconds < 1 || source.waitSeconds > 60) throw new Error('网页等待时间需为 1–60 秒');
    } else source.kind = 'fixed';
  }
  if (input.kind === 'demo') {
    source.demoValue = Number(input.demoValue ?? 36.5);
    source.demoTotal = input.demoTotal == null ? null : Number(input.demoTotal);
    if (!Number.isFinite(source.demoValue) || (source.demoTotal !== null && !Number.isFinite(source.demoTotal))) throw new Error('演示数值无效');
  }
  return source;
}

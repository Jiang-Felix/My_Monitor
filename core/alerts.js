import { randomUUID } from 'node:crypto';
import { parseFixed, validateSample } from './metrics.js';
import { validAlertCadence } from './alert-cadence.js';
import { digestSourceIdentity } from './source-identity.js';

import { MAX_ALERT_POINTS, CHART_POINT_OPTIONS, DEFAULT_CHART_POINTS } from './alert-points.js';
export { MAX_ALERT_POINTS };
const MAX_RULES = 100, MAX_NOTIFICATIONS = 200;
const clone = value => structuredClone(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const bound = (value, label) => value == null || (typeof value === 'string' && !value.trim()) ? null : parseFixed(value, label);

export function validateAlertRule(input) {
  if (!input || typeof input !== 'object') throw new Error('告警配置无效');
  const id = input.id || randomUUID(), name = String(input.name || '').trim();
  if (!validId(id) || !validId(input.sourceId)) throw new Error('请选择需要检测的数据');
  if (!name || name.length > 60) throw new Error('告警名称需要 1–60 个字符');
  if (!['delta', 'value'].includes(input.type)) throw new Error('请选择变量检测或定量检测');
  const lower = bound(input.lower, '范围下限'), upper = bound(input.upper, '范围上限');
  if (lower === null && upper === null) throw new Error('请至少填写范围下限或上限');
  if (lower !== null && upper !== null && lower > upper) throw new Error('范围下限不能大于上限');
  const updateEvery = parseFixed(input.updateEvery ?? 1, '更新次数');
  if (!validAlertCadence(updateEvery)) throw new Error('记录倍率请选择 1–12、步长 0.5；自定义更新次数需为 1–2592000 的整数');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('告警开关无效');
  if (input.notificationsEnabled !== undefined && typeof input.notificationsEnabled !== 'boolean') throw new Error('通知开关无效');
  const chartPoints=Number(input.chartPoints ?? DEFAULT_CHART_POINTS);
  if(typeof input.chartPoints==='boolean'||!CHART_POINT_OPTIONS.includes(chartPoints))throw new Error('图表范围请选择最近10、20或50次');
  return { id, name, sourceId: input.sourceId, type: input.type, lower, upper, updateEvery, chartPoints, enabled: input.enabled !== false, notificationsEnabled:input.notificationsEnabled !== false };
}

export function sourceIdentity(source) {
  // Numeric fixed-value edits are new observations; enabling a source does not change its meaning.
  return digestSourceIdentity(JSON.stringify(['kind', 'url', 'valuePath', 'selector', 'valueMode', 'webUpdateMode', 'unit'].map(key => source[key] ?? null)));
}

function migrateRule(old,source) {
  const threshold = parseFixed(old.threshold, '旧变化阈值');
  if (threshold <= 0 || !['increase', 'decrease', 'change'].includes(old.direction)) throw new Error('旧告警规则无效');
  const intervalSeconds = { hour: 3600, day: 86400, week: 604800, month: 2592000 }[old.unit];
  const rule = validateAlertRule({ ...old, type: 'delta', lower: old.direction === 'increase' ? null : -threshold, upper: old.direction === 'decrease' ? null : threshold, updateEvery:legacyCount(intervalSeconds,source), enabled: false });
  return { ...rule, migrationNote: '旧规则已转换为按数据更新次数记录，请编辑确认范围与次数后开始。' };
}
function legacyCount(seconds,source){
  const value=parseFixed(seconds,'旧记录间隔');
  if(!Number.isInteger(value)||value<1||value>2592000)throw new Error('旧记录间隔无效');
  return Math.max(1,Math.ceil(value/(source?.interval||60)));
}
const updateToken=source=>Number.isSafeInteger(source?.updateSequence)?`sequence:${source.updateSequence}`:Number.isFinite(source?.lastSuccess)?`time:${source.lastSuccess}`:null;

function resetRuntime(track) {
  track.previous = null; track.lastSuccess = null;
  track.measurement = null; track.outside = false; track.error = ''; track.segment = randomUUID(); track.live = false;
  track.updatesSinceRecord=0;
}

function restoreTrack(saved, rule) {
  // Validate earlier 120-point files too; a program restart always begins a new segment.
  if (!Array.isArray(saved.points) || saved.points.length > 120 || saved.sourceId !== rule.sourceId || typeof saved.identity !== 'string' || saved.identity.length > 16384) throw new Error('本地告警图表记录无效');
  const segmentTimes = new Map();
  for (const point of saved.points) {
    if (!Number.isFinite(point.time) || point.time < (segmentTimes.get(point.segment) ?? -Infinity) || !Number.isFinite(point.value) || !Number.isFinite(point.sourceTime) || !validId(point.segment) || (point.measurement !== null && !Number.isFinite(point.measurement))) throw new Error('本地告警记录点无效');
    segmentTimes.set(point.segment,point.time);
  }
  const track = { ruleId: rule.id, sourceId: rule.sourceId, sourceName: String(saved.sourceName || '').slice(0, 60), unit: String(saved.unit || '').slice(0, 16), identity: digestSourceIdentity(saved.identity), current: saved.points.at(-1)?.value ?? null, points: clone(saved.points), lastAlert: saved.lastAlert ? clone(saved.lastAlert) : null };
  resetRuntime(track);
  track.points=track.points.slice(-MAX_ALERT_POINTS);
  track.measurement=track.points.at(-1)?.measurement??null;
  track.outside=Number.isFinite(track.measurement)&&((rule.lower!==null&&track.measurement<rule.lower)||(rule.upper!==null&&track.measurement>rule.upper));
  track.error=typeof saved.error==='string'?saved.error.slice(0,500):'';
  track.live=track.points.length>0;
  return track;
}

export class AlertEngine {
  constructor({ now = Date.now, onNotify = () => {} } = {}) {
    this.now = now; this.onNotify = onNotify;
    this.rules = new Map(); this.tracks = new Map(); this.acceptAfter = new Map(); this.notifications = []; this.activeSession = null;
    this.seenUpdates=new Map();
  }
  fork() {
    const draft=new AlertEngine({now:this.now,onNotify:this.onNotify});
    for(const key of ['rules','tracks','acceptAfter','seenUpdates','notifications','activeSession','lastClock'])draft[key]=clone(this[key]);
    return draft;
  }
  startRun(saved,sources=[]) {
    this.rules.clear(); this.tracks.clear(); this.acceptAfter.clear(); this.notifications = [];
    this.seenUpdates.clear();const available=new Map(sources.map(source=>[source.id,source]));
    if (saved) {
      if (saved.schemaVersion !== undefined && ![2,3].includes(saved.schemaVersion)) throw new Error('告警配置版本无效');
      if (!Array.isArray(saved.rules) || saved.rules.length > MAX_RULES) throw new Error('本地告警规则无效或超过100条');
      const modern = saved.schemaVersion !== undefined;
      for (const input of saved.rules) {
        const source=available.get(input.sourceId);
        const rule = modern ? validateAlertRule({...input,updateEvery:input.updateEvery??(saved.schemaVersion===2?legacyCount(input.intervalSeconds,source):1)}) : migrateRule(input,source);
        if (modern && input.migrationNote) rule.migrationNote = String(input.migrationNote).slice(0, 200);
        if(modern && input.cadenceNote)rule.cadenceNote=String(input.cadenceNote).slice(0,200);
        if(saved.schemaVersion===2&&input.updateEvery===undefined&&rule.updateEvery*(source?.interval||60)!==input.intervalSeconds)rule.cadenceNote=`旧记录间隔 ${input.intervalSeconds}秒已转换为每 ${rule.updateEvery} 次更新（约 ${rule.updateEvery*(source?.interval||60)}秒），请编辑确认。`;
        if (this.rules.has(rule.id)) throw new Error('告警标识重复');
        this.rules.set(rule.id, rule);
      }
      if (modern) {
        if (!Array.isArray(saved.tracking) || !Array.isArray(saved.notifications)) throw new Error('本地告警记录无效');
        const savedTrackIds=new Set();
        for (const item of saved.tracking) {
          const rule = this.rules.get(item.ruleId);
          if (!rule || savedTrackIds.has(item.ruleId)) throw new Error('本地告警图表与条目不匹配');
          savedTrackIds.add(item.ruleId);
          const track=restoreTrack(item, rule);
          if(!rule.enabled)this.tracks.set(rule.id,track);
        }
        this.notifications = clone(saved.notifications).filter(item => Number.isFinite(item.time)).slice(-MAX_NOTIFICATIONS);
      }
    }
    const time = this.now(); this.lastClock = time; this.activeSession = { startedAt: time };
    for (const rule of this.rules.values()){this.acceptAfter.set(rule.id,time);this.seenUpdates.set(rule.id,updateToken(available.get(rule.sourceId)));}
  }
  upsert(input,source) {
    const rule = validateAlertRule(input), old = this.rules.get(rule.id);
    if(old?.cadenceNote&&['sourceId','type','updateEvery'].every(key=>old[key]===rule[key]))rule.cadenceNote=old.cadenceNote;
    if (!old && this.rules.size >= MAX_RULES) throw new Error('最多支持100个告警条目');
    const meaningChanged=old&&['sourceId','type'].some(key=>old[key]!==rule[key]);
    const restarted=!old||meaningChanged||(rule.enabled&&(!old.enabled||['lower','upper','updateEvery'].some(key=>old[key]!==rule[key])));
    if(restarted){this.tracks.delete(rule.id);this.acceptAfter.set(rule.id,this.now());if(source)this.seenUpdates.set(rule.id,updateToken(source));}
    if(old&&!old.enabled&&rule.enabled)this.notifications=this.notifications.filter(item=>item.ruleId!==rule.id);
    this.rules.set(rule.id, rule); return rule;
  }
  remove(id) {
    if (!this.rules.has(id)) throw new Error('告警条目不存在');
    this.rules.delete(id); this.tracks.delete(id); this.acceptAfter.delete(id);
    this.seenUpdates.delete(id);
    this.notifications = this.notifications.filter(item => item.ruleId !== id);
  }
  removeSource(id) {
    const linked=[...this.rules.values()].filter(rule=>rule.sourceId===id);
    for(const rule of linked)this.remove(rule.id);
    return linked.length;
  }
  resetSource(id) {
    for (const rule of this.rules.values()) if (rule.sourceId === id && rule.enabled) { this.tracks.delete(rule.id); this.acceptAfter.set(rule.id, this.now()); }
  }
  observe(sources) {
    if (!this.activeSession) return false;
    const available = new Map(sources.map(source => [source.id, source])), time = this.now();
    let changed = false;
    if (time < this.lastClock) {
      // A discontinuity starts a clean comparison and graph segment.
      this.activeSession.startedAt = time;
      for (const rule of this.rules.values()) {
        if(rule.enabled){this.tracks.delete(rule.id);this.acceptAfter.set(rule.id,time);}
      }
      changed = true;
    }
    this.lastClock = time;
    for (const rule of this.rules.values()) {
      const source = available.get(rule.sourceId); let track = this.tracks.get(rule.id);
      const token=updateToken(source);
      if(!rule.enabled){this.seenUpdates.set(rule.id,token);continue;}
      if (track && source && track.identity !== sourceIdentity(source)) { this.tracks.delete(rule.id); track = null; changed = true; }
      let validSample=false;
      if(source?.sample){try{validateSample(source.sample);validSample=Number.isFinite(source.sample.value)&&(source.sample.total==null||Number.isFinite(source.sample.total));}catch{}}
      // Idle/reloading transitions during a numeric edit or a normal refresh are not failures.
      const interrupted=track && (!source || source.enabled===false || source.failed || source.stale || !['ok','refreshing','idle'].includes(source.status) || (source.status==='ok'&&(!validSample || !Number.isFinite(source.lastSuccess) || source.lastSuccess < track.lastSuccess)));
      if(interrupted){this.tracks.delete(rule.id);track=null;this.acceptAfter.set(rule.id,time);this.seenUpdates.set(rule.id,token);changed=true;}
      if (!rule.enabled || !source?.enabled || !['ok','refreshing'].includes(source.status) || source.failed || source.stale || !source.sample || !Number.isFinite(source.lastSuccess) || source.lastSuccess > time || source.lastSuccess < Math.max(this.activeSession.startedAt, this.acceptAfter.get(rule.id) || 0) || (track?.lastSuccess !== null && track?.lastSuccess !== undefined && source.lastSuccess < track.lastSuccess)) continue;
      if (!Number.isFinite(source.sample.value) || (source.sample.total != null && !Number.isFinite(source.sample.total))) continue;
      try { validateSample(source.sample); } catch { continue; }
      if(token===null||this.seenUpdates.get(rule.id)===token)continue;
      this.seenUpdates.set(rule.id,token);
      if(track&&source.interval>0&&source.lastSuccess-track.lastSuccess>source.interval*2000){this.tracks.delete(rule.id);track=null;}
      if (!track) {
        track = { ruleId: rule.id, sourceId: source.id, sourceName: source.name, unit: source.unit || '', identity: sourceIdentity(source), current: null, points: [], lastAlert: null };
        resetRuntime(track); this.tracks.set(rule.id, track);
      }
      track.lastSuccess=source.lastSuccess;
      track.updatesSinceRecord++;
      changed=true;
      if(track.updatesSinceRecord<rule.updateEvery)continue;
      track.updatesSinceRecord-=rule.updateEvery;
      const previous = track.previous, current = source.sample.value;
      let measurement = rule.type === 'value' ? current : previous === null ? null : current - previous;
      track.error = measurement !== null && !Number.isFinite(measurement) ? '变化量超出可计算范围，请检查数值量级。' : '';
      if (track.error) measurement = null;
      track.previous = current; track.current = current; track.lastSuccess = source.lastSuccess; track.measurement = measurement; track.live = true;
      track.sourceName = source.name; track.unit = source.unit || '';
      track.outside = measurement !== null && ((rule.lower !== null && measurement < rule.lower) || (rule.upper !== null && measurement > rule.upper));
      track.points.push({ time, sourceTime: source.lastSuccess, value: current, measurement, segment: track.segment,sequence:source.updateSequence??null });
      if (track.points.length > MAX_ALERT_POINTS) track.points.splice(0, track.points.length - MAX_ALERT_POINTS);
      if (track.outside) {
        const item = { id: randomUUID(), ruleId: rule.id, name: rule.name, sourceId: source.id, sourceName: source.name, unit: track.unit, type: rule.type, lower: rule.lower, upper: rule.upper, measurement, previous, value: current, time, delivery: rule.notificationsEnabled ? 'pending' : 'muted', error: '' };
        this.notifications.push(item); this.notifications = this.notifications.slice(-MAX_NOTIFICATIONS); track.lastAlert = clone(item);
        if(rule.notificationsEnabled)try { this.onNotify(clone(item)); } catch (failure) { this.updateDelivery(item.id, 'failed', failure.message); }
      }
      changed = true;
    }
    return changed;
  }
  updateDelivery(id, delivery, error = '') {
    if (!['pending', 'requested', 'shown', 'failed', 'unsupported', 'test', 'muted'].includes(delivery)) throw new Error('通知状态无效');
    const update = item => { item.delivery = delivery; item.error = String(error).slice(0, 500); };
    const item = this.notifications.find(item => item.id === id); if (item) update(item);
    for (const track of this.tracks.values()) if (track.lastAlert?.id === id) update(track.lastAlert);
  }
  finishRun() { this.activeSession = null;for(const rule of this.rules.values())if(rule.enabled)this.tracks.delete(rule.id); }
  serialize() { return clone({ schemaVersion: 3, rules: [...this.rules.values()], tracking: [...this.tracks.values()], notifications: this.notifications }); }
  snapshot() { return { ...this.serialize(), activeSession: this.activeSession ? { ...this.activeSession } : null }; }
}

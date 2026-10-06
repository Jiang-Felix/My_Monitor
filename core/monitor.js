import { validateSource } from './config.js';
import { extractSample, validateSample } from './metrics.js';

export class Monitor {
  constructor({ collect, onChange = () => {}, now = Date.now, maxSources = 100 }) {
    if (!Number.isInteger(maxSources) || maxSources < 1) throw new TypeError('Invalid source limit');
    this.maxSources = maxSources;
    this.stopped = false;
    this.collect = collect;
    this.onChange = onChange;
    this.now = now;
    this.sources = new Map();
    this.pending = new Map();
    this.staleFlags = new Map();
    this.lastFinished = new Map();
    this.readings = new Map();
    this.changes = new Map();
    this.recentChanges = new Map();
    this.updateSequences = new Map();
  }
  upsert(input) {
    const config = validateSource(input);
    const old = this.sources.get(config.id);
    if (!old && this.sources.size >= this.maxSources) throw new Error('数据源数量达到上限');
    this.cancel(config.id);
    const fields = ['kind', 'url', 'valuePath', 'totalPath', 'selector', 'totalSelector', 'valueMode', 'totalMode', 'fixedValue', 'fixedTotal', 'waitSeconds', 'webUpdateMode', 'unit', 'demoValue', 'demoTotal'];
    const changed = !old || fields.some(key => old[key] !== config[key]);
    // Numeric edits change the same quantity; identity edits and pause boundaries start a new baseline.
    const numericFields = ['fixedValue', 'fixedTotal', 'demoValue', 'demoTotal'];
    if (!old || old.enabled !== config.enabled || fields.some(key => !numericFields.includes(key) && old[key] !== config[key])) {
      this.readings.delete(config.id); this.changes.delete(config.id); this.recentChanges.delete(config.id);
    }
    const state = { ...config, sample: changed ? null : old.sample, status: changed ? 'idle' : old.status, error: changed ? '' : old.error, lastSuccess: changed ? null : old.lastSuccess, nextRun: this.now(), failures: 0, failed: changed ? false : old.failed };
    state.updateSequence=this.updateSequences.get(config.id)||0;
    this.sources.set(config.id, state);
    this.notify();
    return state;
  }
  restore(records) {
    if (!Array.isArray(records) || records.length > this.maxSources || new Set([...this.sources.keys(), ...records.map(record => record?.id)]).size > this.maxSources) throw new Error('恢复的数据源数量超过上限');
    for (const record of records) {
      const source = this.upsert(record);
      if (record.sample && Number.isFinite(record.sample.value) && (record.sample.total == null || Number.isFinite(record.sample.total))) {
        source.sample = { ...record.sample, unit: source.unit };
        source.lastSuccess = Number.isFinite(record.lastSuccess) ? record.lastSuccess : null;
      }
      source.status = record.status === 'refreshing' ? 'idle' : (record.status || 'idle');
      source.error = record.error || '';
      source.failed = record.failed || !['ok', 'idle', 'refreshing'].includes(source.status);
      if (source.sample) {
        try { validateSample(source.sample); }
        catch (failure) { source.sample = null; source.lastSuccess = null; source.status = 'range'; source.error = failure.message; source.failed = true; }
      }
    }
    this.notify();
  }
  cancel(id) { this.pending.get(id)?.controller.abort(); }
  cancelAll() { this.stopped = true; for (const id of this.pending.keys()) this.cancel(id); }
  remove(id) { this.cancel(id); this.sources.delete(id); this.lastFinished.delete(id); this.readings.delete(id); this.changes.delete(id); this.recentChanges.delete(id); this.updateSequences.delete(id); this.notify(); }
  notify() {
    const sources = this.snapshot();
    this.staleFlags = new Map(sources.map(source => [source.id, source.stale]));
    this.onChange(sources);
  }
  isStale(source) {
    return !!source.sample && (source.failed || source.lastSuccess === null || this.now() - source.lastSuccess > source.interval * 2000 || !['ok', 'refreshing'].includes(source.status));
  }
  snapshot() {
    return [...this.sources.values()].map(source => ({ ...source, sample: source.sample ? { ...source.sample } : null, change: this.changes.get(source.id) ? { ...this.changes.get(source.id) } : null, recentChange: this.recentChanges.get(source.id) ? { ...this.recentChanges.get(source.id) } : null, stale: this.isStale(source) }));
  }
  refresh(id) {
    const source = this.sources.get(id);
    if (this.stopped || !source?.enabled) return Promise.resolve();
    const pending = this.pending.get(id);
    if (pending?.source === source) return pending.promise;
    const controller = new AbortController();
    let startedAt, collected = false;
    source.status = 'refreshing';
    this.notify();
    const collectLatest = async () => {
      if (controller.signal.aborted || this.sources.get(id) !== source) return;
      if (pending) {
        const delay = Math.max(0, (this.lastFinished.get(id) ?? this.now()) + 250 - this.now());
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (controller.signal.aborted || this.sources.get(id) !== source) return;
      }
      startedAt = this.now(); collected = true;
      return this.collect(source, { signal: controller.signal });
    };
    const promise = (pending ? pending.promise.catch(() => {}).then(collectLatest) : Promise.resolve().then(collectLatest)).then(payload => {
      if (controller.signal.aborted || !collected || this.sources.get(id) !== source) return;
      source.sample = extractSample(source, payload);
      source.lastSuccess = this.now();
      source.updateSequence=(this.updateSequences.get(id)||0)+1;
      this.updateSequences.set(id,source.updateSequence);
      const prior = this.readings.get(id), delta = source.sample.value - (prior?.value ?? source.sample.value);
      const change = prior && source.lastSuccess >= prior.time && Number.isFinite(delta) ? { previousValue: prior.value, previousTotal: prior.total, delta, intervalSeconds: source.interval } : null;
      this.changes.set(id, change);
      if (!change) this.recentChanges.delete(id);
      else if (delta !== 0) this.recentChanges.set(id, { ...change, currentValue: source.sample.value, currentTotal: source.sample.total });
      this.readings.set(id, { value: source.sample.value, total: source.sample.total, time: source.lastSuccess });
      source.status = 'ok';
      source.error = '';
      source.failures = 0;
      source.failed = false;
      source.nextRun = Math.max(startedAt + source.interval * 1000, this.now() + 250);
    }).catch(error => {
      if (controller.signal.aborted || this.sources.get(id) !== source) return;
      source.status = ['auth', 'rate', 'locator', 'parse', 'network', 'range'].includes(error.code) ? error.code : 'parse';
      source.error = error.message;
      source.failures++;
      source.failed = true;
      source.nextRun = source.status === 'auth' ? Infinity : this.now() + Math.max(5000, error.retryAfter || 0, Math.min(3600000, source.interval * 1000 * 2 ** Math.min(source.failures, 5)));
    }).finally(() => {
      if (collected && this.sources.has(id)) this.lastFinished.set(id, this.now());
      if (this.pending.get(id)?.promise === promise) this.pending.delete(id);
      this.notify();
    });
    this.pending.set(id, { source, promise, controller });
    return promise;
  }
  async refreshAll() { await Promise.all([...this.sources.keys()].map(id => this.refresh(id))); }
  tick() {
    for (const source of this.sources.values()) if (source.enabled && source.nextRun <= this.now()) void this.refresh(source.id);
    if ([...this.sources.values()].some(source => this.isStale(source) !== this.staleFlags.get(source.id))) this.notify();
  }
}

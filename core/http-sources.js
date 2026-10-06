import { createHash } from 'node:crypto';
import { collectHttp } from './http.js';
import { BoundedQueue, cancellationError } from './collection-queue.js';
import { validateUrl } from './config.js';

export class HttpSources {
  constructor({ concurrency = 4, maxQueued = 100, maxStarts = 8, maxStartsPerHost = 8, rateWindowMs = 1000, maxTotalBytes = 32 * 1024 * 1024, byteWindowMs = 60000, timeout = 15000, maxBytes = 2 * 1024 * 1024, fetcher = fetch } = {}) {
    if (!Number.isInteger(maxStarts) || maxStarts < 1 || !Number.isInteger(maxStartsPerHost) || maxStartsPerHost < 1 || !Number.isFinite(rateWindowMs) || rateWindowMs <= 0 || !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || !Number.isFinite(byteWindowMs) || byteWindowMs < 1) throw new TypeError('Invalid HTTP collection limits');
    this.cache = new Map();
    this.queue = new BoundedQueue({ concurrency, maxQueued });
    this.work = new Map();
    this.hostStarts = new Map();
    this.starts = [];
    this.maxStarts = maxStarts;
    this.maxStartsPerHost = maxStartsPerHost;
    this.rateWindowMs = rateWindowMs;
    this.maxTotalBytes = maxTotalBytes;
    this.byteWindowMs = byteWindowMs;
    this.byteBucketMs = Math.max(1, Math.ceil(byteWindowMs / 60));
    this.byteBuckets = new Map();
    this.options = { timeout, maxBytes, fetcher };
  }
  receiveBytes(bytes) {
    const now = Date.now();
    for (const [expires] of this.byteBuckets) if (expires <= now) this.byteBuckets.delete(expires);
    if (bytes) {
      // At most 61 rolling time buckets; partial buckets expire conservatively.
      const expires = (Math.floor(now / this.byteBucketMs) + 1) * this.byteBucketMs + this.byteWindowMs;
      this.byteBuckets.set(expires, (this.byteBuckets.get(expires) || 0) + bytes);
    }
    let used = [...this.byteBuckets.values()].reduce((total, value) => total + value, 0);
    if (used > this.maxTotalBytes || (!bytes && used >= this.maxTotalBytes)) {
      let retryAfter = this.byteWindowMs;
      for (const [expires, value] of this.byteBuckets) {
        used -= value; retryAfter = Math.max(1, expires - now);
        if (used < this.maxTotalBytes) break;
      }
      throw Object.assign(new Error('接口采集响应总量达到上限，稍后自动重试'), { code: 'rate', retryAfter });
    }
  }
  async waitForHost(host, signal) {
    while (true) {
      if (signal.aborted) throw cancellationError();
      const now = Date.now();
      this.starts = this.starts.filter(time => now - time < this.rateWindowMs);
      for (const [key, starts] of this.hostStarts) {
        const recent = starts.filter(time => now - time < this.rateWindowMs);
        if (recent.length) this.hostStarts.set(key, recent);
        else this.hostStarts.delete(key);
      }
      const starts = this.hostStarts.get(host) || [];
      if (starts.length < this.maxStartsPerHost && this.starts.length < this.maxStarts) {
        if (!this.hostStarts.has(host) && this.hostStarts.size >= 128) throw Object.assign(new Error('请求主机数量达到上限，稍后重试'), { code: 'rate', retryAfter: this.rateWindowMs });
        starts.push(now); this.hostStarts.set(host, starts); this.starts.push(now); return;
      }
      const delay = Math.max(1,
        starts.length >= this.maxStartsPerHost ? starts[0] + this.rateWindowMs - now : 0,
        this.starts.length >= this.maxStarts ? this.starts[0] + this.rateWindowMs - now : 0);
      await new Promise((resolve, reject) => {
        const cancelled = () => { clearTimeout(timer); signal.removeEventListener('abort', cancelled); reject(cancellationError()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancelled); resolve(); }, delay);
        signal.addEventListener('abort', cancelled, { once: true });
        if (signal.aborted) cancelled();
      });
    }
  }
  collect(source, token = '', { signal } = {}) {
    if (this.queue.closed || signal?.aborted) return Promise.reject(cancellationError());
    let host;
    try { host = new URL(validateUrl(source.url)).hostname; }
    catch (error) { return Promise.reject(error); }
    const signature = createHash('sha256').update(JSON.stringify([source.url, token])).digest('hex');
    let cache = this.cache.get(source.id);
    if (!cache || cache.signature !== signature) {
      if (cache) this.clear(source.id);
      cache = { signature }; this.cache.set(source.id, cache);
      if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value);
    }
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    let work = this.work.get(source.id);
    if (!work) { work = new Set(); this.work.set(source.id, work); }
    work.add(controller);
    return this.queue.run(async queuedSignal => {
      if (queuedSignal.aborted) throw cancellationError();
      this.receiveBytes(0);
      await this.waitForHost(host, queuedSignal);
      if (queuedSignal.aborted) throw cancellationError();
      this.receiveBytes(0);
      return collectHttp(source, token, { ...this.options, cache, signal: queuedSignal, onBytes: bytes => this.receiveBytes(bytes) });
    }, { signal: controller.signal }).finally(() => {
      signal?.removeEventListener('abort', cancel);
      work.delete(controller);
      if (!work.size && this.work.get(source.id) === work) this.work.delete(source.id);
    });
  }
  clear(id) { this.cache.delete(id); for (const controller of this.work.get(id) || []) controller.abort(); }
  closeAll() { this.queue.close(); this.cache.clear(); this.hostStarts.clear(); this.starts = []; this.byteBuckets.clear(); }
}

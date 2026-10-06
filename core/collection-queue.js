export const cancellationError = () => Object.assign(new Error('采集已取消'), { name: 'AbortError', code: 'cancelled' });

// An aborted running job keeps its slot until its actual promise settles.
export class BoundedQueue {
  constructor({ concurrency, maxQueued = 100 }) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maxQueued) || maxQueued < 0) throw new TypeError('Invalid collector queue limits');
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.active = new Set();
    this.waiting = [];
    this.closed = false;
  }
  get activeCount() { return this.active.size; }
  get queuedCount() { return this.waiting.length; }
  run(job, { signal } = {}) {
    if (this.closed || signal?.aborted) return Promise.reject(cancellationError());
    if (this.active.size >= this.concurrency && this.waiting.length >= this.maxQueued) return Promise.reject(Object.assign(new Error('采集等待队列已满，稍后重试'), { code: 'rate', retryAfter: 1000 }));
    return new Promise((resolve, reject) => {
      const entry = { job, resolve, reject, controller: new AbortController(), signal };
      entry.abort = () => {
        entry.controller.abort(cancellationError());
        const index = this.waiting.indexOf(entry);
        if (index >= 0) {
          this.waiting.splice(index, 1);
          this.cleanup(entry);
          reject(cancellationError());
        }
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      if (this.active.size < this.concurrency) this.start(entry);
      else this.waiting.push(entry);
    });
  }
  cleanup(entry) { entry.signal?.removeEventListener('abort', entry.abort); }
  start(entry) {
    this.active.add(entry);
    let result;
    try { result = entry.job(entry.controller.signal); }
    catch (error) { result = Promise.reject(error); }
    const finish = (failed, value) => {
      this.cleanup(entry);
      this.active.delete(entry);
      while (!this.closed && this.waiting.length && this.active.size < this.concurrency) this.start(this.waiting.shift());
      if (entry.controller.signal.aborted) entry.reject(cancellationError());
      else if (failed) entry.reject(value);
      else entry.resolve(value);
    };
    Promise.resolve(result).then(value => finish(false, value), error => finish(true, error));
  }
  cancelAll() {
    for (const entry of [...this.waiting, ...this.active]) entry.abort();
  }
  close() { this.closed = true; this.cancelAll(); }
}

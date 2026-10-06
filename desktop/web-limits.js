export const webFailure = (message, code) => Object.assign(new Error(message), { code });
export const cancelled = () => webFailure('网页任务已取消', 'cancelled');

// Every asynchronous browser boundary must release its timer and abort listener.
export function bounded(operation, { signal, timeoutMs, failure, onTimeout } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : cancelled());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (failed, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      failed ? reject(value) : resolve(value);
    };
    const abort = () => finish(true, signal.reason instanceof Error ? signal.reason : cancelled());
    const timer = timeoutMs == null ? undefined : setTimeout(() => {
      finish(true, failure || webFailure('网页操作超时', 'network')); onTimeout?.();
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(()=>{
      if(settled||signal?.aborted)return;
      return operation();
    }).then(value => finish(false, value), error => finish(true, error));
  });
}

// One-second buckets keep accounting memory constant even for streaming pages.
export class RollingBytes {
  constructor(windowMs = 60000) { this.windowMs = windowMs; this.buckets = new Map(); }
  add(bytes, now = Date.now()) {
    const second = Math.floor(now / 1000);
    for (const key of this.buckets.keys()) if ((key + 1) * 1000 <= now - this.windowMs) this.buckets.delete(key);
    this.buckets.set(second, (this.buckets.get(second) || 0) + Math.max(0, bytes));
    return [...this.buckets.values()].reduce((sum, value) => sum + value, 0);
  }
}

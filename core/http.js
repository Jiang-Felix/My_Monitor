import { validateUrl } from './config.js';
import { cancellationError } from './collection-queue.js';

const failure = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });
function retryDelay(header) {
  if (!header) return undefined;
  const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - Date.now());
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined;
}
export async function collectHttp(source, token = '', { timeout = 15000, maxBytes = 2 * 1024 * 1024, fetcher = fetch, cache, signal, onBytes = () => {} } = {}) {
  if (signal?.aborted) throw cancellationError();
  const url = validateUrl(source.url);
  const headers = { Accept: 'application/json' };
  if (cache?.payload !== undefined) {
    if (cache.etag) headers['If-None-Match'] = cache.etag;
    else if (cache.modified) headers['If-Modified-Since'] = cache.modified;
  }
  const clearCache = () => { if (cache) { delete cache.payload; delete cache.etag; delete cache.modified; } };
  if (token) {
    if (/[\r\n]/.test(token) || token.length > 8192) throw failure('授权 Token 格式无效', 'auth');
    headers.Authorization = `Bearer ${token}`;
  }
  const controller = new AbortController();
  let reader;
  const disposeReader = () => { if (reader) void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', disposeReader, { once: true });
  const cancel = () => controller.abort(cancellationError());
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
    if (controller.signal.aborted) {
      if (response.body) void response.body.cancel().catch(() => {});
      throw signal?.aborted ? cancellationError() : failure('请求超时，请检查网络或接口', 'network');
    }
    if (signal?.aborted) throw cancellationError();
    if (response.status === 304) {
      if (cache?.payload === undefined || (!headers['If-None-Match'] && !headers['If-Modified-Since'])) throw failure('接口返回了无法确认的缓存响应，请重新刷新', 'network');
      const payload = cache.payload;
      if (/\bno-store\b/i.test(response.headers.get('cache-control') || '')) clearCache();
      return payload;
    }
    if ([401, 403].includes(response.status)) throw failure('授权失效或没有访问权限，请更新 Token', 'auth');
    if (response.status === 429) {
      throw failure('平台限制请求频率，稍后自动重试', 'rate', { retryAfter: retryDelay(response.headers.get('retry-after')) ?? 60000 });
    }
    if (response.status >= 300 && response.status < 400) throw failure('接口发生重定向，请填写最终接口地址', 'network');
    if (!response.ok) throw failure(`接口返回 HTTP ${response.status}`, 'network', { retryAfter: retryDelay(response.headers.get('retry-after')) ?? 0 });
    if (Number(response.headers.get('content-length')) > maxBytes) throw failure('接口响应过大', 'parse');
    reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw cancellationError();
      if (controller.signal.aborted) throw failure('请求超时，请检查网络或接口', 'network');
      if (done) break;
      onBytes(value.byteLength);
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw failure('接口响应过大', 'parse'); }
      chunks.push(Buffer.from(value));
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw failure('接口没有返回有效 JSON，请检查网址和登录状态', 'parse'); }
    clearCache();
    if (cache && length <= 256 * 1024 && !/\bno-store\b/i.test(response.headers.get('cache-control') || '')) {
      const etag = response.headers.get('etag'), modified = response.headers.get('last-modified');
      if ((etag && etag.length <= 1024) || (modified && modified.length <= 128)) {
        cache.payload = payload;
        if (etag && etag.length <= 1024) cache.etag = etag;
        else if (modified && modified.length <= 128) cache.modified = modified;
      }
    }
    return payload;
  } catch (error) {
    const timedOut = controller.signal.aborted;
    clearCache();
    controller.abort();
    if (signal?.aborted) throw cancellationError();
    if (['auth', 'rate', 'network', 'parse'].includes(error.code)) throw error;
    throw failure(timedOut ? '请求超时，请检查网络或接口' : '无法连接接口，请检查网络和网址', 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', disposeReader);
    reader?.releaseLock();
  }
}

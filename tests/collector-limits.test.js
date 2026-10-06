import test from 'node:test';
import assert from 'node:assert/strict';
import { Monitor } from '../core/monitor.js';
import { HttpSources } from '../core/http-sources.js';
import { collectHttp } from '../core/http.js';
const source = { id: 'a', name: 'test', kind: 'http', url: 'http://127.0.0.1:9/data', valuePath: 'value', interval: 1 };
const turn = () => new Promise(resolve => setImmediate(resolve));

test('source count and oversized restores are rejected before changing active sources', () => {
  const monitor = new Monitor({ collect: async () => ({}), maxSources: 2 });
  monitor.upsert(source); monitor.upsert({ ...source, id: 'b' });
  assert.throws(() => monitor.upsert({ ...source, id: 'c' }), /上限|过多/);
  assert.throws(() => monitor.restore([{ ...source, name: 'changed' }, { ...source, id: 'b' }, { ...source, id: 'c' }]), /上限|过多/);
  assert.equal(monitor.snapshot()[0].name, 'test');
});

test('pause, remove and shutdown abort source work without accepting late results', async () => {
  for (const action of ['pause', 'remove', 'shutdown']) {
    let signal, release;
    const monitor = new Monitor({ collect: (_source, options) => { signal = options?.signal; return new Promise(resolve => { release = resolve; }); } });
    monitor.upsert(source); const pending = monitor.refresh('a'); await turn();
    if (action === 'pause') monitor.upsert({ ...source, enabled: false });
    if (action === 'remove') monitor.remove('a');
    if (action === 'shutdown') monitor.cancelAll();
    assert.equal(signal?.aborted, true, action);
    release({ value: 99 }); await pending;
    assert.equal(monitor.snapshot()[0]?.sample ?? null, null);
  }
});

test('HTTP cancellation propagates to active fetch and preserves an abort result', async () => {
  const controller = new AbortController();
  let received;
  const pending = collectHttp(source, '', { signal: controller.signal, fetcher: (_url, { signal }) => {
    received = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort(); await rejected; assert.equal(received.aborted, true);
});

test('HTTP cancellation and timeout also dispose a stalled response reader', async () => {
  for (const cancelled of [true, false]) {
    let streamController, disposed = false;
    const stream = new ReadableStream({ start(controller) { streamController = controller; }, cancel() { disposed = true; } });
    const controller = new AbortController();
    const pending = collectHttp(source, '', { signal: controller.signal, timeout: cancelled ? 1000 : 10, fetcher: async () => new Response(stream) });
    const outcome = pending.then(() => 'ok', error => error.name === 'AbortError' ? 'cancelled' : error.code);
    await turn(); if (cancelled) controller.abort();
    try {
      assert.equal(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('stalled'), 50))]), cancelled ? 'cancelled' : 'network');
      assert.equal(disposed, true);
    } finally { if (!disposed) streamController.close(); await outcome; }
  }
});

test('HTTP collection limits concurrency and clear removes queued source work', async () => {
  const releases = [], starts = [];
  const collector = new HttpSources({ concurrency: 1, maxQueued: 2, fetcher: (url, { signal }) => {
    starts.push(url); return new Promise((resolve, reject) => {
      releases.push(() => resolve(new Response('{"value":1}')));
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  const first = collector.collect(source), second = collector.collect({ ...source, id: 'b' });
  const removed = collector.collect({ ...source, id: 'c' });
  const rejected = assert.rejects(removed, { name: 'AbortError' });
  await turn(); assert.equal(starts.length, 1);
  collector.clear('c'); await rejected;
  releases.shift()(); await first; await turn(); assert.equal(starts.length, 2);
  releases.shift()(); await second;
  collector.closeAll(); await assert.rejects(collector.collect(source), { name: 'AbortError' });
});

test('HTTP starts to one host wait for the host budget and can be cancelled while waiting', async () => {
  let starts = 0;
  const collector = new HttpSources({ maxStartsPerHost: 1, rateWindowMs: 40, fetcher: async () => { starts++; return new Response('{"value":1}'); } });
  await collector.collect(source);
  const cancelled = collector.collect({ ...source, id: 'b' });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  await turn(); assert.equal(starts, 1); collector.clear('b'); await rejected;
  await collector.collect({ ...source, id: 'c' }); assert.equal(starts, 2);
  collector.closeAll();
});

test('HTTP request start budget is shared across distinct hosts', async () => {
  let starts = 0;
  const collector = new HttpSources({ maxStarts: 1, rateWindowMs: 40, fetcher: async () => { starts++; return new Response('{"value":1}'); } });
  await collector.collect(source);
  const pending = collector.collect({ ...source, id: 'b', url: 'http://localhost:9/data' });
  await turn(); assert.equal(starts, 1);
  await pending; assert.equal(starts, 2); collector.closeAll();
});

test('shared decoded-body budget aborts oversized streams and blocks other hosts until reset', async () => {
  let starts = 0, disposed = false, aborted;
  const collector = new HttpSources({ maxTotalBytes: 20, byteWindowMs: 50, fetcher: async (_url, { signal }) => {
    starts++; aborted = signal;
    if (starts === 2) return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('0123456789')); },
      cancel() { disposed = true; }
    }));
    return new Response('{"value":1}');
  } });
  await collector.collect(source);
  const failure = await collector.collect({ ...source, id: 'b' }).then(() => null, error => error);
  assert.equal(failure?.code, 'rate'); assert.ok(failure.retryAfter > 0 && failure.retryAfter <= 51);
  assert.equal(disposed, true); assert.equal(aborted.aborted, true);
  await assert.rejects(collector.collect({ ...source, id: 'c', url: 'http://localhost:9/data' }), { code: 'rate' });
  assert.equal(starts, 2, 'an exhausted shared budget prevents another body download');
  await new Promise(resolve => setTimeout(resolve, failure.retryAfter + 5));
  assert.deepEqual(await collector.collect({ ...source, id: 'c' }), { value: 1 }); collector.closeAll();
});

test('small one-second HTTP samples remain available under the default byte budget', async () => {
  const collector = new HttpSources({ fetcher: async () => new Response('{"value":1}') });
  assert.deepEqual(await collector.collect(source), { value: 1 });
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.deepEqual(await collector.collect(source), { value: 1 }); collector.closeAll();
});

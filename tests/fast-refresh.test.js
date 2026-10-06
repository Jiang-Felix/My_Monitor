import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSource } from '../core/config.js';
import { Monitor } from '../core/monitor.js';
const status = await import('../core/resource-status.js').catch(() => ({}));
const base = { id: 'fast', name: '快速值', kind: 'http', url: 'https://example.com/data', valuePath: 'value', interval: 1 };

test('only manual pause is paused; empty, invalid and stale samples are failed', () => {
  assert.equal(typeof status.resourceCategory, 'function');
  const good = { ...base, enabled: true, sample: { value: 0 }, lastSuccess: 1000, status: 'ok' };
  for (const patch of [{}, { status: 'refreshing' }]) assert.equal(status.resourceCategory({ ...good, ...patch }, 1500), 'normal');
  for (const patch of [{ sample: null }, { lastSuccess: null }, { status: 'idle' }, { failed: true }, { sample: { value: NaN } }, { sample: { value: 5, total: 4 } }, { lastSuccess: -10000 }]) assert.equal(status.resourceCategory({ ...good, ...patch }, 1500), 'failed');
  assert.equal(status.resourceCategory(good, 4000), 'failed');
  assert.equal(status.resourceCategory({ ...good, enabled: false, status: 'network' }, 5000), 'paused');
  assert.equal(status.resourceCategory(good, 1500, true), 'failed');
});

test('1 second is allowed for API and live DOM but whole-page reload remains bounded', () => {
  assert.equal(validateSource(base).interval, 1);
  const web = { ...base, kind: 'web', selector: '#value' };
  assert.equal(validateSource({ ...web, webUpdateMode: 'live' }).webUpdateMode, 'live');
  assert.throws(() => validateSource(web), /30|重载/);
  assert.equal(validateSource({ ...web, interval: 30 }).webUpdateMode, 'reload');
  for (const patch of [{ interval: 0 }, { interval: 1.5 }, { interval: true }, { interval: 2592001 }, { kind: 'web', selector: '#x', webUpdateMode: 'bad' }]) assert.throws(() => validateSource({ ...base, ...patch }));
});

test('one-second cadence is based on request start, never overlaps or builds a catch-up queue', async () => {
  let now = 1000, calls = 0, release;
  const monitor = new Monitor({ now: () => now, collect: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  monitor.upsert(base); const first = monitor.refresh(base.id); await Promise.resolve();
  now = 1200; release({ value: 10 }); await first;
  assert.equal(monitor.sources.get(base.id).nextRun, 2000);
  now = 1999; monitor.tick(); assert.equal(calls, 1);
  now = 2000; monitor.tick(); await Promise.resolve(); assert.equal(calls, 2);
  now = 10000; monitor.tick(); monitor.tick(); await Promise.resolve(); assert.equal(calls, 2);
  release({ value: 20 }); await monitor.pending.get(base.id).promise;
  assert.equal(monitor.sources.get(base.id).nextRun, 10250);
  now = 10249; monitor.tick(); assert.equal(calls, 2);
});

test('rapid source failures back off and server Retry-After and auth still take precedence', async () => {
  let failure = Object.assign(new Error('offline'), { code: 'network' });
  const monitor = new Monitor({ now: () => 1000, collect: async () => { throw failure; } });
  monitor.upsert(base); await monitor.refresh(base.id);
  assert.equal(monitor.sources.get(base.id).nextRun, 6000);
  failure = Object.assign(new Error('rate'), { code: 'rate', retryAfter: 60000 }); await monitor.refresh(base.id);
  assert.equal(monitor.sources.get(base.id).nextRun, 61000);
  failure = Object.assign(new Error('auth'), { code: 'auth' }); await monitor.refresh(base.id);
  assert.equal(monitor.sources.get(base.id).nextRun, Infinity);
});

test('a pending fast request emits the transition to stale exactly once', async () => {
  let now = 1000, release, changes = 0, held = false;
  const monitor = new Monitor({ now: () => now, onChange: () => changes++, collect: () => held ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ value: 1 }) });
  monitor.upsert(base); await monitor.refresh(base.id);
  now = 2000; held = true; const pending = monitor.refresh(base.id); await Promise.resolve();
  const before = changes;
  now = 3100; monitor.tick(); assert.equal(changes, before + 1, 'UI receives expiry without waiting for network completion');
  now = 3200; monitor.tick(); assert.equal(changes, before + 1, 'no repeated stale broadcasts');
  release({ value: 2 }); await pending;
});

test('editing a running source serializes by id and skips obsolete queued configurations', async () => {
  let release; const calls = [];
  const monitor = new Monitor({ collect: source => { calls.push(source.valuePath); return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ latest: 30 }); } });
  monitor.upsert(base); const first = monitor.refresh(base.id); await Promise.resolve();
  monitor.upsert({ ...base, valuePath: 'obsolete' }); const obsolete = monitor.refresh(base.id);
  monitor.upsert({ ...base, valuePath: 'latest' }); const latest = monitor.refresh(base.id);
  await Promise.resolve();
  try { assert.deepEqual(calls, ['value'], 'new configurations wait for the active request'); }
  finally { release({ value: 10 }); await Promise.all([first, obsolete, latest]); }
  assert.deepEqual(calls, ['value', 'latest']); assert.equal(monitor.sources.get(base.id).sample.value, 30);
});

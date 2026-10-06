import test from 'node:test';
import assert from 'node:assert/strict';
import { Monitor } from '../core/monitor.js';

const source = { id: 'a', name: '测试余额', kind: 'http', url: 'https://example.com', valuePath: 'balance', unit: 'USD', interval: 60, enabled: true };
test('a failed refresh retains the last valid sample and marks it stale', async () => {
  let fail = false;
  const monitor = new Monitor({ collect: async () => { if (fail) throw Object.assign(new Error('需重新授权'), { code: 'auth' }); return { balance: 0 }; }, now: () => 1000 });
  monitor.upsert(source);
  await monitor.refresh('a');
  assert.equal(monitor.snapshot()[0].sample.value, 0);
  fail = true;
  await monitor.refresh('a');
  const state = monitor.snapshot()[0];
  assert.equal(state.sample.value, 0);
  assert.equal(state.status, 'auth');
  assert.equal(state.stale, true);
  assert.equal(state.lastSuccess, 1000);
});
test('concurrent manual and scheduled refreshes share one collection', async () => {
  let finish, calls = 0;
  const monitor = new Monitor({ collect: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  monitor.upsert(source);
  const first = monitor.refresh('a'), second = monitor.refresh('a');
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ balance: 5 });
  await Promise.all([first, second]);
  assert.equal(monitor.snapshot()[0].sample.value, 5);
});
test('editing a source invalidates any pending response from the previous configuration', async () => {
  let finish;
  const monitor = new Monitor({ collect: () => new Promise(resolve => { finish = resolve; }) });
  monitor.upsert(source);
  const request = monitor.refresh('a');
  await Promise.resolve();
  monitor.upsert({ ...source, valuePath: 'credits' });
  finish({ balance: 999 });
  await request;
  assert.equal(monitor.snapshot()[0].sample, null);
});
test('expired cached data is marked stale even before the next collection', () => {
  const monitor = new Monitor({ collect: async () => ({}), now: () => 200000 });
  monitor.restore([{ ...source, sample: { value: 10, total: null, unit: 'USD' }, status: 'ok', lastSuccess: 1000 }]);
  assert.equal(monitor.snapshot()[0].stale, true);
});
test('retrying a failure does not temporarily present the previous sample as fresh', async () => {
  let outcome = 'ok', finish;
  const monitor = new Monitor({ collect: () => outcome === 'ok' ? Promise.resolve({ balance: 20 }) : outcome === 'fail' ? Promise.reject(Object.assign(new Error('Offline'), { code: 'network' })) : new Promise(resolve => { finish = resolve; }) });
  monitor.upsert(source);
  await monitor.refresh('a');
  outcome = 'fail'; await monitor.refresh('a');
  outcome = 'pending'; const pending = monitor.refresh('a'); await Promise.resolve();
  assert.equal(monitor.snapshot()[0].stale, true);
  finish({ balance: 30 }); await pending;
  assert.equal(monitor.snapshot()[0].stale, false);
});

test('overflow retains the last valid sample, clears pending work and recovers after a corrected reading', async () => {
  let value = 40;
  const monitor = new Monitor({ collect: async () => ({ value, total: 100 }) });
  monitor.upsert({ id: 'quota', name: '额度', kind: 'web', url: 'https://example.com', selector: '#balance', totalSelector: '#total', interval: 60 });
  await monitor.refresh('quota'); value = 120; await monitor.refresh('quota');
  const failed = monitor.snapshot()[0];
  assert.equal(failed.status, 'range'); assert.equal(failed.stale, true);
  assert.equal(failed.sample.value, 40); assert.match(failed.error, /120.*100/);
  assert.equal(monitor.pending.size, 0);
  value = 30; await monitor.refresh('quota');
  assert.equal(monitor.snapshot()[0].status, 'ok');
  assert.equal(monitor.snapshot()[0].sample.value, 30);
});

test('restoring an old overflow sample marks that card failed without blocking other data sources', () => {
  const monitor = new Monitor({ collect: async () => ({}) });
  monitor.restore([{ ...source, sample: { value: 120, total: 100 }, status: 'ok', lastSuccess: 1000 }]);
  assert.equal(monitor.snapshot()[0].status, 'range');
  assert.equal(monitor.snapshot()[0].sample, null);
});

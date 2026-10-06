import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceJobs } from '../core/jobs.js';
import { selectToken } from '../core/credentials.js';

test('new configurations wait for old browser work but collect their own value', async () => {
  const jobs = new SourceJobs();
  const oldConfig = {}, newConfig = {};
  let finish, calls = [];
  const old = jobs.run('a', oldConfig, () => { calls.push('old'); return new Promise(resolve => { finish = resolve; }); });
  await Promise.resolve();
  const next = jobs.run('a', newConfig, () => { calls.push('new'); return 42; });
  await Promise.resolve();
  assert.deepEqual(calls, ['old']);
  finish(999);
  assert.equal(await old, 999);
  assert.equal(await next, 42);
  assert.deepEqual(calls, ['old', 'new']);
});
test('same configuration coalesces browser work', async () => {
  const jobs = new SourceJobs(), config = {};
  let calls = 0;
  const first = jobs.run('a', config, async () => { calls++; return 12; });
  const second = jobs.run('a', config, async () => { calls++; return 99; });
  assert.equal(await first, 12); assert.equal(await second, 12); assert.equal(calls, 1);
});
test('hidden credentials are only reused for the original origin', () => {
  const original = { url: 'https://provider.example/api' };
  assert.equal(selectToken({ url: 'https://provider.example/v2' }, original, 'secret'), 'secret');
  assert.equal(selectToken({ url: 'https://other.example/api' }, original, 'secret'), '');
  assert.equal(selectToken({ url: 'https://provider.example:444/api' }, original, 'secret'), '');
  assert.equal(selectToken({ url: 'https://other.example/api' }, original, 'secret', 'new-token'), 'new-token');
  assert.equal(selectToken(original, original, 'secret', '', true), '');
});

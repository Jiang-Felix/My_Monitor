import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Store } from '../core/storage.js';

test('storage restores cached values while never writing API tokens as plaintext', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'monitor-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const key = randomBytes(32);
  const codec = {
    encrypt(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64'); },
    decrypt(text) { const data = Buffer.from(text, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString(); }
  };
  const file = join(dir, 'state.json'), store = new Store(file, codec);
  assert.deepEqual(await store.load(), { sources: [], tokens: Object.create(null) });
  const state = { sources: [{ id: 'a', sample: { value: 0 }, nextRun: Infinity }], tokens: { a: 'private-api-token' } };
  await Promise.all([store.save(state), store.save(state)]);
  assert.ok(!(await readFile(file, 'utf8')).includes('private-api-token'));
  const restored = await new Store(file, codec).load();
  assert.equal(restored.tokens.a, 'private-api-token');
  assert.equal(restored.sources[0].sample.value, 0);
  await store.save({ ...state, alerts: { settings: { recordCount: 3 }, logs: [{ endedAt: 10 }] }, floatingSettings: { showAmount: true, barWidth: 400 } });
  const extended = await new Store(file, codec).load();
  assert.equal(extended.alerts?.settings.recordCount, 3);
  assert.equal(extended.floatingSettings?.barWidth, 400);
  assert.equal(extended.tokens.a, 'private-api-token');
  await store.save({...state,floatingPosition:{x:-1234,y:567}});
  assert.deepEqual((await new Store(file,codec).load()).floatingPosition,{x:-1234,y:567});
  await store.save({...state,language:'en'});
  assert.equal((await new Store(file,codec).load()).language,'en','language preference survives restarting storage');
  await store.save({...state,appSettings:{floatingOnStartup:false}});
  assert.deepEqual((await new Store(file,codec).load()).appSettings,{floatingOnStartup:false});
});

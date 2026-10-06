import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AlertEngine, sourceIdentity } from '../core/alerts.js';
import { Store } from '../core/storage.js';

const source = { id: 'a', name: 'Local fixture', kind: 'http', url: 'http://127.0.0.1:9/?access_token=FAKE-URL-SECRET', valuePath: 'value', unit: 'USD', enabled: true, status: 'ok', interval: 1, lastSuccess: 1000, sample: { value: 1 }, updateSequence: 0 };
const rule = { id: 'rule', name: 'Local alert', sourceId: 'a', type: 'value', lower: null, upper: 100, enabled: true, notificationsEnabled: false };
const legacyIdentity = '["http","http://127.0.0.1:9/?access_token=FAKE-URL-SECRET","value",null,null,null,"USD"]';
function alertState() {
  const alerts = new AlertEngine({ now: () => 1000 }); alerts.startRun(); alerts.upsert(rule, source);
  alerts.observe([{ ...source, updateSequence: 1 }]); return alerts.serialize();
}
async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'monitor-alert-secret-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = randomBytes(32), file = join(directory, 'state.json');
  const codec = {
    encrypt(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString('base64'); },
    decrypt(text) { const data = Buffer.from(text, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString(); }
  };
  return { file, codec, store: new Store(file, codec) };
}

test('active alert identities never duplicate URL secrets in the primary state or backup', async t => {
  const { file, codec, store } = await fixture(t);
  const alerts = alertState(); assert.equal(alerts.tracking.length, 1);
  const state = { sources: [source], tokens: {}, alerts };
  await store.save(state); await store.save(state);
  for (const path of [file, `${file}.bak`]) {
    assert.ok(!(await fs.readFile(path, 'utf8')).includes('FAKE-URL-SECRET'));
    const loaded = await new Store(path, codec).load();
    assert.equal(loaded.sources[0].url, source.url);
    assert.equal(loaded.alerts.tracking[0].identity, sourceIdentity(source));
  }
});

test('disabled legacy alert tracks retain their points while removing secret identity strings', () => {
  const saved = alertState(); saved.rules[0].enabled = false; saved.tracking[0].identity = legacyIdentity;
  const alerts = new AlertEngine({ now: () => 2000 }); alerts.startRun(saved, [source]);
  const restored = alerts.serialize();
  assert.equal(restored.tracking[0].identity, sourceIdentity(source));
  assert.ok(!JSON.stringify(restored).includes('FAKE-URL-SECRET'));
  assert.deepEqual(restored.tracking[0].points, saved.tracking[0].points);
});

test('migration backup sanitizes legacy alert identity even before the alert engine restores it', async t => {
  const { file, codec, store } = await fixture(t);
  const alerts = alertState(); alerts.rules[0].enabled = false; alerts.tracking[0].identity = legacyIdentity;
  await fs.writeFile(file, JSON.stringify({ version: 1, sources: [source], tokens: {}, alerts }));
  const loaded = await store.load(); await store.save(loaded);
  for (const path of [file, `${file}.bak`]) {
    assert.ok(!(await fs.readFile(path, 'utf8')).includes('FAKE-URL-SECRET'));
    assert.equal((await new Store(path, codec).load()).alerts.tracking[0].identity, sourceIdentity(source));
  }
});

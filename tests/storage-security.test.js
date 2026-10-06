import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Store } from '../core/storage.js';
import { selectToken } from '../core/credentials.js';

function codec() {
  const key = randomBytes(32);
  return {
    encrypt(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString('base64'); },
    decrypt(text) { const data = Buffer.from(text, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString(); }
  };
}
async function fixture(t, options) {
  const dir = await fs.mkdtemp(join(tmpdir(), 'monitor-storage-security-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json'), cipher = codec();
  return { dir, file, cipher, store: new Store(file, cipher, options) };
}
const state = (url = 'https://example.com/api', value = 1) => ({ sources: [{ id: 'a', url, sample: { value } }], tokens: { a: 'FAKE-BEARER-SECRET' } });

test('sensitive source URLs are encrypted and restored without changing routes or signatures', async t => {
  const { file, cipher, store } = await fixture(t);
  const url = 'https://example.com/?access_token=FAKE-URL-SECRET&signature=keep#/dashboard?password=FAKE-HASH-SECRET&tab=usage';
  await store.save(state(url));
  const raw = await fs.readFile(file, 'utf8'), disk = JSON.parse(raw);
  assert.ok(!raw.includes('FAKE-URL-SECRET'));
  assert.ok(!raw.includes('FAKE-HASH-SECRET'));
  assert.equal(disk.sources[0].url, '');
  assert.equal(typeof disk.encryptedUrls.a, 'string');
  assert.equal((await new Store(file, cipher).load()).sources[0].url, url);
});

test('migration backup encrypts legacy sensitive URLs instead of copying plaintext', async t => {
  const { file, cipher, store } = await fixture(t);
  const url = 'https://example.com/#access_token=FAKE-LEGACY-SECRET';
  await fs.writeFile(file, JSON.stringify({ version: 1, ...state(url), tokens: { a: cipher.encrypt('FAKE-BEARER-SECRET') } }));
  const original = await store.load();
  await store.save({ ...original, sources: [{ ...original.sources[0], sample: { value: 2 } }] });
  const backup = await fs.readFile(`${file}.bak`, 'utf8');
  assert.ok(!backup.includes('FAKE-LEGACY-SECRET'));
  assert.equal((await new Store(`${file}.bak`, cipher).load()).sources[0].sample.value, 1);
  assert.equal((await new Store(`${file}.bak`, cipher).load()).sources[0].url, url);
});

test('load rejects a file larger than 10 MiB before reading its contents and preserves it', async t => {
  const { file, store } = await fixture(t);
  const handle = await fs.open(file, 'w');
  await handle.truncate(10 * 1024 * 1024 + 1); await handle.close();
  await assert.rejects(store.load(), /大小|size|large/i);
  await assert.rejects(store.save(state()), /读取|read|只读/i);
  assert.equal((await fs.stat(file)).size, 10 * 1024 * 1024 + 1);
});

test('storage rejects too many sources and malformed or oversized token records', async t => {
  const { store } = await fixture(t);
  await assert.rejects(store.save({ sources: Array.from({ length: 101 }, (_, n) => ({ id: `a-${n}` })), tokens: {} }));
  for (const tokens of [{ a: 4 }, { a: 'x'.repeat(16385) }, [], 'x']) await assert.rejects(store.save({ sources: [], tokens }));
});

test('decoded token dictionary has no inherited constructor token and accepts an own constructor key', async t => {
  const { file, cipher, store } = await fixture(t);
  await store.save({ sources: [{ id: 'a' }], tokens: {} });
  const first = await new Store(file, cipher).load();
  assert.equal(first.tokens.constructor, undefined);
  await store.save({ sources: [{ id: 'constructor' }], tokens: { constructor: 'FAKE-CONSTRUCTOR-SECRET' } });
  const restored = await new Store(file, cipher).load();
  assert.equal(restored.tokens.constructor, 'FAKE-CONSTRUCTOR-SECRET');
});

test('corrupt configuration and decrypt failures preserve original files and block subsequent save', async t => {
  const { file, store } = await fixture(t);
  const original = '{ malformed config'; await fs.writeFile(file, original);
  await assert.rejects(store.load());
  await assert.rejects(store.save(state()));
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('failed encryption leaves both the committed state and its backup unchanged', async t => {
  const { file, cipher, store } = await fixture(t);
  await store.save(state()); await store.save(state(undefined, 2));
  const prior = await fs.readFile(file, 'utf8'), backup = await fs.readFile(`${file}.bak`, 'utf8');
  cipher.encrypt = () => { throw new Error('Synthetic key service failure'); };
  await assert.rejects(store.save(state('https://example.com/?token=FAKE-FAILED-SECRET')), /key service/);
  assert.equal(await fs.readFile(file, 'utf8'), prior);
  assert.equal(await fs.readFile(`${file}.bak`, 'utf8'), backup);
});

test('aborting during write prevents a late commit and removes the temporary file', { timeout: 1000 }, async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), writing = new Promise(resolve => { started = resolve; });
  const { dir, file, cipher } = await fixture(t);
  await new Store(file, cipher).save(state());
  const io = { writeFile: async (...args) => { started(); await gate; return fs.writeFile(...args); } };
  const store = new Store(file, cipher, { io }), controller = new AbortController();
  const saving = store.save(state(undefined, 2), { signal: controller.signal });
  await writing; controller.abort(); release();
  await assert.rejects(saving, { name: 'AbortError' });
  assert.equal((await new Store(file, cipher).load()).sources[0].sample.value, 1);
  assert.ok(!(await fs.readdir(dir)).some(name => name.includes('.tmp')));
});

test('save queue rejects overflow without reporting unwritten candidates as successful', { timeout: 1000 }, async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), encoding = new Promise(resolve => { started = resolve; });
  const { file, cipher } = await fixture(t);
  const originalEncrypt = cipher.encrypt;
  cipher.encrypt = async value => { started(); await gate; return originalEncrypt(value); };
  const store = new Store(file, cipher);
  const queued = Array.from({ length: 32 }, (_, n) => store.save(state(undefined, n)));
  await encoding;
  await assert.rejects(store.save(state(undefined, 99)), /积压|queue/i);
  release(); await Promise.all(queued);
  assert.equal((await new Store(file, cipher).load()).sources[0].sample.value, 31);
});

test('credential selection rejects nonstring values and invalid URL inputs', () => {
  const source = { url: 'https://example.com/api' };
  assert.equal(selectToken(source, source, Object.prototype.constructor), '');
  assert.throws(() => selectToken(source, source, '', { trim: () => 'FAKE-OBJECT-TOKEN' }));
  assert.equal(selectToken({ url: 'broken' }, source, 'FAKE-TOKEN'), '');
  assert.equal(selectToken({ url: 'https://elsewhere.example/' }, source, 'FAKE-TOKEN'), '');
});

test('malformed disk token dictionaries and oversized decrypted tokens block loading', async t => {
  const { file, cipher } = await fixture(t);
  for (const tokens of [[], { a: 12 }, { a: 'x'.repeat(65537) }, Object.fromEntries(Array.from({ length: 101 }, (_, n) => [`a-${n}`, 'ciphertext']))]) {
    await fs.writeFile(file, JSON.stringify({ version: 1, sources: [], tokens }));
    await assert.rejects(new Store(file, cipher).load());
  }
  await fs.writeFile(file, JSON.stringify({ version: 1, sources: [], tokens: { a: 'ciphertext' } }));
  await assert.rejects(new Store(file, { decrypt: () => 'x'.repeat(16385) }).load());
});

test('ordinary signed URLs and legitimate fragments remain byte-for-byte intact on disk', async t => {
  const { file, store } = await fixture(t);
  const url = 'https://example.com/object?signature=abc%2Bdef&expires=123#/dashboard?tab=usage';
  await store.save(state(url));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).sources[0].url, url);
});

test('load size guard never invokes a content read for an oversized file', async () => {
  let reads = 0;
  const store = new Store('synthetic-only.json', codec(), { io: { open: async () => ({ stat: async () => ({ isFile: () => true, size: 10 * 1024 * 1024 + 1 }), read: async () => { reads++; throw new Error('must not read'); }, close: async () => {} }) } });
  await assert.rejects(store.load(), /大小/);
  assert.equal(reads, 0);
});

test('save failure after writing its temporary data keeps the previous state and backup recoverable', async t => {
  const { dir, file, cipher } = await fixture(t);
  await new Store(file, cipher).save(state());
  const store = new Store(file, cipher, { io: { rename: async (from, to) => {
    if (to === file) throw new Error('Synthetic rename failure');
    return fs.rename(from, to);
  } } });
  await assert.rejects(store.save(state(undefined, 2)), /rename failure/);
  assert.equal((await new Store(file, cipher).load()).sources[0].sample.value, 1);
  assert.equal((await new Store(`${file}.bak`, cipher).load()).sources[0].sample.value, 1);
  assert.ok(!(await fs.readdir(dir)).some(name => name.includes('.tmp')));
});

test('an aborted queued save cannot commit after its preceding write completes', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), encoding = new Promise(resolve => { started = resolve; });
  const { file, cipher } = await fixture(t);
  const originalEncrypt = cipher.encrypt;
  cipher.encrypt = async value => { started(); await gate; return originalEncrypt(value); };
  const store = new Store(file, cipher), controller = new AbortController();
  const first = store.save(state(undefined, 1));
  const second = store.save(state(undefined, 2), { signal: controller.signal });
  const rejection = assert.rejects(second, { name: 'AbortError' });
  await encoding; controller.abort(); release();
  await first; await rejection;
  assert.equal((await new Store(file, cipher).load()).sources[0].sample.value, 1);
});

test('commit hook marks only the primary rename, whose completion remains committed after abort', { timeout: 1000 }, async t => {
  let release, started, commitStarts = 0;
  const gate = new Promise(resolve => { release = resolve; }), renaming = new Promise(resolve => { started = resolve; });
  const { dir, file, cipher } = await fixture(t);
  await new Store(file, cipher).save(state());
  const store = new Store(file, cipher, { io: { rename: async (from, to) => {
    if (to === file) { started(); await gate; }
    return fs.rename(from, to);
  } } });
  const controller = new AbortController();
  const saving = store.save(state(undefined, 2), { signal: controller.signal, onCommitStart: () => { commitStarts++; } });
  await renaming;
  try {
    assert.equal(commitStarts, 1, 'backup rename must not mark primary commit');
    assert.equal((await new Store(file, cipher).load()).sources[0].sample.value, 1);
    controller.abort();
  } finally { release(); await saving; }
  assert.equal((await new Store(file, cipher).load()).sources[0].sample.value, 2);
  assert.equal((await new Store(`${file}.bak`, cipher).load()).sources[0].sample.value, 1);
  assert.ok(!(await fs.readdir(dir)).some(name => name.includes('.tmp')));
});

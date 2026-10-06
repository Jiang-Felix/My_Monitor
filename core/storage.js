import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hasSensitiveUrl } from './sensitive-url.js';
import { digestSourceIdentity } from './source-identity.js';

const MAX_BYTES = 10 * 1024 * 1024, MAX_SOURCES = 100, MAX_SECRET = 16384, MAX_CIPHER = 65536, MAX_PENDING = 32;
const own = (object, key) => Object.hasOwn(object, key);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const emptyState = () => ({ sources: [], tokens: Object.create(null) });
function abort(signal) {
  if (signal?.aborted) throw new DOMException('保存已取消', 'AbortError');
}
function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES) throw new Error('数据源数量或内容无效（最多 100 个）');
  const ids = new Set();
  for (const source of sources) {
    if (!record(source) || !own(source, 'id') || !validId(source.id) || ids.has(source.id)) throw new Error('数据源标识无效或重复');
    if (own(source, 'url') && (typeof source.url !== 'string' || source.url.length > MAX_SECRET)) throw new Error('数据源网址无效或太长');
    ids.add(source.id);
  }
  return ids;
}
function validateSecrets(values, maxLength, label) {
  if (!record(values) || Object.keys(values).length > MAX_SOURCES) throw new Error(`${label}内容或数量无效`);
  for (const [id, value] of Object.entries(values)) {
    if (!validId(id) || typeof value !== 'string' || value.length > maxLength) throw new Error(`${label}内容无效或太长`);
  }
}
function json(state) {
  const data = JSON.stringify(state, null, 2);
  if (Buffer.byteLength(data, 'utf8') > MAX_BYTES) throw new Error('配置文件大小超过 10 MiB');
  return data;
}
function snapshot(input) {
  if (!record(input)) throw new Error('配置内容无效');
  validateSources(input.sources);
  validateSecrets(input.tokens ?? {}, MAX_SECRET, 'Token');
  const extras = {};
  for (const key of ['alerts', 'floatingSettings', 'floatingPosition', 'appSettings']) {
    if (own(input, key) && input[key] != null) {
      if (!record(input[key])) throw new Error('配置附加内容无效');
      extras[key] = input[key];
    }
  }
  if (['zh-CN', 'en'].includes(input.language)) extras.language = input.language;
  const state = { sources: input.sources, tokens: Object.fromEntries(Object.entries(input.tokens ?? {})), ...extras };
  json(state);
  return structuredClone(state);
}

export class Store {
  constructor(file, codec, { io = {} } = {}) {
    this.file = file; this.codec = codec; this.io = { ...fs, ...io };
    this.queue = Promise.resolve(); this.pending = 0; this.readOnly = false;
    this.loaded = false; this.hasFile = false; this.previous = null;
  }
  async readBounded(file, signal) {
    abort(signal);
    const handle = await this.io.open(file, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('配置文件大小超过 10 MiB 或文件类型无效');
      // The bounded read also covers a file growing after stat, before JSON parsing.
      const chunks = []; let size = 0;
      while (size <= MAX_BYTES) {
        abort(signal);
        const chunk = Buffer.alloc(Math.min(65536, MAX_BYTES + 1 - size));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        size += bytesRead; chunks.push(chunk.subarray(0, bytesRead));
      }
      if (size > MAX_BYTES) throw new Error('配置文件大小超过 10 MiB');
      return Buffer.concat(chunks, size).toString('utf8');
    } finally { await handle.close(); }
  }
  async decode(raw) {
    const disk = JSON.parse(raw);
    if (!record(disk) || ![1, 2].includes(disk.version)) throw new Error('配置文件版本或内容无效');
    const ids = validateSources(disk.sources);
    const encryptedTokens = own(disk, 'tokens') ? disk.tokens : {};
    const encryptedUrls = own(disk, 'encryptedUrls') ? disk.encryptedUrls : {};
    validateSecrets(encryptedTokens, MAX_CIPHER, '加密 Token');
    validateSecrets(encryptedUrls, MAX_CIPHER, '加密网址');
    const tokens = Object.create(null), sources = structuredClone(disk.sources);
    for (const [id, ciphertext] of Object.entries(encryptedTokens)) {
      const value = await this.codec.decrypt(ciphertext);
      if (typeof value !== 'string' || value.length > MAX_SECRET) throw new Error('解密 Token 内容无效');
      tokens[id] = value;
    }
    for (const [id, ciphertext] of Object.entries(encryptedUrls)) {
      if (!ids.has(id)) throw new Error('加密网址缺少对应的数据源');
      const source = sources.find(source => source.id === id);
      if (source.url) throw new Error('加密网址与明文网址重复');
      const value = await this.codec.decrypt(ciphertext);
      if (typeof value !== 'string' || !value || value.length > MAX_SECRET) throw new Error('解密网址内容无效');
      source.url = value;
    }
    const state = snapshot({ ...disk, sources, tokens });
    state.tokens = tokens;
    return state;
  }
  async load({ signal } = {}) {
    try {
      let raw;
      try { raw = await this.readBounded(this.file, signal); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        this.loaded = true; this.hasFile = false; this.previous = null;
        return emptyState();
      }
      const state = await this.decode(raw);
      abort(signal);
      this.previous = snapshot(state); this.loaded = true; this.hasFile = true;
      return state;
    } catch (error) {
      // Do not silently restore a backup or overwrite an unreadable original.
      if (error.name !== 'AbortError') this.readOnly = true;
      throw error;
    }
  }
  async encode(state, signal) {
    state = structuredClone(state);
    // Sanitize prior legacy state too, before it becomes the recovery backup.
    for (const track of Array.isArray(state.alerts?.tracking) ? state.alerts.tracking : []) {
      if (record(track) && typeof track.identity === 'string') track.identity = digestSourceIdentity(track.identity);
    }
    const sources = structuredClone(state.sources), tokens = Object.create(null), encryptedUrls = Object.create(null);
    for (const [id, value] of Object.entries(state.tokens)) {
      abort(signal);
      if (value) tokens[id] = await this.codec.encrypt(value);
    }
    for (const source of sources) if (hasSensitiveUrl(source.url)) {
      abort(signal);
      encryptedUrls[source.id] = await this.codec.encrypt(source.url);
      source.url = '';
    }
    abort(signal);
    validateSecrets(tokens, MAX_CIPHER, '加密 Token');
    validateSecrets(encryptedUrls, MAX_CIPHER, '加密网址');
    // An empty codec result must never quietly discard a secret.
    if ([...Object.values(tokens), ...Object.values(encryptedUrls)].some(value => !value)) throw new Error('凭证加密失败');
    return json({ ...state, version: 2, sources, tokens, encryptedUrls });
  }
  async atomicWrite(file, data, signal, onCommitStart) {
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      abort(signal);
      await this.io.writeFile(temp, data, { encoding: 'utf8', mode: 0o600, flag: 'wx', signal });
      abort(signal);
      onCommitStart?.();
      await this.io.rename(temp, file);
    } finally {
      await this.io.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  save(input, { signal, onCommitStart } = {}) {
    let state;
    try {
      abort(signal);
      if (this.readOnly) throw new Error('现有配置无法读取，已停止写入以保留原文件');
      if (this.pending >= MAX_PENDING) throw new Error('保存队列积压过多，请稍后重试');
      state = snapshot(input);
    } catch (error) { return Promise.reject(error); }
    this.pending++;
    const task = this.queue.catch(() => {}).then(async () => {
      abort(signal);
      if (!this.loaded) await this.load({ signal });
      if (this.readOnly) throw new Error('现有配置无法读取，已停止写入以保留原文件');
      const data = await this.encode(state, signal);
      // Re-encode previous valid state: raw legacy files may contain URL credentials.
      // A migration backup therefore never duplicates those plaintext secrets.
      const backup = this.hasFile ? await this.encode(this.previous, signal) : null;
      abort(signal);
      await this.io.mkdir(dirname(this.file), { recursive: true });
      if (backup !== null) await this.atomicWrite(`${this.file}.bak`, backup, signal);
      await this.atomicWrite(this.file, data, signal, onCommitStart);
      this.previous = state; this.hasFile = true;
    }).finally(() => { this.pending--; });
    this.queue = task;
    return task;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseValue, readPath, extractSample, progress } from '../core/metrics.js';
import { validateSource } from '../core/config.js';

test('numeric extraction preserves zero and parses explicit units and separators', () => {
  for (const [input, expected] of [[0, 0], ['0', 0], ['1,234.50 USD', 1234.5], ['36.5 GB', 36.5], ['¥ -12.25', -12.25]]) {
    assert.equal(parseValue(input), expected);
  }
});
test('missing or ambiguous values never become a balance of zero', () => {
  for (const input of [null, undefined, '', '加载中', true, '12 / 100', '1.234,56', Infinity]) {
    assert.throws(() => parseValue(input));
  }
});
test('JSON paths traverse nested arrays but never inherited properties', () => {
  assert.equal(readPath({ data: [{ balance: 0 }] }, 'data[0].balance'), 0);
  assert.throws(() => readPath({}, '__proto__.x'));
  assert.throws(() => readPath({}, 'missing'));
});
test('a quota uses two independently extracted values and handles zero capacity', () => {
  assert.deepEqual(extractSample({ kind: 'http', valuePath: 'used', totalPath: 'limit', unit: 'GB' }, { used: '36.5', limit: 100 }), { value: 36.5, total: 100, unit: 'GB' });
  assert.equal(progress({ value: 10, total: 0 }), null);
  assert.equal(progress({ value: 120, total: 100 }), null);
});

test('fixed values need no website and numeric validation never turns empty or invalid input into zero', () => {
  const base = { name: '固定额度', kind: 'fixed', interval: 60, fixedValue: '0', totalMode: 'fixed', fixedTotal: '100' };
  const config = validateSource(base);
  assert.equal(config.fixedValue, 0);
  assert.equal(config.fixedTotal, 100);
  assert.equal(config.url, undefined);
  assert.deepEqual(extractSample(config, {}), { value: 0, total: 100, unit: '' });
  for (const fixedValue of ['', 'nope', Infinity, false]) assert.throws(() => validateSource({ ...base, fixedValue }));
});

test('current and total can independently come from the website or fixed values', () => {
  const base = { kind: 'web', name: '网页额度', url: 'https://example.com', interval: 60, selector: '#balance' };
  const fixedTotal = validateSource({ ...base, totalMode: 'fixed', fixedTotal: '100' });
  assert.deepEqual(extractSample(fixedTotal, { value: '36.5 GB', total: null }), { value: 36.5, total: 100, unit: '' });
  const fixedValue = validateSource({ ...base, valueMode: 'fixed', fixedValue: '10', totalMode: 'web', totalSelector: '#limit' });
  assert.deepEqual(extractSample(fixedValue, { value: null, total: '100 GB' }), { value: 10, total: 100, unit: '' });
  assert.equal(validateSource({ ...base, url: '', valueMode: 'fixed', fixedValue: '10', totalMode: 'none' }).kind, 'fixed');
});

test('current above total is a range failure, including a nonzero current with zero total', () => {
  for (const sample of [{ value: 120, total: 100 }, { value: 1, total: 0 }]) {
    assert.throws(() => extractSample({ kind: 'web' }, sample), error => error.code === 'range' && error.message.includes('大于总量'));
  }
  assert.deepEqual(extractSample({ kind: 'web' }, { value: 0, total: 0 }), { value: 0, total: 0, unit: '' });
});

test('an explicitly selected total must not silently disappear when its payload is empty', () => {
  for (const source of [{ kind: 'web', totalMode: 'web' }, { kind: 'web', totalSelector: '#limit' }, { kind: 'http', valuePath: 'value', totalPath: 'total' }]) {
    assert.throws(() => extractSample(source, { value: 10, total: null }), error => error.code === 'parse' && error.message.includes('总量'));
  }
});
test('source validation rejects unsafe URLs, scripts, and uncontrolled polling', () => {
  const base = { name: '余额', kind: 'http', url: 'https://example.com/api', valuePath: 'balance', interval: 60, unit: 'USD' };
  assert.equal(validateSource(base).name, '余额');
  assert.equal(validateSource({ ...base, url: 'http://127.0.0.1:8080/data' }).interval, 60);
  for (const patch of [{ url: 'file:///C:/secret' }, { url: 'http://example.com/api' }, { url: 'https://user:pass@example.com' }, { interval: 0 }, { interval: 0.5 }, { valuePath: '__proto__.x' }, { kind: 'script' }]) {
    assert.throws(() => validateSource({ ...base, ...patch }));
  }
});

test('web sources retain a bounded page wait and supply a default for existing configurations', () => {
  const source = { name: '网页', kind: 'web', url: 'https://example.com', selector: '#balance', interval: 60 };
  assert.equal(validateSource(source).waitSeconds, 3);
  assert.equal(validateSource({ ...source, waitSeconds: '8' }).waitSeconds, 8);
  for (const waitSeconds of [0, 61, 1.5, 'bad']) assert.throws(() => validateSource({ ...source, waitSeconds }));
});

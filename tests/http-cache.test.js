import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const module = await import('../core/http-sources.js').catch(() => ({}));

test('conditional requests confirm unchanged payloads without downloading JSON again', async t => {
  assert.equal(typeof module.HttpSources, 'function');
  let value = 10, bytes = 0, requests = 0;
  const server = http.createServer((req, res) => {
    requests++; res.setHeader('ETag', `"${value}"`);
    if (req.headers['if-none-match'] === `"${value}"`) { res.writeHead(304); res.end(); return; }
    const body = JSON.stringify({ value }); bytes += body.length; res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const source = { id: 'a', url: `http://127.0.0.1:${server.address().port}` }, collector = new module.HttpSources();
  assert.deepEqual(await collector.collect(source), { value: 10 }); const initialBytes = bytes;
  assert.deepEqual(await collector.collect(source), { value: 10 }); assert.equal(bytes, initialBytes);
  value = 20; assert.deepEqual(await collector.collect(source), { value: 20 }); assert.equal(requests, 3);
});

test('cache validators never cross credentials/URLs and no-store never retains payload', async t => {
  assert.equal(typeof module.HttpSources, 'function');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push([req.url, req.headers.authorization, req.headers['if-none-match'], req.headers['if-modified-since']]);
    res.setHeader('Last-Modified', 'Wed, 01 Jan 2025 00:00:00 GMT'); res.setHeader('ETag', '"a"');
    if (req.url === '/private') res.setHeader('Cache-Control', 'private, no-store');
    res.end('{"value":10}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`, collector = new module.HttpSources();
  await collector.collect({ id: 'a', url }, 'one'); await collector.collect({ id: 'a', url }, 'one');
  assert.equal(seen[1][2], '"a"'); assert.equal(seen[1][3], undefined, 'ETag takes precedence');
  await collector.collect({ id: 'a', url }, 'two'); assert.equal(seen[2][2], undefined);
  await collector.collect({ id: 'a', url: `${url}/other` }, 'two'); assert.equal(seen[3][2], undefined);
  await collector.collect({ id: 'a', url: `${url}/private` }); await collector.collect({ id: 'a', url: `${url}/private` });
  assert.equal(seen.at(-1)[2], undefined); collector.clear('a'); assert.equal(collector.cache.size, 0);
});

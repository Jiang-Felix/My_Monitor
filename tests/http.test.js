import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { collectHttp } from '../core/http.js';

async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('HTTP collection sends a bearer token and returns the actual JSON body', async t => {
  const url = await fixture(t, (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-secret');
    res.setHeader('Content-Type', 'application/json');
    res.end('{"data":{"balance":0}}');
  });
  assert.deepEqual(await collectHttp({ url }, 'fixture-secret'), { data: { balance: 0 } });
});
test('authentication and rate limits are distinguished from missing numeric fields', async t => {
  const url = await fixture(t, (req, res) => {
    res.statusCode = req.url === '/auth' ? 401 : 429;
    res.setHeader('Retry-After', '120');
    res.end('error');
  });
  await assert.rejects(collectHttp({ url: `${url}/auth` }), { code: 'auth' });
  await assert.rejects(collectHttp({ url: `${url}/rate` }), error => error.code === 'rate' && error.retryAfter === 120000);
});
test('redirects are rejected so credentials cannot be forwarded elsewhere', async t => {
  let leaked = false;
  const target = await fixture(t, (req, res) => { leaked = true; res.end('{}'); });
  const url = await fixture(t, (req, res) => { res.writeHead(302, { Location: target }); res.end(); });
  await assert.rejects(collectHttp({ url }, 'secret'), /重定向/);
  assert.equal(leaked, false);
});
test('malformed responses and stalled requests do not produce valid samples', async t => {
  const url = await fixture(t, (req, res) => { if (req.url === '/bad') res.end('<html>Login</html>'); });
  await assert.rejects(collectHttp({ url: `${url}/bad` }), { code: 'parse' });
  await assert.rejects(collectHttp({ url: `${url}/slow` }, '', { timeout: 30 }), { code: 'network' });
});
test('large streamed responses are rejected before they can fill application memory', async t => {
  const url = await fixture(t, (req, res) => res.end(JSON.stringify({ data: 'a'.repeat(1000) })));
  await assert.rejects(collectHttp({ url }, '', { maxBytes: 100 }), /过大/);
});
test('rejected status closes a response that would otherwise stream forever', async t => {
  let closed;
  const responseClosed = new Promise(resolve => { closed = resolve; });
  const url = await fixture(t, (_req, res) => { res.on('close', closed); res.writeHead(401); res.write('unauthorized'); });
  await assert.rejects(collectHttp({ url }), { code: 'auth' });
  const disposed = await Promise.race([responseClosed.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 500))]);
  assert.equal(disposed, true);
});
test('a connection failure is not falsely reported as a timeout', async () => {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(collectHttp({ url }), error => error.code === 'network' && error.message.includes('无法连接'));
});

test('retryable errors respect server delays including 503 and values beyond one day', async t => {
  const url = await fixture(t, (req, res) => { res.writeHead(req.url === '/busy' ? 503 : 429, { 'Retry-After': req.url === '/busy' ? '120' : '172800' }); res.end(); });
  await assert.rejects(collectHttp({ url: `${url}/busy` }), error => error.code === 'network' && error.retryAfter === 120000);
  await assert.rejects(collectHttp({ url: `${url}/rate` }), error => error.code === 'rate' && error.retryAfter === 172800000);
});

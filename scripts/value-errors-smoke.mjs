import assert from 'node:assert/strict';
import http from 'node:http';

export async function runValueErrorsSmoke(web) {
  const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<p id="value">40 GB</p><p id="limit">100 GB</p><p class="duplicate">5</p><p class="duplicate">6</p><p id="bad">not a number</p>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const source = { id: 'smoke-bad-value', kind: 'web', url: `http://127.0.0.1:${server.address().port}`, selector: '#[', waitSeconds: 1 };
  try {
    const failure = await web.collect(source).then(() => null, error => error);
    assert.equal(failure?.code, 'locator');
    assert.match(failure.message, /选择器.*格式/);
    assert.equal(web.jobs.pending.size, 0);
    const fixedTotal = { ...source, selector: '#value', valueMode: 'web', totalMode: 'fixed', fixedTotal: 100 };
    assert.equal((await web.collect(fixedTotal)).value, '40 GB');
    const mixed = { ...source, valueMode: 'fixed', fixedValue: 10, totalMode: 'web', totalSelector: '#limit', selector: '' };
    assert.equal((await web.collect(mixed)).total, '100 GB');
    for (const [selector, code, message] of [['.duplicate', 'locator', /多个/], ['#bad', 'parse', /当前量/], ['#missing', 'locator', /找不到/]]) {
      const failed = await web.collect({ ...source, selector }).then(() => null, error => error);
      assert.equal(failed?.code, code); assert.match(failed.message, message);
      assert.equal(web.jobs.pending.size, 0);
    }
    assert.equal((await web.collect({ ...source, selector: '#value' })).value, '40 GB');
    // Simulate a renderer that never resolves its DOM read. The real browser window must
    // be discarded so a later refresh can create a working window with the same session.
    const stalled = web.windows.get(source.id);
    const timeout = web.readTimeoutMs;
    web.readTimeoutMs = 100;
    stalled.webContents.executeJavaScript = () => new Promise(() => {});
    try {
      const timedOut = await web.collect({ ...source, selector: '#value' }).then(() => null, error => error);
      assert.equal(timedOut?.code, 'network'); assert.match(timedOut.message, /读取超时/);
      assert.equal(stalled.isDestroyed(), true); assert.equal(web.jobs.pending.size, 0);
    } finally { web.readTimeoutMs = timeout; }
    assert.equal((await web.collect({ ...source, selector: '#value' })).value, '40 GB');
    console.log('PASS selector syntax/duplicate/missing/text failures release collection jobs and allow recovery; mixed website/fixed metrics read correctly');
    console.log('PASS stalled DOM read times out, destroys its stuck window and allows a fresh collection');
  } finally { await web.clear(source.id); server.closeAllConnections(); server.close(); }
}

import assert from 'node:assert/strict';
import http from 'node:http';
import { powerMonitor } from 'electron';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function runFastRefreshSmoke({ web, monitor, mainWindow }) {
  let pageRequests = 0, apiRequests = 0, apiBodies = 0, value = 10, failure = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/page') {
      pageRequests++; res.setHeader('Content-Type', 'text/html;charset=utf-8');
      res.end('<html><body><span id="value">0</span><script>setInterval(()=>document.querySelector("#value").textContent=Number(document.querySelector("#value").textContent)+1,250)</script></body></html>'); return;
    }
    apiRequests++;
    if (failure) { res.writeHead(failure, { 'Retry-After': '120' }); res.end(); return; }
    res.setHeader('ETag', `"${value}"`);
    if (req.headers['if-none-match'] === `"${value}"`) { res.writeHead(304); res.end(); return; }
    apiBodies++; res.end(JSON.stringify({ value }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`, source = { id: 'live-fast', kind: 'web', url: `${url}/page`, selector: '#value', valueMode: 'web', totalMode: 'none', waitSeconds: 1, webUpdateMode: 'live', interval: 1 };
  const run = code => mainWindow.webContents.executeJavaScript(code, true);
  const invoke = async (method, input) => { const result = await run(`window.monitor.${method}(${JSON.stringify(input)})`); assert.equal(result.ok, true, result.error); return result.data; };
  try {
    const first = await web.collect(source);
    await sleep(1050); const next = await web.collect(source);
    assert.equal(pageRequests, 1, 'live mode never reloads the initialized page per sample');
    assert.ok(Number(next.value) > Number(first.value), 'live DOM changes are read');
    assert.equal(web.jobs.pending.size, 0);
    await web.getWindow(source.id).webContents.executeJavaScript('document.querySelector("#value").removeAttribute("id")');
    await assert.rejects(web.collect(source), /找不到|定位|选取/);
    web.close(source.id); await web.collect(source); assert.ok(pageRequests >= 2, 'destroyed pages bootstrap again');
    await invoke('save', { id: 'api-fast', name: '1 秒接口', kind: 'http', url: `${url}/api`, valuePath: 'value', interval: 1 });
    await monitor.refresh('api-fast');
    let now = Date.now(), last = monitor.sources.get('api-fast').lastSuccess, confirmed = 0;
    const deadline = now + 3500;
    while (Date.now() < deadline) {
      monitor.tick(); await sleep(50);
      const current = monitor.sources.get('api-fast').lastSuccess;
      if (current > last) { confirmed++; last = current; }
    }
    assert.ok(confirmed >= 3, `at least 3 fresh confirmations within 3.5 seconds, actual ${confirmed}`);
    assert.ok(apiRequests >= 4); assert.equal(apiBodies, 1, 'unchanged JSON body downloaded only once');
    value = 25; await monitor.refresh('api-fast'); assert.equal(monitor.sources.get('api-fast').sample.value, 25);
    assert.ok(powerMonitor.listenerCount('resume') > 0, 'resume policy is installed for this actual application');
    for (const status of [503, 401]) {
      failure = status; await monitor.refresh('api-fast'); const before = apiRequests;
      powerMonitor.emit('resume'); await sleep(150);
      assert.equal(apiRequests, before, 'resume respects server retry deadlines and auth stops');
    }
    console.log('PASS 1-second API cadence and conditional confirmations, live DOM changes without page reload, invalid DOM failure and destroyed-page recovery');
  } finally {
    if (monitor.sources.has('api-fast')) await invoke('remove', 'api-fast');
    await web.clear(source.id); server.closeAllConnections(); server.close();
  }
}

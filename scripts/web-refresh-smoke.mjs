import assert from 'node:assert/strict';
import http from 'node:http';
import { Monitor } from '../core/monitor.js';

export async function runWebRefreshSmoke(web) {
  let balance = '36.5', total = '100', cacheRequests = 0, apiRequests = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    if (req.url === '/cached') {
      cacheRequests++;
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(`<html><body><p id="balance">${balance} GB</p><p id="total">${total} GB</p></body></html>`);
    } else if (req.url === '/dynamic-api') {
      res.setHeader('Cache-Control', 'no-store');
      res.end(`<html><body><p id="balance">36.5 GB</p><p id="total">100 GB</p><script>
        setTimeout(async () => { const data = await (await fetch('/api-current')).json(); document.querySelector('#balance').textContent = data.balance + ' GB'; document.querySelector('#total').textContent = data.total + ' GB'; }, 200);
      </script></body></html>`);
    } else if (req.url === '/api-current') {
      apiRequests++;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      setTimeout(() => res.end(JSON.stringify({ balance, total })), 2500);
    } else if (req.url === '/dynamic') {
      res.setHeader('Cache-Control', 'no-store');
      res.end(`<html><body><p id="balance">36.5 GB</p><p id="total">100 GB</p><script>
        setTimeout(() => { document.querySelector('#balance').textContent = '${balance} GB'; document.querySelector('#total').textContent = '${total} GB'; }, 1500);
      </script></body></html>`);
    } else if (req.url === '/busy') {
      res.setHeader('Cache-Control', 'no-store');
      res.end('<html><body><p id="balance">42.5 GB</p><script>fetch("/stream").then(response => response.text());</script></body></html>');
    } else if (req.url === '/stream') {
      res.writeHead(200); res.write('unrelated ongoing request');
    } else { res.writeHead(404); res.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ids = ['refresh-cache', 'refresh-dynamic', 'refresh-api', 'refresh-busy'];
  try {
    for (const [index, page] of ['cached', 'dynamic', 'dynamic-api'].entries()) {
      balance = '36.5'; total = '100';
      let now = 1000;
      const monitor = new Monitor({ collect: source => web.collect(source), now: () => now });
      monitor.upsert({ id: ids[index], kind: 'web', name: '网页更新回归', url: `${base}/${page}`, selector: '#balance', totalSelector: '#total', unit: 'GB', interval: 30, ...(page === 'dynamic-api' ? { waitSeconds: 1 } : {}) });
      await monitor.refresh(ids[index]);
      assert.equal(monitor.snapshot()[0].sample.value, 36.5);
      balance = '91.25'; total = '200';
      await monitor.refresh(ids[index]);
      console.log(`Refresh diagnostic: ${page}, server=${balance}, collected=${monitor.snapshot()[0].sample.value}, cacheRequests=${cacheRequests}, apiRequests=${apiRequests}`);
      assert.equal(monitor.snapshot()[0].sample.value, 91.25, `${page}: manual refresh must collect the updated website value`);
      assert.equal(monitor.snapshot()[0].sample.total, 200);
      balance = '0'; total = '250'; now += 30001;
      monitor.tick();
      await monitor.refresh(ids[index]);
      assert.equal(monitor.snapshot()[0].sample.value, 0, `${page}: scheduled refresh must preserve the updated zero value`);
      assert.equal(monitor.snapshot()[0].sample.total, 250);
      assert.equal(monitor.snapshot()[0].status, 'ok');
      await web.clear(ids[index]);
      console.log(`PASS ${page} website updates propagate through manual and scheduled collection`);
    }
    assert.equal((await web.collect({ id: ids[3], url: `${base}/busy`, selector: '#balance', waitSeconds: 1 })).value, '42.5 GB', 'unrelated long-lived requests must not block a stable metric indefinitely');
    console.log('PASS stable website value can be collected despite an unrelated streaming request');
  } finally {
    for (const id of ids) await web.clear(id);
    server.closeAllConnections(); server.close();
  }
}

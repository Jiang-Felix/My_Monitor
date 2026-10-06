import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
  throw new Error(`Timeout: ${label}`);
}
export async function runAuthSmoke(web) {
  let oauthOrigin, serviceOrigin;
  const oauth = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(`<html><body><h1>测试身份提供方</h1><button id="approve" onclick="location.href='${serviceOrigin}/callback'">授权并返回</button></body></html>`);
  });
  const service = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    if (req.url.startsWith('/exchange')) {
      setTimeout(() => {
        res.setHeader('Set-Cookie', 'monitor-auth=yes; Path=/; SameSite=Lax');
        res.end('ok');
      }, 700);
    } else if (req.url.startsWith('/callback')) {
      res.end(`<html><body><script>window.opener?.postMessage('signed-in', '${serviceOrigin}'); window.close();</script></body></html>`);
    } else if ((req.headers.cookie || '').includes('monitor-auth=yes')) {
      res.end('<html><body><p id="balance">42.5 USD</p></body></html>');
    } else {
      res.end(`<html><body><h1>请登录</h1><button id="login" onclick="window.open('${oauthOrigin}/authorize','oauth','width=500,height=650')">第三方登录</button><button id="blank" onclick="const child=window.open('about:blank','oauth-blank'); child.location.href='${oauthOrigin}/authorize'">空白页启动登录</button><script>addEventListener('message', async event => { if(event.origin === '${serviceOrigin}' && event.data === 'signed-in') { await fetch('/exchange'); location.reload(); } });</script></body></html>`);
    }
  });
  await new Promise(resolve => oauth.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  oauthOrigin = `http://127.0.0.1:${oauth.address().port}`;
  serviceOrigin = `http://127.0.0.1:${service.address().port}`;
  try {
    for (const bootstrap of ['login', 'blank', 'picker']) {
      const id = `auth-test-${bootstrap}`, url = `${serviceOrigin}/dashboard`;
      const selection = bootstrap === 'picker' ? web.pick(url, id) : null;
      if (!selection) await web.login({ id, url });
      else await until(async () => {
        const window = web.windows.get(id);
        return window && window.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")');
      }, 'picker before login');
      const parent = web.windows.get(id);
      await parent.webContents.executeJavaScript(`document.querySelector('#${bootstrap === 'picker' ? 'login' : bootstrap}').click(); true`, true);
      let popup;
      await until(() => {
        popup = [...(web.popups?.get(id) || [])][0];
        return popup && !popup.isDestroyed();
      }, 'third-party authentication popup');
      await until(() => popup.webContents.executeJavaScript('!!document.querySelector("#approve")'), 'OAuth provider page');
      assert.equal(popup.webContents.session, parent.webContents.session);
      const prefs = popup.webContents.getLastWebPreferences();
      assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true);
      assert.equal(await popup.webContents.executeJavaScript('typeof window.monitor'), 'undefined');
      await popup.webContents.executeJavaScript('document.querySelector("#approve").click(); true', true);
      await until(() => parent.webContents.executeJavaScript('!!document.querySelector("#balance")'), 'opener receives callback and authenticated cookie');
      if (selection) {
        await until(() => parent.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'), 'picker restored after callback');
        // OAuth closes its focused popup; restore native focus before sending real mouse input.
        parent.show(); parent.focus();
        await until(() => parent.webContents.executeJavaScript('document.hasFocus()'), 'picker native focus after OAuth callback');
        await parent.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await parent.webContents.executeJavaScript('window.__authSmokeClicks=[]; document.addEventListener("click",event=>window.__authSmokeClicks.push({id:event.target.id,tag:event.target.tagName,x:event.clientX,y:event.clientY}),true); true');
        const box = JSON.parse(await parent.webContents.executeJavaScript('JSON.stringify(document.querySelector("#__my_monitor_picker__").getBoundingClientRect().toJSON())'));
        const click = (x, y) => {
          parent.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
          parent.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
        };
        click(box.x + 60, box.bottom - 36); await sleep(100);
        const valueBox = JSON.parse(await parent.webContents.executeJavaScript('JSON.stringify(document.querySelector("#balance").getBoundingClientRect().toJSON())'));
        click(valueBox.x + 20, valueBox.y + 14);
        try { await until(() => !web.picking.has(id), 'numeric selection finishes after OAuth callback'); }
        catch (error) {
          console.log('OAuth picker input diagnostic:', await parent.webContents.executeJavaScript('({ clicks:window.__authSmokeClicks,focused:document.hasFocus(),ratio:devicePixelRatio,width:innerWidth,height:innerHeight,host:document.querySelector("#__my_monitor_picker__")?.getBoundingClientRect().toJSON(),value:document.querySelector("#balance")?.getBoundingClientRect().toJSON(),scrollY })'));
          await mkdir('artifacts',{recursive:true}); await writeFile('artifacts/auth-picker-failure.png',(await parent.webContents.capturePage()).toPNG());
          throw error;
        }
        const picked = await selection;
        assert.equal(picked.selector, '#balance'); assert.equal(picked.raw, '42.5 USD');
      }
      assert.equal((await web.collect({ id, url, selector: '#balance' })).value, '42.5 USD');
      await web.clear(id);
      console.log(`PASS ${bootstrap} OAuth popup shares isolated session, preserves opener callback and collects after login`);
    }
  } finally { service.closeAllConnections(); oauth.closeAllConnections(); service.close(); oauth.close(); }
}

import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { Store } from '../core/storage.js';
import { safeStorage } from 'electron';
import { runAuthSmoke } from './auth-smoke.mjs';
import { runWebRefreshSmoke } from './web-refresh-smoke.mjs';
import { runFloatingSmoke } from './floating-smoke.mjs';
import { runValueErrorsSmoke } from './value-errors-smoke.mjs';
import { runValueFormSmoke } from './value-form-smoke.mjs';
import { runWorkspaceSmoke } from './workspace-smoke.mjs';
import { runResourceViewsSmoke } from './resource-views-smoke.mjs';
import { runFastRefreshSmoke } from './fast-refresh-smoke.mjs';
import { runFloatingChangeSmoke } from './floating-change-smoke.mjs';
import { runFloatingBoundsSmoke } from './floating-bounds-smoke.mjs';
import { runPickerCloseSmoke } from './picker-close-smoke.mjs';
import { runAdaptiveUISmoke } from './adaptive-ui-smoke.mjs';
import { runFloatingPositionSmoke } from './floating-position-smoke.mjs';
import { runTestModeSmoke } from './test-mode-smoke.mjs';
import { runCadenceSmoke } from './cadence-smoke.mjs';
import { runAlertControlsSmoke } from './alert-controls-smoke.mjs';
import { runFormOptionsSmoke } from './form-options-smoke.mjs';
import { runFloatingMotionSmoke } from './floating-motion-smoke.mjs';
import {runLanguageSmoke} from './language-smoke.mjs';
import {runSettingsSmoke} from './settings-smoke.mjs';
import {runThemeSmoke} from './theme-smoke.mjs';
import {runDataControlsSmoke} from './data-controls-smoke.mjs';
import {runFloatingDisplaySmoke} from './floating-display-smoke.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(70); }
  throw new Error(`Timeout: ${label}`);
}
export async function runSmoke({ mainWindow, monitor, web, persist, showFloating, getFloating, root,trayEvents,doubleClickTime,store,httpSources,transactions,provisionalIds,showMain,getMain }) {
  if(process.argv.includes('--empty-memory-only')){
    const {runEmptyMemorySmoke}=await import('./empty-memory-smoke.mjs');await runEmptyMemorySmoke({mainWindow,monitor,getFloating,root,trayEvents,doubleClickTime,showMain,getMain});return;
  }
  if(process.argv.includes('--web-idle-only')){
    const {runWebIdleSmoke}=await import('./web-idle-smoke.mjs');await runWebIdleSmoke(web);return;
  }
  if(process.argv.includes('--idle-memory-only')){
    const {runIdleMemorySmoke}=await import('./idle-memory-smoke.mjs');await runIdleMemorySmoke({mainWindow,monitor,web,getFloating,root});return;
  }
  if(process.argv.includes('--floating-stability-only')){
    const {runFloatingStabilitySmoke}=await import('./floating-stability-smoke.mjs');await runFloatingStabilitySmoke({mainWindow,monitor,getFloating,root});return;
  }
  if(['--low-usage-only','--low-usage-write','--low-usage-read'].some(flag=>process.argv.includes(flag))){
    const {runLowUsageSmoke}=await import('./low-usage-smoke.mjs');await runLowUsageSmoke({mainWindow,web,store,root});return;
  }
  if(process.argv.includes('--docs-media-only')){
    const {runDocsMediaSmoke}=await import('./docs-media-smoke.mjs');
    await runDocsMediaSmoke({mainWindow,monitor,getFloating,root});return;
  }
  if(process.argv.includes('--security-only')){
    const {runSecurityHardeningSmoke}=await import('./security-hardening-smoke.mjs');
    await runSecurityHardeningSmoke({mainWindow,monitor,web,persist,store,httpSources,transactions,provisionalIds});return;
  }
  let authFail = false, pageBalance = 36.5;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/page')) {
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      const send = () => res.end(`<html><body style="padding:40px;font:24px sans-serif"><h1>测试资源</h1><p id="balance">${pageBalance} GB</p><p id="total">100 GB</p></body></html>`);
      req.url === '/page-delay' ? setTimeout(send, 200) : send(); return;
    }
    if (authFail) { res.writeHead(401); res.end('{}'); return; }
    assert.equal(req.headers.authorization, 'Bearer smoke-secret');
    res.setHeader('Content-Type', 'application/json'); res.end('{"data":{"used":36.5,"total":100}}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = code => mainWindow.webContents.executeJavaScript(code, true);
  const invoke = async (method, input) => {
    const result = await run(`window.monitor.${method}(${input === undefined ? '' : JSON.stringify(input)})`);
    assert.equal(result.ok, true, result.error);
    return result.data;
  };
  try {
    await until(() => run('!!window.monitor && !!document.querySelector("#empty-add")'), 'renderer initialization');
    if(['--data-controls-only','--controls-write','--controls-read'].some(flag=>process.argv.includes(flag))){await runDataControlsSmoke({mainWindow,monitor,getFloating,root,trayEvents,doubleClickTime});return;}
    if(['--themes-only','--theme-write','--theme-read'].some(flag=>process.argv.includes(flag))){await runThemeSmoke({mainWindow,getFloating,root});return;}
    if(['--settings-only','--settings-write','--settings-read'].some(flag=>process.argv.includes(flag))){await runSettingsSmoke({mainWindow,getFloating,root});return;}
    await invoke('floating',false);
    if(['--floating-display-only','--floating-display-write','--floating-display-read'].some(flag=>process.argv.includes(flag))){await runFloatingDisplaySmoke({mainWindow,monitor,getFloating,root});return;}
    if (process.argv.includes('--position-write')||process.argv.includes('--position-read')){await runFloatingPositionSmoke({mainWindow,getFloating,persist});return;}
    if(['--language-write','--language-read','--language-only'].some(flag=>process.argv.includes(flag))){await runLanguageSmoke({mainWindow,monitor,web,getFloating,root});return;}
    assert.equal(await run('document.querySelector("#empty").hidden'), false);
    if (process.argv.includes('--motion-only')){await runFloatingMotionSmoke({mainWindow,monitor,getFloating});return;}
    if (process.argv.includes('--form-options-only')){await runFormOptionsSmoke({mainWindow,monitor,root});return;}
    if (process.argv.includes('--alert-controls-only')){await runAlertControlsSmoke({mainWindow,monitor,root});return;}
    if (process.argv.includes('--cadence-only')){await runCadenceSmoke({mainWindow,monitor,root});return;}
    if (process.argv.includes('--test-mode-only')){await runTestModeSmoke({mainWindow,monitor,root});return;}
    if (process.argv.includes('--picker-close-only')) { await runPickerCloseSmoke({mainWindow,web}); return; }
    if (process.argv.includes('--adaptive-only')) { await runAdaptiveUISmoke({mainWindow,root}); return; }
    if (process.argv.includes('--views-only')) { await runResourceViewsSmoke({ mainWindow, monitor, root }); console.log('Resource views desktop checks passed'); return; }
    if (process.argv.includes('--bounds-only')) { await runFloatingBoundsSmoke({mainWindow,getFloating}); return; }
    if (process.argv.includes('--floating-only')) { await runFloatingChangeSmoke({mainWindow,monitor,getFloating,root}); await runFloatingBoundsSmoke({mainWindow,getFloating}); console.log('Floating changes desktop checks passed'); return; }
    if (process.argv.includes('--auth-only')) { await runAuthSmoke(web); console.log('Authentication desktop checks passed'); return; }
    if (process.argv.includes('--fast-only')) { await runFastRefreshSmoke({ web, monitor, mainWindow }); console.log('Fast refresh desktop checks passed'); return; }
    if(!process.argv.includes('--integration-only')){
    await runDataControlsSmoke({mainWindow,monitor,getFloating,root,trayEvents,doubleClickTime});
    await runFloatingDisplaySmoke({mainWindow,monitor,getFloating,root});
    await runLanguageSmoke({mainWindow,monitor,web,getFloating,root});
    await runFormOptionsSmoke({mainWindow,monitor,root});
    await runAlertControlsSmoke({mainWindow,monitor,root});
    await runCadenceSmoke({mainWindow,monitor,root});
    await runTestModeSmoke({mainWindow,monitor,root});
    await runWorkspaceSmoke({ mainWindow, monitor, getFloating, root });
    await runPickerCloseSmoke({mainWindow,web});
    await runResourceViewsSmoke({ mainWindow, monitor, root });
    await runAdaptiveUISmoke({mainWindow,root});
    await runFloatingMotionSmoke({mainWindow,monitor,getFloating});
    await runFloatingChangeSmoke({mainWindow,monitor,getFloating,root});
    await runFloatingBoundsSmoke({mainWindow,getFloating});
    await runFastRefreshSmoke({ web, monitor, mainWindow });
    if (process.argv.includes('--workspace-only')) { console.log('Workspace desktop smoke checks passed'); return; }
    await runValueErrorsSmoke(web);
    await runValueFormSmoke({ mainWindow, monitor, web, root });
    await runFloatingSmoke({ mainWindow, monitor, getFloating, root });
    }
    await runAuthSmoke(web);
    await runWebRefreshSmoke(web);
    const source = { id: 'smoke-http', name: '真实接口测试', kind: 'http', url: `${base}/api`, valuePath: 'data.used', totalPath: 'data.total', unit: 'GB', interval: 60, enabled: true, token: 'smoke-secret' };
    await invoke('save', source);
    await monitor.refresh('smoke-http');
    await until(() => run('document.querySelector(".metric-value")?.textContent.includes("36.5")'), 'HTTP card value');
    assert.equal(monitor.snapshot()[0].sample.total, 100);
    console.log('PASS real HTTP → secure IPC → rendered quota card');
    authFail = true;
    await invoke('refresh', 'smoke-http');
    assert.equal(monitor.snapshot()[0].status, 'auth');
    assert.equal(monitor.snapshot()[0].sample.value, 36.5);
    await until(() => run('document.querySelector(".status")?.textContent.includes("重新授权")'), 'auth failure UI');
    console.log('PASS expired authorization retains old sample and shows error');
    authFail = false;
    await invoke('refresh', 'smoke-http');
    await persist();
    const file = join(app.getPath('userData'), 'monitor-state.json');
    assert.ok(!(await readFile(file, 'utf8')).includes('smoke-secret'));
    const restored = await new Store(file, { decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')) }).load();
    assert.equal(restored.tokens['smoke-http'], 'smoke-secret');
    assert.equal(restored.sources[0].sample.value, 36.5);
    console.log('PASS persisted sample and operating-system encrypted credential round-trip');
    let leaked = false;
    const other = http.createServer((req, res) => { leaked ||= !!req.headers.authorization; res.end('{"data":{"used":1,"total":100}}'); });
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    try {
      await invoke('preview', { ...source, url: `http://127.0.0.1:${other.address().port}/api`, token: '' });
      assert.equal(leaked, false);
    } finally { other.closeAllConnections(); other.close(); }
    console.log('PASS cross-origin preview never reuses a hidden provider token');

    // Start the actual picker through renderer IPC, then click its overlay and a real DOM element.
    await run(`window.__pickSmoke = window.monitor.pick(${JSON.stringify({ url: `${base}/page`, id: 'smoke-web' })}); true`);
    await until(() => web.windows.get('smoke-web')?.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'), 'picker injection');
    const remote = web.windows.get('smoke-web');
    const box = await remote.webContents.executeJavaScript('JSON.stringify(document.querySelector("#__my_monitor_picker__").getBoundingClientRect().toJSON())');
    const rect = JSON.parse(box);
    const click = async (x, y) => {
      remote.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      remote.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
      await sleep(100);
    };
    await click(rect.x + 60, rect.bottom - 36);
    const target = JSON.parse(await remote.webContents.executeJavaScript('JSON.stringify(document.querySelector("#balance").getBoundingClientRect().toJSON())'));
    await click(target.x + 20, target.y + 14);
    const selected = await run('window.__pickSmoke');
    assert.equal(selected.ok, true, selected.error);
    assert.equal(selected.data.selector, '#balance');
    assert.equal(selected.data.raw, '36.5 GB');
    await invoke('save', { id: 'smoke-web', kind: 'web', name: '真实网页测试', url: `${base}/page`, selector: selected.data.selector, totalSelector: '#total', interval: 60, unit: 'GB' });
    await monitor.refresh('smoke-web');
    const sample = monitor.snapshot().find(s => s.id === 'smoke-web').sample;
    assert.deepEqual(sample, { value: 36.5, total: 100, unit: 'GB' });
    console.log('PASS real page → mouse element picker → saved selector → background collection');
    pageBalance = 81.5;
    await run('document.querySelector("[data-id=smoke-web] [data-action=pause]").click(); true');
    await until(()=>run('document.querySelector("[data-id=smoke-web] [data-action=pause]")?.textContent==="▶"&&!document.querySelector("[data-id=smoke-web] [data-action=pause]").disabled'),'website monitoring paused');
    await run('document.querySelector("[data-id=smoke-web] [data-action=pause]").click(); true');
    await until(() => run('document.querySelector("[data-id=smoke-web] .metric-value")?.textContent.includes("81.5")'), 'updated website value reaches dashboard card');
    assert.equal(monitor.snapshot().find(s => s.id === 'smoke-web').sample.value, 81.5);
    await run('document.querySelector("[data-id=smoke-web] [data-action=edit]").click(); true');
    assert.equal(await run('document.querySelector("[name=waitSeconds]").value'), '3');
    assert.equal(await run('document.querySelector("[name=waitSeconds]").disabled'), false);
    await run('document.querySelector("#close-dialog").click(); true');
    pageBalance = 36.5;
    console.log('PASS website change → dashboard monitoring resume → latest rendered card value');

    const raceSource = { id: 'smoke-race', kind: 'web', name: '竞态测试', url: `${base}/page-delay`, selector: '#balance', totalSelector: '', interval: 60, unit: 'GB' };
    await invoke('save', raceSource);
    await until(() => !!web.jobs.current('smoke-race'), 'first web request in flight');
    await invoke('save', { ...raceSource, selector: '#total' });
    await monitor.refresh('smoke-race');
    assert.equal(monitor.snapshot().find(s => s.id === 'smoke-race').sample.value, 100);
    await invoke('remove', 'smoke-race');
    console.log('PASS editing a running web source collects the new selector without accepting old payload');
    const deletedSource = { ...raceSource, id: 'smoke-delete' };
    await invoke('save', deletedSource);
    await until(() => !!web.jobs.current('smoke-delete'), 'collection running before deletion');
    await run(`window.__deletedPick = window.monitor.pick(${JSON.stringify({ id: 'smoke-delete', url: `${base}/page-delay` })}); true`);
    await until(() => web.picking.has('smoke-delete'), 'picker waiting for old collection');
    await invoke('remove', 'smoke-delete');
    const deletedPick = await run('window.__deletedPick');
    assert.equal(deletedPick.ok, false);
    assert.equal(web.windows.has('smoke-delete'), false);
    assert.equal(web.picking.has('smoke-delete'), false);
    console.log('PASS deleting a source cancels a waiting picker without reopening its account');

    // A stale picker must not mutate a newly opened editor.
    await run(`document.querySelector('#add-button').click(); document.querySelector('[data-kind="web"]').click(); document.querySelector('[name="url"]').value=${JSON.stringify(`${base}/page`)}; document.querySelector('#pick-value').click(); true`);
    await until(() => web.picking.size === 1, 'UI picker pending');
    const pendingId = [...web.picking][0];
    await until(() => web.windows.get(pendingId)?.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'), 'UI picker ready');
    await run("document.querySelector('#close-dialog').click(); true");
    await run("document.querySelector('#add-button').click(); document.querySelector('[name=\"name\"]').value='新表单'; true");
    await until(() => web.picking.size === 0&&!web.windows.has(pendingId), 'closed editor cancels its old picker');
    await sleep(100);
    assert.equal(await run('document.querySelector("[name=selector]").value'), '');
    assert.equal(await run('document.querySelector("[name=name]").value'), '新表单');
    await run("document.querySelector('#close-dialog').click(); true");
    await web.clear(pendingId);
    console.log('PASS a closed form discards its old picker result after another editor opens');

    await invoke('demo');
    await monitor.refreshAll();
    await until(() => run('document.querySelectorAll(".metric-card").length === 5'), 'demo labels');
    assert.equal(await run('document.querySelectorAll(".demo-tag").length'), 3);
    await run('document.querySelector("#add-button").click(); true');
    assert.equal(await run('document.querySelector("#source-dialog").open'), true);
    await run('document.querySelector("#close-dialog").click(); true');
    showFloating();
    await until(() => getFloating()?.webContents.executeJavaScript('document.querySelectorAll(".floating-track[data-id]").length === 5'), 'floating view shares state');
    await until(() => getFloating().isAlwaysOnTop(), 'floating window becomes always-on-top after native creation');
    assert.equal(getFloating().isAlwaysOnTop(), true);
    console.log('PASS source dialog, explicit demos, shared always-on-top floating view');
    const artifacts = join(root, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await writeFile(join(artifacts, 'dashboard.png'), (await mainWindow.webContents.capturePage()).toPNG());
    await writeFile(join(artifacts, 'floating.png'), (await getFloating().webContents.capturePage()).toPNG());
    console.log('Desktop smoke checks passed; screenshots saved in artifacts/');
  } finally { server.closeAllConnections(); server.close(); }
}

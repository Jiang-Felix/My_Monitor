import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
  throw new Error(`Timeout: ${label}`);
}

export async function runValueFormSmoke({ mainWindow, monitor, web, root }) {
  let current = 40;
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(`<h1>账户额度</h1><p id="current">${current} GB</p><p id="limit">100 GB</p>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const run = code => mainWindow.webContents.executeJavaScript(code, true);
  const config = { id: 'smoke-mixed-ui', name: '网页与固定值', kind: 'web', url, selector: '#current', valueMode: 'web', totalMode: 'fixed', fixedTotal: 100, unit: 'GB', waitSeconds: 1, interval: 60 };
  let fixedId, pickedId, previewId;
  try {
    await run(`document.querySelector('#add-button').click(); { const mode=document.querySelector('[name=valueMode]');mode.value='fixed';mode.dispatchEvent(new Event('change')); } document.querySelector('[name=name]').value='固定值测试'; document.querySelector('[name=fixedValue]').value='nope'; document.querySelector('#save-button').click(); true`);
    assert.equal(await run('document.querySelector("#source-dialog").open'), true);
    assert.match(await run('document.querySelector("#form-error").textContent'), /实时数据.*有效数字/);
    assert.equal(monitor.sources.size, 0);
    assert.equal(await run('document.querySelector("[name=url]").disabled'), true);
    await run(`document.querySelector('[name=fixedValue]').value='120'; const total=document.querySelector('[name=totalMode]'); total.value='fixed'; total.dispatchEvent(new Event('change')); document.querySelector('[name=fixedTotal]').value='100'; document.querySelector('#preview-button').click(); true`);
    await until(() => run('document.querySelector("#form-error").textContent.includes("大于总量")'), 'range error in preview');
    assert.equal(monitor.sources.size, 0);
    await run('document.querySelector("#save-button").click(); true');
    await until(() => monitor.sources.size === 1 && [...monitor.sources.values()][0].status === 'range', 'fixed quota fails when current exceeds total');
    fixedId = [...monitor.sources.keys()][0];
    await until(() => run('document.querySelector(".card-error")?.textContent.includes("120")'), 'specific overflow error on card');
    assert.match(await run('document.querySelector(".status").textContent'), /监控异常/);
    assert.equal(monitor.sources.get(fixedId).sample, null);
    assert.equal(await run('!!document.querySelector("[data-action=open]")'), false);
    await run('document.querySelector(".repair-button").click(); true');
    assert.equal(await run('document.querySelector("[name=fixedValue]").value'), '120');
    await run('document.querySelector("[name=fixedValue]").value="0"; document.querySelector("#save-button").click(); true');
    await until(() => monitor.sources.get(fixedId).status === 'ok', 'zero fixed current recovers');
    assert.deepEqual(monitor.sources.get(fixedId).sample, { value: 0, total: 100, unit: '' });
    await monitor.refresh(fixedId);
    assert.equal(monitor.sources.get(fixedId).sample.value, 0);
    assert.equal((await run(`window.monitor.remove(${JSON.stringify(fixedId)})`)).ok, true);

    await run(`document.querySelector('#add-button').click(); document.querySelector('[data-kind=web]').click(); document.querySelector('[name=name]').value='无效选择器'; document.querySelector('[name=url]').value=${JSON.stringify(url)}; document.querySelector('[name=selector]').value='100'; document.querySelector('#save-button').click(); true`);
    assert.match(await run('document.querySelector("#form-error").textContent'), /实时数据选择器格式无效/);
    assert.equal(monitor.sources.size, 0);
    await run('document.querySelector("[name=selector]").value="#missing"; document.querySelector("[name=waitSeconds]").value="1"; document.querySelector("#preview-button").click(); true');
    await until(() => web.jobs.pending.size === 1, 'preview reading old configuration');
    previewId = [...web.jobs.pending.keys()][0];
    await run('const mode=document.querySelector("[name=valueMode]"); mode.value="fixed"; mode.dispatchEvent(new Event("change")); document.querySelector("[name=fixedValue]").value="10"; true');
    try { await until(() => run('!document.querySelector("#preview-button").disabled'), 'old preview finishes after mode change'); }
    catch (failure) {
      console.log('Preview recovery diagnostic:', { pending: [...web.jobs.pending.keys()], form: await run('({ open:document.querySelector("#source-dialog").open, error:document.querySelector("#form-error").textContent, previewDisabled:document.querySelector("#preview-button").disabled })') });
      throw failure;
    }
    assert.equal(await run('document.querySelector("#form-error").textContent'), '');
    assert.equal(await run('document.querySelector("#preview-output").hidden'), true);
    await run('document.querySelector("#close-dialog").click(); true');

    assert.equal((await run(`window.monitor.save(${JSON.stringify(config)})`)).ok, true);
    await monitor.refresh(config.id);
    assert.deepEqual(monitor.sources.get(config.id).sample, { value: 40, total: 100, unit: 'GB' });
    current = 120;
    await monitor.refresh(config.id);
    await until(() => monitor.sources.get(config.id).status === 'range', 'updated website exceeding fixed total fails');
    await until(() => run('document.querySelector("[data-id=smoke-mixed-ui] .status")?.textContent.includes("旧数据")'), 'last valid sample labeled old');
    assert.equal(monitor.sources.get(config.id).sample.value, 40);
    assert.match(await run('document.querySelector("[data-id=smoke-mixed-ui] .card-error").textContent'), /120 GB.*100 GB/);
    const artifacts = join(root, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await writeFile(join(artifacts, 'value-error-card.png'), (await mainWindow.webContents.capturePage()).toPNG());
    await run('document.querySelector("[data-id=smoke-mixed-ui] .repair-button").click(); true');
    assert.equal(await run('document.querySelector("[name=totalMode]").value'), 'fixed');
    assert.equal(await run('document.querySelector("[name=fixedTotal]").value'), '100');
    await run('document.querySelector("[name=fixedTotal]").value="200"; document.querySelector("#save-button").click(); true');
    await until(() => monitor.sources.get(config.id).status === 'ok', 'raising fixed total recovers webpage card');
    assert.deepEqual(monitor.sources.get(config.id).sample, { value: 120, total: 200, unit: 'GB' });
    await run('document.querySelector("[data-id=smoke-mixed-ui] [data-action=edit]").click(); const v=document.querySelector("[name=valueMode]"); v.value="fixed"; v.dispatchEvent(new Event("change")); document.querySelector("[name=fixedValue]").value="10"; const t=document.querySelector("[name=totalMode]"); t.value="web"; t.dispatchEvent(new Event("change")); document.querySelector("[name=totalSelector]").value="#limit"; document.querySelector("#save-button").click(); true');
    await until(() => monitor.sources.get(config.id).status === 'ok' && monitor.sources.get(config.id).sample?.value === 10, 'fixed current and website total saved from form');
    assert.deepEqual(monitor.sources.get(config.id).sample, { value: 10, total: 100, unit: 'GB' });
    assert.equal((await run(`window.monitor.remove(${JSON.stringify(config.id)})`)).ok, true);
    console.log('PASS form validation, fixed zero/no URL, overflow failure card with old-value label, visible repair, both mixed metric modes and recovery');

    // A nonnumeric click must leave the picker open, allowing another click without reopening it.
    pickedId = 'smoke-invalid-click';
    await run(`window.__invalidPick = window.monitor.pick(${JSON.stringify({ id: pickedId, url })}); true`);
    await until(() => web.windows.get(pickedId)?.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'), 'picker for invalid text');
    const remote = web.windows.get(pickedId);
    const click = async selector => {
      const rect = await remote.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
      const x = Math.round(rect.x + 10), y = Math.round(rect.y + 10);
      remote.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      remote.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await sleep(100);
    };
    const rect = await remote.webContents.executeJavaScript('document.querySelector("#__my_monitor_picker__").getBoundingClientRect().toJSON()');
    remote.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x + 60), y: Math.round(rect.bottom - 36), button: 'left', clickCount: 1 });
    remote.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x + 60), y: Math.round(rect.bottom - 36), button: 'left', clickCount: 1 });
    await sleep(100); await click('h1');
    assert.equal(web.picking.has(pickedId), true);
    assert.equal(await remote.webContents.executeJavaScript('!!document.querySelector("#__my_monitor_picker__")'), true);
    await click('#current');
    const picked = await run('window.__invalidPick');
    assert.equal(picked.ok, true); assert.equal(picked.data.raw, '120 GB');
    console.log('PASS nonnumeric picker click stays open and accepts a corrected numeric selection');
  } finally {
    for (const id of [fixedId, config.id, pickedId, previewId].filter(Boolean)) {
      if (monitor.sources.has(id)) await run(`window.monitor.remove(${JSON.stringify(id)})`);
      else await web.clear(id);
    }
    server.closeAllConnections(); server.close();
  }
}

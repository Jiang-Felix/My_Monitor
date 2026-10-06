import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_FLOATING_SETTINGS } from '../core/floating-settings.js';
import { runRangeAlertsSmoke } from './range-alerts-smoke.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
  throw new Error(`Timeout: ${label}`);
}

export async function runWorkspaceSmoke({ mainWindow, monitor, getFloating, root }) {
  const run = code => mainWindow.webContents.executeJavaScript(code, true);
  const invoke = async (method, value) => {
    const result = await run(`window.monitor.${method}(${JSON.stringify(value)})`);
    assert.equal(result.ok, true, result.error); return result.data;
  };
  assert.deepEqual(await run('[...document.querySelectorAll(".nav-label")].map(n => n.textContent.trim())'), ['数据', '告警', '浮窗', '设置']);
  await run('document.querySelector("[data-page=alarms]").click(); true');
  assert.equal(await run('document.querySelector("#alarms-page").hidden'), false);
  const source = { id: 'workspace-value', name: '告警测试量', kind: 'fixed', fixedValue: 10, totalMode: 'fixed', fixedTotal: 100, unit: 'GB', interval: 60 };
  let ruleId;
  try {
    await invoke('save', source); await monitor.refresh(source.id);
    await runRangeAlertsSmoke({ mainWindow, monitor, root, source });
    const artifacts = join(root, 'artifacts'); await mkdir(artifacts, { recursive: true });

    await invoke('save', { ...source, id: 'workspace-paused', name: '暂停项', enabled: false });
    await invoke('save', { ...source, id: 'workspace-failed', name: '失败项', fixedValue: 3, fixedTotal: 2 }); await monitor.refresh('workspace-failed');
    await invoke('save', { ...source, id: 'workspace-single', name: '余额', fixedValue: 20, totalMode: 'none' }); await monitor.refresh('workspace-single');
    await run('document.querySelector("[data-page=data]").click(); document.querySelector("[data-filter=abnormal]").click(); true');
    await until(()=>run('document.querySelectorAll("#cards .metric-card").length===2'),'coalesced data categories settle');
    assert.equal(await run('document.querySelectorAll("#cards .metric-card").length'), 2);
    // An initial failure has no old sample, but remains failed while a retry is pending.
    const collect = monitor.collect;
    let releaseRetry;
    monitor.collect = source => source.id === 'workspace-failed' ? new Promise(resolve => { releaseRetry = resolve; }) : collect(source);
    const retry = monitor.refresh('workspace-failed');
    try {
      await until(() => !!releaseRetry, 'failed source begins a held retry');
      assert.equal(await run('document.querySelectorAll("#cards .metric-card").length'), 2, 'retrying a first failure stays in the abnormal filter');
    } finally { releaseRetry?.({}); await retry; monitor.collect = collect; }
    await run('document.querySelector("[data-filter=normal]").click(); true');
    assert.equal(await run('document.querySelectorAll("#cards .metric-card").length'), 2);
    await run('document.querySelector("[data-filter=all]").click(); document.querySelector("[data-page=floating]").click(); true');
    assert.equal(await run('document.querySelector("#floating-page").hidden'), false);
    assert.deepEqual(await run('[...document.querySelectorAll("[data-page].active")].map(node => node.dataset.page)'), ['floating']);
    await run('Promise.allSettled([...document.querySelectorAll("[data-page]")].flatMap(node => node.getAnimations()).map(animation => animation.finished))');
    assert.notEqual(await run('getComputedStyle(document.querySelector("[data-page=floating]")).backgroundColor'),await run('getComputedStyle(document.querySelector("[data-page=data]")).backgroundColor'),'selected page has a distinct background');
    await run('const form=document.querySelector("#floating-settings"); form.elements.barWidth.value="340"; form.elements.barHeight.value="44"; form.elements.fillColor.value="#ddeeff"; form.elements.showName.checked=true; form.elements.showAmount.checked=true; form.elements.showPercent.checked=true; form.elements.showUnit.checked=false; form.elements.showDeltaValue.checked=false; form.querySelector("[type=submit]").click(); true');
    await until(async () => (await invoke('snapshot')).floatingSettings.barWidth === 340, 'floating styles saved');
    await invoke('floating', true);
    await until(() => getFloating()?.webContents.executeJavaScript('document.querySelector("[data-id=workspace-value] .floating-amount")?.textContent === "36/100"'), 'floating amount shows saved settings');
    await until(() => getFloating().isVisible(), 'floating native surface is visible');
    assert.ok(Math.abs(getFloating().getSize()[0] - 470) <= 1, `native width includes both label columns, allowing one DIP of display-scale rounding: ${JSON.stringify(getFloating().getBounds())}`);
    assert.equal(await getFloating().webContents.executeJavaScript('document.querySelector(".floating-name").textContent'), '告');
    assert.equal(await getFloating().webContents.executeJavaScript('document.querySelector("[data-id=workspace-single]").parentElement.querySelector(".floating-percent").textContent'), '--');
    await getFloating().webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await writeFile(join(artifacts, 'floating-custom.png'), (await getFloating().webContents.capturePage()).toPNG());
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await writeFile(join(artifacts, 'floating-settings-page.png'), (await mainWindow.webContents.capturePage()).toPNG());
    const restored = JSON.parse(await readFile(join(app.getPath('userData'), 'monitor-state.json'), 'utf8'));
    assert.equal(restored.floatingSettings.showAmount, true); assert.equal(restored.floatingSettings.barWidth, 340);
    if (process.argv.includes('--native-notification-probe')) {
      const native = await invoke('notificationTest');
      console.log('Native notification probe:', native.delivery, native.error || '');
      await writeFile(join(artifacts, 'notification-probe.json'), JSON.stringify(native));
    }
    console.log('PASS data/alarms/floating pages, status filtering and native configurable floating labels and amounts');
  } finally {
    await invoke('floating', false); await invoke('floatingSettings', DEFAULT_FLOATING_SETTINGS);
    if (ruleId) await invoke('alertRemove', ruleId);
    for (const id of ['workspace-value', 'workspace-paused', 'workspace-failed', 'workspace-single']) if (monitor.sources.has(id)) await invoke('remove', id);
    await run('document.querySelector("[data-page=data]").click(); true');
  }
}

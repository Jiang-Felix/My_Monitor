import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
  throw new Error(`Timeout: ${label}`);
}
export async function runFloatingSmoke({ mainWindow, monitor, getFloating, root }) {
  const run = code => mainWindow.webContents.executeJavaScript(code, true);
  await run('document.querySelector("[data-page=floating]").click(); document.querySelector("#floating-page-toggle").click(); true');
  await until(() => !!getFloating(), 'open floating window from dashboard');
  const window = getFloating();
  assert.equal(window.getContentBounds().height, window.getBounds().height, 'floating panel must have no system title bar');
  assert.equal(window.isResizable(), false);
  assert.equal(window.isMenuBarVisible(), false);
  await until(() => window.webContents.executeJavaScript('!!document.querySelector("#floating-rows")'), 'floating renderer');
  await until(() => window.isVisible(), 'floating native surface is visible');
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal((await window.webContents.capturePage()).toBitmap()[3], 0, 'outside rounded panel must be genuinely transparent');
  assert.equal(await window.webContents.executeJavaScript('document.body.innerText.trim()'), '');
  assert.equal((await run('window.monitor.snapshot()')).data.floatingOpen, true);
  await until(() => run('document.querySelector("#floating-page-toggle").textContent.includes("关闭")'), 'close control reflects open window');
  for (const [id, value, total] of [['float-zero', 0, 100], ['float-half', 50, 100], ['float-over', 120, 100], ['float-unknown', 10, null]]) {
    monitor.upsert({ id, name: '浮窗测试', kind: 'demo', demoValue: value, demoTotal: total, interval: 60 });
    await monitor.refresh(id);
  }
  await until(() => window.webContents.executeJavaScript('document.querySelectorAll(".floating-track[data-id]").length === 4'), 'one progress row per source');
  assert.equal(monitor.sources.get('float-over').status, 'range');
  assert.deepEqual(await window.webContents.executeJavaScript('[...document.querySelectorAll(".floating-fill")].map(node => node.style.width)'), ['0%', '50%', '0%', '0%']);
  assert.equal(window.getSize()[1] >= 170 && window.getSize()[1] < 200, true, '20px default bars must fit four rows in a compact panel');
  await until(() => window.isAlwaysOnTop(), 'floating panel stays above windows');
  monitor.upsert({ id: 'float-half', name: '浮窗测试', kind: 'demo', demoValue: 75, demoTotal: 100, interval: 60 });
  await monitor.refresh('float-half');
  await until(() => window.webContents.executeJavaScript('document.querySelector("[data-id=float-half] .floating-fill")?.style.width === "75%"'), 'live progress update');
  const artifacts = join(root, 'artifacts');
  await mkdir(artifacts, { recursive: true });
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await writeFile(join(artifacts, 'floating-controls.png'), (await window.webContents.capturePage()).toPNG());
  for (let index = 0; index < 15; index++) monitor.upsert({ id: `float-many-${index}`, name: '滚动测试', kind: 'demo', demoValue: 50, demoTotal: 100, interval: 60 });
  await until(() => window.webContents.executeJavaScript('document.querySelectorAll(".floating-track[data-id]").length === 19'), 'large source list');
  assert.equal(window.getSize()[1] <= 600, true);
  assert.equal(await window.webContents.executeJavaScript('document.querySelector("#floating-rows").scrollHeight > document.querySelector("#floating-rows").clientHeight'), true);
  for (let index = 0; index < 15; index++) monitor.remove(`float-many-${index}`);
  await until(()=>window.getSize()[1]<300,'coalesced row removal resizes native floating panel');
  assert.equal(window.getSize()[1] < 300, true, 'removing rows shrinks the panel again');
  await run('document.querySelector("#floating-page-toggle").click(); true');
  await until(() => !getFloating(), 'close floating window from dashboard');
  assert.equal((await run('window.monitor.snapshot()')).data.floatingOpen, false);
  await until(() => run('document.querySelector("#floating-page-toggle").textContent.includes("打开")'), 'open control reflects closed window');
  for (const id of ['float-zero', 'float-half', 'float-over', 'float-unknown']) monitor.remove(id);
  // Exercise the public API and native close path, including recreation after a close.
  assert.equal((await run('window.monitor.floating(true)')).ok, true);
  await until(() => !!getFloating(), 'floating window recreation');
  await until(() => getFloating().webContents.executeJavaScript('!!document.querySelector("#floating-rows")'), 'recreated floating renderer');
  await getFloating().webContents.executeJavaScript('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); true');
  await until(() => !getFloating(), 'Escape closes the panel');
  assert.equal((await run('window.monitor.floating(true)')).ok, true);
  await until(() => !!getFloating(), 'reopen after Escape');
  getFloating().close();
  await until(() => !getFloating(), 'native close updates state');
  assert.equal((await run('window.monitor.floating(false)')).data, false);
  await run('document.querySelector("[data-page=data]").click(); true');
  console.log('PASS transparent frameless floating panel, open/close, live capsule progress, zero/overflow/no-total values');
}

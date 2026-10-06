import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Only the smoke runner's disposable profile and simulated values are used.
export async function runDocsMediaSmoke({ mainWindow, monitor, getFloating, root }) {
  const run = code => mainWindow.webContents.executeJavaScript(code, true);
  const invoke = async (method, input) => {
    const result = await run(`window.monitor.${method}(${JSON.stringify(input)})`);
    assert.equal(result.ok, true, result.error);
    return result.data;
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (let n = 0; n < 100 && !await run('!!document.querySelector("#empty-add")'); n++) await sleep(50);
  const version=(await invoke('snapshot')).version;
  assert.equal(await run(`document.querySelector('.version').textContent.includes(${JSON.stringify(version)})`),true,'sidebar uses the current runtime version');
  const output = join(root, 'docs/media');
  await mkdir(output, { recursive: true });
  mainWindow.setContentSize(1260, 860);
  mainWindow.show();
  const sources = [
    { id: 'docs-traffic', name: '☁ 云服务流量', fixedValue: 42, fixedTotal: 100, unit: 'GB', interval: 60 },
    { id: 'docs-budget', name: '◈ 月度预算', fixedValue: 850, fixedTotal: 1200, unit: '¥', interval: 3600 },
    { id: 'docs-credit', name: '✦ API 余额', fixedValue: 2048, unit: 'credits', interval: 600 },
  ];
  for (const source of sources) {
    monitor.upsert({ ...source, kind: 'fixed', totalMode: source.fixedTotal === undefined ? 'none' : 'fixed' });
    await monitor.refresh(source.id);
  }
  await invoke('alertSave', { id: 'docs-delta', name: '流量变化', sourceId: 'docs-traffic', type: 'delta', lower: -2, upper: 4, updateEvery: 1, chartPoints: 20, notificationsEnabled: false });
  await invoke('alertSave', { id: 'docs-value', name: '预算余量', sourceId: 'docs-budget', type: 'value', lower: 600, upper: 1200, updateEvery: 1, chartPoints: 20, notificationsEnabled: false });
  await invoke('alertSave', { id: 'docs-stopped', name: '余额观察', sourceId: 'docs-credit', type: 'value', lower: 1000, upper: 4000, updateEvery: 2, enabled: false });
  let value = 42;
  for (const delta of [1, 2, 1, 3, 1, 2, 5, 1, 2, 0, 1, 3, 2, 1, 0, 2, 1, 2, 3, 2]) {
    value += delta;
    monitor.upsert({ ...monitor.sources.get('docs-traffic'), fixedValue: value });
    await monitor.refresh('docs-traffic');
    monitor.upsert({ ...monitor.sources.get('docs-budget'), fixedValue: 850 - (value - 42) * 5 });
    await monitor.refresh('docs-budget');
    await sleep(12);
  }
  async function capture(name) {
    await run('window.scrollTo(0,0);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await sleep(400);
    await writeFile(join(output, name), (await mainWindow.webContents.capturePage()).toPNG());
  }
  await run('document.querySelector("[data-page=data]").click();document.querySelector("[data-view=cards]")?.click();true');
  await capture('data-cards.png');
  await run('document.querySelector("[data-view=list]").click();true');
  await capture('data-list.png');
  await run('document.querySelector("[data-page=alarms]").click();true');
  await invoke('alertSave', { id: 'docs-delta', name: '流量变化', sourceId: 'docs-traffic', type: 'delta', lower: -2, upper: 4, updateEvery: 1, chartPoints: 20, notificationsEnabled: true });
  mainWindow.setContentSize(1260, 1060);
  await sleep(200);
  await run('document.querySelector("[data-rule-id=docs-delta] [data-alert-action=chart]").click();true');
  // Space accelerated fixture records along their configured cadence for the
  // documentation illustration; this does not change persisted app records.
  const illustration = await invoke('snapshot');
  for (const track of illustration.alerts.tracking) {
    const source = sources.find(item => item.id === track.sourceId);
    for (const [index, point] of track.points.entries()) point.time -= (track.points.length - 1 - index) * source.interval * 1000;
  }
  mainWindow.webContents.send('monitor:update', illustration);
  await capture('alerts.png');
  mainWindow.setContentSize(1260, 860);
  await run('document.querySelector("[data-page=floating]").click();true');
  await capture('floating-settings.png');
  await invoke('floating', true);
  await sleep(500);
  assert.ok(getFloating() && !getFloating().isDestroyed());
  await writeFile(join(output, 'floating.png'), (await getFloating().webContents.capturePage()).toPNG());
  mainWindow.setContentSize(1260,1280);
  await run('document.querySelector("[data-page=settings]").click();true');
  await capture('settings.png');
  mainWindow.setContentSize(1260,860);
  await invoke('appSettings', { theme: 'sand' });
  await run('document.querySelector("[data-page=data]").click();true');
  await capture('data-sand.png');
  console.log('PASS documentation media: 7 current UI captures, simulated values, isolated profile');
}

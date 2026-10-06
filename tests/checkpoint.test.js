import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../core/checkpoint.js').catch(() => ({}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('samples coalesce to latest state and explicit flush saves before shutdown', async () => {
  assert.equal(typeof module.CheckpointWriter, 'function');
  let latest = 0; const saved = [];
  const writer = new module.CheckpointWriter({ delayMs: 20, write: async () => saved.push(latest) });
  for (latest = 1; latest <= 10; latest++) writer.schedule(); latest = 10;
  await sleep(45); assert.deepEqual(saved, [10]);
  latest = 11; writer.schedule(); await writer.flush(); assert.deepEqual(saved, [10, 11]);
  await sleep(30); assert.deepEqual(saved, [10, 11]);
});

test('slow writes do not create one queued snapshot per update and failures can recover', async () => {
  assert.equal(typeof module.CheckpointWriter, 'function');
  let release, latest = 1; const saved = [];
  const writer = new module.CheckpointWriter({ delayMs: 20, write: async () => { saved.push(latest); if (latest === 1) await new Promise(resolve => { release = resolve; }); } });
  writer.schedule(); const first = writer.flush(); await Promise.resolve();
  for (latest = 2; latest <= 50; latest++) writer.schedule(); latest = 50;
  await sleep(30); assert.deepEqual(saved, [1]); release(); await first; await writer.flush(); assert.deepEqual(saved, [1, 50]);
  let fail = true; const recovery = new module.CheckpointWriter({ write: async () => { if (fail) throw new Error('disk'); } });
  recovery.schedule(); await assert.rejects(recovery.flush(), /disk/); fail = false; recovery.schedule(); await recovery.flush();
});

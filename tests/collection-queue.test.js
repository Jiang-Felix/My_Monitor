import test from 'node:test';
import assert from 'node:assert/strict';
const { BoundedQueue } = await import('../core/collection-queue.js').catch(() => ({}));
const turn = () => new Promise(resolve => setImmediate(resolve));

test('collector queue bounds running jobs and rejects overflow without starting it', async () => {
  assert.equal(typeof BoundedQueue, 'function');
  const queue = new BoundedQueue({ concurrency: 1, maxQueued: 1 });
  let release, starts = 0;
  const first = queue.run(() => { starts++; return new Promise(resolve => { release = resolve; }); });
  const second = queue.run(() => { starts++; return 2; });
  await assert.rejects(queue.run(() => { starts++; }), { code: 'rate' });
  assert.equal(starts, 1);
  release(1);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.equal(starts, 2);
});

test('queued cancellation never starts work and active abort retains its slot until settlement', async () => {
  assert.equal(typeof BoundedQueue, 'function');
  const queue = new BoundedQueue({ concurrency: 1, maxQueued: 2 });
  const active = new AbortController(), queued = new AbortController();
  let release, received, starts = 0;
  const first = queue.run(signal => { received = signal; return new Promise(resolve => { release = resolve; }); }, { signal: active.signal });
  const firstRejected = assert.rejects(first, { name: 'AbortError' });
  const cancelled = queue.run(() => { starts++; }, { signal: queued.signal });
  const cancelledRejected = assert.rejects(cancelled, { name: 'AbortError' });
  queued.abort(); await cancelledRejected;
  const last = queue.run(() => { starts++; return 3; });
  active.abort(); await turn();
  assert.equal(received.aborted, true); assert.equal(starts, 0);
  release(1); await firstRejected;
  assert.equal(await last, 3); assert.equal(starts, 1);
});

test('closing a queue cancels queued jobs, signals active work and rejects new work', async () => {
  assert.equal(typeof BoundedQueue, 'function');
  const queue = new BoundedQueue({ concurrency: 1 });
  let release, signal;
  const active = queue.run(value => { signal = value; return new Promise(resolve => { release = resolve; }); });
  const activeRejected = assert.rejects(active, { name: 'AbortError' });
  const queued = assert.rejects(queue.run(() => assert.fail('closed queued work ran')), { name: 'AbortError' });
  queue.close(); assert.equal(signal.aborted, true); await queued;
  await assert.rejects(queue.run(() => 1), { name: 'AbortError' });
  release(); await activeRejected;
});

test('a settled job releases its slot before its caller starts the next job', async () => {
  const queue = new BoundedQueue({ concurrency: 1, maxQueued: 0 });
  assert.equal(await queue.run(() => 1), 1);
  assert.equal(await queue.run(() => 2), 2);
});

test('live concurrency changes drain waiting jobs without cancelling or oversubscribing active work',async()=>{
  const queue=new BoundedQueue({concurrency:1});
  const releases=[],started=[];
  const jobs=[0,1,2,3].map(id=>queue.run(signal=>{assert.equal(signal.aborted,false);started.push(id);return new Promise(resolve=>{releases[id]=resolve;});}));
  assert.deepEqual(started,[0]);queue.setConcurrency(3);assert.deepEqual(started,[0,1,2]);
  queue.setConcurrency(1);releases[0](0);releases[1](1);await turn();assert.deepEqual(started,[0,1,2]);
  releases[2](2);await turn();assert.deepEqual(started,[0,1,2,3]);releases[3](3);
  assert.deepEqual(await Promise.all(jobs),[0,1,2,3]);assert.equal(queue.activeCount,0);
  assert.throws(()=>queue.setConcurrency(0));
});

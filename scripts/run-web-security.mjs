import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const profile = await mkdtemp(join(tmpdir(), 'my-monitor-web-security-'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(require('electron'), ['scripts/web-security.cjs', profile], { env, stdio: 'inherit', windowsHide: true });
  const timer = setTimeout(() => child.kill(), 55000);
  try { process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); }); }
  finally { clearTimeout(timer); }
} finally {
  const target = resolve(profile);
  assert.ok(target.startsWith(resolve(tmpdir()) + sep + 'my-monitor-web-security-'));
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

// Wait for the native GUI test, then clean its disposable profile after all
// Electron handles close. Launching a GUI exe alone may return before it exits.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const archive = resolve(process.argv[2] || join(root, 'release', manifest.version, 'MyMonitor-win32-x64/resources/app.asar'));
const profile = await mkdtemp(join(tmpdir(), 'monitor-packaged-floating-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
try {
  const child = spawn(require('electron'), [join(root, 'scripts/packaged-floating-smoke.cjs'), archive, '--probe-data', profile], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  const timer = setTimeout(() => { console.error('Packaged floating test exceeded 120 seconds'); child.kill(); }, 120000);
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    process.exitCode = code ?? 1;
  } finally { clearTimeout(timer); }
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let count = 0;
for (const directory of ['core', 'desktop', 'ui', 'scripts', 'tests']) {
  for (const entry of await readdir(directory)) if (/\.(js|cjs|mjs)$/.test(entry)) {
    const result = spawnSync(process.execPath, ['--check', join(directory, entry)], { encoding: 'utf8' });
    if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
    count++;
  }
}
console.log(`Syntax checked: ${count} files`);

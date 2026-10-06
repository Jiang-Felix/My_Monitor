import { packager } from '@electron/packager';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const electronDirectory = dirname(require.resolve('electron/package.json'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const icons=spawnSync(require('electron'),['scripts/build-icons.cjs'],{env,stdio:'inherit',windowsHide:true});
if(icons.status!==0)throw new Error('Unable to build Windows icons');
// The installed Electron package carries its official release checksums.
// Reuse those and the verified download cache instead of fetching checksum metadata again.
const checksums = JSON.parse(await readFile(join(electronDirectory, 'checksums.json'), 'utf8'));
const paths = await packager({
  dir: '.', name: 'MyMonitor', platform: 'win32', arch: 'x64', out: process.argv[2] || join('release', manifest.version),
  overwrite: true, asar: true,
  icon:'ui/assets/ICON.ico',
  ignore: [/^\/(release|artifacts|tests|docs|scripts|\.git|\.github)(\/|$)/, /^\/(\.gitignore|\.gitattributes|\.editorconfig|package-lock\.json|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md)$/],
  download: { checksums }
});
console.log(`Packaged: ${paths.join(', ')}`);

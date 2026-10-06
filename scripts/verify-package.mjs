import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {extractFile} from '@electron/asar';
const root=resolve(import.meta.dirname,'..');
const sourceManifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const archive=resolve(process.argv[2]||join(root,'release',sourceManifest.version,'MyMonitor-win32-x64/resources/app.asar'));
assert.ok(archive.endsWith('app.asar'));
async function files(dir){const all=[];for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())all.push(...await files(file));else if(entry.isFile())all.push(file);}return all;}
const inputs=[...await files(join(root,'core')),...await files(join(root,'desktop')),...await files(join(root,'ui')),join(root,'README.md'),join(root,'LICENSE')];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const file of inputs){const name=relative(root,file);assert.equal(hash(extractFile(archive,name)),hash(await readFile(file)),`Archive differs: ${name}`);}
console.log(`PASS packaged/source SHA256 parity: ${inputs.length} production files`);
// Packager deliberately strips development-only manifest fields.
const manifest=JSON.parse(extractFile(archive,'package.json'));
for(const key of ['name','version','description','type','main','dependencies','license','author','repository'])assert.deepEqual(manifest[key],sourceManifest[key],`Runtime manifest differs: ${key}`);
console.log('PASS packaged runtime manifest identity, entry point and dependencies');

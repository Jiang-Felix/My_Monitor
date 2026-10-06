import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const electron = require('electron');
const data = await mkdtemp(join(tmpdir(), 'my-monitor-smoke-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const phases=process.argv.includes('--floating-display-persistence-only')?[['--floating-display-write'],['--floating-display-read']]:process.argv.includes('--controls-persistence-only')?[['--controls-write'],['--controls-read']]:process.argv.includes('--themes-persistence-only')?[['--theme-write'],['--theme-read']]:process.argv.includes('--settings-persistence-only')?[['--settings-write'],['--settings-read']]:process.argv.includes('--position-only')?[['--position-write'],['--position-read']]:process.argv.includes('--language-persistence-only')?[['--language-write'],['--language-read']]:[process.argv.slice(2)];
try{
  for(const args of phases){
    const child=spawn(electron,['.','--smoke','--smoke-data',data,...args],{env,stdio:'inherit',windowsHide:true});
    // Full desktop coverage includes deliberately delayed sites and streaming requests.
    const timer=setTimeout(()=>{console.error('Desktop smoke exceeded its 240-second limit');child.kill();},240000);
    let code;
    try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}
    finally{clearTimeout(timer);}
    if(code!==0){process.exitCode=code??1;break;}
  }
}finally{await rm(data,{recursive:true,force:true});}

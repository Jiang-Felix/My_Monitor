const {app,BrowserWindow,ipcMain}=require('electron');
const {mkdtempSync,rmSync,existsSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const version=require('../package.json').version;
const archive=resolve(process.argv[2]||join('release',version,'MyMonitor-win32-x64/resources/app.asar'));
if(!archive.endsWith('app.asar')||!existsSync(archive))throw new Error('Pass a packaged app.asar path');
const profileArg=process.argv.indexOf('--probe-data');
const ownsProfile=profileArg<0;
const profile=ownsProfile?mkdtempSync(join(tmpdir(),'monitor-packaged-floating-')):resolve(process.argv[profileArg+1]);
if(!profile.startsWith(join(tmpdir(),'monitor-packaged-floating-')))throw new Error('Use an isolated packaged-probe profile');
app.setPath('userData',profile);
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
  const {DEFAULT_FLOATING_SETTINGS,validateFloatingSettings}=await import(pathToFileURL(join(archive,'core/floating-settings.js')).href);
  const {runFloatingCompositorSmoke}=await import(pathToFileURL(join(__dirname,'floating-compositor-smoke.mjs')).href);
  const state={sources:Array.from({length:6},(_,i)=>({id:String(i),name:'fixture',enabled:true,status:'ok',sample:{value:50+i*5,total:100}})),floatingSettings:{...DEFAULT_FLOATING_SETTINGS}};
  ipcMain.handle('monitor:snapshot',()=>({ok:true,data:state}));
  let floating;
  async function open(){
    floating=new BrowserWindow({width:54+state.floatingSettings.barWidth+(state.floatingSettings.showName?28:0)+(state.floatingSettings.showPercent?48:0),height:234,frame:false,transparent:true,resizable:false,minimizable:false,maximizable:false,fullscreenable:false,hasShadow:false,roundedCorners:true,thickFrame:false,skipTaskbar:true,backgroundColor:'#00000000',show:false,alwaysOnTop:true,webPreferences:{preload:join(archive,'desktop/preload.cjs'),contextIsolation:true,sandbox:true}});
    await floating.loadFile(join(archive,'ui/floating.html'));floating.show();
  }
  const setSettings=async settings=>{
    state.floatingSettings=validateFloatingSettings(settings);
    floating.webContents.send('monitor:update',state);
    await floating.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  };
  await open();
  await runFloatingCompositorSmoke({getFloating:()=>floating,settings:state.floatingSettings,setSettings,root:resolve(__dirname,'..')});
  floating.destroy();state.floatingSettings=validateFloatingSettings({...state.floatingSettings,barWidth:410,barHeight:4,showAmount:false,showDeltaValue:false});
  await open();
  await runFloatingCompositorSmoke({getFloating:()=>floating,settings:state.floatingSettings,setSettings,root:resolve(__dirname,'..')});
  floating.destroy();console.log('PASS packaged ASAR UI, preload and settings: six rows, reopening, 410px width and 4px thin bars');app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
app.on('will-quit',()=>{if(ownsProfile)try{rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){console.error('Standalone probe profile cleanup failed:',error.code);}});

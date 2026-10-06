import test from 'node:test';
import assert from 'node:assert/strict';
import { appSettings, validateAppSettings } from '../core/app-settings.js';
import { StartupPreference } from '../desktop/startup.js';
const defaultSettings={floatingOnStartup:true,theme:'ocean',traySingleClick:true,trayDoubleClick:true};

test('startup floating preference defaults on, preserves false and rejects malformed updates', () => {
  assert.deepEqual(appSettings(), defaultSettings);
  assert.deepEqual(appSettings({ floatingOnStartup: false }), {...defaultSettings,floatingOnStartup:false});
  assert.deepEqual(appSettings({ floatingOnStartup: 'false' }), defaultSettings);
  assert.deepEqual(validateAppSettings({ floatingOnStartup: false }), {...defaultSettings,floatingOnStartup:false});
  for (const input of [null, [], { floatingOnStartup: 0 }, { launchAtLogin: true }]) assert.throws(() => validateAppSettings(input));
});

test('theme updates preserve startup preference and startup updates preserve theme',()=>{
  assert.deepEqual(validateAppSettings({theme:'cloud'},{floatingOnStartup:false,theme:'ocean'}),{...defaultSettings,floatingOnStartup:false,theme:'cloud'});
  assert.deepEqual(validateAppSettings({floatingOnStartup:true},{floatingOnStartup:false,theme:'forest'}),{...defaultSettings,theme:'forest'});
  assert.equal(appSettings({theme:'invalid'}).theme,'ocean');
  for(const value of [{theme:'invalid'},{theme:null},{theme:'cloud',unknown:true},{}])assert.throws(()=>validateAppSettings(value));
});

test('tray gestures default on independently and saved false survives all partial preference updates',()=>{
  const saved=validateAppSettings({traySingleClick:false,trayDoubleClick:false},{floatingOnStartup:false,theme:'sand'});
  assert.deepEqual(saved,{floatingOnStartup:false,theme:'sand',traySingleClick:false,trayDoubleClick:false});
  assert.deepEqual(appSettings(saved),saved);
  assert.deepEqual(validateAppSettings({theme:'cloud'},saved),{...saved,theme:'cloud'});
  assert.deepEqual(validateAppSettings({traySingleClick:true},saved),{...saved,traySingleClick:true});
  for(const key of ['traySingleClick','trayDoubleClick'])for(const value of [0,'false',null])assert.throws(()=>validateAppSettings({[key]:value}));
});

test('startup registration uses the current packaged executable without shell commands', () => {
  let registered = false;
  const calls = [];
  const app = { isPackaged: true, getLoginItemSettings(options) { calls.push(options); return { openAtLogin: registered }; }, setLoginItemSettings(options) { calls.push(options); registered = options.openAtLogin; } };
  const startup = new StartupPreference(app, 'C:\\App With Spaces\\MyMonitor.exe');
  assert.equal(startup.get(), false);
  assert.equal(startup.set(true), true);
  assert.deepEqual(calls[1], { openAtLogin: true, enabled:true, path: 'C:\\App With Spaces\\MyMonitor.exe', args: [] });
  assert.equal(startup.set(false), false);
  assert.throws(() => startup.set('true'));
  assert.throws(() => new StartupPreference({ isPackaged: false }, 'electron.exe').set(true));
});

test('startup registration failure is surfaced instead of presenting a saved toggle', () => {
  const startup = new StartupPreference({ isPackaged: true, getLoginItemSettings: () => ({ openAtLogin: false }), setLoginItemSettings() {} }, 'app.exe');
  assert.throws(() => startup.set(true), /开机自启/);
});

test('a registration disabled in Windows is shown as off', () => {
  const startup=new StartupPreference({isPackaged:true,getLoginItemSettings:()=>({openAtLogin:true,executableWillLaunchAtLogin:false})},'app.exe');
  assert.equal(startup.get(),false);
});

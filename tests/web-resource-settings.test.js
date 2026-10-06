import test from 'node:test';
import assert from 'node:assert/strict';
import {browserResourcePolicy,DEFAULT_WEB_LIMITS,restoreWebLimits,validateWebLimits,WEB_LIMIT_FIELDS} from '../core/web-resource-settings.js';
import {setLanguage,t} from '../core/i18n.js';

test('low usage policy reproduces the original budgets with consistent display units',()=>{
  const policy=browserResourcePolicy(true);
  assert.equal(policy.maxResponseBytes,16*1024*1024);
  assert.equal(policy.requestLimit,120);assert.equal(policy.requestWindowMs,60000);
  assert.equal(policy.maxSourceBytes,64*1024*1024);assert.equal(policy.maxTotalBytes,128*1024*1024);
  assert.equal(policy.maxRendererMemoryKiB,256*1024);assert.equal(policy.maxTotalRendererMemoryKiB,1024*1024);
  assert.equal(policy.maxRendererCPU,60);assert.equal(policy.cpuSamples,3);assert.equal(policy.checkIntervalMs,5000);
  assert.equal(policy.maxWindows,8);assert.equal(policy.maxPopups,4);assert.equal(policy.maxProfiles,128);assert.equal(policy.concurrency,2);
  assert.equal(policy.readTimeoutMs,8000);assert.equal(policy.navigationTimeoutMs,20000);assert.equal(policy.pickTimeoutMs,600000);
  const custom=browserResourcePolicy(true,{rendererMemoryMiB:512,requestWindowSeconds:120,concurrency:4});
  assert.equal(custom.maxRendererMemoryKiB,512*1024);assert.equal(custom.requestWindowMs,120000);assert.equal(custom.concurrency,4);
});
test('compatibility mode ignores restrictive user budgets for fan-out and slow page timeouts',()=>{
  const policy=browserResourcePolicy(false,{maxWindows:1,maxProfiles:1,concurrency:1,navigationTimeoutSeconds:5,readTimeoutSeconds:2});
  assert.equal(policy.lowUsageMode,false);assert.equal(policy.maxWindows,128);assert.equal(policy.maxProfiles,4096);
  assert.equal(policy.concurrency,6);assert.equal(policy.navigationTimeoutMs,60000);assert.equal(policy.readTimeoutMs,15000);
});
test('saved invalid thresholds fall back individually and explicit edits reject every out-of-range value',()=>{
  assert.deepEqual(restoreWebLimits(null),DEFAULT_WEB_LIMITS);
  assert.equal(restoreWebLimits({requestLimit:500,rendererMemoryMiB:'512'}).requestLimit,500);
  assert.equal(restoreWebLimits({requestLimit:500,rendererMemoryMiB:'512'}).rendererMemoryMiB,256);
  for(const field of WEB_LIMIT_FIELDS){
    for(const value of [field.min-1,field.max+1,field.value+.5,NaN,Infinity,String(field.value),null])assert.throws(()=>validateWebLimits({[field.key]:value}));
    assert.equal(validateWebLimits({[field.key]:field.min})[field.key],field.min);
    assert.equal(validateWebLimits({[field.key]:field.max})[field.key],field.max);
  }
});
test('website threshold titles and validation messages have English translations',()=>{
  setLanguage('en');
  try{
    for(const text of [...WEB_LIMIT_FIELDS.map(field=>field.label),'低占用模式','网页资源阈值设置无效','网页资源阈值必须为允许范围内的整数'])assert.equal(/[\u4e00-\u9fff]/.test(t(text)),false,text);
  }finally{setLanguage('zh-CN');}
});

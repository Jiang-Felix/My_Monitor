// Human-readable units for settings; conversions belong at the browser boundary.
export const WEB_LIMIT_FIELDS = Object.freeze([
  {key:'requestLimit',label:'每页请求次数上限',unit:'次',group:'请求与流量',value:120,min:1,max:20000},
  {key:'requestWindowSeconds',label:'请求与流量统计窗口',unit:'秒',group:'请求与流量',value:60,min:1,max:3600},
  {key:'responseMiB',label:'单个响应大小上限',unit:'MiB',group:'请求与流量',value:16,min:1,max:1024},
  {key:'sourceMiB',label:'每页接收流量上限',unit:'MiB',group:'请求与流量',value:64,min:1,max:8192},
  {key:'totalMiB',label:'全部网页接收流量上限',unit:'MiB',group:'请求与流量',value:128,min:1,max:32768},
  {key:'maxResources',label:'每页同时跟踪的网络资源上限',unit:'个',group:'请求与流量',value:256,min:16,max:16384},
  {key:'rendererMemoryMiB',label:'单个网页进程内存上限',unit:'MiB',group:'内存与 CPU',value:256,min:64,max:16384},
  {key:'totalRendererMemoryMiB',label:'全部网页进程内存上限',unit:'MiB',group:'内存与 CPU',value:1024,min:128,max:65536},
  {key:'rendererCPU',label:'每页 CPU 占用上限',unit:'%',group:'内存与 CPU',value:60,min:1,max:1000},
  {key:'cpuSamples',label:'CPU 连续超限次数',unit:'次',group:'内存与 CPU',value:3,min:1,max:120},
  {key:'checkSeconds',label:'资源检查间隔',unit:'秒',group:'内存与 CPU',value:5,min:1,max:60},
  {key:'cooldownSeconds',label:'资源超限后的重试冷却',unit:'秒',group:'内存与 CPU',value:60,min:0,max:3600},
  {key:'maxWindows',label:'同时打开的网页窗口上限',unit:'个',group:'窗口与任务',value:8,min:1,max:128},
  {key:'maxPopups',label:'每页登录弹窗上限',unit:'个',group:'窗口与任务',value:4,min:0,max:16},
  {key:'maxProfiles',label:'本次运行的网页会话上限',unit:'个',group:'窗口与任务',value:128,min:1,max:4096},
  {key:'concurrency',label:'网页读取并发上限',unit:'个',group:'窗口与任务',value:2,min:1,max:16},
  {key:'navigationTimeoutSeconds',label:'网页加载超时',unit:'秒',group:'窗口与任务',value:20,min:5,max:300},
  {key:'readTimeoutSeconds',label:'网页读取超时',unit:'秒',group:'窗口与任务',value:8,min:2,max:120},
  {key:'pickTimeoutMinutes',label:'网页选取超时',unit:'分钟',group:'窗口与任务',value:10,min:1,max:60}
]);
export const DEFAULT_WEB_LIMITS=Object.freeze(Object.fromEntries(WEB_LIMIT_FIELDS.map(field=>[field.key,field.value])));
const valid=(field,value)=>Number.isInteger(value)&&value>=field.min&&value<=field.max;
export function restoreWebLimits(value) {
  return Object.fromEntries(WEB_LIMIT_FIELDS.map(field=>[field.key,valid(field,value?.[field.key])?value[field.key]:field.value]));
}
export function validateWebLimits(input,current) {
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.keys(input).some(key=>!Object.hasOwn(DEFAULT_WEB_LIMITS,key)))throw new Error('网页资源阈值设置无效');
  for(const field of WEB_LIMIT_FIELDS)if(Object.hasOwn(input,field.key)&&!valid(field,input[field.key]))throw new Error('网页资源阈值必须为允许范围内的整数');
  return {...restoreWebLimits(current),...input};
}
export function browserResourcePolicy(enabled,limits) {
  const value=restoreWebLimits(limits),lowUsageMode=enabled===true;
  return {
    lowUsageMode,maxResponseBytes:value.responseMiB*1024*1024,requestLimit:value.requestLimit,
    requestWindowMs:value.requestWindowSeconds*1000,maxSourceBytes:value.sourceMiB*1024*1024,maxTotalBytes:value.totalMiB*1024*1024,
    resourceCooldownMs:value.cooldownSeconds*1000,maxRendererMemoryKiB:value.rendererMemoryMiB*1024,
    maxTotalRendererMemoryKiB:value.totalRendererMemoryMiB*1024,maxRendererCPU:value.rendererCPU,cpuSamples:value.cpuSamples,
    checkIntervalMs:value.checkSeconds*1000,maxResources:value.maxResources,
    // Compatibility mode removes resource interception but still bounds task fan-out.
    maxWindows:lowUsageMode?value.maxWindows:128,maxPopups:lowUsageMode?value.maxPopups:8,
    maxProfiles:lowUsageMode?value.maxProfiles:4096,concurrency:lowUsageMode?value.concurrency:6,
    navigationTimeoutMs:(lowUsageMode?value.navigationTimeoutSeconds:60)*1000,
    readTimeoutMs:(lowUsageMode?value.readTimeoutSeconds:15)*1000,
    pickTimeoutMs:(lowUsageMode?value.pickTimeoutMinutes:30)*60000
  };
}

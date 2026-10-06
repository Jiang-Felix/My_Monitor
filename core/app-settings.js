import { THEMES,themeById } from './themes.js';
const booleanSettings=['floatingOnStartup','traySingleClick','trayDoubleClick'];
export function appSettings(value) {
  return {...Object.fromEntries(booleanSettings.map(key=>[key,typeof value?.[key]==='boolean'?value[key]:true])),theme:themeById(value?.theme).id};
}

export function validateAppSettings(value,current) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || !Object.keys(value).length || Object.keys(value).some(key=>![...booleanSettings,'theme'].includes(key))) throw new Error('应用设置无效');
  for(const key of booleanSettings)if(Object.hasOwn(value,key)&&typeof value[key]!=='boolean')throw new Error(key==='floatingOnStartup'?'启动浮窗设置无效':'托盘点击设置无效');
  if(Object.hasOwn(value,'theme')&&!THEMES.some(theme=>theme.id===value.theme))throw new Error('配色方案无效');
  return appSettings({...appSettings(current),...value});
}

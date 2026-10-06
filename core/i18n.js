import { staticMessages } from './locales-static.js';
import { appMessages } from './locales-app.js';
import { workspaceMessages } from './locales-workspace.js';
import { desktopMessages } from './locales-desktop.js';

export const LANGUAGES=['zh-CN','en'];
let language='zh-CN';
export function setLanguage(value) {
  if(!LANGUAGES.includes(value))throw new Error('Unsupported language');
  language=value;
  return language;
}
export const getLanguage=()=>language;
export const localeCode=()=>language==='en'?'en-US':'zh-CN';
export const normalizeTerms=text=>String(text??'').replace(/悬浮窗/g,'浮窗').replace(/当前量|当前值|瞬时值/g,'实时数据').replace(/总量(?!数据)/g,'总量数据').replace(/检查点/g,'记录').replace(/监控台/g,'监控').replace(/采集/g,'监控').replace(/“数据”页/g,'“实时数据”页').replace(/资源指标/g,'实时数据指标').replace(/资源进度/g,'实时数据进度').replace(/连接你的资源/g,'连接实时数据').replace(/选择监控数值/g,'选取实时数据');
const messages=Object.fromEntries(Object.entries({...desktopMessages,...staticMessages,...workspaceMessages,...appMessages}).map(([zh,en])=>[normalizeTerms(zh),en]));
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const templates=Object.entries(messages).filter(([key])=>/\{\w+\}/.test(key)).map(([key,value])=>{
  const names=[],parts=key.split(/(\{\w+\})/);
  const pattern=parts.map(part=>/^\{\w+\}$/.test(part)?(names.push(part.slice(1,-1)),'([\\s\\S]*?)'):escape(part)).join('');
  return {pattern:new RegExp(`^${pattern}$`),names,value};
});
export function t(text,lang=language) {
  const zh=normalizeTerms(text);
  if(lang!=='en')return zh;
  if(Object.hasOwn(messages,zh))return messages[zh];
  return translateTemplate(zh,lang,0);
}
function translateTemplate(text,lang,depth) {
  if(Object.hasOwn(messages,text))return messages[text];
  if(depth<4)for(const entry of templates) {
    const match=entry.pattern.exec(text);if(!match)continue;
    const values=Object.fromEntries(entry.names.map((name,index)=>[name,translateTemplate(match[index+1],lang,depth+1)]));
    return entry.value.replace(/\{(\w+)\}/g,(_all,key)=>values[key]??'');
  }
  return text;
}
export const translateMessage=(text,lang=language)=>t(text,lang);

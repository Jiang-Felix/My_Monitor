import { validAlertCadence } from '../core/alert-cadence.js';
import { t, getLanguage } from '../core/i18n.js';
const tr=(message,values)=>t(message).replace(/\{(\w+)\}/g,(_,key)=>String(values[key]));
export function frequencyText(updates,interval,{compact=false}={}){
  if(!validAlertCadence(updates)||!Number.isFinite(interval)||interval<=0)return t('请选择检测数据，并填写有效的更新次数');
  let remaining=updates*interval;const parts=[];
  for(const [size,label] of [[86400,'天'],[3600,'小时'],[60,'分钟'],[1,'秒']]){
    const amount=size===1?remaining:Math.floor(remaining/size);if(amount){parts.push(`${amount}${t(label)}`);remaining=size===1?0:remaining%size;}
  }
  const duration=parts.join(getLanguage()==='en'?' ':'');
  return compact?tr('约每 {duration} 记录一次',{duration}):tr('对应频率：约每 {duration} 记录一次（数据每 {interval}秒更新）',{duration,interval});
}

import {WEB_LIMIT_FIELDS,DEFAULT_WEB_LIMITS,restoreWebLimits} from '../core/web-resource-settings.js';
import {t} from '../core/i18n.js';

export function initializeWebResourceControls(form,onSave) {
  const fields=form.querySelector('#web-limits-fields'),inputs=new Map(),labels=new Map(),groups=new Map();
  let dirty=false,current=restoreWebLimits(),blocked=false;
  for(const field of WEB_LIMIT_FIELDS){
    let group=groups.get(field.group);
    if(!group){
      const section=document.createElement('fieldset'),legend=document.createElement('legend');
      section.className='web-limit-group';section.append(legend);fields.append(section);
      group={section,legend};groups.set(field.group,group);
    }
    const label=document.createElement('label'),caption=document.createElement('span'),input=document.createElement('input'),range=document.createElement('small');
    input.type='number';input.name=field.key;input.min=field.min;input.max=field.max;input.step=1;input.required=true;
    label.append(caption,input,range);group.section.append(label);
    inputs.set(field.key,input);labels.set(field.key,{caption,range});
  }
  form.addEventListener('input',()=>{dirty=true;});
  form.querySelector('#web-limits-reset').addEventListener('click',()=>{
    if(blocked)return;
    dirty=true;for(const [key,input] of inputs)input.value=DEFAULT_WEB_LIMITS[key];
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(blocked||!form.reportValidity())return;
    const value=Object.fromEntries([...inputs].map(([key,input])=>[key,Number(input.value)]));
    if(await onSave(value)){dirty=false;render(current,blocked);}
  });
  function render(value,disabled=false) {
    current=restoreWebLimits(value);blocked=disabled;
    form.querySelector('#web-limits-title').textContent=t('低占用模式阈值');
    form.querySelector('#web-limits-description').textContent=t('这些阈值仅在低占用模式开启时生效。请求次数包含网页自身的请求；流量按统计窗口累计。降低阈值可能中断登录或监控，调高阈值会增加资源占用。恢复默认后请保存。');
    for(const [name,group] of groups)group.legend.textContent=t(name);
    for(const field of WEB_LIMIT_FIELDS){
      const input=inputs.get(field.key),label=labels.get(field.key);
      if(!dirty&&input.value!==String(current[field.key]))input.value=current[field.key];
      input.disabled=disabled;
      label.caption.textContent=`${t(field.label)} (${t(field.unit)})`;
      input.title=`${t(field.label)}: ${field.min}–${field.max} ${t(field.unit)}`;
      label.range.textContent=`${field.min}–${field.max} ${t(field.unit)}`;
    }
    const save=form.querySelector('#web-limits-save'),reset=form.querySelector('#web-limits-reset');
    save.textContent=t('保存阈值');reset.textContent=t('恢复默认阈值');save.disabled=disabled;reset.disabled=disabled;
  }
  return {render,isDirty:()=>dirty};
}

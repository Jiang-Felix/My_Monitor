import {initializeFormChoices} from './form-choices.js';
import {t} from '../core/i18n.js';
import {MIN_ALERT_MULTIPLIER,MAX_ALERT_MULTIPLIER,ALERT_MULTIPLIER_STEP,validAlertCadence} from '../core/alert-cadence.js';
export function initializeAlertFormControls(form,onChange){
  const choices=initializeFormChoices(form),slider=form.querySelector('#alert-multiplier-slider'),input=form.elements.updateEvery;
  slider.min=MIN_ALERT_MULTIPLIER;slider.max=MAX_ALERT_MULTIPLIER;slider.step=ALERT_MULTIPLIER_STEP;
  const ticks=form.querySelector('#alert-multiplier-ticks');
  for(const value of [1,2,4,6,8,10,12]){
    const button=document.createElement('button');button.type='button';button.className='cadence-tick';button.dataset.multiplier=value;button.textContent=`${value}×`;button.style.left=`${(value-1)/11*100}%`;ticks.append(button);
  }
  function select(value){input.value=value;onChange();}
  slider.addEventListener('input',()=>select(Number(slider.value)));
  ticks.addEventListener('click',event=>{const button=event.target.closest('[data-multiplier]');if(button)select(Number(button.dataset.multiplier));});
  function sync(){
    choices.sync();
    for(const group of form.querySelectorAll('[data-choice-for]')){
      const select=form.elements[group.dataset.choiceFor];
      for(const button of group.querySelectorAll('[data-choice-value]')){
        const option=[...select.options].find(option=>option.value===button.dataset.choiceValue);
        if(option)button.textContent=option.textContent;
      }
    }
    const value=Number(input.value),preset=validAlertCadence(value)&&value<=MAX_ALERT_MULTIPLIER;
    input.step=document.body.classList.contains('test-mode')&&Number.isInteger(value)?'1':'0.5';
    slider.value=Number.isFinite(value)?Math.max(1,Math.min(12,Math.round(value*2)/2)):1;
    const label=validAlertCadence(value)?`${value}×${preset?'':t('（自定义）')}`:t('请选择记录倍率');
    form.querySelector('#alert-multiplier-value').textContent=label;slider.setAttribute('aria-valuetext',label);
    slider.style.setProperty('--multiplier-position',`${(Number(slider.value)-1)/11*100}%`);
    form.querySelector('#alert-custom-cadence').hidden=preset;
    for(const button of ticks.querySelectorAll('[data-multiplier]')){const selected=Number(button.dataset.multiplier)===value;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}
  }
  window.addEventListener('test-mode-change',sync);window.addEventListener('language-change',sync);sync();return {sync};
}

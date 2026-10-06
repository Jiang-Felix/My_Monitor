export function initializeFormChoices(form){
  const groups=[...form.querySelectorAll('[data-choice-for]')];
  for(const group of groups){
    const select=form.elements[group.dataset.choiceFor];
    for(const option of select.options){
      const button=document.createElement('button');button.type='button';button.className='choice-button';button.dataset.choiceValue=option.value;button.textContent=option.textContent;group.append(button);
    }
    group.addEventListener('click',event=>{
      const button=event.target.closest('[data-choice-value]');if(!button||button.disabled||select.disabled)return;
      select.value=button.dataset.choiceValue;select.dispatchEvent(new Event('change',{bubbles:true}));sync();
    });
    select.addEventListener('change',sync);
  }
  function sync(){
    for(const group of groups){
      const select=form.elements[group.dataset.choiceFor];
      for(const button of group.querySelectorAll('[data-choice-value]')){
        const selected=select.value===button.dataset.choiceValue,option=[...select.options].find(o=>o.value===button.dataset.choiceValue);
        if(option){button.textContent=option.textContent;button.title=option.textContent;}
        button.disabled=select.disabled||!option||option.disabled;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
      }
    }
  }
  sync();return {sync};
}

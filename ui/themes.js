import { THEMES,themeById } from '../core/themes.js';
import {t} from '../core/i18n.js';

let appliedTheme;
export function applyTheme(id) {
  const theme=themeById(id);
  if(appliedTheme!==theme.id){
    const root=document.documentElement;
    for(const [name,color] of Object.entries(theme.colors))root.style.setProperty(`--${name}`,color);
    root.style.colorScheme=theme.scheme;root.dataset.theme=theme.id;root.dataset.scheme=theme.scheme;
    appliedTheme=theme.id;
    try{localStorage.setItem('monitorTheme',theme.id);}catch{}
  }
  return theme;
}
export function initializeThemes(container,onChoose) {
  const buttons=THEMES.map(theme=>{
    const button=document.createElement('button');button.type='button';button.className='theme-option';button.dataset.theme=theme.id;
    const swatch=document.createElement('span');swatch.className='theme-swatch';swatch.setAttribute('aria-hidden','true');
    for(const name of ['bg','panel','blue','teal']){const color=document.createElement('span');color.style.backgroundColor=theme.colors[name];swatch.append(color);}
    const label=document.createElement('span');label.className='theme-name';
    const check=document.createElement('span');check.className='theme-check';check.textContent='✓';check.setAttribute('aria-hidden','true');
    button.append(swatch,label,check);button.addEventListener('click',()=>onChoose(theme.id));container.append(button);
    return {button,label,theme};
  });
  return {render(id,busy=false){
    const selected=themeById(id).id;
    for(const {button,label,theme} of buttons){
      const active=theme.id===selected;label.textContent=t(theme.name);button.title=t(theme.name);button.setAttribute('aria-label',t(theme.name));button.setAttribute('aria-pressed',String(active));button.classList.toggle('selected',active);button.disabled=busy;
    }
  }};
}

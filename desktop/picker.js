// Executed only inside a sandboxed remote page. It has no desktop bridge.
import { parseValue } from '../core/metrics.js';
import { t } from '../core/i18n.js';

export function pickerCopy() {
  const phrases=['拖动选取提示；方向键可移动','选择监控数值','收起','展开','开始选取','选取中','取消','先正常登录，并打开包含目标数值的页面。可拖动标题移动提示，或点击“收起”。准备好后点击“开始选取”，再点击一个数值。','请选择展示数值的文字元素，不能选择输入框。','点击需要监控的数值。蓝色边框表示当前元素。按 Esc 取消。','选取失败：{error}。请重新点击只包含一个数值的文字元素，或按 Esc 取消后设置固定数值。','没有可解析的数值','数值格式不明确，请选择只包含一个数值的元素','不支持此小数或千分位格式','数值超出范围'];
  return Object.fromEntries(phrases.map(phrase=>[phrase,t(phrase)]));
}

export function pickerScript() {
  return `(${installPicker.toString()})(${parseValue.toString()},${JSON.stringify(pickerCopy())})`;
}

function installPicker(parseValue, copy) {
  // Reinstallation in the same document must settle and remove the previous picker.
  document.dispatchEvent(new Event('__my_monitor_cancel_picker__'));
  return new Promise(resolve => {
    const text=phrase=>copy[phrase]||phrase;
    const host = document.createElement('div');
    host.id = '__my_monitor_picker__';
    host.style.cssText = 'position:fixed;top:16px;right:16px;width:min(300px,calc(100vw - 24px));z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      *{box-sizing:border-box}section{font:14px "Segoe UI","Microsoft YaHei UI",sans-serif;width:100%;max-height:calc(100vh - 24px);overflow:auto;background:#172b43;color:#f1f6fb;border:1px solid #648ab3;border-radius:12px;padding:18px;box-shadow:0 8px 40px #0005}
      header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;cursor:grab;touch-action:none;user-select:none}header:active{cursor:grabbing}header:focus-visible{outline:2px solid #b9d9f7;outline-offset:4px}strong{font-size:16px}p{line-height:1.6;color:#bed0e3;margin:0 0 14px}button{background:#b9d9f7;color:#142a43;border:0;border-radius:6px;padding:9px 12px;cursor:pointer;font:inherit}button+button{background:#30465f;color:#fff;margin-left:8px}#collapse{background:transparent;color:#bed0e3;font-size:12px;padding:4px}button:focus-visible{outline:2px solid #b9d9f7;outline-offset:3px}[hidden]{display:none!important}
    </style><section><header id="drag" tabindex="0" aria-label="拖动选取提示；方向键可移动"><strong>选择监控数值</strong><button id="collapse" aria-expanded="true">收起</button></header><p>先正常登录，并打开包含目标数值的页面。可拖动标题移动提示，或点击“收起”。准备好后点击“开始选取”，再点击一个数值。</p><button id="start">开始选取</button><button id="cancel">取消</button></section>`;
    document.documentElement.append(host);
    let active = false, hovered = null, previous = '', settled=false, dragging=null, message='intro',selectionError='';
    function localize() {
      root.querySelector('#drag').setAttribute('aria-label',text('拖动选取提示；方向键可移动'));
      root.querySelector('strong').textContent=text('选择监控数值');
      root.querySelector('#collapse').textContent=text(root.querySelector('p').hidden?'展开':'收起');
      root.querySelector('#start').textContent=text(active?'选取中':'开始选取');
      root.querySelector('#cancel').textContent=text('取消');
      const paragraph=root.querySelector('p');
      paragraph.textContent=message==='input'?text('请选择展示数值的文字元素，不能选择输入框。'):message==='failure'?text('选取失败：{error}。请重新点击只包含一个数值的文字元素，或按 Esc 取消后设置固定数值。').replace('{error}',text(selectionError)):message==='active'?text('点击需要监控的数值。蓝色边框表示当前元素。按 Esc 取消。'):text('先正常登录，并打开包含目标数值的页面。可拖动标题移动提示，或点击“收起”。准备好后点击“开始选取”，再点击一个数值。');
    }
    const languageChanged=event=>{if(event.detail&&typeof event.detail==='object'){copy=event.detail;localize();}};
    document.addEventListener('__my_monitor_language__',languageChanged);localize();
    const place=(x,y)=>{
      const rect=host.getBoundingClientRect();host.style.right='auto';
      host.style.left=`${Math.max(12,Math.min(x,innerWidth-rect.width-12))}px`;
      host.style.top=`${Math.max(12,Math.min(y,innerHeight-rect.height-12))}px`;
    };
    const fit=()=>{const rect=host.getBoundingClientRect();place(rect.x,rect.y);};
    const fold=collapsed=>{root.querySelector('p').hidden=collapsed;root.querySelector('#collapse').textContent=text(collapsed?'展开':'收起');root.querySelector('#collapse').setAttribute('aria-expanded',String(!collapsed));fit();};
    const drag=root.querySelector('#drag');
    drag.addEventListener('pointerdown',event=>{
      if(event.target.closest('button')||event.button!==0)return;
      const rect=host.getBoundingClientRect();dragging={id:event.pointerId,x:event.clientX-rect.x,y:event.clientY-rect.y};drag.setPointerCapture(event.pointerId);event.preventDefault();
    });
    drag.addEventListener('pointermove',event=>{if(dragging&&dragging.id===event.pointerId)place(event.clientX-dragging.x,event.clientY-dragging.y);});
    const endDrag=()=>{dragging=null;};drag.addEventListener('pointerup',endDrag);drag.addEventListener('pointercancel',endDrag);drag.addEventListener('lostpointercapture',endDrag);
    drag.addEventListener('keydown',event=>{const steps={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]};if(!steps[event.key]||event.target!==drag)return;event.preventDefault();event.stopPropagation();const rect=host.getBoundingClientRect();place(rect.x+steps[event.key][0],rect.y+steps[event.key][1]);});
    root.querySelector('#collapse').addEventListener('click',event=>{event.preventDefault();fold(!root.querySelector('p').hidden);});
    root.addEventListener('click',event=>event.stopPropagation());
    const observer=new ResizeObserver(fit);observer.observe(host);window.addEventListener('resize',fit);
    const restore = () => { if (hovered) hovered.style.outline = previous; hovered = null; };
    const cleanup = () => {
      restore(); host.remove();
      document.removeEventListener('mouseover', hover, true);
      document.removeEventListener('click', choose, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('__my_monitor_language__',languageChanged);
      document.removeEventListener('__my_monitor_cancel_picker__',cancelPicker);
      observer.disconnect();window.removeEventListener('resize',fit);
    };
    const done = value => { if(settled)return;settled=true;cleanup();resolve(value); };
    const cancelPicker=()=>done(null);
    document.addEventListener('__my_monitor_cancel_picker__',cancelPicker,{once:true});
    const hover = event => {
      if (!active || event.composedPath().includes(host)) return;
      restore(); hovered = event.target; previous = hovered.style.outline;
      hovered.style.outline = '2px solid #318cdd';
    };
    const selectorFor = element => {
      if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
      const parts = [];
      let node = element;
      while (node && node.nodeType === 1) {
        const tag = node.localName;
        const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.localName === tag) : [node];
        parts.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
        const candidate = parts.join(' > ');
        if (document.querySelectorAll(candidate).length === 1) return candidate;
        node = node.parentElement;
      }
      return parts.join(' > ');
    };
    const choose = event => {
      if (!active || event.composedPath().includes(host)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const element = event.target;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) { message='input';localize();fold(false);return; }
      const raw = (element.innerText || element.textContent || '').trim().slice(0, 500);
      try { parseValue(raw); }
      catch (failure) { message='failure';selectionError=failure.message;localize();fold(false);return; }
      done({ url: location.href, selector: selectorFor(element), raw });
    };
    const key = event => { if (event.key === 'Escape') {event.preventDefault();event.stopImmediatePropagation();done(null);} };
    root.querySelector('#start').addEventListener('click',event=>{event.preventDefault();active=true;message='active';localize();fold(true);});
    root.querySelector('#cancel').addEventListener('click',event=>{event.preventDefault();done(null);});
    document.addEventListener('mouseover', hover, true);
    document.addEventListener('click', choose, true);
    document.addEventListener('keydown', key, true);
  });
}

export function readScript(selector, totalSelector) {
  return `(${readValues.toString()})(${JSON.stringify(selector)},${JSON.stringify(totalSelector || '')})`;
}

function readValues(selector, totalSelector) {
  try {
    const read = (selector, label) => {
      if (!selector) return null;
      let elements;
      try { elements = document.querySelectorAll(selector); }
      catch { throw { error: `${label}选择器格式无效，请通过“网页选取”重新选择，或改为固定数值`, code: 'locator', terminal: true }; }
      if (elements.length !== 1) {
        const auth = /login|sign.?in|auth/i.test(location.pathname) || !!document.querySelector('input[type=password]');
        throw { error: elements.length ? `${label}选择器匹配到多个元素（${elements.length} 个），请重新选取唯一的数值元素` : `${label}找不到目标元素，请检查登录状态或重新选取`, code: auth ? 'auth' : 'locator' };
      }
      return (elements[0].innerText || elements[0].textContent || '').trim().slice(0, 500);
    };
    return { value: read(selector, '当前量'), total: read(totalSelector, '总量') };
  } catch (failure) { return failure; }
}

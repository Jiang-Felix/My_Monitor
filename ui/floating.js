import { validateFloatingSettings } from '../core/floating-settings.js';
import { applyFloatingStyle, createFloatingRow, renderFloatingRow } from './floating-row.js';
import { t, setLanguage, getLanguage } from '../core/i18n.js';

const api = window.monitor;
const rows = document.querySelector('#floating-rows');
const tracks = new Map();
let latest;
function render(state) {
  latest=state;
  const {sources,floatingSettings}=state;
  if(state.language)setLanguage(state.language);
  document.documentElement.lang=getLanguage();document.title=`My Monitor · ${t('浮窗')}`;
  document.querySelector('.floating-panel').setAttribute('aria-label',t('资源进度'));
  const settings = validateFloatingSettings(floatingSettings);
  applyFloatingStyle(document.documentElement, settings);
  const present = new Set();
  for (const source of sources) {
    present.add(source.id);
    let row = tracks.get(source.id);
    if (!row) { row = createFloatingRow(document, source); tracks.set(source.id, row); }
    renderFloatingRow(row, source, settings); rows.append(row);
  }
  for (const [id, row] of tracks) if (!present.has(id)) { row.remove(); tracks.delete(id); }
  rows.querySelector('.floating-placeholder')?.remove();
  if (!sources.length) {
    const placeholder = document.createElement('div'); placeholder.className = 'floating-track floating-placeholder';
    placeholder.setAttribute('aria-label', t('尚未添加数据源')); rows.append(placeholder);
  }
}
window.addEventListener('language-change',()=>{if(latest)render({...latest,language:undefined});});
api.onUpdate(render);
void api.snapshot().then(result => { if (result.ok) render(result.data); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.floating(false); });
document.addEventListener('contextmenu', event => event.preventDefault());

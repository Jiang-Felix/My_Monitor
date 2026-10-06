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
  const present = new Set(sources.map(source => source.id));
  for (const [id, row] of tracks) if (!present.has(id)) { row.remove(); tracks.delete(id); }
  if (sources.length) rows.querySelector('.floating-placeholder')?.remove();
  for (const [index, source] of sources.entries()) {
    let row = tracks.get(source.id);
    if (!row) { row = createFloatingRow(document, source); tracks.set(source.id, row); }
    // Keep live rows attached during value updates: reparenting animated rows
    // invalidates their layout and the transparent window's composited surface.
    if (rows.children[index] !== row) rows.insertBefore(row, rows.children[index] || null);
    renderFloatingRow(row, source, settings);
  }
  if (!sources.length) {
    let placeholder = rows.querySelector('.floating-placeholder');
    if (!placeholder) {
      placeholder = document.createElement('div'); placeholder.className = 'floating-track floating-placeholder';
      rows.append(placeholder);
    }
    placeholder.setAttribute('aria-label', t('尚未添加数据源'));
  }
}
window.addEventListener('language-change',()=>{if(latest)render({...latest,language:undefined});});
api.onUpdate(render);
void api.snapshot().then(result => { if (result.ok) render(result.data); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') void api.floating(false); });
document.addEventListener('contextmenu', event => event.preventDefault());

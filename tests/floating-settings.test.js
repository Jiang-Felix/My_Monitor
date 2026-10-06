import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { progress } from '../core/metrics.js';
import { applyFloatingStyle, createFloatingRow, renderFloatingRow } from '../ui/floating-row.js';
import {t,setLanguage,getLanguage} from '../core/i18n.js';

const load = () => import('../core/floating-settings.js');

test('missing and partial settings use the visible 20 by 300 default and preserve explicit off choices', async () => {
  const { DEFAULT_FLOATING_SETTINGS, validateFloatingSettings } = await load();
  const expected = { backgroundColor: '#74767a', backgroundOpacity: 0.62, trackColor: '#141517', fillColor: '#fafafa', barHeight: 20, barWidth: 300, showName: true, showAmount: true, showPercent: true, showDeltaBand: true, showDeltaValue: true, showSmooth: true, increaseColor: '#34c779', decreaseColor: '#ef5261', showUnit: true, showTotal: true, showZeroDelta: false, textAlign:'distributed' };
  assert.deepEqual(DEFAULT_FLOATING_SETTINGS, expected);
  assert.deepEqual(validateFloatingSettings(), expected);
  assert.deepEqual(validateFloatingSettings({ showName: true }), { ...expected, showName: true });
  assert.equal(validateFloatingSettings({showSmooth:true}).showSmooth,true);
  assert.equal(validateFloatingSettings({showSmooth:false}).showSmooth,false,'explicitly saved preference is preserved');
  assert.deepEqual(validateFloatingSettings({showName:false,showAmount:false,showTotal:false,showUnit:false,showPercent:false,showSmooth:false,showDeltaBand:false,showDeltaValue:false}),{...expected,showName:false,showAmount:false,showTotal:false,showUnit:false,showPercent:false,showSmooth:false,showDeltaBand:false,showDeltaValue:false});
  assert.throws(()=>validateFloatingSettings({showSmooth:1}));
});

test('renderer keeps default bars and safely renders optional labels and retained samples', async () => {
  const { validateFloatingSettings, DEFAULT_FLOATING_SETTINGS } = await load();
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.style = { setProperty(key, value) { this[key] = value; } }; this.attributes = {}; this.insertions = 0; }
    append(...children) { for (const child of children) this.insertBefore(child, null); }
    insertBefore(child, before) { if (child === before) return; child.remove(); child.parent = this; this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child); this.insertions++; }
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; } }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    querySelector(selector) { return this.children.find(child => child.className?.includes(selector.slice(1))) || this.children.map(child => child.querySelector(selector)).find(Boolean); }
    get textContent() { return this.children.length ? this.children.map(c=>c.textContent).join('') : this._text || ''; }
    set textContent(value) { this._text=value; this.children=[]; }
    get firstElementChild() { return this.children[0]; }
  }
  const rows = new Element(); const root = new Element(); const panel=new Element();let update,languageChange;
  const document={documentElement:root,querySelector:selector=>selector==='.floating-panel'?panel:rows,createElement:()=>new Element(),addEventListener(){}};
  const api = { onUpdate(fn) { update = fn; }, snapshot: async () => ({ ok: false }) };
  const script = (await readFile(new URL('../ui/floating.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(script, { window: { monitor: api,addEventListener(event,callback){if(event==='language-change')languageChange=callback;} }, document, progress, validateFloatingSettings, DEFAULT_FLOATING_SETTINGS, applyFloatingStyle, createFloatingRow, renderFloatingRow,t,setLanguage,getLanguage });
  const source = { id: '1', name: '😀<script>', sample: { value: 25, total: 100 }, stale: true };
  update({ sources: [source] });
  let track = rows.querySelector('.floating-track');
  assert.equal(track.dataset.id, '1');
  assert.equal(track.querySelector('.floating-fill').style.width, '25%');
  assert.equal(rows.querySelector('.floating-name').hidden, false);
  assert.equal(rows.querySelector('.floating-amount').hidden, false);
  assert.equal(rows.querySelector('.floating-percent').hidden, false);
  assert.equal(root.style['--bar-width'], '300px');
  update({ sources: [source], floatingSettings: { showName: true, showAmount: true, showPercent: true, barHeight: 48 } });
  assert.equal(rows.querySelector('.floating-name').textContent, '😀');
  assert.equal(rows.querySelector('.floating-amount').textContent, '25/100');
  assert.equal(rows.querySelector('.floating-percent').textContent, '25%');
  assert.match(track.attributes['aria-valuetext'], /上次有效值/);
  assert.equal(root.style['--bar-height'], '48px');
  setLanguage('en');
  try{
    languageChange();
    assert.equal(rows.querySelector('.floating-track'),track,'language changes retain the existing track');
    assert.equal(rows.querySelector('.floating-name').textContent,'😀','user labels remain unchanged');
    assert.match(track.attributes['aria-valuetext'],/Last valid reading/);
    assert.equal(document.title,'My Monitor · Floating window');
    assert.equal(root.lang,'en');
    assert.equal(panel.attributes['aria-label'],'Live data progress');
  }finally{setLanguage('zh-CN');languageChange();}
  update({ sources: [{ ...source, sample: { value: 42, total: null } }], floatingSettings: { showAmount: true, showPercent: true } });
  assert.equal(rows.querySelector('.floating-amount').textContent, '42');
  assert.equal(rows.querySelector('.floating-percent').textContent, '--');
  update({ sources: [{ ...source, sample: null }], floatingSettings: { showAmount: true } });
  assert.equal(rows.querySelector('.floating-amount').textContent, '--');
  assert.equal(rows.insertions,1,'numeric, settings and language updates never detach existing rows');
  const first=rows.children[0],second={...source,id:'2'},third={...source,id:'3'};
  update({sources:[source,second,third]});
  const secondRow=rows.children[1],thirdRow=rows.children[2];
  update({sources:[third,source,second]});
  assert.deepEqual(rows.children,[thirdRow,first,secondRow],'real source reordering preserves the same row objects');
  update({sources:[third,second]});
  assert.deepEqual(rows.children,[thirdRow,secondRow],'removing a source leaves other rows intact');
  update({sources:[]});const placeholder=rows.children[0],insertions=rows.insertions;
  update({sources:[]});assert.equal(rows.children[0],placeholder);assert.equal(rows.insertions,insertions,'empty updates keep one stable placeholder');
  update({sources:[source]});assert.equal(rows.children.length,1);assert.equal(rows.children[0].querySelector('.floating-track').dataset.id,'1');
});

test('numeric form strings and valid boundary values are accepted', async () => {
  const { validateFloatingSettings } = await load();
  assert.equal(validateFloatingSettings({ backgroundOpacity: '0.05', barHeight: '16', barWidth: '640' }).barWidth, 640);
  assert.equal(validateFloatingSettings({ backgroundOpacity: 1, barHeight: 80, barWidth: 120, fillColor: '#ABCDEF' }).fillColor, '#ABCDEF');
});

test('invalid types, ranges, unsafe colors and unknown fields are rejected', async () => {
  const { validateFloatingSettings } = await load();
  for (const input of [null, [], 'x', { extra: true }, { increaseColor:'rgba(1,2,3,.5)' }, { decreaseColor:'#fff' }, { showDeltaBand:'true' }, { showDeltaValue:1 }, { showUnit:null }, { showTotal:'false' }, { fillColor: 'red' }, { trackColor: '#fff' }, { backgroundColor: '#ffffff;display:none' }, { showName: 'true' }, { showAmount: 1 }, { showPercent: null }, { barWidth: '' }, { barHeight: ' ' }, { barWidth: true }, { barHeight: NaN }, { backgroundOpacity: Infinity }, { backgroundOpacity: 0.049 }, { backgroundOpacity: 1.01 }, { barHeight: 3 }, { barHeight: 81 }, { barHeight: 20.5 }, { barWidth: 119 }, { barWidth: 641 }, { barWidth: '12px' }]) {
    assert.throws(() => validateFloatingSettings(input), undefined, JSON.stringify(input));
  }
});

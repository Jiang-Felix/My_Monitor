import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, t } from '../core/i18n.js';
import { initializeSourceCadence } from '../ui/source-cadence.js';
import { initializeFormChoices } from '../ui/form-choices.js';

function element() {
  const attributes = {}, listeners = {}, classes = new Set();
  return {
    dataset: {}, style: {}, textContent: '', hidden: false,
    attributes, listeners,
    classList: { toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    addEventListener(name, listener) { listeners[name] = listener; },
    setAttribute(name, value) { attributes[name] = value; },
  };
}

test('cadence language refresh preserves the dirty interval and selected website update mode', () => {
  const originalDocument = globalThis.document;
  const nodes = Object.fromEntries(['cadence-controls', 'cadence-slider', 'cadence-ticks', 'cadence-value', 'cadence-legend', 'cadence-status', 'cadence-hint', 'cadence-custom-note'].map(id => [id, element()]));
  const ticks = Array.from({ length: 11 }, (_, index) => ({ ...element(), dataset: { cadenceIndex: String(index) } }));
  nodes['cadence-ticks'].querySelectorAll = () => ticks;
  const form = { elements: { interval: { value: '17' }, webUpdateMode: { value: 'reload' } } };
  globalThis.document = { querySelector: selector => nodes[selector.slice(1)] };
  try {
    setLanguage('zh-CN');
    const cadence = initializeSourceCadence({ form, needsWeb: () => true, isTestMode: () => false, onChange: () => assert.fail('Translation must not dispatch input changes') });
    const originalValues = JSON.stringify(form.elements);
    setLanguage('en'); cadence.refresh();
    assert.equal(JSON.stringify(form.elements), originalValues);
    assert.equal(nodes['cadence-value'].textContent, '17 seconds (custom)');
    assert.equal(nodes['cadence-status'].textContent, 'Reload page on a schedule');
    assert.equal(ticks[0].attributes.title, 'Update every 1 second');
    assert.equal(ticks[0].attributes['aria-label'], 'Update every 1 second');
    setLanguage('zh-CN'); cadence.refresh();
    assert.equal(nodes['cadence-value'].textContent, '17秒（自定义）');
    assert.equal(form.elements.webUpdateMode.value, 'reload');
  } finally { globalThis.document = originalDocument; setLanguage('zh-CN'); }
});

test('choice language refresh retains the selected value and disabled options', () => {
  const originalDocument = globalThis.document;
  const group = { ...element(), dataset: { choiceFor: 'totalMode' }, buttons: [], append(button) { this.buttons.push(button); }, querySelectorAll() { return this.buttons; } };
  const select = { ...element(), value: 'fixed', disabled: false, options: [{ value: 'none', textContent: '不设置总量数据' }, { value: 'web', textContent: '网页选取', disabled: true }, { value: 'fixed', textContent: '固定数值' }] };
  const form = { querySelectorAll: () => [group], elements: { totalMode: select } };
  globalThis.document = { createElement: () => element() };
  try {
    setLanguage('zh-CN');
    const choices = initializeFormChoices(form);
    const originalLabels = select.options.map(option => option.textContent);
    setLanguage('en');
    select.options.forEach((option, index) => { option.textContent = t(originalLabels[index]); });
    choices.sync();
    assert.equal(select.value, 'fixed');
    assert.equal(group.buttons[2].textContent, 'Fixed value');
    assert.equal(group.buttons[2].attributes['aria-pressed'], 'true');
    assert.equal(group.buttons[1].disabled, true);
    setLanguage('zh-CN');
    select.options.forEach((option, index) => { option.textContent = originalLabels[index]; });
    choices.sync();
    assert.equal(group.buttons[2].textContent, '固定数值');
    assert.equal(select.value, 'fixed');
  } finally { globalThis.document = originalDocument; setLanguage('zh-CN'); }
});

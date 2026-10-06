import test from 'node:test';
import assert from 'node:assert/strict';
import {t,setLanguage,getLanguage,localeCode,translateMessage,normalizeTerms} from '../core/i18n.js';

test('language defaults to Chinese, validates the supported choices and unifies legacy terms',()=>{
  setLanguage('zh-CN');
  assert.equal(getLanguage(),'zh-CN');assert.equal(localeCode(),'zh-CN');
  assert.equal(normalizeTerms('当前量 / 总量 / 悬浮窗 / 检查点'),'实时数据 / 总量数据 / 浮窗 / 记录');
  assert.equal(normalizeTerms('总量数据'),'总量数据');
  assert.throws(()=>setLanguage('fr'));assert.equal(getLanguage(),'zh-CN');
  setLanguage('en');assert.equal(localeCode(),'en-US');assert.equal(t('总量'),'Total data');
  setLanguage('zh-CN');
});

test('translated validation templates preserve values and field paths and translate nested causes',()=>{
  assert.equal(translateMessage('实时数据读取失败：没有可解析的数值。请修改配置或重新选取数值元素','en'),'Could not read Live data: No readable numeric value. Edit the settings or select the value again.');
  assert.equal(translateMessage('找不到字段 data.balance','en'),'Field not found: data.balance');
  const range=translateMessage('当前量 120 GB 大于总量 100 GB，请检查选取元素、固定数值及单位是否一致','en');
  assert.match(range,/Live data 120 GB exceeds total data 100 GB/);
  assert.doesNotMatch(range,/\p{Script=Han}/u);
});

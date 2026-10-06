import test from 'node:test';
import assert from 'node:assert/strict';
import {frequencyText} from '../ui/alert-frequency.js';
test('update-count frequency converts source cadence to seconds, mixed minutes, hours and days',()=>{
  for(const [n,interval,expected] of [[1,1,'1秒'],[3,30,'1分钟30秒'],[60,60,'1小时'],[24,3600,'1天']])assert.match(frequencyText(n,interval),new RegExp(expected));
  assert.match(frequencyText(3,60),/3分钟/);assert.match(frequencyText(3,1),/3秒/);
  for(const [n,interval] of [[0,60],[1.25,60],[1,undefined]])assert.match(frequencyText(n,interval),/有效/);
});
test('half-step frequency preserves fractional seconds and mixed real time units',()=>{
  assert.match(frequencyText(1.5,1),/1\.5秒/);
  assert.match(frequencyText(1.5,60),/1分钟30秒/);
  assert.match(frequencyText(2.5,30),/1分钟15秒/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFloatingSettings,DEFAULT_FLOATING_SETTINGS,floatingRowHeight} from '../core/floating-settings.js';
import {floatingPresentation} from '../ui/floating-view.js';

test('thin bars remain readable when text is enabled and side labels keep their own height',()=>{
  const noText={showAmount:false,showDeltaValue:false,showName:false,showPercent:false};
  assert.equal(validateFloatingSettings({...noText,barHeight:4}).barHeight,4);
  for(const key of ['showAmount','showDeltaValue'])assert.equal(validateFloatingSettings({...noText,barHeight:4,[key]:true}).barHeight,16);
  assert.equal(floatingRowHeight(validateFloatingSettings({...noText,barHeight:4,showPercent:true})),16);
  assert.equal(floatingRowHeight(validateFloatingSettings({...noText,barHeight:4})),4);
  assert.equal(DEFAULT_FLOATING_SETTINGS.textAlign,'distributed');
  for(const textAlign of ['left','center','right','distributed'])assert.equal(validateFloatingSettings({textAlign}).textAlign,textAlign);
  assert.throws(()=>validateFloatingSettings({textAlign:'justify'}));
  assert.throws(()=>validateFloatingSettings({barHeight:3}));
});
test('zero change is hidden by default without hiding a retained band; its switch only affects text',()=>{
  const settings=validateFloatingSettings({showAmount:true,showDeltaValue:true,showDeltaBand:true});
  const source={status:'ok',enabled:true,sample:{value:75,total:100},change:{previousValue:75,previousTotal:100,delta:0,intervalSeconds:60},recentChange:{previousValue:50,previousTotal:100,currentValue:75,currentTotal:100,delta:25,intervalSeconds:60}};
  assert.equal(DEFAULT_FLOATING_SETTINGS.showZeroDelta,false);
  const hidden=floatingPresentation(source,settings);
  assert.equal(hidden.text,'75/100');
  assert.equal(hidden.displayDelta,'');
  assert.ok(hidden.band);
  assert.equal(floatingPresentation(source,{...settings,showAmount:false}).text,'');
  assert.equal(floatingPresentation(source,{...settings,showZeroDelta:true}).text,'75/100  +0/1分钟');
  assert.equal(floatingPresentation(source,{...settings,showDeltaValue:false,showZeroDelta:true}).text,'75/100');
  assert.equal(floatingPresentation({...source,change:{...source.change,delta:-0.25}},settings).text,'75/100  -0.25/1分钟');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSource,validateUrl} from '../core/config.js';
test('URLs and field paths have finite bounds before parsing, and identifiers and switches keep their types',()=>{
  assert.throws(()=>validateUrl('https://example.com/'+ 'a'.repeat(9000)),/网址/);
  const input={id:'safe',name:'Fixture',kind:'http',url:'https://example.com',valuePath:'value',interval:60};
  assert.throws(()=>validateSource({...input,valuePath:'a'.repeat(3000)}),/路径/);
  assert.throws(()=>validateSource({...input,id:123}),/标识/);
  assert.throws(()=>validateSource({...input,enabled:'false'}),/开关/);
});

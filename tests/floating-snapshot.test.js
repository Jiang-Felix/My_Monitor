import test from 'node:test';
import assert from 'node:assert/strict';
import {floatingSnapshot} from '../core/floating-snapshot.js';
import {floatingPresentation} from '../ui/floating-view.js';
import {DEFAULT_FLOATING_SETTINGS} from '../core/floating-settings.js';
test('floating payload retains every display field while omitting account and editor data',()=>{
  const source={id:'reading',name:'Reading',unit:'GB',enabled:true,status:'ok',failed:false,stale:false,sample:{value:50,total:100},change:{previousValue:40,previousTotal:100,delta:10,intervalSeconds:1},recentChange:{previousValue:40,previousTotal:100,currentValue:50,currentTotal:100,delta:10,intervalSeconds:1},url:'https://example.com/account?token=secret',selector:'#secret',hasToken:true,lastSuccess:123};
  const payload=floatingSnapshot([source],DEFAULT_FLOATING_SETTINGS,'en');
  assert.equal(payload.language,'en');assert.equal(payload.floatingSettings,DEFAULT_FLOATING_SETTINGS);
  assert.deepEqual(floatingPresentation(payload.sources[0],DEFAULT_FLOATING_SETTINGS),floatingPresentation(source,DEFAULT_FLOATING_SETTINGS));
  for(const key of ['url','selector','hasToken','lastSuccess'])assert.equal(Object.hasOwn(payload.sources[0],key),false);
  assert.equal(JSON.stringify(payload).includes('secret'),false);
});

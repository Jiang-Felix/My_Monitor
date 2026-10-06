import test from 'node:test';
import assert from 'node:assert/strict';
const {alertCategory}=await import('../core/alert-status.js').catch(()=>({}));
test('running notifications classify active or silent while stopped and blocked detection classify paused',()=>{
  const now=1000,rule={enabled:true,notificationsEnabled:true};
  const source={enabled:true,status:'ok',lastSuccess:now,interval:60,sample:{value:2,total:null}};
  assert.equal(typeof alertCategory,'function');
  assert.equal(alertCategory(rule,source,{outside:true},now),'active','a real outside value is still a healthy detection');
  assert.equal(alertCategory({...rule,notificationsEnabled:false},source,{},now),'silent');
  for(const [r,s,t,blocked] of [[{...rule,enabled:false},source,{}],[rule,{...source,enabled:false},{}],[rule,{...source,status:'network',failed:true},{}],[rule,source,{error:'overflow'}],[rule,undefined,{}],[rule,source,{},true],[rule,{...source,lastSuccess:now-121000},{}]])assert.equal(alertCategory(r,s,t,now,blocked),'paused');
  assert.equal(alertCategory(rule,{...source,status:'refreshing'},{},now),'active');
});

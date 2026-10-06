import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {NotificationBatch} from '../core/notification-batch.js';
import {t,localeCode} from '../core/i18n.js';

async function fixture(){
  class FakeNotification extends EventEmitter{
    static instances=[];static isSupported(){return true;}
    constructor(options){super();this.options=options;FakeNotification.instances.push(this);}
    show(){this.emit('show');}close(){this.emit('close');}
  }
  const source=await readFile(new URL('../desktop/notifications.js',import.meta.url),'utf8');
  const context={Notification:FakeNotification,NotificationBatch,t,localeCode,setTimeout,clearTimeout,process,console};vm.createContext(context);
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace('export class DesktopNotifications','class DesktopNotifications')+'\nthis.Service=DesktopNotifications;',context);
  return {Service:context.Service,Notification:FakeNotification};
}
test('desktop notifications batch receipts, bound native objects and release timers',async()=>{
  const {Service,Notification}=await fixture();const receipts=[];const service=new Service({onDelivery:(...args)=>receipts.push(args)});
  for(let i=0;i<100;i++)service.send({id:String(i),name:'Synthetic',sourceName:'Local',time:1000,type:'value',upper:0,value:1,measurement:1});
  assert.equal(Notification.instances.length,0);service.batch.flush();assert.equal(Notification.instances.length,1);
  assert.equal(receipts.filter(([,status])=>status==='shown').length,100);
  for(let i=0;i<5;i++){service.send({id:`single-${i}`,name:'Synthetic',type:'value',upper:0,value:1,measurement:1});service.batch.flush();}
  assert.equal(service.active.size,3);assert.equal(service.lifetimes.size,3);service.dispose();assert.equal(service.active.size,0);assert.equal(service.lifetimes.size,0);
});
test('isolated smoke notification tests never create an OS notification',async()=>{
  const {Service,Notification}=await fixture();const service=new Service({enabled:false});
  const result=await service.test();assert.equal(result.delivery,'test');assert.equal(Notification.instances.length,0);service.dispose();
});

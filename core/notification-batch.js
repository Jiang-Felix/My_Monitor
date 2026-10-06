// Summaries bound OS toast work; the alert engine still records every checkpoint.
export class NotificationBatch {
  constructor({delayMs=2000,maxItems=200,maxRules=100,onBatch=()=>{}}={}) {
    this.delayMs=delayMs;this.maxItems=maxItems;this.maxRules=maxRules;this.onBatch=onBatch;this.items=[];this.latestByRule=new Map();this.count=0;this.timer=null;this.closed=false;
  }
  get size(){return this.items.length;}
  push(item){
    if(this.closed)return;
    this.count++;this.items.push(item);
    if(item.ruleId){
      if(!this.latestByRule.has(item.ruleId)&&this.latestByRule.size>=this.maxRules)this.latestByRule.delete(this.latestByRule.keys().next().value);
      this.latestByRule.set(item.ruleId,item);
    }
    if(this.items.length>this.maxItems)this.items.splice(0,this.items.length-this.maxItems);
    if(!this.timer)this.timer=setTimeout(()=>this.flush(),this.delayMs);
  }
  flush(){
    clearTimeout(this.timer);this.timer=null;
    if(!this.count||this.closed)return;
    const recentIds=new Set(this.items.map(item=>item.id));
    const extras=[...this.latestByRule.values()].filter(item=>!recentIds.has(item.id));
    const batch={items:[...extras,...this.items],count:this.count};this.items=[];this.latestByRule.clear();this.count=0;
    this.onBatch(batch);
  }
  dispose(){this.closed=true;clearTimeout(this.timer);this.timer=null;this.items=[];this.latestByRule.clear();this.count=0;}
}

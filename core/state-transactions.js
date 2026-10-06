// Persist the candidate before touching live state. All configuration edits share this queue.
export class StateTransactions {
  constructor({write,timeoutMs=8000,maxPending=32,onBusy=()=>{},onUncertain=()=>{}}) {
    this.write=write;this.timeoutMs=timeoutMs;this.maxPending=maxPending;this.onBusy=onBusy;
    this.queue=Promise.resolve();this.pending=0;this.closed=false;this.onUncertain=onUncertain;
  }
  run(prepare,activate,{persist=true}={}) {
    if(this.closed)return Promise.reject(new Error('软件正在退出，请稍后重试'));
    if(this.pending>=this.maxPending)return Promise.reject(new Error('保存操作繁忙，请稍后重试'));
    this.pending++;
    const task=this.queue.catch(()=>{}).then(async()=>{
      if(this.closed)throw new Error('软件正在退出，请稍后重试');
      this.onBusy(true);
      const controller=new AbortController();let timer,committing=false;
      this.activeController=controller;
      try {
        const candidate=prepare();
        if(persist)await Promise.race([
          Promise.resolve().then(()=>this.write(candidate,{signal:controller.signal,onCommitStart:()=>{committing=true;}})),
          new Promise((_resolve,reject)=>{timer=setTimeout(()=>{
            controller.abort();
            if(committing){this.closed=true;this.onUncertain();}
            reject(new Error(committing?'配置提交状态无法确认，已暂停监控和保存；请退出软件后检查磁盘并重新打开':'配置保存超时，原运行配置保持不变，请检查磁盘状态'));
          },this.timeoutMs);})
        ]);
        clearTimeout(timer);
        controller.signal.throwIfAborted();
        return await activate(candidate);
      }finally{clearTimeout(timer);this.activeController=null;this.onBusy(false);}
    }).finally(()=>{this.pending--;});
    this.queue=task;return task;
  }
  runExclusive(action){return this.run(()=>null,action,{persist:false});}
  close(){this.closed=true;this.activeController?.abort();}
}

export class SourceJobs {
  constructor() { this.pending = new Map(); }
  current(id) { return this.pending.get(id)?.promise; }
  run(id, config, job) {
    const previous = this.pending.get(id);
    if (previous?.config === config) return previous.promise;
    const promise = (previous ? previous.promise.catch(() => {}) : Promise.resolve()).then(job).finally(() => {
      if (this.pending.get(id)?.promise === promise) this.pending.delete(id);
    });
    this.pending.set(id, { config, promise });
    return promise;
  }
}

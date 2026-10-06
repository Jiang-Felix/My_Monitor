export class CheckpointWriter {
  constructor({ write, delayMs = 5000, onError = () => {} }) {
    this.write = write; this.delayMs = delayMs; this.onError = onError;
    this.dirty = false; this.timer = null; this.running = null;
  }
  schedule() {
    this.dirty = true;
    if (this.timer || this.running) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(this.onError); }, this.delayMs);
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.running) { await this.running; if (this.dirty) return this.flush(); return; }
    if (!this.dirty) return;
    this.dirty = false;
    const task = Promise.resolve().then(() => this.write());
    this.running = task;
    try { await task; }
    finally { this.running = null; if (this.dirty) this.schedule(); }
  }
}

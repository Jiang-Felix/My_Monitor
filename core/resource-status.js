import { validateSample } from './metrics.js';

export function resourceCategory(source, now = Date.now(), blocked = false) {
  if (source.enabled === false) return 'paused';
  if (blocked || source.failed || !['ok', 'refreshing'].includes(source.status) || !Number.isFinite(source.sample?.value) || !Number.isFinite(source.lastSuccess) || source.stale || now - source.lastSuccess > source.interval * 2000) return 'failed';
  if (source.sample.total != null && !Number.isFinite(source.sample.total)) return 'failed';
  try { validateSample(source.sample); } catch { return 'failed'; }
  return 'normal';
}

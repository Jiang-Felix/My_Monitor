export function selectToken(candidate, existing, stored = '', provided = '', clear = false) {
  if (clear) return '';
  if (typeof provided !== 'string') throw new Error('Token 必须是文本');
  if (provided.length > 16384) throw new Error('Token 太长');
  if (provided.trim()) return provided.trim();
  if (typeof stored !== 'string' || stored.length > 16384 || typeof existing?.url !== 'string' || typeof candidate?.url !== 'string') return '';
  try {
    const target = new URL(candidate.url), previous = new URL(existing.url);
    if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) return '';
    return target.origin === previous.origin ? stored : '';
  } catch { return ''; }
}

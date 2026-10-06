import { validateUrl } from './config.js';

export function safeWebNavigation(url, allowBlank = false) {
  try { validateUrl(url); return true; }
  catch { return allowBlank && url === 'about:blank'; }
}

export function canPickPage(url, sourceUrl) {
  return safeWebNavigation(url) && safeWebNavigation(sourceUrl) && new URL(url).hostname !== 'accounts.google.com' && new URL(url).origin === new URL(sourceUrl).origin;
}

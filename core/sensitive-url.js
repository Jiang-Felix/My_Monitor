const sensitiveNames = new Set([
  'token', 'accesstoken', 'idtoken', 'refreshtoken', 'authtoken', 'bearertoken',
  'authorization', 'auth', 'password', 'passwd', 'pwd', 'secret', 'clientsecret',
  'apikey', 'credential', 'credentials', 'sessiontoken', 'sessionid',
  'xamzsecuritytoken', 'xgoogsecuritytoken'
]);
const sensitive = name => sensitiveNames.has(name.toLowerCase().replace(/[-_\s]/g, ''));

function parts(input) {
  if (typeof input !== 'string') return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  const fragment = url.hash.slice(1), separator = fragment.indexOf('?');
  return { url, prefix: separator < 0 ? '' : fragment.slice(0, separator + 1), fragment: new URLSearchParams(separator < 0 ? fragment : fragment.slice(separator + 1)) };
}

export function hasSensitiveUrl(input) {
  const parsed = parts(input);
  return !!parsed && (!!parsed.url.username || !!parsed.url.password || [...parsed.url.searchParams.keys(), ...parsed.fragment.keys()].some(sensitive));
}

// Display only: retain the original URL in memory for navigation and encryption.
export function redactSensitiveUrl(input) {
  const parsed = parts(input);
  if (!parsed || !hasSensitiveUrl(input)) return input;
  const { url, fragment, prefix } = parsed;
  if (url.username) url.username = '[REDACTED]';
  if (url.password) url.password = '[REDACTED]';
  for (const key of [...url.searchParams.keys()]) if (sensitive(key)) url.searchParams.set(key, '[REDACTED]');
  let changedFragment = false;
  for (const key of [...fragment.keys()]) if (sensitive(key)) { fragment.set(key, '[REDACTED]'); changedFragment = true; }
  if (changedFragment) url.hash = `${prefix}${fragment}`;
  return url.href;
}

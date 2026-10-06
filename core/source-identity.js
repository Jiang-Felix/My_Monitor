import { createHash } from 'node:crypto';

// Older alert tracks stored serialized source URLs here. Keep identity comparisons
// stable without persisting a second copy of authentication parameters.
export function digestSourceIdentity(identity) {
  if (/^sha256:[a-f0-9]{64}$/.test(identity)) return identity;
  return `sha256:${createHash('sha256').update(identity).digest('hex')}`;
}

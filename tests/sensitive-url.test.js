import test from 'node:test';
import assert from 'node:assert/strict';

test('sensitive URL detection covers query and OAuth fragments without discarding business routes', async () => {
  const { hasSensitiveUrl, redactSensitiveUrl } = await import('../core/sensitive-url.js');
  for (const url of [
    'https://example.com/?access_token=FAKE-SECRET',
    'https://example.com/#id_token=FAKE-SECRET&state=normal',
    'https://example.com/#/dashboard?password=FAKE-SECRET&tab=usage',
    'https://example.com/?Authorization=FAKE-SECRET',
    'https://example.com/?api-key=FAKE-SECRET',
    'https://example.com/?X-Amz-Security-Token=FAKE-SECRET'
  ]) {
    assert.equal(hasSensitiveUrl(url), true, url);
    assert.ok(!redactSensitiveUrl(url).includes('FAKE-SECRET'));
  }
  for (const url of ['https://example.com/#/dashboard?tab=usage', 'https://example.com/?signature=legit&expires=123', 'https://example.com/?tokenCount=2', 'https://example.com/#section-token', 'broken']) {
    assert.equal(hasSensitiveUrl(url), false, url);
    assert.equal(redactSensitiveUrl(url), url);
  }
  assert.ok(redactSensitiveUrl('https://example.com/#/dashboard?token=FAKE-SECRET&tab=usage').includes('/dashboard?'));
});

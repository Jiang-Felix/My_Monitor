import test from 'node:test';
import assert from 'node:assert/strict';
import { safeWebNavigation, canPickPage } from '../core/web-navigation.js';

test('authentication popups allow HTTPS and blank bootstrap pages without allowing local code or files', () => {
  assert.equal(safeWebNavigation('https://accounts.google.com/o/oauth2/v2/auth'), true);
  assert.equal(safeWebNavigation('about:blank', true), true);
  assert.equal(safeWebNavigation('about:blank'), false);
  for (const url of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,test', 'http://accounts.google.com']) assert.equal(safeWebNavigation(url, true), false);
});
test('picker only runs on the requested site, never on the Google login page', () => {
  assert.equal(canPickPage('https://service.example/dashboard', 'https://service.example/login'), true);
  assert.equal(canPickPage('https://accounts.google.com/signin', 'https://service.example/login'), false);
  assert.equal(canPickPage('https://accounts.google.com/signin', 'https://accounts.google.com/signin'), false);
  assert.equal(canPickPage('about:blank', 'https://service.example'), false);
});

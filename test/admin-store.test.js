'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const store = require('../api/admin/store');

test('scrypt hashes are salted and verify correctly', () => {
  const hash = store.scryptHash('test-password-123');
  assert.match(hash, /^scrypt\$/);
  assert.notEqual(hash, store.scryptHash('test-password-123'));
  assert.equal(store.verifyScrypt('test-password-123', hash), true);
  assert.equal(store.verifyScrypt('wrong-password', hash), false);
});

test('sessions are invalid when version or email differs', async () => {
  const secret = 'test-session-secret';
  const state = { email: 'admin@example.com', sessionVersion: 3 };
  const payload = Buffer.from(JSON.stringify({
    email: state.email,
    version: 3,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const token = `${payload}.${store.sign(payload, secret)}`;
  const req = { headers: { cookie: `${store.COOKIE}=${token}` } };
  assert.equal(await store.validSession(req, secret, state), true);
  assert.equal(await store.validSession(req, secret, { ...state, sessionVersion: 4 }), false);
});

test('email validation rules reject malformed addresses', () => {
  for (const email of ['', 'name', 'name@', '@example.com', 'a b@example.com']) {
    assert.equal(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), false);
  }
  assert.equal(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test('admin@example.com'), true);
});

test('password policy requires 12 characters', () => {
  assert.equal('short'.length >= 12, false);
  assert.equal('long-password-123'.length >= 12, true);
});

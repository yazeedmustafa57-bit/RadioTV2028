'use strict';

const crypto = require('node:crypto');

const COOKIE = '__Host-novalive_admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function redisConfig() {
  const url = process.env.REDIS_URL || process.env.KV_REST_API_URL;
  if (!url) return null;
  if (process.env.KV_REST_API_URL) {
    return {
      kind: 'rest',
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    };
  }
  return { kind: 'url', url };
}

async function redisGet(key) {
  const c = redisConfig();
  if (!c) return null;
  if (c.kind === 'rest') {
    if (!c.token) throw new Error('Redis-Konfiguration unvollständig');
    const r = await fetch(`${c.url.replace(/\/$/, '')}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${c.token}` },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('Redis nicht erreichbar');
    const d = await r.json();
    return d.result == null ? null : d.result;
  }
  const r = await fetch('/noop', { cache: 'no-store' }).catch(() => null);
  void r;
  throw new Error('Für REDIS_URL wird ein Redis-REST-Adapter benötigt');
}

async function redisSet(key, value) {
  const c = redisConfig();
  if (!c) throw new Error('Redis ist nicht konfiguriert');
  if (c.kind === 'rest') {
    if (!c.token) throw new Error('Redis-Konfiguration unvollständig');
    const r = await fetch(`${c.url.replace(/\/$/, '')}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}` },
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('Redis-Schreiben fehlgeschlagen');
  } else {
    throw new Error('Für REDIS_URL wird ein Redis-REST-Adapter benötigt');
  }
}

function reply(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function getCookie(req) {
  const header = req.headers.cookie || '';
  const prefix = `${COOKIE}=`;
  const item = header.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  return item ? item.slice(prefix.length) : '';
}

function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  const derived = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('base64')}`;
}

function verifyScrypt(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const actual = crypto.scryptSync(password, parts[1], 64);
    const expected = Buffer.from(parts[2], 'base64');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function credentialState() {
  const envReset = String(process.env.ADMIN_RESET_VERSION || '');
  if (!redisConfig()) {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return null;
    return {
      email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
      password: process.env.ADMIN_PASSWORD,
      passwordHash: null,
      reset: envReset,
      sessionVersion: 0,
    };
  }
  const state = await redisGet('novalive:admin:credentials');
  const resetState = await redisGet('novalive:admin:reset-version').catch(() => null);
  if (!state || resetState !== envReset) {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return null;
    return {
      email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
      password: process.env.ADMIN_PASSWORD,
      passwordHash: null,
      reset: envReset,
      sessionVersion: 0,
    };
  }
  let parsed;
  try { parsed = typeof state === 'string' ? JSON.parse(state) : state; } catch { return null; }
  return {
    email: String(parsed.email || '').trim().toLowerCase(),
    passwordHash: parsed.passwordHash,
    password: null,
    reset: envReset,
    sessionVersion: Number.isInteger(parsed.sessionVersion) ? parsed.sessionVersion : 0,
  };
}

async function verifyPassword(password, state) {
  if (state.passwordHash) return verifyScrypt(password, state.passwordHash);
  return typeof state.password === 'string' && safeEqual(password, state.password);
}

async function validSession(req, secret, state) {
  const token = getCookie(req);
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(payload, secret))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.email === state.email && Number.isInteger(session.version) && session.version === state.sessionVersion && Number.isInteger(session.exp) && session.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

async function saveRedisCredentials(state) {
  const nextReset = String(process.env.ADMIN_RESET_VERSION || '');
  await redisSet('novalive:admin:reset-version', nextReset);
  await redisSet('novalive:admin:credentials', {
    email: state.email,
    passwordHash: state.passwordHash,
    sessionVersion: state.sessionVersion,
  });
}

async function ensureResetSeed(state) {
  if (!redisConfig()) return;
  const resetState = await redisGet('novalive:admin:reset-version').catch(() => null);
  if (resetState === state.reset && await redisGet('novalive:admin:credentials').catch(() => null)) return;
  await redisSet('novalive:admin:reset-version', state.reset);
}

module.exports = { COOKIE, SESSION_TTL_SECONDS, reply, safeEqual, sign, getCookie, scryptHash, verifyScrypt, credentialState, verifyPassword, validSession, saveRedisCredentials, ensureResetSeed, redisConfig };

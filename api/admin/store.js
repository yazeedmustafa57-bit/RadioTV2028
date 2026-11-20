'use strict';

const crypto = require('node:crypto');
const { get, put } = require('@vercel/blob');

const COOKIE = '__Host-novalive_admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const CREDENTIAL_PATH = 'novalive/admin/credentials.json';
const RESET_PATH = 'novalive/admin/reset-version.json';

function blobConfigAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function blobGet(pathname) {
  if (!blobConfigAvailable()) throw new Error('Blob-Konfiguration fehlt');
  try {
    const blob = await get(pathname, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
      useCache: false,
    });
    if (!blob) return null;
    return await blob.text();
  } catch (error) {
    if (error?.name === 'BlobNotFoundError' || /not found|404/i.test(error?.message || '') || error?.statusCode === 404) return null;
    throw error;
  }
}

async function blobSet(pathname, value) {
  if (!blobConfigAvailable()) throw new Error('Blob-Konfiguration fehlt');
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
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
  } catch { return false; }
}

function parseJson(raw) {
  if (raw == null) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

async function credentialState() {
  const envReset = String(process.env.ADMIN_RESET_VERSION || '');
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return null;

  // Login and signed sessions must remain independent of persistent storage.
  // If Blob is missing or unavailable, credentials come exclusively from env vars.
  if (!blobConfigAvailable()) {
    return {
      email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
      passwordHash: null,
      password: process.env.ADMIN_PASSWORD,
      reset: envReset,
      sessionVersion: 0,
      storageAvailable: false,
    };
  }

  let resetRaw;
  let credentialsRaw;
  try {
    resetRaw = await blobGet(RESET_PATH);
    credentialsRaw = await blobGet(CREDENTIAL_PATH);
  } catch {
    return {
      email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
      passwordHash: null,
      password: process.env.ADMIN_PASSWORD,
      reset: envReset,
      sessionVersion: 0,
      storageAvailable: false,
    };
  }
  const resetState = parseJson(resetRaw)?.reset;
  const parsed = parseJson(credentialsRaw);

  if (resetState === envReset && parsed && typeof parsed.passwordHash === 'string') {
    return {
      email: String(parsed.email || '').trim().toLowerCase(),
      passwordHash: parsed.passwordHash,
      password: null,
      reset: envReset,
      sessionVersion: Number.isInteger(parsed.sessionVersion) ? parsed.sessionVersion : 0,
      storageAvailable: true,
    };
  }

  const initialState = {
    email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
    passwordHash: scryptHash(process.env.ADMIN_PASSWORD),
    password: null,
    reset: envReset,
    sessionVersion: parsed && Number.isInteger(parsed.sessionVersion) ? parsed.sessionVersion + 1 : 0,
  };
  try {
    await saveBlobCredentials(initialState);
  } catch {
    return {
      email: process.env.ADMIN_EMAIL.trim().toLowerCase(),
      passwordHash: null,
      password: process.env.ADMIN_PASSWORD,
      reset: envReset,
      sessionVersion: 0,
      storageAvailable: false,
    };
  }
  initialState.storageAvailable = true;
  return initialState;
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

async function saveBlobCredentials(state) {
  const reset = String(process.env.ADMIN_RESET_VERSION || '');
  // Credential writes must remain atomic from the caller's perspective: publish
  // credentials first, then mark the reset version. The mismatch is deliberately
  // detected by credentialState(), which performs the emergency re-seed.
  await blobSet(CREDENTIAL_PATH, {
    email: state.email,
    passwordHash: state.passwordHash,
    sessionVersion: state.sessionVersion,
  });
  await blobSet(RESET_PATH, { reset });
}

async function ensureResetSeed(state) {
  if (!blobConfigAvailable()) return;
  const resetRaw = await blobGet(RESET_PATH);
  const resetState = parseJson(resetRaw)?.reset;
  const credentialsRaw = await blobGet(CREDENTIAL_PATH);
  if (resetState === state.reset && credentialsRaw) return;
  await blobSet(RESET_PATH, { reset: state.reset });
}

module.exports = { COOKIE, SESSION_TTL_SECONDS, reply, safeEqual, sign, getCookie, scryptHash, verifyScrypt, credentialState, verifyPassword, validSession, saveBlobCredentials, ensureResetSeed, blobConfigAvailable, blobGet, blobSet };

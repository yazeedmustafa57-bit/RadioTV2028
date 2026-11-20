'use strict';

const crypto = require('node:crypto');

const COOKIE = '__Host-novalive_admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

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

function validSession(req, secret, email) {
  const token = getCookie(req);
  const dot = token.lastIndexOf('.');
  if (dot < 1) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(payload, secret))) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.email === email && Number.isInteger(session.exp) && session.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

module.exports = function handler(req, res) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!adminEmail || !adminPassword || !secret) {
    return reply(res, 503, { ok: false, error: 'Admin-Anmeldung ist nicht konfiguriert.' });
  }

  if (req.method === 'GET') {
    return reply(res, 200, { ok: validSession(req, secret, adminEmail.trim().toLowerCase()) });
  }

  if (req.method === 'DELETE') {
    return reply(res, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return reply(res, 405, { ok: false, error: 'Methode nicht erlaubt.' });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' });
    } catch {
      return reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' });
    }
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const expectedEmail = adminEmail.trim().toLowerCase();
  if (!safeEqual(email, expectedEmail) || !safeEqual(password, adminPassword)) {
    return reply(res, 401, { ok: false, error: 'E-Mail oder Passwort falsch.' });
  }

  const payload = Buffer.from(JSON.stringify({
    email: expectedEmail,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString('base64url'),
  })).toString('base64url');
  const token = `${payload}.${sign(payload, secret)}`;
  return reply(res, 200, { ok: true }, {
    'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  });
};

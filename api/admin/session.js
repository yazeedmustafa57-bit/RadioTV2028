'use strict';

const crypto = require('node:crypto');
const store = require('./store');

module.exports = async function handler(req, res) {
  const secret = process.env.SESSION_SECRET;
  let state;
  try { state = await store.credentialState(); }
  catch (e) { return store.reply(res, 503, { ok: false, error: 'Privater Blob-Speicher ist nicht verfügbar.' }); }
  if (!state || !secret) return store.reply(res, 503, { ok: false, error: 'Admin-Anmeldung ist nicht konfiguriert.' });

  if (req.method === 'GET') {
    const ok = await store.validSession(req, secret, state);
    return store.reply(res, 200, { ok });
  }

  if (req.method === 'DELETE') {
    return store.reply(res, 200, { ok: true }, {
      'Set-Cookie': `${store.COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return store.reply(res, 405, { ok: false, error: 'Methode nicht erlaubt.' });
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try { if (new URL(origin).host !== host) return store.reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' }); }
    catch { return store.reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' }); }
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!store.safeEqual(email, state.email) || !(await store.verifyPassword(password, state))) {
    return store.reply(res, 401, { ok: false, error: 'E-Mail oder Passwort falsch.' });
  }

  await store.ensureResetSeed(state).catch(() => {});
  const payload = Buffer.from(JSON.stringify({
    email: state.email,
    version: state.sessionVersion,
    exp: Math.floor(Date.now() / 1000) + store.SESSION_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString('base64url'),
  })).toString('base64url');
  const token = `${payload}.${store.sign(payload, secret)}`;
  return store.reply(res, 200, { ok: true }, {
    'Set-Cookie': `${store.COOKIE}=${token}; Path=/; Max-Age=${store.SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  });
};

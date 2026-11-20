'use strict';

const store = require('./store');
const limiter = require('./rate-limit');

function checkOrigin(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try { if (new URL(origin).host !== host) { store.reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' }); return false; } }
    catch { store.reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' }); return false; }
  }
  return true;
}

async function fail(req, res, status, error) {
  return store.reply(res, status, { ok: false, error });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return store.reply(res, 405, { ok: false, error: 'Methode nicht erlaubt.' }); }
  if (!checkOrigin(req, res)) return;
  let rate;
  try { rate = await limiter.enforce(req, res, 'password'); } catch { return store.reply(res, 503, { ok: false, error: 'Ratenbegrenzung nicht verfügbar.' }); }
  if (!rate) return;

  let state;
  try { state = await store.credentialState(); } catch { return store.reply(res, 503, { ok: false, error: 'Speicher nicht verfügbar.' }); }
  const secret = process.env.SESSION_SECRET;
  if (!state || !secret) return store.reply(res, 503, { ok: false, error: 'Admin-Anmeldung ist nicht konfiguriert.' });
  if (!(await store.validSession(req, secret, state))) return fail(req, res, 401, 'Sitzung abgelaufen oder ungültig. Bitte neu anmelden.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body?.newPassword === 'string' ? body.newPassword : '';
  const repeat = typeof body?.repeatPassword === 'string' ? body.repeatPassword : '';
  if (!(await store.verifyPassword(current, state))) return fail(req, res, 401, 'Aktuelles Passwort falsch.');
  if (next.length < 12) return fail(req, res, 400, 'Das neue Passwort muss mindestens 12 Zeichen lang sein.');
  if (!next || next !== repeat) return fail(req, res, 400, 'Die neuen Passwortfelder stimmen nicht überein.');

  state.passwordHash = store.scryptHash(next);
  state.password = null;
  state.sessionVersion += 1;
  try { await store.saveBlobCredentials(state); }
  catch { return store.reply(res, 503, { ok: false, error: 'Zugangsdaten konnten nicht gespeichert werden.' }); }

  await limiter.clear(rate.key).catch(() => {});
  return store.reply(res, 200, { ok: true, message: 'Passwort geändert, bitte neu anmelden.' }, {
    'Set-Cookie': `${store.COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
  });
};

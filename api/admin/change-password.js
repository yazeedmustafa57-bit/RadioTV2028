'use strict';

const store = require('./store');
const memoryAttempts = new Map();

function checkOrigin(req, res) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try { if (new URL(origin).host !== host) { store.reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' }); return false; } }
    catch { store.reply(res, 403, { ok: false, error: 'Anfrage abgelehnt.' }); return false; }
  }
  return true;
}

function clientId(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

async function loadAttempts(req) {
  const id = clientId(req);
  const path = `novalive/admin/rate/password-${Buffer.from(id).toString('base64url')}.json`;
  if (store.blobConfigAvailable()) {
    try {
      const raw = await store.blobGet(path);
      if (raw) return { path, item: JSON.parse(raw) };
    } catch {}
  }
  return { path, item: memoryAttempts.get(id) || null };
}

async function saveAttempts(path, item, id) {
  memoryAttempts.set(id, item);
  if (store.blobConfigAvailable()) await store.blobSet(path, item);
}

async function rateLimit(req, res) {
  const id = clientId(req);
  const record = await loadAttempts(req);
  const now = Date.now();
  let item = record.item;
  if (!item || now - item.start >= 15 * 60 * 1000) item = { start: now, failures: 0 };
  if (item.failures >= 5) {
    await saveAttempts(record.path, item, id);
    store.reply(res, 429, { ok: false, error: 'Zu viele Fehlversuche. Bitte warte 15 Minuten.' });
    return false;
  }
  await saveAttempts(record.path, item, id);
  return { id, path: record.path, item };
}

async function fail(req, res, status, error, record) {
  record.item.failures += 1;
  await saveAttempts(record.path, record.item, record.id).catch(() => {});
  return store.reply(res, status, { ok: false, error });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return store.reply(res, 405, { ok: false, error: 'Methode nicht erlaubt.' }); }
  if (!checkOrigin(req, res)) return;
  let rate;
  try { rate = await rateLimit(req, res); } catch { return store.reply(res, 503, { ok: false, error: 'Speicher nicht verfügbar.' }); }
  if (!rate) return;

  let state;
  try { state = await store.credentialState(); } catch { return store.reply(res, 503, { ok: false, error: 'Speicher nicht verfügbar.' }); }
  const secret = process.env.SESSION_SECRET;
  if (!state || !secret) return store.reply(res, 503, { ok: false, error: 'Admin-Anmeldung ist nicht konfiguriert.' });
  if (!(await store.validSession(req, secret, state))) return fail(req, res, 401, 'Sitzung abgelaufen oder ungültig. Bitte neu anmelden.', rate);

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body?.newPassword === 'string' ? body.newPassword : '';
  const repeat = typeof body?.repeatPassword === 'string' ? body.repeatPassword : '';
  if (!(await store.verifyPassword(current, state))) return fail(req, res, 401, 'Aktuelles Passwort falsch.', rate);
  if (next.length < 12) return fail(req, res, 400, 'Das neue Passwort muss mindestens 12 Zeichen lang sein.', rate);
  if (!next || next !== repeat) return fail(req, res, 400, 'Die neuen Passwortfelder stimmen nicht überein.', rate);

  state.passwordHash = store.scryptHash(next);
  state.password = null;
  state.sessionVersion += 1;
  try { await store.saveBlobCredentials(state); }
  catch { return store.reply(res, 503, { ok: false, error: 'Zugangsdaten konnten nicht gespeichert werden.' }); }

  return store.reply(res, 200, { ok: true, message: 'Passwort geändert, bitte neu anmelden.' }, {
    'Set-Cookie': `${store.COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
  });
};

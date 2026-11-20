'use strict';

const crypto = require('node:crypto');
const { Redis } = require('@upstash/redis');
const { reply } = require('./store');

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
const script = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

function redisClient() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash Redis is not configured');
  return new Redis({ url, token });
}

function clientKey(req, action) {
  const forwarded = req.headers['x-forwarded-for'];
  const address = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown';
  const digest = crypto.createHash('sha256').update(address).digest('hex');
  return `novalive:admin:rate:${action}:${digest}`;
}

const memoryAttempts = new Map();

async function consume(req, action) {
  const key = clientKey(req, action);
  try {
    const count = Number(await redisClient().eval(script, [key], [String(WINDOW_SECONDS)]));
    return { allowed: Number.isSafeInteger(count) && count <= MAX_ATTEMPTS, key };
  } catch {
    const now = Date.now();
    let entry = memoryAttempts.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + WINDOW_SECONDS * 1000 };
    entry.count += 1;
    memoryAttempts.set(key, entry);
    if (memoryAttempts.size > 10000) {
      for (const [oldKey, oldEntry] of memoryAttempts) {
        if (oldEntry.resetAt <= now) memoryAttempts.delete(oldKey);
      }
    }
    return { allowed: entry.count <= MAX_ATTEMPTS, key };
  }
}

async function clear(key) {
  memoryAttempts.delete(key);
  try { await redisClient().del(key); } catch {}
}

async function enforce(req, res, action) {
  const result = await consume(req, action);
  if (!result.allowed) {
    reply(res, 429, { ok: false, error: 'Zu viele Versuche. Bitte warte 15 Minuten.' });
    return null;
  }
  return result;
}

module.exports = { enforce, clear, consume, WINDOW_SECONDS, MAX_ATTEMPTS };

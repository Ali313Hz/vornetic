// stripe.js — which Stripe address the server talks to, and checking that a webhook came from Stripe.
const crypto = require('crypto');
const LIVE_API = 'https://api.stripe.com';

// The automated tests run a fake Stripe on this computer and point STRIPE_API_URL at it.
// That override is honoured only when NODE_ENV=test AND the address is local (127.0.0.1 or
// localhost). Everywhere else the real Stripe address is used, so the secret key can never be
// sent to, and payment answers can never come from, another server.
function apiBase(env = process.env) {
  const url = env.STRIPE_API_URL;
  if (url && env.NODE_ENV === 'test' && /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/?$/.test(url)) return url.replace(/\/$/, '');
  return LIVE_API;
}
const overrideIgnored = (env = process.env) => !!env.STRIPE_API_URL && apiBase(env) === LIVE_API;

// Stripe signs every webhook it sends: header "Stripe-Signature: t=<unix time>,v1=<hex HMAC-SHA256
// of "<t>.<body>" made with the endpoint's signing secret>" (several v1 while a secret is being
// rotated). Checked here with Node's crypto, no Stripe SDK. rawBody must be the exact bytes received.
// An event signed more than 5 minutes ago (or ahead) is refused, so a captured one can't be replayed
// later. Returns the parsed event; throws if anything is wrong.
const WEBHOOK_TOLERANCE_SECONDS = 300;
function verifyWebhook(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Buffer.isBuffer(rawBody) || typeof header !== 'string' || !secret) throw new Error('missing body, signature or secret');
  let t = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim(), value = part.slice(i + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(Buffer.from(value, 'hex'));
  }
  if (t === null || !signatures.length) throw new Error('malformed signature header');
  if (Math.abs(nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS) throw new Error('signature timestamp too old');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  if (!signatures.some(sig => crypto.timingSafeEqual(sig, expected))) throw new Error('signature does not match');
  return JSON.parse(rawBody.toString('utf8'));
}

module.exports = { LIVE_API, apiBase, overrideIgnored, verifyWebhook, WEBHOOK_TOLERANCE_SECONDS };

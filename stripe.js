// stripe.js — which Stripe address the server talks to.
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

module.exports = { LIVE_API, apiBase, overrideIgnored };

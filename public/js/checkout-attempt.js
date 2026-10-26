// public/js/checkout-attempt.js — one checkout attempt = one order (the server side is in server.js,
// POST /api/orders). Loaded by the shop page before app.js; also required by the tests.
//
// One random ID per checkout attempt, kept in this browser (all tabs) while what is bought and where
// it goes stay the same, also after coming back from the Stripe page. The server answers a repeat of
// the same attempt with the order it already made, so a double click, a refresh, a second tab,
// "back" from Stripe or switching EN/ES never makes a second order.
// - The display language is not part of the attempt: switching EN/ES changes no purchase.
// - The attempt keeps the form as sent (delivery details, notes, payment method), so the checkout
//   page can put it back after a return from Stripe — but only for the customer who started it
//   ("owner": the signed-in account, or 'guest'). For anyone else it is thrown away, never shown or
//   reused, and logging out clears it.
(function (root) {
  const KEY = 'vcheckout';
  const load = storage => { try { return storage ? JSON.parse(storage.getItem(KEY) || 'null') : null; } catch { return null; } };
  const save = (storage, a) => { try { if (storage) storage.setItem(KEY, JSON.stringify(a)); } catch { /* private mode: no protection, no harm */ } };
  const clear = storage => { try { if (storage) storage.removeItem(KEY); } catch {} };
  // FNV-1a, 32 bit: enough to notice that the cart or the form changed
  const hashText = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16); };
  const newId = c => c.randomUUID ? c.randomUUID()
    : [...c.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  // Who the attempt belongs to: the signed-in customer (me = the account, as /api/account/me gives it) or a guest
  const ownerOf = me => (me && me.id ? 'user:' + me.id : 'guest');

  // The ID to send with this order (body = what the page sends; lang and items are ignored / used as below)
  function attemptId(storage, body, owner, cryptoObj) {
    const { lang, items, ...fields } = body;                  // lang: display only, not part of the purchase
    const fp = hashText(JSON.stringify([items, fields]));
    let a = load(storage);
    if (!a || a.owner !== owner || a.fp !== fp || !a.id) {
      a = { id: newId(cryptoObj), owner, fp, fields };
      save(storage, a);
    }
    return a.id;
  }
  // The form of this customer's pending attempt, to put back on the checkout page ({} if none).
  // Someone else's pending attempt is discarded, never shown.
  function pendingFields(storage, owner) {
    const a = load(storage);
    if (!a) return {};
    if (a.owner !== owner) { clear(storage); return {}; }
    return a.fields || {};
  }

  // The delivery address of the last checkout, remembered in this browser to pre-fill the next one —
  // for the same customer only. Someone else on this browser (another account, or a guest after an
  // account, or an account after a guest) never gets it: it is thrown away. An address saved by an
  // older shop page has no owner, so it is thrown away too. Logging out forgets it.
  const ADDR_KEY = 'vaddr';
  function rememberAddress(storage, owner, addr) {
    try { if (storage) storage.setItem(ADDR_KEY, JSON.stringify({ owner, addr })); } catch {}
  }
  const forgetAddress = storage => { try { if (storage) storage.removeItem(ADDR_KEY); } catch {} };
  function savedAddress(storage, owner) {
    let s = null;
    try { s = storage ? JSON.parse(storage.getItem(ADDR_KEY) || 'null') : null; } catch {}
    if (!s) return {};
    if (s.owner !== owner || !s.addr) { forgetAddress(storage); return {}; }
    return s.addr;
  }

  const api = { attemptId, pendingFields, clear, ownerOf, hashText, KEY, rememberAddress, savedAddress, forgetAddress, ADDR_KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckoutAttempt = api;
})(this);

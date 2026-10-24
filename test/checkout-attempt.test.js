// test/checkout-attempt.test.js — the shop page's checkout attempt (public/js/checkout-attempt.js):
// which ID is sent with an order, and whose details the checkout page may put back.
// The browser file itself is loaded; a Map stands in for localStorage.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CA = require('../public/js/checkout-attempt.js');

const fakeStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), raw: m };
};
const form = (extra = {}) => ({
  email: 'a@example.test', phone: '611000111', customer_name: 'Customer A', address: 'Calle A 1', zip: '28001',
  city: 'Madrid', province: '', country: 'ES', notes: 'Note from A', payment_method: 'card',
  lang: 'en', items: [{ id: 8, qty: 1, options: {}, car: null }], ...extra,
});
const A = CA.ownerOf({ id: 1, email: 'a@example.test' }), B = CA.ownerOf({ id: 2, email: 'b@example.test' }), GUEST = CA.ownerOf(null);

test('switching the display language (EN/ES) keeps the same attempt: no second order', () => {
  const st = fakeStorage();
  const id = CA.attemptId(st, form({ lang: 'en' }), A, crypto);
  assert.strictEqual(CA.attemptId(st, form({ lang: 'es' }), A, crypto), id, 'EN -> ES');
  assert.strictEqual(CA.attemptId(st, form({ lang: 'en' }), A, crypto), id, 'and back');
  assert.ok(!('lang' in CA.pendingFields(st, A)), 'the language is not part of the stored form');
});

test('anything bought or delivered changing makes a new attempt (cart, address, notes, payment method)', () => {
  const st = fakeStorage();
  const id = CA.attemptId(st, form(), A, crypto);
  for (const change of [{ items: [{ id: 8, qty: 2, options: {}, car: null }] }, { address: 'Calle B 2' }, { notes: 'other' }, { payment_method: 'bizum' }]) {
    const st2 = fakeStorage();
    const first = CA.attemptId(st2, form(), A, crypto);
    assert.notStrictEqual(CA.attemptId(st2, form(change), A, crypto), first, JSON.stringify(change));
  }
  assert.strictEqual(CA.attemptId(st, form(), A, crypto), id, 'unchanged: the same attempt');
});

test('back from Stripe: the same customer gets the whole form back (address, notes, method), not the cart or language', () => {
  const st = fakeStorage();
  CA.attemptId(st, form({ lang: 'es' }), A, crypto);
  const f = CA.pendingFields(st, A);
  assert.deepStrictEqual([f.email, f.phone, f.address, f.notes, f.payment_method], ['a@example.test', '611000111', 'Calle A 1', 'Note from A', 'card']);
  assert.ok(!('items' in f) && !('lang' in f));
  // submitting that restored form again gives the same ID
  const id = JSON.parse(st.getItem(CA.KEY)).id;
  assert.strictEqual(CA.attemptId(st, { ...f, lang: 'en', items: form().items }, A, crypto), id);
});

test('another customer on the same browser never sees or reuses the pending details (and the attempt is discarded)', () => {
  for (const [first, next] of [[A, B], [A, GUEST], [GUEST, A]]) {
    const st = fakeStorage();
    const id = CA.attemptId(st, form(), first, crypto);
    assert.deepStrictEqual(CA.pendingFields(st, next), {}, `${first} -> ${next}: nothing shown`);
    assert.strictEqual(st.getItem(CA.KEY), null, 'and it is gone');
    assert.notStrictEqual(CA.attemptId(st, form(), next, crypto), id, 'their own order gets its own attempt, even with the same form');
  }
});

test('clear() (used on logout and after a placed order) removes the pending details; no storage = no crash', () => {
  const st = fakeStorage();
  CA.attemptId(st, form(), A, crypto);
  CA.clear(st);
  assert.deepStrictEqual(CA.pendingFields(st, A), {});
  // private mode / blocked storage: works, just without protection
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  for (const s of [null, broken]) {
    assert.match(CA.attemptId(s, form(), A, crypto), /^[0-9a-f-]{32,36}$/);
    assert.deepStrictEqual(CA.pendingFields(s, A), {});
    CA.clear(s);
  }
});

test('the shop page uses it: loaded before app.js, cleared on logout, restored only for the owner', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('/js/checkout-attempt.js') > 0 && html.indexOf('/js/checkout-attempt.js') < html.indexOf('/js/app.js'), 'loaded before app.js');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const logout = app.slice(app.indexOf("await post('/api/account/logout')"), app.indexOf("await post('/api/account/logout')") + 300);
  assert.match(logout, /CheckoutAttempt\.clear\(/, 'logout clears the pending checkout');
  assert.match(app, /CheckoutAttempt\.pendingFields\(browserStorage\(\), CheckoutAttempt\.ownerOf\(ME\)\)/, 'restored for the current customer only');
  assert.doesNotMatch(app, /store\.(get|set|del)\('vcheckout'/, 'no other code reads or writes it directly');
});

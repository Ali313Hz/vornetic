/* Vornetic — satıcı paneli / panel de vendedor */
(() => {
'use strict';
const root = document.getElementById('root');
// Panel language: Turkish or Spanish (button in the top bar, remembered in this browser).
// L('Türkçe', 'Español') picks the text; the server answers in the same language (admin-i18n.js).
const LANG_KEY = 'vn-admin-lang';
let LANG = (() => { try { return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'tr'; } catch { return 'tr'; } })();
const L = (tr, es) => LANG === 'es' ? es : tr;
const locale = () => LANG === 'es' ? 'es-ES' : 'tr-TR';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const eur = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const toEuro = c => c == null ? '' : (c / 100).toFixed(2);
const day = s => (s || '').slice(0, 16);
// Euro text typed by the admin → cents. "12,50" "12.5" "12" are fine; anything else → null
// (never silently 0), so a typo shows an error instead of being saved.
// Same formats as the CSV import: "12", "12,5", "12.50", "1.250,00" (Spain/Turkey), "1,250.00",
// with or without "€". "1.250" stays an error: it could be 1250 € or 1,25 €.
function parseEuro(text) {
  const s = String(text ?? '').replace(/€|eur/gi, '').replace(/[\s ]/g, '');
  const cents = (whole, frac = '') => Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  let m;
  if ((m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(s))) return cents(m[1], m[2]);
  if ((m = /^(\d{1,3}(?:\.\d{3}){1,2}),(\d{1,2})$/.exec(s))) return cents(m[1].replace(/\./g, ''), m[2]);
  if ((m = /^(\d{1,3}(?:,\d{3}){1,2})\.(\d{1,2})$/.exec(s))) return cents(m[1].replace(/,/g, ''), m[2]);
  return null;
}
// Warning for a paid order that was cancelled but not fully refunded (null = nothing to show)
function refundWarning(o) {
  if (!o.needs_refund) return null;
  return o.refund_total_cents
    ? L(`⚠ İade eksik: ${eur(o.refund_due_cents)} kaldı (${eur(o.refund_total_cents)} iade edildi)`,
      `⚠ Devolución incompleta: faltan ${eur(o.refund_due_cents)} (devuelto ${eur(o.refund_total_cents)})`)
    : L(`⚠ Ödendi ama iptal: ${eur(o.refund_due_cents)} iade edilmeli`, `⚠ Pagado pero cancelado: hay que devolver ${eur(o.refund_due_cents)}`);
}

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const headers = { 'X-Admin-Lang': LANG, ...(isForm ? {} : { 'Content-Type': 'application/json' }) };
  const r = await fetch(url, { headers, ...opts });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error(L('Oturum kapandı', 'La sesión ha caducado')); }
  if (!r.ok) throw new Error(d.error || L('Hata', 'Error'));
  return d;
}
const send = (url, body, method = 'PUT') => api(url, { method, body: JSON.stringify(body) });
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

const STATUS = () => L({ pending: 'Ödeme bekliyor', paid: 'Ödendi — gönderilecek', shipped: 'Kargoda', delivered: 'Teslim edildi', cancelled: 'İptal' },
  { pending: 'Pendiente de pago', paid: 'Pagado — por enviar', shipped: 'Enviado', delivered: 'Entregado', cancelled: 'Cancelado' });
const PAY = () => L({ card: 'Kart (Stripe)', bizum: 'Bizum', transfer: 'Havale', contact: 'İletişimle ödeme' },
  { card: 'Tarjeta (Stripe)', bizum: 'Bizum', transfer: 'Transferencia', contact: 'Pago acordado por contacto' });
const TABS = () => L({ orders: 'Siparişler', customers: 'Müşteriler', withdrawals: 'Cayma', products: 'Ürünler', categories: 'Kategoriler', bulbs: 'Ampuller', finance: 'Finans', stats: 'Özet', settings: 'Ayarlar' },
  { orders: 'Pedidos', customers: 'Clientes', withdrawals: 'Desistimientos', products: 'Productos', categories: 'Categorías', bulbs: 'Bombillas', finance: 'Finanzas', stats: 'Resumen', settings: 'Ajustes' });
let ME = {};
let tab = 'orders';

function showLogin() {
  $('#tabs').innerHTML = ''; $('#logout').hidden = true;
  root.innerHTML = `<form id="lf" class="box" style="max-width:380px;margin:60px auto">
    <h2>${L('Satıcı paneli', 'Panel de vendedor')}</h2>
    <label class="f"><span>${L('Şifre', 'Contraseña')}</span><input class="in" type="password" name="password" autofocus autocomplete="current-password"></label>
    <div id="lerr"></div><button class="btn block">${L('Giriş', 'Entrar')}</button></form>`;
  $('#lf').addEventListener('submit', async e => {
    e.preventDefault();
    try { await send('/api/admin/login', { password: e.target.password.value }, 'POST'); start(); }
    catch (err) { $('#lerr').innerHTML = `<p class="notice err" style="margin-bottom:12px">${esc(err.message)}</p>`; }
  });
}

async function start() {
  try { ME = await api('/api/admin/me'); } catch { return; }
  $('#logout').hidden = false;
  drawTabs();
  show();
}
// Production: no backup copied off the server for 2 days (scripts/backup-offsite.sh, README → Yedek)
function drawBackupWarning() {
  const b = ME.backup;
  const when = t => esc(new Date(t).toLocaleString(locale()));
  const full = b && b.offsite_full_at && Date.parse(b.offsite_full_at) < Date.parse(b.offsite_at);
  const what = !b || !b.offsite_at ? L('Sunucu dışına hiç yedek alınmadı.', 'Nunca se ha hecho una copia de seguridad fuera del servidor.')
    : !b.offsite_full_at ? L(`Fotoğraflarla birlikte tam yedek hiç alınmadı (son veritabanı yedeği: ${when(b.offsite_at)}).`,
      `Nunca se ha hecho una copia completa con las fotos (última copia de la base de datos: ${when(b.offsite_at)}).`)
    : L(`Son 2 gündür sunucu dışına ${full ? 'tam yedek (fotoğraflarla)' : 'yedek'} alınmadı (son tam yedek: ${when(b.offsite_full_at)}).`,
      `En los últimos 2 días no se ha hecho ${full ? 'ninguna copia completa (con fotos)' : 'ninguna copia'} fuera del servidor (última copia completa: ${when(b.offsite_full_at)}).`);
  $('#bkwarn').innerHTML = b && b.warn ? `<p class="notice err" style="margin-top:12px">⚠ ${what} ${L('Sunucu çökerse siparişler, müşteri bilgileri ve fotoğraflar kaybolur: README → Yedek.',
    'Si el servidor falla, se pierden los pedidos, los datos de clientes y las fotos: README → Yedek.')}</p>` : '';
}
function drawTabs() {
  drawBackupWarning();
  $('#tabs').innerHTML = Object.entries(TABS()).map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${v}${
    k === 'withdrawals' && ME.open_withdrawals ? ` <span class="badge" style="position:static;display:inline-grid">${ME.open_withdrawals}</span>` : ''}${
    k === 'orders' && ME.overdue_orders ? ` <span class="badge" style="position:static;display:inline-grid" title="${L('5 günü geçmiş, ödemesi kontrol edilecek', 'Más de 5 días: comprobar el pago')}">${ME.overdue_orders}</span>` : ''}</button>`).join('');
}
async function refreshMe() { try { ME = await api('/api/admin/me'); drawTabs(); } catch {} }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; drawTabs(); show(); } });
$('#logout').addEventListener('click', async () => { await send('/api/admin/logout', {}, 'POST'); showLogin(); });

function show() {
  root.innerHTML = `<p class="muted">${L('Yükleniyor…', 'Cargando…')}</p>`;
  window.scrollTo(0, 0);
  ({ orders: viewOrders, customers: viewCustomers, withdrawals: viewWithdrawals, products: viewProducts, categories: viewCategories, bulbs: viewBulbs, finance: viewFinance, stats: viewStats, settings: viewSettings })[tab]().catch(e => {
    root.innerHTML = `<p class="notice err">${esc(e.message)}</p>`;
  });
}

/* ---------- Siparişler ---------- */
let orderFilter = '', orderSearch = '';
async function viewOrders() {
  const orders = await api('/api/admin/orders' + (orderFilter ? '?status=' + orderFilter : ''));
  root.innerHTML = `
    <div class="section-head"><h2>${L('Siparişler', 'Pedidos')}</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="in search" id="os" placeholder="${L('Ara: isim, e-posta, sipariş no', 'Buscar: nombre, email, nº de pedido')}" value="${esc(orderSearch)}">
        <select class="in" id="of" style="width:auto">
          <option value="">${L('Hepsi', 'Todos')}</option>${Object.entries(STATUS()).map(([k, v]) => `<option value="${k}"${k === orderFilter ? ' selected' : ''}>${v}</option>`).join('')}
          <option value="overdue"${orderFilter === 'overdue' ? ' selected' : ''}>⏰ ${L('5 günü geçenler', 'Más de 5 días')}${ME && ME.overdue_orders ? ` (${ME.overdue_orders})` : ''}</option>
        </select></div></div>
    <div id="olist"></div>`;
  const draw = () => {
    const q = orderSearch.toLowerCase();
    const list = q ? orders.filter(o => [o.ref, o.customer_name, o.email, o.phone, o.city].join(' ').toLowerCase().includes(q)) : orders;
    $('#olist').innerHTML = list.length ? list.map(orderHtml).join('') : `<p class="muted">${L('Sipariş yok.', 'No hay pedidos.')}</p>`;
    bindOrderCards($('#olist'));
  };
  draw();
  $('#of').addEventListener('change', e => { orderFilter = e.target.value; show(); });
  $('#os').addEventListener('input', e => { orderSearch = e.target.value; draw(); });
}
function bindOrderCards(scope, after = show) {
  $$('.order', scope).forEach(el => {
    $('.save', el).addEventListener('click', async () => {
      try {
        const r = await send('/api/admin/orders/' + el.dataset.id, { status: $('.sts', el).value, tracking: $('.trk', el).value });
        toast(r.mailed ? L('Kaydedildi · müşteriye e-posta gitti', 'Guardado · email enviado al cliente') : L('Kaydedildi', 'Guardado')); after();
      } catch (e) { toast(e.message); }
    });
    $('.addrfd', el)?.addEventListener('click', async () => {
      const cents = parseEuro($('.rfd', el).value);
      if (!cents) return toast(L('Geçersiz tutar — örnek: 12,50', 'Importe no válido — ejemplo: 12,50'));
      if (!confirm(L(`${eur(cents)} iade kaydı eklensin? (Kayıt sonradan silinemez.)`, `¿Registrar una devolución de ${eur(cents)}? (No se puede borrar después.)`))) return;
      try {
        await send(`/api/admin/orders/${el.dataset.id}/refunds`, { amount_cents: cents, note: $('.rfdnote', el).value }, 'POST');
        toast(L('İade kaydedildi', 'Devolución registrada')); after();
      } catch (e) { toast(e.message); }
    });
    $$('[data-pchk]', el).forEach(btn => btn.addEventListener('click', async () => {
      const fix = btn.dataset.fix === '1';
      const was = PCHK()[btn.dataset.pchk === 'paid' ? 'unpaid' : 'paid'], now = PCHK()[btn.dataset.pchk];
      if (fix && !confirm(L(`Önceki cevap "${was}" idi. "${now}" olarak düzeltilsin mi? (Her iki cevap da tarihçede kalır.)`,
        `La respuesta anterior era "${was}". ¿Corregir a "${now}"? (Las dos respuestas quedan en el historial.)`))) return;
      try {
        await send('/api/admin/orders/' + el.dataset.id, { payment_check: btn.dataset.pchk, ...(fix && { confirm_correction: true }) });
        toast(L('Kaydedildi', 'Guardado')); after();
      } catch (e) { toast(e.message); }
    }));
    // Overdue Bizum/transfer order: the admin checked the bank/Bizum
    $('.odpaid', el)?.addEventListener('click', async () => {
      if (!confirm(L('Ödeme banka/Bizum hesabına geldi mi? Sipariş "Ödendi" yapılacak.', '¿Ha llegado el pago al banco/Bizum? El pedido se marcará como "Pagado".'))) return;
      try { await send('/api/admin/orders/' + el.dataset.id, { status: 'paid' }); toast(L('Ödendi olarak kaydedildi', 'Marcado como pagado')); refreshMe(); after(); }
      catch (e) { toast(e.message); }
    });
    $('.odcancel', el)?.addEventListener('click', async () => {
      if (!confirm(L('Ödeme gelmedi mi? Sipariş iptal edilecek, stok geri eklenecek ve müşteriye e-posta gidecek.',
        '¿No ha llegado el pago? El pedido se cancelará, el stock se repondrá y el cliente recibirá un email.'))) return;
      try {
        const r = await send(`/api/admin/orders/${el.dataset.id}/cancel-unpaid`, { confirm: true }, 'POST');
        toast(r.mail ? L('İptal edildi · müşteriye e-posta gönderiliyor', 'Cancelado · enviando email al cliente')
          : L('İptal edildi · e-posta kapalı, müşteriye kendin haber ver', 'Cancelado · el email está desactivado, avisa tú al cliente')); refreshMe(); after();
      } catch (e) { toast(e.message); }
    });
    $('.latepay', el)?.addEventListener('click', async () => {
      const d = $('.latedate', el).value;
      if (!confirm(L(`${d} tarihinde gelen ödeme kaydedilsin mi? Sipariş iptal kalır; parayı iade edip "İade ekle" ile kaydet.`,
        `¿Registrar el pago recibido el ${d}? El pedido sigue cancelado; devuelve el dinero y regístralo con "Añadir devolución".`))) return;
      try { await send(`/api/admin/orders/${el.dataset.id}/late-payment`, { confirm: true, paid_on: d }, 'POST'); toast(L('Ödeme kaydedildi · iade gerekiyor', 'Pago registrado · hay que devolverlo')); after(); }
      catch (e) { toast(e.message); }
    });
    $('[data-cust]', el)?.addEventListener('click', () => { tab = 'customers'; drawTabs(); viewCustomer(+$('[data-cust]', el).dataset.cust); });
  });
}
function waUrl(phone, text) {
  const p = (phone || '').replace(/[^\d]/g, '');
  return p ? `https://wa.me/${p.length === 9 ? '34' + p : p}?text=${encodeURIComponent(text)}` : '';
}
// Why an order was cancelled for non-payment (server: expireUnpaidOrders, cancel-unpaid)
const AUTO_CANCEL = () => L({
  unpaid_5_days: 'İptal: 5 günde ödeme gelmedi',
  card_checkout_expired: 'Otomatik iptal: kart ödemesi tamamlanmadı',
}, {
  unpaid_5_days: 'Cancelado: sin pago en 5 días',
  card_checkout_expired: 'Cancelado automáticamente: el pago con tarjeta no se completó',
});
// E-mails about the order that are queued, retried or given up (server: mail_outbox, flushMails)
const MAIL_NAME = () => L({ confirmation: 'Sipariş onayı', shop_new_order: 'Mağazaya yeni sipariş', charged_after_cancel: 'İptal sonrası ödeme (müşteri)',
  shop_charged_after_cancel: 'İptal sonrası ödeme (mağaza)', expired: 'Ödeme gelmedi / iptal' },
{ confirmation: 'Confirmación del pedido', shop_new_order: 'Aviso de pedido nuevo a la tienda', charged_after_cancel: 'Pago tras cancelar (cliente)',
  shop_charged_after_cancel: 'Pago tras cancelar (tienda)', expired: 'Pago no recibido / cancelado' });
const mailBadges = o => JSON.parse(o.mails || '[]').filter(m => m.state === 'due' || m.state === 'failed').map(m => m.state === 'failed'
  ? `<span class="status cancelled">⚠ ${L('E-posta gönderilemedi', 'Email no enviado')}: ${MAIL_NAME()[m.kind] || esc(m.kind)} — ${L('kendin yaz', 'escribe tú')}</span> `
  : `<span class="status pending">✉ ${L('E-posta bekliyor', 'Email pendiente')}: ${MAIL_NAME()[m.kind] || esc(m.kind)}</span> `).join('');
// A cancelled Bizum/transfer order whose money arrived anyway can get the payment recorded (stays cancelled, refund due)
const canRecordLate = o => o.status === 'cancelled' && !o.paid_at && !o.payment_unknown && ['bizum', 'transfer', 'contact'].includes(o.payment_method);
const isOverdue = o => o.overdue_at && o.status === 'pending' && !o.paid_at;
// Answers to "was this old cancelled order paid?", oldest first, with a button to correct the latest
const PCHK = () => L({ paid: 'Ödenmişti', unpaid: 'Ödenmemişti' }, { paid: 'Estaba pagado', unpaid: 'No estaba pagado' });
function paymentCheckHtml(o) {
  const checks = JSON.parse(o.payment_checks || '[]');
  if (!checks.length) return '';
  const last = checks[checks.length - 1].answer, other = last === 'paid' ? 'unpaid' : 'paid';
  return `<div class="order-actions"><span class="small">${L('Eski ödeme kontrolü', 'Comprobación de pago antigua')}: ${checks.map(c =>
    `${esc(day(c.created_at))} <b>${PCHK()[c.answer]}</b>`).join(' → ')}</span>
    <button class="btn sm ghost" data-pchk="${other}" data-fix="1">${L('Düzelt', 'Corregir')}: ${PCHK()[other]}</button></div>`;
}
function orderHtml(o) {
  const items = JSON.parse(o.items);
  const wa = waUrl(o.phone, `Vornetic — ${o.ref}`);
  return `<div class="order" data-id="${o.id}">
    <div class="order-head">
      <div><b>${esc(o.ref)}</b> · <span class="muted">${esc(day(o.created_at))}</span> · <span class="muted">${esc(o.lang.toUpperCase())}</span>
        ${o.user_id ? ` · <button class="chip-btn small" data-cust="${o.user_id}">${L('kayıtlı müşteri', 'cliente registrado')} →</button>` : ` · <span class="muted small">${L('misafir', 'invitado')}</span>`}</div>
      <div>${refundWarning(o) ? `<span class="status cancelled">${esc(refundWarning(o))}</span> ` : ''}${o.payment_unknown ? `<span class="status pending">⚠ ${L('Eski iptal: ödeme durumu bilinmiyor', 'Cancelación antigua: estado del pago desconocido')}</span> ` : ''}${AUTO_CANCEL()[o.auto_cancel_reason] ? `<span class="status cancelled" title="${esc(day(o.auto_cancelled_at))}">${AUTO_CANCEL()[o.auto_cancel_reason]}</span> ` : ''}${mailBadges(o)}${isOverdue(o) ? `<span class="status pending">⏰ ${L('5 gün doldu: ödemeyi kontrol et', '5 días: comprueba el pago')}</span> ` : ''}${o.stripe_mismatch ? `<span class="status cancelled" title="${esc(o.stripe_mismatch)}">⚠ ${L("Stripe tutarı uyuşmuyor: ödemeyi Stripe'ta kontrol et", 'El importe de Stripe no coincide: compruébalo en Stripe')}</span> ` : ''}${o.withdrawals ? `<span class="status pending">↩ ${L('Cayma talebi', 'Desistimiento')}</span> ` : ''}<span class="status ${esc(o.status)}">${STATUS()[o.status]}</span></div>
    </div>
    <div class="order-cols">
      <div class="items">${items.map(i => `<div><b>${i.qty}× ${esc(i.name)}</b> — ${eur(i.unit_cents * i.qty)}
        ${i.car ? `<small>🚗 ${esc(i.car)}</small>` : ''}${(i.options || []).map(x => `<small>${esc(x)}</small>`).join('')}</div>`).join('')}
        <div style="border:0">${L('Kargo', 'Envío')}: ${eur(o.shipping_cents)} · <b>${L('Toplam', 'Total')}: ${eur(o.total_cents)}</b> · ${PAY()[o.payment_method] || esc(o.payment_method)}
          ${o.paid_at ? ` · ${L('Ödeme', 'Pago')}: ${esc(day(o.paid_at))}${o.paid_at_estimated ? L(' (tahmini)', ' (estimado)') : ''}${o.paid_via === 'late' ? L(' (iptalden sonra geldi)', ' (llegó tras cancelar)') : ''}` : ''}</div>
        ${JSON.parse(o.refunds || '[]').map(r => `<div style="border:0"><small>↩ ${L('İade', 'Devolución')} ${esc(day(r.created_at))}: <b>${eur(r.amount_cents)}</b>${r.note ? ' — ' + esc(r.note) : ''}</small></div>`).join('')}
      </div>
      <div>
        <b>${esc(o.customer_name)}</b><br>
        ${esc(o.address)}<br>${esc(o.zip)} ${esc(o.city)}${o.province ? ', ' + esc(o.province) : ''} · ${esc(o.country)}<br>
        <a class="link" href="mailto:${esc(o.email)}">${esc(o.email)}</a> · ${esc(o.phone)}
        ${wa ? ` · <a class="link" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${o.notes ? `<p class="notice" style="margin-top:8px">${esc(o.notes)}</p>` : ''}
      </div>
    </div>
    <div class="order-actions">
      <select class="in sts">${Object.entries(STATUS()).map(([k, v]) => `<option value="${k}"${k === o.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <input class="in trk" placeholder="${L('Kargo takip no (Kargoda yapmadan önce yaz)', 'Nº de seguimiento (escríbelo antes de marcar Enviado)')}" value="${esc(o.tracking)}" style="min-width:260px">
      <button class="btn sm save">${L('Kaydet', 'Guardar')}</button>
    </div>
    ${o.payment_unknown ? `<div class="order-actions"><span class="small">${L('Bu eski iptal sipariş ödenmiş miydi?', '¿Estaba pagado este pedido cancelado antiguo?')}</span>
      <button class="btn sm ghost" data-pchk="paid">${PCHK().paid}</button><button class="btn sm ghost" data-pchk="unpaid">${PCHK().unpaid}</button></div>` : ''}
    ${isOverdue(o) ? `<div class="order-actions"><span class="small">${L('5 gün geçti, ödeme kayıtlı değil. Banka/Bizum hesabını kontrol et:', 'Han pasado 5 días y no hay pago registrado. Revisa el banco/Bizum:')}</span>
      <button class="btn sm ghost odpaid">${L('Ödeme geldi', 'Pago recibido')}</button><button class="btn sm ghost odcancel">${L('Ödeme gelmedi — iptal et', 'No ha llegado — cancelar')}</button></div>` : ''}
    ${canRecordLate(o) ? `<div class="order-actions"><span class="small">${L('İptalden sonra para geldi mi? (Sipariş iptal kalır, stok alınmaz, iade gerekir.)', '¿Llegó el dinero después de cancelar? (El pedido sigue cancelado, no se toca el stock y hay que devolverlo.)')}</span>
      <input class="in latedate" type="date" value="${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })}" style="width:auto">
      <button class="btn sm ghost latepay">${L('Geç gelen ödemeyi kaydet', 'Registrar pago tardío')}</button></div>` : ''}
    ${paymentCheckHtml(o)}
    ${o.paid_at && o.refund_total_cents < o.total_cents ? `<div class="order-actions">
      <input class="in rfd" inputmode="decimal" placeholder="${L('İade € (ör. 12,50)', 'Devolución € (ej. 12,50)')}" style="width:150px">
      <input class="in rfdnote" placeholder="${L('Not (isteğe bağlı)', 'Nota (opcional)')}" maxlength="200" style="min-width:180px">
      <button class="btn sm ghost addrfd">${L('İade ekle', 'Añadir devolución')}</button></div>` : ''}
  </div>`;
}

/* ---------- Müşteriler ---------- */
let custSearch = '';
const carText = c => { try { const x = typeof c === 'string' ? JSON.parse(c) : c; return x ? `${x.brand} ${x.model} ${x.gen} · ${x.year}${x.engine ? ' · ' + x.engine : ''}` : ''; } catch { return ''; } };
async function viewCustomers() {
  const list = await api('/api/admin/customers');
  root.innerHTML = `
    <div class="section-head"><h2>${L('Müşteriler', 'Clientes')} <span class="muted" style="font-weight:400">(${list.length})</span></h2>
      <input class="in search" id="cs" placeholder="${L('Ara: isim, e-posta, telefon, şehir', 'Buscar: nombre, email, teléfono, ciudad')}" value="${esc(custSearch)}"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>${L('Müşteri', 'Cliente')}</th><th>${L('İletişim', 'Contacto')}</th><th>${L('Adres', 'Dirección')}</th><th>${L('Araba', 'Coche')}</th><th>${L('Sipariş', 'Pedidos')}</th><th>${L('Harcama', 'Gastado')}</th><th>${L('Kayıt', 'Alta')}</th></tr></thead>
      <tbody id="ctb"></tbody></table></div>`;
  const draw = () => {
    const q = custSearch.toLowerCase();
    const rows = q ? list.filter(u => [u.name, u.email, u.phone, u.city, u.zip].join(' ').toLowerCase().includes(q)) : list;
    $('#ctb').innerHTML = rows.length ? rows.map(u => `<tr class="click" data-id="${u.id}">
      <td><b>${esc(u.name)}</b></td>
      <td>${esc(u.email)}<br><span class="muted">${esc(u.phone)}</span></td>
      <td>${u.address ? `${esc(u.address)}<br><span class="muted">${esc(u.zip)} ${esc(u.city)} · ${esc(u.country)}</span>` : '<span class="muted">—</span>'}</td>
      <td>${esc(carText(u.car)) || '<span class="muted">—</span>'}</td>
      <td>${u.orders}</td><td>${eur(u.spent_cents)}</td><td class="muted">${esc(day(u.created_at).slice(0, 10))}</td></tr>`).join('')
      : `<tr><td colspan="7" class="muted">${L('Henüz kayıtlı müşteri yok.', 'Todavía no hay clientes registrados.')}</td></tr>`;
    $$('tr.click').forEach(tr => tr.addEventListener('click', () => viewCustomer(+tr.dataset.id)));
  };
  draw();
  $('#cs').addEventListener('input', e => { custSearch = e.target.value; draw(); });
}

async function viewCustomer(id) {
  root.innerHTML = `<p class="muted">${L('Yükleniyor…', 'Cargando…')}</p>`;
  const { user: u, orders } = await api('/api/admin/customers/' + id);
  const wa = waUrl(u.phone, `Hola ${u.name}, te escribimos de Vornetic.`);
  const spent = orders.filter(o => o.paid_at).reduce((a, o) => a + o.total_cents - o.refund_total_cents, 0);
  root.innerHTML = `
    <div class="section-head"><h2>${esc(u.name)}</h2><button class="btn ghost sm" id="back">← ${L('Müşteriler', 'Clientes')}</button></div>
    <div class="order-cols" style="margin-bottom:20px">
      <div class="box" style="margin:0">
        <h3>${L('İletişim', 'Contacto')}</h3>
        <p style="margin:0 0 6px"><a class="link" href="mailto:${esc(u.email)}">${esc(u.email)}</a></p>
        <p style="margin:0 0 6px">${esc(u.phone) || `<span class="muted">${L('Telefon yok', 'Sin teléfono')}</span>`} ${wa ? `· <a class="link" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p>
        <p class="muted small" style="margin:0">${L('Kayıt', 'Alta')}: ${esc(day(u.created_at))} · ${orders.length} ${L('sipariş', 'pedidos')} · ${L('ödenen', 'pagado')} ${eur(spent)}</p>
      </div>
      <div class="box" style="margin:0">
        <h3>${L('Adres ve araba', 'Dirección y coche')}</h3>
        <p style="margin:0 0 6px">${u.address ? `${esc(u.address)}<br>${esc(u.zip)} ${esc(u.city)}${u.province ? ', ' + esc(u.province) : ''} · ${esc(u.country)}` : `<span class="muted">${L('Adres kaydedilmemiş', 'Sin dirección guardada')}</span>`}</p>
        <p style="margin:0">🚗 ${esc(carText(u.car)) || `<span class="muted">${L('Araba kaydedilmemiş', 'Sin coche guardado')}</span>`}</p>
      </div>
    </div>
    <h3>${L('Siparişleri', 'Sus pedidos')}</h3>
    <div id="custOrders">${orders.length ? orders.map(orderHtml).join('') : `<p class="muted">${L('Bu müşterinin siparişi yok.', 'Este cliente no tiene pedidos.')}</p>`}</div>
    <div class="box" style="margin-top:24px">
      <h3>${L('Hesap', 'Cuenta')}</h3>
      <p class="muted small">${L('Müşteri şifresini unutursa geçici bir şifre belirleyip ona WhatsApp/e-posta ile gönder; müşteri girişten sonra kendi değiştirebilir.',
        'Si el cliente olvida su contraseña, pon una temporal y envíasela por WhatsApp/email; después de entrar puede cambiarla.')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="in" id="newPw" placeholder="${L('Yeni geçici şifre (en az 8)', 'Nueva contraseña temporal (mín. 8)')}" style="max-width:280px">
        <button class="btn sm" id="setPw">${L('Şifreyi ayarla', 'Cambiar contraseña')}</button>
        <button class="btn danger sm" id="delU" style="margin-left:auto">${L('Hesabı sil', 'Borrar cuenta')}</button>
      </div>
    </div>`;
  $('#back').addEventListener('click', show);
  bindOrderCards($('#custOrders'), () => viewCustomer(id));
  $('#setPw').addEventListener('click', async () => {
    try { await send(`/api/admin/customers/${id}/password`, { password: $('#newPw').value }); toast(L('Şifre değişti', 'Contraseña cambiada')); $('#newPw').value = ''; }
    catch (e) { toast(e.message); }
  });
  $('#delU').addEventListener('click', async () => {
    if (!confirm(L('Bu müşteri hesabı silinsin mi? Siparişleri kayıtlarda kalır.', '¿Borrar la cuenta de este cliente? Sus pedidos se conservan.'))) return;
    await api('/api/admin/customers/' + id, { method: 'DELETE' }); toast(L('Silindi', 'Borrado')); show();
  });
}

/* ---------- Cayma talepleri ---------- */
async function viewWithdrawals() {
  const list = await api('/api/admin/withdrawals');
  root.innerHTML = `
    <div class="section-head"><h2>${L('Cayma talepleri', 'Desistimientos')}</h2></div>
    <p class="notice" style="margin-bottom:16px">${L(`Müşteri "Desistir del contrato aquí" formunu doldurunca burada görünür ve müşteriye otomatik onay e-postası gider.
    Yapman gereken: müşteriye iade adresini yaz, ürün gelince parayı 14 gün içinde geri öde, siparişi "İptal" yap (stok geri eklenir), sonra burada "Tamamlandı" işaretle.
    EVO (kişiye özel) ürünlerde kusur yoksa cayma hakkı yok.`, `Cuando el cliente rellena el formulario "Desistir del contrato aquí" aparece aquí y recibe un email de confirmación automático.
    Lo que tienes que hacer: escribe al cliente la dirección de devolución, cuando llegue el producto devuelve el dinero en 14 días, pon el pedido en "Cancelado" (el stock se repone) y marca aquí "Hecho".
    Las alfombrillas EVO (a medida) no tienen desistimiento salvo defecto.`)}</p>
    ${list.length ? list.map(w => {
      const items = JSON.parse(w.items);
      const wa = waUrl(w.phone, `Vornetic — ${w.ref}`);
      return `<div class="order" data-id="${w.id}" style="${w.handled ? 'opacity:.55' : ''}">
        <div class="order-head"><div><b>${esc(w.ref)}</b> · <span class="muted">${esc(day(w.created_at))}</span> · ${esc(w.name)}</div>
          <span class="status ${w.handled ? 'delivered' : 'pending'}">${w.handled ? L('Tamamlandı', 'Hecho') : L('Bekliyor', 'Pendiente')}</span></div>
        <div class="small">${items.map(i => `${i.qty}× ${esc(i.name)}${i.car ? ' (' + esc(i.car) + ')' : ''}`).join(' · ')} · ${L('Toplam', 'Total')} ${eur(w.total_cents)} · ${L('sipariş durumu', 'estado del pedido')}: ${STATUS()[w.order_status]}</div>
        ${w.message ? `<p class="notice" style="margin-top:8px">${esc(w.message)}</p>` : ''}
        <div class="order-actions">
          <a class="link small" href="mailto:${esc(w.email)}">${esc(w.email)}</a>${wa ? ` · <a class="link small" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn ghost sm hd" style="margin-left:auto">${w.handled ? L('Geri al', 'Deshacer') : L('Tamamlandı', 'Hecho')}</button>
        </div></div>`;
    }).join('') : `<p class="muted">${L('Cayma talebi yok.', 'No hay desistimientos.')}</p>`}`;
  $$('.order .hd').forEach(b => b.addEventListener('click', async () => {
    const el = b.closest('.order');
    const handled = !el.style.opacity;
    await send('/api/admin/withdrawals/' + el.dataset.id, { handled });
    await refreshMe(); show();
  }));
}

/* ---------- Ampul listesi (arabaya göre) ---------- */
async function viewBulbs() {
  const d = await api('/api/admin/bulbs');
  const why = L({ format: 'biçim hatalı (4 parça olmalı, | ile ayrılmış)', car: 'araba listede yok — marka/model/kasa cars.txt ile birebir aynı olmalı', key: 'anahtar hatalı (low, high, fog, xenon)' },
    { format: 'formato incorrecto (4 partes separadas por |)', car: 'el coche no está en la lista — marca/modelo/generación deben ser idénticos a cars.txt', key: 'clave incorrecta (low, high, fog, xenon)' });
  const errs = e => e.length ? `<div class="notice err" style="margin-bottom:12px">${L(`${e.length} satır kullanılmıyor`, `${e.length} filas no se usan`)}:<br>${e.map(([n, line, r]) =>
    `${L('Satır', 'Fila')} ${n}: <span class="mono">${esc(line)}</span> — ${why[r]}`).join('<br>')}</div>` : '';
  root.innerHTML = `
    <div class="section-head"><h2>${L('Ampul listesi', 'Lista de bombillas')} <span class="muted" style="font-weight:400">(${d.count} ${L('araba', 'coches')})</span></h2></div>
    <p class="notice" style="margin-bottom:12px">${L(`Müşteri arabasını seçince "Bombillas de tu coche" kutusunda bu bilgiler görünür ve doğru ürüne gider.
    Listede olmayan arabada müşteriye "ampulündeki kodu kontrol et veya WhatsApp'tan sor" yazar.<br>
    <b>İlk liste benim bilgime dayanıyor — satıştan önce kendi bildiklerinle kontrol et.</b> Emin olmadığın satırı sil ya da anahtarı çıkar.`,
    `Cuando el cliente elige su coche, estos datos salen en "Bombillas de tu coche" y llevan al producto correcto.
    Para un coche que no está en la lista, al cliente se le dice "mira el código de tu bombilla o pregúntanos por WhatsApp".<br>
    <b>La primera lista se hizo con datos generales — revísala con lo que sabes antes de vender.</b> Si no estás seguro de una fila, bórrala o quita la clave.`)}</p>
    <div class="help">${L(`Biçim:  Marka | Model | Kasa | low=H7, high=H1, fog=H11, xenon=D1S
low = kısa far (halojen) · high = uzun far · fog = sis · xenon = fabrikadan xenonlu araçta kısa far
H4 tek ampulle kısa+uzun far demek: sadece low=H4 yaz.
Marka / model / kasa adını "Araç seç" listesindekiyle birebir aynı yaz (ör. BMW | 3 Series | E90/E91/E92/E93).`,
`Formato:  Marca | Modelo | Generación | low=H7, high=H1, fog=H11, xenon=D1S
low = cruce (halógena) · high = carretera · fog = antiniebla · xenon = cruce en coches con xenón de fábrica
H4 es una sola bombilla para cruce y carretera: escribe solo low=H4.
Escribe marca / modelo / generación exactamente como en la lista "Elige tu coche" (ej. BMW | 3 Series | E90/E91/E92/E93).`)}</div>
    <div id="bErr">${errs(d.errors)}</div>
    <textarea class="in mono" id="bText" rows="24" spellcheck="false">${esc(d.text)}</textarea>
    <div class="row-end" style="margin-top:12px"><button class="btn" id="bSave">${L('Kaydet', 'Guardar')}</button></div>`;
  $('#bSave').addEventListener('click', async () => {
    try {
      const r = await send('/api/admin/bulbs', { text: $('#bText').value });
      $('#bErr').innerHTML = errs(r.errors);
      toast(L(`Kaydedildi · ${r.count} araba`, `Guardado · ${r.count} coches`));
    } catch (e) { toast(e.message); }
  });
}

/* ---------- Medya yükleme (fotoğraflar telefonda küçültülür) ---------- */
async function shrinkImage(file) {
  if (!file.type.startsWith('image/') || file.size < 400 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
// Upload limits from the server (GET /api/admin/me), with the same defaults
const uploadLimits = limits => ({ photo_mb: 12, video_mb: 80, photo_ext: ['.jpg', '.jpeg', '.png', '.webp'], video_ext: ['.mp4', '.webm'], ...limits });
// Which selected files to try: the right type, and videos not over the limit (they are sent as they
// are, so a too-big one is skipped before using any bandwidth). Photos are NOT size-checked here:
// a big camera photo is usually shrunk well under the limit first (shrinkImage, see photoTooBig).
function planUploads(list, limits) {
  const lim = uploadLimits(limits);
  const send = [], skipped = [];
  for (const f of list) {
    const ext = (/\.[^.]+$/.exec(f.name || '') || [''])[0].toLowerCase();
    const video = lim.video_ext.includes(ext), photo = lim.photo_ext.includes(ext);
    if (!video && !photo) skipped.push(`${f.name}: ${L('sadece JPG, PNG, WEBP fotoğraf veya MP4, WEBM video', 'solo fotos JPG, PNG, WEBP o vídeos MP4, WEBM')}`);
    else if (video && f.size > lim.video_mb * 1024 * 1024) skipped.push(`${f.name}: ${L(`video en fazla ${lim.video_mb} MB`, `vídeo de ${lim.video_mb} MB como máximo`)}`);
    else send.push(f);
  }
  return { send, skipped };
}
// After shrinking: is this photo still over the limit? (message, or null when it can be sent)
function photoTooBig(original, shrunk, limits) {
  const lim = uploadLimits(limits);
  const ext = (/\.[^.]+$/.exec(original.name || '') || [''])[0].toLowerCase();
  if (!lim.photo_ext.includes(ext) || shrunk.size <= lim.photo_mb * 1024 * 1024) return null;
  return `${original.name}: ${L(`küçültüldükten sonra bile ${lim.photo_mb} MB'tan büyük`, `pesa más de ${lim.photo_mb} MB incluso reducida`)}`;
}
// One file per request (the server accepts one), one after another, so every request stays under
// the server's and Nginx's size limit even when many large videos are selected together.
async function uploadFiles(files) {
  const { send, skipped } = planUploads([...files], ME.upload);
  const media = [];
  const note = document.createElement('div');
  note.className = 'toast';
  if (send.length) document.body.appendChild(note);
  try {
    for (const [i, f] of send.entries()) {
      note.textContent = `${f.type.startsWith('video/') ? L('Video yükleniyor', 'Subiendo vídeo') : L('Yükleniyor', 'Subiendo')} ${i + 1}/${send.length}… ${L('sayfayı kapatma', 'no cierres la página')}`;
      try {
        const ready = await shrinkImage(f);
        const tooBig = photoTooBig(f, ready, ME.upload);
        if (tooBig) { skipped.push(tooBig); continue; }
        const fd = new FormData();
        fd.append('files', ready);
        const r = await api('/api/admin/upload', { method: 'POST', body: fd });
        if (!r.media.length) skipped.push(`${f.name}: ${L(`alınmadı (fotoğraf en fazla ${ME.upload?.photo_mb || 12} MB)`, `no aceptado (foto de ${ME.upload?.photo_mb || 12} MB como máximo)`)}`);
        media.push(...r.media);
      } catch (e) { skipped.push(`${f.name}: ${e.message}`); }
    }
  } finally { note.remove(); }
  if (skipped.length) toast(`${L(`${skipped.length} dosya yüklenmedi`, `${skipped.length} archivos no subidos`)} — ${skipped.join(' · ')}`);
  return media;
}
const mediaThumb = m => m.type === 'video'
  ? `<div class="vt">▶<span>video</span></div>` : `<img src="${esc(m.src)}" alt="" loading="lazy">`;

/* ---------- Kategoriler ---------- */
let CATS = [];
const loadCats = async () => (CATS = await api('/api/admin/categories'));
const catName = slug => CATS.find(c => c.slug === slug)?.name_es || slug;

async function viewCategories() {
  await loadCats();
  root.innerHTML = `
    <div class="section-head"><h2>${L('Kategoriler', 'Categorías')}</h2><button class="btn sm" id="newCat">+ ${L('Yeni kategori', 'Nueva categoría')}</button></div>
    <p class="muted small">${L('Sıra küçük olan menüde önce görünür. Gizli kategori menüde ve sitede görünmez.', 'Las de orden más bajo salen antes en el menú. Una categoría oculta no sale ni en el menú ni en la web.')}</p>
    <div class="cat-list">${CATS.map(c => `<div class="prow">
      <img src="${esc(c.image || '/img/favicon.png')}" alt="">
      <div><b>${esc(c.name_es)}</b> <span class="muted">/ ${esc(c.name_en)}</span> ${c.active ? '' : `<span class="status cancelled">${L('Gizli', 'Oculta')}</span>`}<br>
        <span class="muted small">${c.products} ${L('ürün', 'productos')} · ${L('sıra', 'orden')} ${c.sort} · ${L('adres', 'dirección')} /c/${esc(c.slug)}</span></div>
      <div class="row-end"><button class="btn ghost sm" data-edit="${esc(c.slug)}">${L('Düzenle', 'Editar')}</button></div>
    </div>`).join('')}</div>`;
  $('#newCat').addEventListener('click', () => editCategory(null));
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => editCategory(CATS.find(c => c.slug === b.dataset.edit))));
}
function editCategory(c) {
  const isNew = !c;
  c = c ? { ...c } : { name_es: '', name_en: '', desc_es: '', desc_en: '', image: '', sort: (CATS.length + 1) * 10, active: 1 };
  root.innerHTML = `<div class="box" style="max-width:760px">
    <div class="section-head"><h2>${isNew ? L('Yeni kategori', 'Nueva categoría') : esc(c.name_es)}</h2><button class="btn ghost sm" id="back">← ${L('Kategoriler', 'Categorías')}</button></div>
    <div class="grid2">
      <label class="f"><span>${L('İsim — İspanyolca', 'Nombre — español')}</span><input class="in" id="cNameEs" value="${esc(c.name_es)}" placeholder="ej. Pantallas"></label>
      <label class="f"><span>${L('İsim — İngilizce', 'Nombre — inglés')}</span><input class="in" id="cNameEn" value="${esc(c.name_en)}" placeholder="e.g. Screens"></label>
    </div>
    <label class="f"><span>${L("Kısa açıklama — İspanyolca (kategori sayfasında ve Google'da görünür)", 'Descripción corta — español (sale en la página de la categoría y en Google)')}</span><textarea class="in" id="cDescEs" rows="2">${esc(c.desc_es)}</textarea></label>
    <label class="f"><span>${L('Kısa açıklama — İngilizce', 'Descripción corta — inglés')}</span><textarea class="in" id="cDescEn" rows="2">${esc(c.desc_en)}</textarea></label>
    <div class="grid2">
      <label class="f"><span>${L('Sıra', 'Orden')}</span><input class="in" id="cSort" type="number" value="${esc(c.sort)}"></label>
      <label class="chk" style="margin-top:28px"><input type="checkbox" id="cActive" ${c.active ? 'checked' : ''}> ${L('Sitede göster', 'Mostrar en la web')}</label>
    </div>
    <p class="muted small" style="margin-bottom:6px">${L('Kategori fotoğrafı (ana sayfadaki kutu)', 'Foto de la categoría (recuadro de la página de inicio)')}</p>
    <div class="mtiles" id="cImg">${c.image ? `<div class="mtile"><img src="${esc(c.image)}" alt=""><button class="mx" data-x>✕</button></div>` : ''}
      <label class="mtile add">+ ${L('Fotoğraf', 'Foto')}<input type="file" accept="image/*" hidden></label></div>
    <div class="savebar">
      ${!isNew ? `<button class="btn danger sm" id="cDel">${L('Sil', 'Borrar')}</button>` : ''}
      <button class="btn" id="cSave">${L('Kaydet', 'Guardar')}</button>
    </div></div>`;
  const drawImg = () => {
    $('#cImg').innerHTML = `${c.image ? `<div class="mtile"><img src="${esc(c.image)}" alt=""><button class="mx" data-x>✕</button></div>` : ''}
      <label class="mtile add">+ ${L('Fotoğraf', 'Foto')}<input type="file" accept="image/*" hidden></label>`;
    $('#cImg [data-x]')?.addEventListener('click', () => { c.image = ''; drawImg(); });
    $('#cImg input').addEventListener('change', async e => { const m = await uploadFiles(e.target.files); if (m[0]) { c.image = m[0].src; drawImg(); } });
  };
  drawImg();
  $('#back').addEventListener('click', show);
  $('#cSave').addEventListener('click', async () => {
    const body = { name_es: $('#cNameEs').value, name_en: $('#cNameEn').value, desc_es: $('#cDescEs').value, desc_en: $('#cDescEn').value,
      image: c.image, sort: $('#cSort').value, active: $('#cActive').checked };
    if (!body.name_en) body.name_en = body.name_es;
    try {
      await send('/api/admin/categories' + (isNew ? '' : '/' + c.slug), body, isNew ? 'POST' : 'PUT');
      toast(L('Kaydedildi', 'Guardado')); show();
    } catch (e) { toast(e.message); }
  });
  $('#cDel')?.addEventListener('click', async () => {
    if (!confirm(L('Kategori silinsin mi?', '¿Borrar la categoría?'))) return;
    try { await api('/api/admin/categories/' + c.slug, { method: 'DELETE' }); toast(L('Silindi', 'Borrado')); show(); }
    catch (e) { toast(e.message); }
  });
}

/* ---------- Ürünler ---------- */
const STATUS_P = () => L({ available: 'Satışta', soon: 'Yakında', hidden: 'Gizli' }, { available: 'A la venta', soon: 'Próximamente', hidden: 'Oculto' });
async function viewProducts() {
  const [list] = await Promise.all([api('/api/admin/products'), loadCats()]);
  const groups = CATS.map(c => [c, list.filter(p => p.category === c.slug)]);
  root.innerHTML = `
    <div class="section-head"><h2>${L('Ürünler', 'Productos')}</h2><button class="btn sm" id="newP">+ ${L('Yeni ürün', 'Nuevo producto')}</button></div>
    ${groups.map(([c, ps]) => `<h3 class="grp">${esc(c.name_es)} <span class="muted">(${ps.length})</span></h3>
      ${ps.length ? ps.map(p => `<div class="prow" data-id="${p.id}">
        <img src="${esc(p.media.find(m => m.type === 'image')?.src || '/img/favicon.png')}" alt="">
        <div><b>${esc(p.name_es)}</b> <span class="status ${p.status === 'available' ? 'delivered' : p.status === 'soon' ? 'paid' : 'cancelled'}">${STATUS_P()[p.status] || p.status}</span><br>
          <span class="muted small">${eur(p.price_cents)}${p.options.length ? ' · ' + p.options.map(o => `${o.values.length} ${esc(o.es)}`).join(' × ') : ''}${p.fitment === 'car' ? ` · ${L('arabaya özel', 'según coche')}` : ''}</span>
          <div class="stock">${L('Stok', 'Stock')} <button class="sbtn" data-d="-1" aria-label="${L('azalt', 'restar')}">−</button><b>${p.stock}</b><button class="sbtn" data-d="1" aria-label="${L('artır', 'sumar')}">+</button>${p.stock <= 3 && p.status === 'available' ? ` <span class="status pending">${L('az kaldı', 'quedan pocos')}</span>` : ''}</div></div>
        <div class="row-end"><a class="btn ghost sm" href="/p/${esc(p.slug)}" target="_blank">${L('Gör', 'Ver')}</a><button class="btn sm" data-edit>${L('Düzenle', 'Editar')}</button></div>
      </div>`).join('') : `<p class="muted small">${L('Bu kategoride ürün yok.', 'No hay productos en esta categoría.')}</p>`}`).join('')}`;
  $('#newP').addEventListener('click', () => editProduct(null));
  $$('.prow[data-id]').forEach(row => {
    const p = list.find(x => x.id === +row.dataset.id);
    $('[data-edit]', row).addEventListener('click', () => editProduct(p));
    $$('.sbtn', row).forEach(b => b.addEventListener('click', async () => {
      const r = await send(`/api/admin/products/${p.id}/stock`, { delta: +b.dataset.d }, 'POST');
      p.stock = r.stock; $('.stock b', row).textContent = r.stock;
    }));
  });
}

const OPTION_PRESETS = [
  ['Color', 'Colour'], ['Casquillo', 'Socket'], ['Temperatura de color', 'Colour temperature'],
  ['Tipo de bombilla', 'Bulb type'], ['Juego', 'Set'], ['Tamaño', 'Size'],
];
const euro = c => (c / 100).toFixed(2).replace('.', ',');
const toCents = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const newId = () => Math.random().toString(36).slice(2, 10);

function editProduct(src) {
  const isNew = !src;
  const P = src ? JSON.parse(JSON.stringify(src)) : {
    category: CATS[0]?.slug || '', fitment: 'universal', status: 'available',
    name_es: '', name_en: '', desc_es: '', desc_en: '', price_cents: 0, old_price_cents: null, stock: 10, sort: 50,
    options: [], combos: {}, media: [], manufacturer: '', eu_responsible: '', safety_es: '', safety_en: '',
  };
  let openMedia = null;     // which value / combination has its media panel open
  let comboFilter = '';
  let dirty = false;

  const allCombos = () => {
    let out = [[]];
    for (const o of P.options) { const n = []; for (const pr of out) for (const v of o.values) n.push([...pr, v]); out = n; }
    return P.options.length >= 2 ? out : [];
  };
  const keyOf = vals => vals.map(v => v.id).join('|');
  const basePrice = vals => P.price_cents + vals.reduce((a, v) => a + (v.delta || 0), 0);
  // media list for a target: 'p' | 'v:oi:vi' | 'c:key'
  const getList = ctx => {
    if (ctx === 'p') return P.media;
    if (ctx.startsWith('v:')) { const [, oi, vi] = ctx.split(':'); return P.options[oi].values[vi].media; }
    const k = ctx.slice(2); return (P.combos[k] = P.combos[k] || {}).media = P.combos[k].media || [];
  };
  const library = () => {
    const seen = new Set(), out = [];
    const add = m => { if (!seen.has(m.src)) { seen.add(m.src); out.push(m); } };
    P.media.forEach(add);
    P.options.forEach(o => o.values.forEach(v => v.media.forEach(add)));
    Object.values(P.combos).forEach(c => (c.media || []).forEach(add));
    return out;
  };

  const tiles = (ctx, withPicker) => {
    const list = getList(ctx);
    return `<div class="mtiles" data-ctx="${ctx}">
      ${list.map((m, i) => `<div class="mtile">${mediaThumb(m)}${ctx === 'p' && i === 0 ? `<span class="main">${L('Ana', 'Principal')}</span>` : ''}
        <div class="mctl">${i ? `<button type="button" data-act="mleft" data-i="${i}" aria-label="${L('sola', 'a la izquierda')}">‹</button>` : ''}${i < list.length - 1 ? `<button type="button" data-act="mright" data-i="${i}" aria-label="${L('sağa', 'a la derecha')}">›</button>` : ''}</div>
        <button type="button" class="mx" data-act="mdel" data-i="${i}" aria-label="${L('kaldır', 'quitar')}">✕</button></div>`).join('')}
      <label class="mtile add">+ ${L('Fotoğraf / video', 'Foto / vídeo')}<input type="file" accept="image/*,video/mp4,video/webm" multiple hidden data-up="${ctx}"></label>
    </div>
    ${withPicker && library().length ? `<p class="muted small" style="margin:10px 0 6px">${L('Ya da üründeki fotoğraflardan seç:', 'O elige entre las fotos del producto:')}</p>
      <div class="mtiles pick">${library().map(m => `<button type="button" class="mtile${list.some(x => x.src === m.src) ? ' on' : ''}" data-act="mpick" data-ctx="${ctx}" data-src="${esc(m.src)}">${mediaThumb(m)}</button>`).join('')}</div>` : ''}`;
  };

  const valueRow = (o, oi, v, vi) => {
    const ctx = `v:${oi}:${vi}`;
    return `<div class="vrow${v.soon ? ' soon' : ''}">
      <input class="in" data-k="ves" data-oi="${oi}" data-vi="${vi}" value="${esc(v.es)}" placeholder="${L('İspanyolca', 'Español')}" aria-label="${L('Değer İspanyolca', 'Valor en español')}">
      <input class="in" data-k="ven" data-oi="${oi}" data-vi="${vi}" value="${esc(v.en === v.es ? '' : v.en)}" placeholder="${L('İngilizce (aynıysa boş)', 'Inglés (vacío si es igual)')}" aria-label="${L('Değer İngilizce', 'Valor en inglés')}">
      <label class="delta"><span>+€</span><input class="in" data-k="vdelta" data-oi="${oi}" data-vi="${vi}" inputmode="decimal" value="${v.delta ? euro(v.delta) : ''}" placeholder="0"></label>
      <button type="button" class="btn ghost sm${openMedia === ctx ? ' on' : ''}" data-act="vmedia" data-ctx="${ctx}">📷 ${v.media.length || ''}</button>
      <button type="button" class="btn ghost sm${v.soon ? ' on' : ''}" data-act="vsoon" data-oi="${oi}" data-vi="${vi}" title="${L('Henüz elimde yok', 'Todavía no lo tengo')}">${L('Yakında', 'Próximamente')}</button>
      <button type="button" class="btn ghost sm" data-act="vdel" data-oi="${oi}" data-vi="${vi}" aria-label="${L('Sil', 'Borrar')}">✕</button>
      ${openMedia === ctx ? `<div class="vmedia"><p class="small" style="margin:0 0 8px">${L(`<b>${esc(v.es || 'Bu değer')}</b> seçilince gösterilecek fotoğraf ve videolar:`, `Fotos y vídeos que se muestran al elegir <b>${esc(v.es || 'este valor')}</b>:`)}</p>${tiles(ctx, true)}</div>` : ''}
    </div>`;
  };

  const optionsHtml = () => `
    ${P.options.map((o, oi) => `<div class="optcard">
      <div class="opthead">
        <input class="in" data-k="oes" data-oi="${oi}" value="${esc(o.es)}" placeholder="${L('Seçenek adı (ej. Color)', 'Nombre de la opción (ej. Color)')}" aria-label="${L('Seçenek adı İspanyolca', 'Nombre de la opción en español')}">
        <input class="in" data-k="oen" data-oi="${oi}" value="${esc(o.en)}" placeholder="${L('İngilizce (e.g. Colour)', 'Inglés (e.g. Colour)')}" aria-label="${L('Seçenek adı İngilizce', 'Nombre de la opción en inglés')}">
        <button type="button" class="btn ghost sm" data-act="odel" data-oi="${oi}">${L('Seçeneği sil', 'Borrar opción')}</button>
      </div>
      <div class="vlist">${o.values.map((v, vi) => valueRow(o, oi, v, vi)).join('')}</div>
      <div class="vadd"><input class="in" data-k="vnew" data-oi="${oi}" placeholder="${L('Yeni değer ekle — birden fazlası için virgül: D1S, D2S, D3S', 'Añadir valor — varios separados por comas: D1S, D2S, D3S')}">
        <button type="button" class="btn sm" data-act="vadd" data-oi="${oi}">${L('Ekle', 'Añadir')}</button></div>
    </div>`).join('')}
    ${P.options.length < 3 ? `<div class="presets"><span class="muted small">${L('Seçenek ekle:', 'Añadir opción:')}</span>
      ${OPTION_PRESETS.map(([es, en], i) => `<button type="button" class="chip" data-act="oadd" data-i="${i}">${esc(es)}</button>`).join('')}
      <button type="button" class="chip" data-act="oadd" data-i="-1">+ ${L('Başka', 'Otra')}</button></div>` : ''}`;

  const combosHtml = () => {
    const rows = allCombos();
    if (!rows.length) return '';
    const off = rows.filter(r => P.combos[keyOf(r)]?.off).length;
    const q = comboFilter.toLowerCase();
    const shown = q ? rows.filter(r => r.map(v => v.es).join(' ').toLowerCase().includes(q)) : rows;
    return `<details class="box" ${openMedia?.startsWith('c:') || comboFilter ? 'open' : ''}>
      <summary><b>${L('Kombinasyonlar', 'Combinaciones')}</b> <span class="muted">(${rows.length}${off ? ` · ${off} ${L('kapalı', 'desactivadas')}` : ''})</span></summary>
      <p class="muted small">${L('Satmadığın birleşimi kapat (ör. D2R + 8000K). Fiyat alanı boşsa otomatik hesaplanır (ana fiyat + farklar). İstersen bir birleşime özel fiyat ya da fotoğraf ver.',
        'Desactiva las combinaciones que no vendes (ej. D2R + 8000K). Si el precio está vacío se calcula solo (precio base + diferencias). Si quieres, pon a una combinación su propio precio o foto.')}</p>
      ${rows.length > 12 ? `<input class="in" data-k="cfilter" value="${esc(comboFilter)}" placeholder="${L('Ara: ör. D2R', 'Buscar: ej. D2R')}" style="margin-bottom:10px">` : ''}
      <div class="ctable">${shown.slice(0, 300).map(r => {
        const k = keyOf(r), c = P.combos[k] || {}, ctx = `c:${k}`;
        return `<div class="crow${c.off ? ' off' : ''}">
          <span class="clabel">${r.map(v => esc(v.es)).join(' · ')}</span>
          <label class="delta"><span>€</span><input class="in" data-k="cprice" data-key="${esc(k)}" inputmode="decimal" value="${Number.isInteger(c.price) ? euro(c.price) : ''}" placeholder="${euro(basePrice(r))}"></label>
          <button type="button" class="btn ghost sm${openMedia === ctx ? ' on' : ''}" data-act="vmedia" data-ctx="${ctx}">📷 ${(c.media || []).length || ''}</button>
          <button type="button" class="btn sm ${c.off ? 'ghost' : ''}" data-act="ctoggle" data-key="${esc(k)}">${c.off ? L('Kapalı', 'Desactivada') : L('Satışta', 'A la venta')}</button>
          ${openMedia === ctx ? `<div class="vmedia">${tiles(ctx, true)}</div>` : ''}
        </div>`;
      }).join('')}</div></details>`;
  };

  const draw = () => {
    const y = window.scrollY;
    root.innerHTML = `<div class="peditor">
      <div class="section-head"><h2>${isNew ? L('Yeni ürün', 'Nuevo producto') : esc(P.name_es || L('Ürün', 'Producto'))}</h2><button type="button" class="btn ghost sm" data-act="back">← ${L('Ürünler', 'Productos')}</button></div>

      <div class="box">
        <div class="grid2">
          <label class="f"><span>${L('Ürün adı — İspanyolca', 'Nombre — español')}</span><input class="in" data-f="name_es" value="${esc(P.name_es)}" placeholder="ej. Bombilla Xenón Pro"></label>
          <label class="f"><span>${L('Ürün adı — İngilizce', 'Nombre — inglés')}</span><input class="in" data-f="name_en" value="${esc(P.name_en)}" placeholder="e.g. Xenon Bulb Pro"></label>
        </div>
        <div class="grid2">
          <label class="f"><span>${L('Kategori', 'Categoría')}</span><select class="in" data-f="category">${CATS.map(c => `<option value="${esc(c.slug)}"${c.slug === P.category ? ' selected' : ''}>${esc(c.name_es)}</option>`).join('')}</select></label>
          <div class="f"><span class="lbl">${L('Durum', 'Estado')}</span><div class="seg">${Object.entries(STATUS_P()).map(([k, l]) => `<button type="button" data-act="status" data-v="${k}" class="${P.status === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        </div>
        <div class="f"><span class="lbl">${L('Tip', 'Tipo')}</span><div class="seg">
          <button type="button" data-act="fit" data-v="universal" class="${P.fitment !== 'car' ? 'on' : ''}">Universal</button>
          <button type="button" data-act="fit" data-v="car" class="${P.fitment === 'car' ? 'on' : ''}">${L('Arabaya özel (müşteri arabasını seçer)', 'Según coche (el cliente elige su coche)')}</button></div></div>
        <p class="muted small" style="margin:0">${L('Yakında = sitede görünür, "Próximamente" yazar, satın alınamaz. Gizli = sitede görünmez.', 'Próximamente = sale en la web con "Próximamente" y no se puede comprar. Oculto = no sale en la web.')}</p>
      </div>

      <div class="box"><h3>${L('Fiyat ve stok', 'Precio y stock')}</h3>
        <div class="grid3">
          <label class="f"><span>${L('Fiyat (€)', 'Precio (€)')}</span><input class="in" data-f="price_cents" data-money inputmode="decimal" value="${euro(P.price_cents)}"></label>
          <label class="f"><span>${L('Stok', 'Stock')}</span><input class="in" data-f="stock" type="number" min="0" value="${P.stock}"></label>
          <label class="f"><span>${L('Sıra', 'Orden')}</span><input class="in" data-f="sort" type="number" value="${P.sort}"></label>
        </div>
        <label class="f" style="margin:0"><span>${L('İndirimden önceki fiyat (€) — sadece son 30 günde gerçekten uyguladığın en düşük fiyat. Emin değilsen boş bırak.',
          'Precio antes del descuento (€) — solo el precio más bajo que aplicaste de verdad en los últimos 30 días. Si no estás seguro, déjalo vacío.')}</span>
          <input class="in" data-f="old_price_cents" data-money inputmode="decimal" value="${P.old_price_cents ? euro(P.old_price_cents) : ''}" placeholder="${L('boş', 'vacío')}"></label>
      </div>

      <div class="box"><h3>${L('Fotoğraf ve videolar', 'Fotos y vídeos')}</h3>
        <p class="muted small" style="margin-top:0">${L('İlk sıradaki ana fotoğraftır. Telefonla çektiğin fotoğraflar otomatik küçültülür. Video: MP4.', 'La primera es la foto principal. Las fotos del móvil se reducen solas. Vídeo: MP4.')}</p>
        ${tiles('p', false)}
      </div>

      <div class="box"><h3>${L('Seçenekler (varyantlar)', 'Opciones (variantes)')}</h3>
        <p class="muted small" style="margin-top:0">${L('Ör. "Casquillo": D1S, D2S… — her değere fiyat farkı, kendi fotoğraf/videosu ve "Yakında" işareti verebilirsin. Seçeneği olmayan ürün için boş bırak.',
          'Ej. "Casquillo": D1S, D2S… — a cada valor le puedes dar diferencia de precio, sus fotos/vídeos y la marca "Próximamente". Déjalo vacío si el producto no tiene opciones.')}</p>
        ${optionsHtml()}
      </div>

      ${combosHtml()}

      <div class="box"><h3>${L('Açıklama', 'Descripción')}</h3>
        <label class="f"><span>${L('İspanyolca', 'Español')}</span><textarea class="in" data-f="desc_es" rows="7">${esc(P.desc_es)}</textarea></label>
        <label class="f" style="margin:0"><span>${L('İngilizce', 'Inglés')}</span><textarea class="in" data-f="desc_en" rows="7">${esc(P.desc_en)}</textarea></label>
      </div>

      <details class="box"><summary><b>${L('Ürün güvenliği bilgisi', 'Seguridad del producto')}</b> <span class="muted">(${L('AB kuralı — ürün sayfasında görünür', 'norma UE — sale en la página del producto')})</span></summary>
        <div class="grid2" style="margin-top:12px">
          <label class="f"><span>${L('Üretici — ad, adres, e-posta/web (kutunun etiketinde)', 'Fabricante — nombre, dirección, email/web (en la etiqueta de la caja)')}</span><textarea class="in" data-f="manufacturer" rows="3">${esc(P.manufacturer)}</textarea></label>
          <label class="f"><span>${L("AB'deki sorumlu kişi — üretici AB dışındaysa (ithalatçı / toptancı)", 'Responsable en la UE — si el fabricante está fuera de la UE (importador / mayorista)')}</span><textarea class="in" data-f="eu_responsible" rows="3">${esc(P.eu_responsible)}</textarea></label>
        </div>
        <label class="f"><span>${L('Güvenlik uyarıları — İspanyolca', 'Advertencias de seguridad — español')}</span><textarea class="in" data-f="safety_es" rows="3">${esc(P.safety_es)}</textarea></label>
        <label class="f" style="margin:0"><span>${L('Güvenlik uyarıları — İngilizce', 'Advertencias de seguridad — inglés')}</span><textarea class="in" data-f="safety_en" rows="3">${esc(P.safety_en)}</textarea></label>
      </details>

      <div class="savebar">
        ${!isNew ? `<button type="button" class="btn danger sm" data-act="delete">${L('Sil', 'Borrar')}</button><a class="btn ghost sm" href="/p/${esc(P.slug)}" target="_blank">${L('Sitede gör', 'Ver en la web')}</a>` : ''}
        <span id="pErr" class="small" style="color:var(--bad)"></span>
        <button type="button" class="btn" data-act="save">${L('Kaydet', 'Guardar')}</button>
      </div>
    </div>`;
    window.scrollTo(0, y);
  };

  const ed = root;
  const onInput = e => {
    const el = e.target, k = el.dataset.k, f = el.dataset.f;
    dirty = true;
    if (f) P[f] = el.dataset.money !== undefined ? toCents(el.value) : (el.type === 'number' ? +el.value : el.value);
    if (!k) return;
    const o = P.options[el.dataset.oi], v = o?.values[el.dataset.vi];
    if (k === 'oes') o.es = el.value;
    if (k === 'oen') o.en = el.value;
    if (k === 'ves') { if (!v.en || v.en === v.es) v.en = el.value; v.es = el.value; }
    if (k === 'ven') v.en = el.value;
    if (k === 'vdelta') v.delta = toCents(el.value) || 0;
    if (k === 'cprice') { const c = P.combos[el.dataset.key] = P.combos[el.dataset.key] || {}; const n = toCents(el.value); if (n == null) delete c.price; else c.price = n; }
    if (k === 'cfilter') { comboFilter = el.value; const pos = el.selectionStart; draw(); const n = $('[data-k=cfilter]'); n?.focus(); n?.setSelectionRange(pos, pos); }
  };
  const addValues = oi => {
    const inp = $(`[data-k=vnew][data-oi="${oi}"]`);
    const parts = inp.value.split(',').map(x => x.trim()).filter(Boolean);
    for (const x of parts) P.options[oi].values.push({ id: newId(), es: x, en: x, delta: 0, soon: false, media: [] });
    if (parts.length) { dirty = true; draw(); $(`[data-k=vnew][data-oi="${oi}"]`)?.focus(); }
  };
  const onClick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act, oi = +b.dataset.oi, vi = +b.dataset.vi;
    if (a === 'back') { if (!dirty || confirm(L('Kaydedilmemiş değişiklikler var. Çıkılsın mı?', 'Hay cambios sin guardar. ¿Salir?'))) { cleanup(); show(); } return; }
    dirty = true;
    if (a === 'status') P.status = b.dataset.v;
    if (a === 'fit') P.fitment = b.dataset.v;
    if (a === 'oadd') {
      const pr = OPTION_PRESETS[+b.dataset.i] || ['', ''];
      P.options.push({ id: newId(), es: pr[0], en: pr[1], values: [] });
    }
    if (a === 'odel' && confirm(L('Bu seçenek ve tüm değerleri silinsin mi?', '¿Borrar esta opción y todos sus valores?'))) { P.options.splice(oi, 1); P.combos = {}; }
    if (a === 'vadd') return addValues(oi);
    if (a === 'vdel') { P.options[oi].values.splice(vi, 1); openMedia = null; }
    if (a === 'vsoon') P.options[oi].values[vi].soon = !P.options[oi].values[vi].soon;
    if (a === 'vmedia') openMedia = openMedia === b.dataset.ctx ? null : b.dataset.ctx;
    if (a === 'ctoggle') { const c = P.combos[b.dataset.key] = P.combos[b.dataset.key] || {}; c.off = !c.off; }
    if (a === 'mdel' || a === 'mleft' || a === 'mright') {
      const list = getList(b.closest('[data-ctx]').dataset.ctx), i = +b.dataset.i;
      if (a === 'mdel') list.splice(i, 1);
      else { const j = a === 'mleft' ? i - 1 : i + 1; [list[i], list[j]] = [list[j], list[i]]; }
    }
    if (a === 'mpick') {
      const list = getList(b.dataset.ctx), i = list.findIndex(m => m.src === b.dataset.src);
      if (i >= 0) list.splice(i, 1); else list.push(library().find(m => m.src === b.dataset.src));
    }
    if (a === 'save') return save();
    if (a === 'delete') {
      if (!confirm(L('Ürün kalıcı olarak silinsin mi? (Sadece saklamak için Durum → Gizli yap.)', '¿Borrar el producto para siempre? (Para solo esconderlo: Estado → Oculto.)'))) return;
      await api('/api/admin/products/' + P.id, { method: 'DELETE' }); cleanup(); toast(L('Silindi', 'Borrado')); show(); return;
    }
    draw();
  };
  const onChange = async e => {
    const up = e.target.dataset.up;
    if (up) {
      const media = await uploadFiles(e.target.files);
      getList(up).push(...media);
      dirty = true; draw();
      return;
    }
    onInput(e);
  };
  const onKey = e => { if (e.key === 'Enter' && e.target.dataset.k === 'vnew') { e.preventDefault(); addValues(+e.target.dataset.oi); } };
  async function save() {
    $('#pErr').textContent = '';
    for (const o of P.options) { o.en = o.en || o.es; for (const v of o.values) v.en = v.en || v.es; }
    if (!P.name_en) P.name_en = P.name_es;
    try {
      const r = await send('/api/admin/products' + (isNew ? '' : '/' + P.id), P, isNew ? 'POST' : 'PUT');
      dirty = false; cleanup(); toast(L('Kaydedildi', 'Guardado')); show();
      return r;
    } catch (err) { $('#pErr').textContent = err.message; }
  }
  function cleanup() {
    ed.removeEventListener('input', onInput); ed.removeEventListener('click', onClick);
    ed.removeEventListener('change', onChange); ed.removeEventListener('keydown', onKey);
  }
  ed.addEventListener('input', onInput);
  ed.addEventListener('click', onClick);
  ed.addEventListener('change', onChange);
  ed.addEventListener('keydown', onKey);
  // leaving through the top tabs also removes the listeners
  $('#tabs').addEventListener('click', cleanup, { once: true });
  draw();
  window.scrollTo(0, 0);
}

/* ---------- Özet ---------- */
/* ---------- Finans ---------- */
// Simple income / expense overview per month. Website money comes from orders automatically;
// everything else is added here or imported from CSV. All amounts in EUR.
// Today in the shop's calendar (Madrid), "YYYY-MM-DD". Not toISOString(): that is UTC, which is
// still "yesterday" between midnight and 01:00 (winter) / 02:00 (summer) in Spain. The server
// groups website money by Madrid months too, so both sides use the same calendar.
function shopToday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
let finMonth = shopToday().slice(0, 7), finSearch = '';
const FIN_LAST = 'vn-fin-last';     // last category used per type (only in this browser)
const lastCat = kind => { try { return JSON.parse(localStorage.getItem(FIN_LAST) || '{}')[kind]; } catch { return null; } };
const rememberCat = (kind, cat) => {
  try { const m = JSON.parse(localStorage.getItem(FIN_LAST) || '{}'); m[kind] = cat; localStorage.setItem(FIN_LAST, JSON.stringify(m)); } catch { /* private mode */ }
};
const monthName = m => new Date(m + '-15T00:00:00Z').toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Finance category names come from the server in Turkish (finance.js); Spanish by key
const FIN_CAT_ES = {
  income: { amazon: 'Amazon', wallapop: 'Wallapop', vinted: 'Vinted', wholesale: 'Mayorista / cliente directo', other: 'Otros ingresos' },
  expense: { storage: 'Almacén / alquiler', stock: 'Stock / compra de mercancía', shipping: 'Envíos / logística', customs: 'Aduana / importación',
    taxes: 'Impuestos (IVA, etc.)', gestor: 'Gestor / contable', platform_fees: 'Comisiones de plataformas',
    packaging: 'Embalaje', advertising: 'Publicidad', subscriptions: 'Suscripciones', other: 'Otros gastos' },
};
const finCats = C => LANG === 'es' ? Object.fromEntries(Object.entries(C).map(([kind, cats]) =>
  [kind, Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, FIN_CAT_ES[kind]?.[k] || v]))])) : C;
const FIN_SAMPLE = '﻿type;date;amount_eur;category;note;country;party;reference\r\n'
  + 'gelir;2026-10-05;45,90;Wallapop;Xenon D1S;ES;;\r\ngelir;2026-10-07;320,00;Toptan;10 set LED;PT;Auto Lisboa;F-2026-12\r\n'
  + 'gider;2026-10-01;150,00;Depo / kira;Ekim kirası;ES;;\r\ngider;2026-10-10;60,50;Gestor / muhasebeci;;ES;Gestoría;\r\n';

async function viewFinance() {
  const d = await api('/api/admin/finance?month=' + finMonth);
  const C = finCats(d.categories);
  const catName = (kind, k) => C[kind][k] || k;
  const right = 'style="text-align:right;white-space:nowrap"';
  const w = d.warnings;
  const notes = [
    w.needs_refund && L(`${w.needs_refund} iptal siparişte iade eksik (Siparişler'de ⚠ ile işaretli).`, `${w.needs_refund} pedidos cancelados con devolución incompleta (marcados con ⚠ en Pedidos).`),
    w.payment_unknown && L(`${w.payment_unknown} eski iptal siparişin ödeme durumu bilinmiyor; cevaplanana kadar gelire sayılmaz.`, `${w.payment_unknown} pedidos cancelados antiguos con pago desconocido; no cuentan como ingreso hasta responder.`),
    d.web.estimated_dates && L(`Bu ayın ${d.web.estimated_dates} web ödemesinin tarihi tahmini (eski sipariş tarihi).`, `La fecha de ${d.web.estimated_dates} pagos web de este mes es estimada (fecha del pedido antiguo).`),
  ].filter(Boolean);
  root.innerHTML = `
    <div class="section-head fin-head"><h2>${L('Finans', 'Finanzas')}</h2>
      <div class="fin-tools">
        <input class="in" type="month" id="fm" value="${d.month}" aria-label="${L('Ay', 'Mes')}">
        <a class="btn ghost sm" href="/api/admin/finance/export.xlsx?month=${d.month}" download>${L('Excel indir (bu ay)', 'Descargar Excel (este mes)')}</a>
        <a class="btn ghost sm" href="/api/admin/finance/export.xlsx" download>${L('Excel indir (tümü)', 'Descargar Excel (todo)')}</a>
        <a class="btn ghost sm" href="/api/admin/finance/export.csv?month=${d.month}" download>${L('CSV indir', 'Descargar CSV')}</a>
        <label class="btn ghost sm" style="cursor:pointer">${L('CSV içe aktar', 'Importar CSV')}<input type="file" id="fimp" accept=".csv,text/csv" hidden></label>
        <button class="btn ghost sm" id="fsample">${L('Örnek CSV', 'CSV de ejemplo')}</button>
      </div></div>
    <div class="stats fin-stats">
      <div><b>${eur(d.income_cents)}</b><span>${L('Toplam gelir', 'Ingresos totales')} · ${esc(monthName(d.month))}</span></div>
      <div><b>${eur(d.expense_cents)}</b><span>${L('Toplam gider', 'Gastos totales')}</span></div>
      <div><b style="color:${d.balance_cents < 0 ? 'var(--bad)' : 'var(--ok)'}">${eur(d.balance_cents)}</b><span>${L('Kalan (tahmini)', 'Saldo (estimado)')}</span></div>
    </div>
    <p class="muted small" style="margin-top:-12px">${L('Yönetim tahmini — resmi kâr veya vergi hesabı değildir. Ürün maliyetleri ve vergiler gider olarak girilmedikçe "kalan" kâr demek değildir.',
      'Estimación de gestión — no es un cálculo oficial de beneficio ni de impuestos. Si no apuntas el coste de producto y los impuestos como gastos, el "saldo" no es beneficio.')}</p>
    ${notes.length ? `<p class="notice">${notes.map(esc).join('<br>')}</p>` : ''}
    <div class="fin-tools" style="margin:14px 0"><button class="btn" id="addInc">+ ${L('Gelir ekle', 'Añadir ingreso')}</button><button class="btn" id="addExp">+ ${L('Gider ekle', 'Añadir gasto')}</button></div>
    <div id="fform"></div><div id="fimpres"></div>
    <div class="grid2">
      <div class="box"><h3>${L('Gelir', 'Ingresos')}</h3><table>
        <tr><td>${L('Web sitesi ödemeleri', 'Pagos de la web')} <span class="muted small">(${L(`${d.web.orders} sipariş · kargo ${eur(d.web.shipping_cents)} dahil`, `${d.web.orders} pedidos · envíos ${eur(d.web.shipping_cents)} incluidos`)})</span></td><td ${right}>${eur(d.web.payments_cents)}</td></tr>
        <tr><td>${L('Web sitesi iadeleri', 'Devoluciones de la web')} <span class="muted small">(${d.web.refunds})</span></td><td ${right}>− ${eur(d.web.refunds_cents)}</td></tr>
        ${d.manual_income.map(r => `<tr><td>${esc(catName('income', r.category))} <span class="muted small">(${r.n})</span></td><td ${right}>${eur(r.total_cents)}</td></tr>`).join('')}
        <tr><th>${L('Toplam', 'Total')}</th><th ${right}>${eur(d.income_cents)}</th></tr></table>
        <p class="muted small" style="margin-bottom:0">${L('Web satışları siparişlerden otomatik gelir (ödeme günü); iadeler iade gününde düşülür. Buradan eklenemez, böylece iki kez sayılmaz.',
          'Las ventas web vienen solas de los pedidos (día del pago); las devoluciones se restan el día de la devolución. No se añaden aquí, así no se cuentan dos veces.')}</p></div>
      <div class="box"><h3>${L('Gider', 'Gastos')}</h3>
        ${d.expenses.length ? `<table>${d.expenses.map(r => `<tr><td>${esc(catName('expense', r.category))} <span class="muted small">(${r.n})</span></td><td ${right}>${eur(r.total_cents)}</td></tr>`).join('')}
          <tr><th>${L('Toplam', 'Total')}</th><th ${right}>${eur(d.expense_cents)}</th></tr></table>` : `<p class="muted small">${L('Bu ay gider yok.', 'Sin gastos este mes.')}</p>`}</div>
    </div>
    <div class="section-head" style="margin:8px 0 10px"><h3 style="margin:0">${L('Kayıtlar', 'Movimientos')} · ${esc(monthName(d.month))} (${d.entries.length})</h3>
      <input class="in search" id="fq" placeholder="${L('Ara: not, kişi, referans', 'Buscar: nota, persona, referencia')}" value="${esc(finSearch)}" style="max-width:260px"></div>
    <div class="table-wrap" id="flist"></div>
    <div class="box" style="margin-top:16px"><h3>${L('Son 12 ay', 'Últimos 12 meses')}</h3><div style="overflow-x:auto"><table>
      <tr><th>${L('Ay', 'Mes')}</th><th ${right}>${L('Gelir', 'Ingresos')}</th><th ${right}>${L('Gider', 'Gastos')}</th><th ${right}>${L('Kalan', 'Saldo')}</th></tr>
      ${d.months.map(m => `<tr class="click" data-m="${m.month}"><td>${esc(monthName(m.month))}</td><td ${right}>${eur(m.income_cents)}</td>
        <td ${right}>${eur(m.expense_cents)}</td><td ${right}>${eur(m.balance_cents)}</td></tr>`).join('')}</table></div></div>`;

  const drawList = () => {
    const q = finSearch.toLowerCase();
    const list = q ? d.entries.filter(e => [e.note, e.party, e.reference, e.country, catName(e.kind, e.category)].join(' ').toLowerCase().includes(q)) : d.entries;
    $('#flist').innerHTML = list.length ? list.map(e => `<div class="fin-row" data-id="${e.id}">
      <div><b class="${e.kind === 'income' ? 'fin-in' : 'fin-out'}">${e.kind === 'income' ? '+' : '−'} ${eur(e.amount_cents)}</b>
        <span class="muted">· ${esc(e.date)} · ${esc(catName(e.kind, e.category))}</span>
        ${[e.note, e.party, e.reference, e.country].some(Boolean) ? `<br><small>${[e.note, e.party, e.reference && 'Ref ' + e.reference, e.country].filter(Boolean).map(esc).join(' · ')}</small>` : ''}</div>
      <div class="fin-tools"><button class="chip-btn small" data-act="edit">${L('Düzenle', 'Editar')}</button><button class="chip-btn small" data-act="copy">${L('Tekrarla', 'Repetir')}</button>
        <button class="chip-btn small" data-act="del">${L('Sil', 'Borrar')}</button></div></div>`).join('')
      : `<p class="muted" style="padding:12px;margin:0">${q ? L('Eşleşen kayıt yok.', 'Ningún movimiento coincide.') : L('Bu ay elle eklenmiş kayıt yok.', 'Este mes no hay movimientos añadidos a mano.')}</p>`;
    $$('.fin-row', $('#flist')).forEach(row => {
      const e = d.entries.find(x => x.id === +row.dataset.id);
      $$('[data-act]', row).forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.act === 'edit') return financeForm(e.kind, C, e);
        if (b.dataset.act === 'copy') return financeForm(e.kind, C, { ...e, id: undefined, date: shopToday() });
        if (!confirm(`${L('Bu kayıt silinsin mi?', '¿Borrar este movimiento?')}\n${e.kind === 'income' ? L('Gelir', 'Ingreso') : L('Gider', 'Gasto')} · ${e.date} · ${catName(e.kind, e.category)} · ${eur(e.amount_cents)}`)) return;
        try { await api('/api/admin/finance/entries/' + e.id, { method: 'DELETE' }); toast(L('Silindi', 'Borrado')); show(); }
        catch (err) { toast(err.message); }
      }));
    });
  };
  drawList();
  $('#fq').addEventListener('input', e => { finSearch = e.target.value; drawList(); });
  $('#fm').addEventListener('change', e => { if (e.target.value) { finMonth = e.target.value; show(); } });
  $$('tr[data-m]').forEach(tr => tr.addEventListener('click', () => { finMonth = tr.dataset.m; show(); }));
  $('#addInc').addEventListener('click', () => financeForm('income', C));
  $('#addExp').addEventListener('click', () => financeForm('expense', C));
  $('#fsample').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([FIN_SAMPLE], { type: 'text/csv' }));
    a.download = 'vornetic-finans-ornek.csv'; a.click(); URL.revokeObjectURL(a.href);
  });
  $('#fimp').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) financeImport(file, C); });
}

// Add / edit form: amount, category and date are enough; the rest is optional ("Daha fazla")
function financeForm(kind, C, e = {}) {
  const editing = !!e.id;
  const cat = e.category || lastCat(kind) || Object.keys(C[kind])[0];
  const more = [e.country, e.party, e.reference].some(Boolean);
  $('#fform').innerHTML = `<form class="box" id="ff">
    <h3>${editing ? L('Kaydı düzenle', 'Editar movimiento') : kind === 'income' ? L('Gelir ekle', 'Añadir ingreso') : L('Gider ekle', 'Añadir gasto')}</h3>
    <div class="grid2">
      <label class="f"><span>${L('Tutar (€)', 'Importe (€)')}</span><input class="in" name="amount" inputmode="decimal" placeholder="${L('ör. 12,50', 'ej. 12,50')}" required
        value="${e.amount_cents ? (e.amount_cents / 100).toFixed(2).replace('.', ',') : ''}"></label>
      <label class="f"><span>${kind === 'income' ? L('Kaynak', 'Origen') : L('Kategori', 'Categoría')}</span><select class="in" name="category">
        ${Object.entries(C[kind]).map(([k, l]) => `<option value="${k}"${k === cat ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    </div>
    <div class="grid2">
      <label class="f"><span>${L('Tarih', 'Fecha')}</span><input class="in" type="date" name="date" required value="${esc(e.date || shopToday())}"></label>
      <label class="f"><span>${L('Not (isteğe bağlı)', 'Nota (opcional)')}</span><input class="in" name="note" maxlength="300" value="${esc(e.note)}"></label>
    </div>
    <details${more ? ' open' : ''}><summary class="small muted" style="cursor:pointer;margin-bottom:10px">${L(`Daha fazla: ülke, ${kind === 'income' ? 'alıcı' : 'tedarikçi'}, fatura no`, `Más: país, ${kind === 'income' ? 'cliente' : 'proveedor'}, nº de factura`)}</summary>
      <div class="grid2">
        <label class="f"><span>${L('Ülke (ES, PT, FR…)', 'País (ES, PT, FR…)')}</span><input class="in" name="country" maxlength="2" value="${esc(e.country)}"></label>
        <label class="f"><span>${kind === 'income' ? L('Alıcı / firma', 'Cliente / empresa') : L('Tedarikçi', 'Proveedor')}</span><input class="in" name="party" maxlength="120" value="${esc(e.party)}"></label>
      </div>
      <label class="f"><span>${L('Fatura / referans no', 'Nº de factura / referencia')}</span><input class="in" name="reference" maxlength="60" value="${esc(e.reference)}"></label>
    </details>
    <div class="fin-tools"><button class="btn">${editing ? L('Kaydet', 'Guardar') : L('Ekle', 'Añadir')}</button><button type="button" class="btn ghost" id="fcancel">${L('Vazgeç', 'Cancelar')}</button></div>
  </form>`;
  const f = $('#ff');
  f.amount.focus();
  f.scrollIntoView({ block: 'nearest' });
  $('#fcancel').addEventListener('click', () => { $('#fform').innerHTML = ''; });
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const cents = parseEuro(f.amount.value);
    if (!cents) return toast(L('Geçersiz tutar — örnek: 12,50', 'Importe no válido — ejemplo: 12,50'));
    const body = { kind, amount_cents: cents, category: f.category.value, date: f.date.value,
      note: f.note.value, country: f.country.value, party: f.party.value, reference: f.reference.value };
    try {
      const r = editing ? await send('/api/admin/finance/entries/' + e.id, body) : await send('/api/admin/finance/entries', body, 'POST');
      rememberCat(kind, body.category);
      toast(r.possible_duplicate ? L('Kaydedildi — dikkat: aynı gün, tutar ve kategoride başka kayıt da var', 'Guardado — ojo: hay otro movimiento con el mismo día, importe y categoría') : L('Kaydedildi', 'Guardado'));
      finMonth = body.date.slice(0, 7);
      show();
    } catch (err) { toast(err.message); }
  });
}

// File bytes → text, only if they are valid UTF-8 (else null). Excel's plain "CSV" uses the old
// Windows encoding; reading it as UTF-8 garbles accents, and garbled rows look like new entries.
function readUtf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

// CSV import: first a preview (nothing saved), then one click saves all rows — or none, if any row has an error
async function financeImport(file, C) {
  const box = $('#fimpres');
  if (file.size > 120 * 1024) { box.innerHTML = `<p class="notice err">${L('Dosya çok büyük (en fazla 120 KB / 500 satır). Dosyayı böl.', 'Archivo demasiado grande (máximo 120 KB / 500 filas). Divídelo.')}</p>`; return; }
  const csv = readUtf8(await file.arrayBuffer());
  if (csv === null) {
    box.innerHTML = `<p class="notice err">${L('Dosya UTF-8 değil (Excel\'in normal "CSV" kaydı). Türkçe/İspanyolca harfler bozulur ve kayıtlar iki kez eklenebilir. '
      + 'Excel\'de <b>Farklı Kaydet → CSV UTF-8 (virgülle ayrılmış)</b> seçip tekrar yükle.',
      'El archivo no es UTF-8 (el "CSV" normal de Excel). Las letras con acento se estropean y los movimientos podrían añadirse dos veces. '
      + 'En Excel elige <b>Guardar como → CSV UTF-8 (delimitado por comas)</b> y súbelo de nuevo.')}</p>`;
    return;
  }
  let r;
  try { r = await send('/api/admin/finance/import', { csv, dry_run: true }, 'POST'); }
  catch (err) { box.innerHTML = `<p class="notice err">${esc(err.message)}</p>`; return; }
  const list = (items, fmt) => items.length ? `<ul class="small" style="margin:6px 0 0;padding-left:18px">${items.slice(0, 30).map(x => `<li>${fmt(x)}</li>`).join('')}${items.length > 30 ? `<li>… +${items.length - 30}</li>` : ''}</ul>` : '';
  box.innerHTML = `<div class="box"><h3>${L('İçe aktarma önizlemesi', 'Vista previa de la importación')} · ${esc(file.name)}</h3>
    <p style="margin:0">${L('Eklenecek', 'Se añadirán')}: <b>${r.add_count}</b> · ${L('Tekrar (atlanır)', 'Repetidos (se saltan)')}: <b>${r.duplicates.length}</b> · ${L('Web satırı (atlanır)', 'Filas de la web (se saltan)')}: <b>${r.ignored.length}</b> · ${L('Hata', 'Errores')}: <b style="color:${r.errors.length ? 'var(--bad)' : 'inherit'}">${r.errors.length}</b></p>
    ${r.errors.length ? `<p class="notice err" style="margin-top:10px">${L('Hataları dosyada düzeltip tekrar yükle — hata varken hiçbir satır kaydedilmez.', 'Corrige los errores en el archivo y súbelo de nuevo — con errores no se guarda ninguna fila.')}${list(r.errors, x => `${L('Satır', 'Fila')} ${x.line}: ${esc(x.msg)}`)}</p>` : ''}
    ${r.warnings.length ? `<p class="notice" style="margin-top:10px">${r.warnings.map(esc).join('<br>')}</p>` : ''}
    ${list(r.duplicates, x => `${L('Satır', 'Fila')} ${x.line}: ${esc(x.reason)}`)}
    ${r.add.length ? `<div class="table-wrap" style="margin-top:10px"><table><tr><th>${L('Satır', 'Fila')}</th><th>${L('Tür', 'Tipo')}</th><th>${L('Tarih', 'Fecha')}</th><th>${L('Kategori', 'Categoría')}</th><th style="text-align:right">${L('Tutar', 'Importe')}</th><th>${L('Not', 'Nota')}</th><th>${L('Kişi / firma', 'Persona / empresa')}</th><th>Ref</th></tr>
      ${r.add.slice(0, 20).map(x => `<tr><td>${x.line}</td><td>${x.kind === 'income' ? L('Gelir', 'Ingreso') : L('Gider', 'Gasto')}</td><td>${esc(x.date)}</td><td>${esc(C[x.kind][x.category] || x.category)}</td>
        <td style="text-align:right">${eur(x.amount_cents)}</td><td>${esc(x.note)}</td><td>${esc(x.party)}</td><td>${esc(x.reference)}</td></tr>`).join('')}</table></div>
      ${r.add.length > 20 ? `<p class="muted small">${L(`… ve ${r.add.length - 20} satır daha`, `… y ${r.add.length - 20} filas más`)}</p>` : ''}` : ''}
    <div class="fin-tools" style="margin-top:12px">
      ${!r.errors.length && r.add_count ? `<button class="btn" id="fimpgo">${L(`İçe aktar (${r.add_count} kayıt)`, `Importar (${r.add_count} movimientos)`)}</button>` : ''}
      <button class="btn ghost" id="fimpno">${L('Kapat', 'Cerrar')}</button></div></div>`;
  $('#fimpno').addEventListener('click', () => { box.innerHTML = ''; });
  $('#fimpgo')?.addEventListener('click', async () => {
    try { const done = await send('/api/admin/finance/import', { csv }, 'POST'); toast(L(`${done.saved} kayıt eklendi`, `${done.saved} movimientos añadidos`)); show(); }
    catch (err) { toast(err.message); }
  });
}

async function viewStats() {
  const s = await api('/api/admin/stats');
  root.innerHTML = `
    <div class="stats">
      <div><b>${s.pending}</b><span>${L('Ödeme bekleyen', 'Pendientes de pago')}</span></div>
      <div><b>${s.to_ship}</b><span>${L('Gönderilecek', 'Por enviar')}</span></div>
      ${s.needs_refund ? `<div><b>${s.needs_refund}</b><span>⚠ ${L('İadesi eksik iptal', 'Cancelados con devolución incompleta')}</span></div>` : ''}
      ${s.payment_unknown ? `<div><b>${s.payment_unknown}</b><span>⚠ ${L('Ödemesi bilinmeyen eski iptal', 'Cancelados antiguos con pago desconocido')}</span></div>` : ''}
      <div><b>${s.orders_30d}</b><span>${L('Sipariş (30 gün)', 'Pedidos (30 días)')}</span></div>
      <div><b>${eur(s.revenue_30d)}</b><span>${L(`Net tahsilat (30 gün): ödenen ${eur(s.paid_30d)} − iade ${eur(s.refunded_30d)}`, `Cobrado neto (30 días): pagado ${eur(s.paid_30d)} − devuelto ${eur(s.refunded_30d)}`)}</span></div>
      <div><b>${s.customers}</b><span>${L('Kayıtlı müşteri', 'Clientes registrados')}</span></div>
    </div>
    <div class="box"><h3>${L('Ürün görüntülenmeleri', 'Visitas a productos')}</h3>
      <table><tr><th>${L('Ürün', 'Producto')}</th><th>${L('7 gün', '7 días')}</th><th>${L('30 gün', '30 días')}</th></tr>
      ${s.views.map(v => `<tr><td>${esc(v.name)}</td><td>${v.d7 || 0}</td><td>${v.d30 || 0}</td></tr>`).join('')}</table>
    </div>`;
}

/* ---------- Ayarlar ---------- */
async function viewSettings() {
  const [s, me] = await Promise.all([api('/api/admin/settings'), api('/api/admin/me')]);
  const f = (k, label, extra = '') => `<label class="f"><span>${label}</span><input class="in" name="${k}" value="${esc(s[k])}" ${extra}></label>`;
  const m = (k, label) => `<label class="f"><span>${label}</span><input class="in" name="${k}" data-money inputmode="decimal" value="${toEuro(Number(s[k]))}"></label>`;
  root.innerHTML = `<form id="sf" style="max-width:820px">
    <h2>${L('Ayarlar', 'Ajustes')}</h2>
    <div class="box"><h3>${L('İletişim', 'Contacto')}</h3><div class="grid2">
      ${f('shop_email', L('E-posta', 'Email'))}${f('whatsapp', L('WhatsApp (ülke kodu ile, sadece rakam: 34600111222)', 'WhatsApp (con prefijo, solo números: 34600111222)'))}</div></div>
    <div class="box"><h3>${L('Kargo', 'Envíos')}</h3>
      <p class="muted small" style="margin-top:0">${L('Kanarya, Ceuta ve Melilla otomatik kapalı (posta koduna göre) — oralara KDV ve gümrük farklı.', 'Canarias, Ceuta y Melilla están cerradas automáticamente (por código postal) — allí el IVA y la aduana son distintos.')}</p>
      <div class="grid2">${m('ship_es_cents', L('İspanya yarımada (€)', 'España peninsular (€)'))}${m('free_es_cents', L('Yarımadada bu tutardan sonra ücretsiz (€) — 0 = hiç', 'Gratis en la península desde este importe (€) — 0 = nunca'))}</div>
      <div class="grid2">${m('ship_ib_cents', L('Balear Adaları (€)', 'Baleares (€)'))}${m('ship_pt_cents', L('Portekiz (€)', 'Portugal (€)'))}</div>
      <div class="grid2">${m('free_far_cents', L('Balear/Portekiz bu tutardan sonra ücretsiz (€) — 0 = hiç', 'Gratis a Baleares/Portugal desde este importe (€) — 0 = nunca'))}
        <label class="chk" style="margin-top:26px"><input type="checkbox" id="ptOn" ${s.ship_pt_on !== '0' ? 'checked' : ''}> ${L("Portekiz'e gönder", 'Enviar a Portugal')}</label></div></div>
    <div class="box"><h3>${L('E-posta', 'Email')}</h3>
      <p class="notice" style="margin:0 0 12px">${me.mail ? L('<b style="color:var(--ok)">Açık</b> — sipariş onayı, ödeme/kargo/iptal bildirimleri, cayma onayı ve şifre sıfırlama e-postaları gidiyor. Yeni siparişler yukarıdaki e-posta adresine bildirilir.',
          '<b style="color:var(--ok)">Activado</b> — se envían los emails de confirmación, pago/envío/cancelación, desistimiento y cambio de contraseña. Los pedidos nuevos se avisan al email de arriba.')
        : L('<b style="color:var(--bad)">Kapalı</b> — müşterilere sipariş onayı gitmiyor (AB\'de zorunlu). Açmak için README → "E-posta" bölümüne bak.',
          '<b style="color:var(--bad)">Desactivado</b> — los clientes no reciben la confirmación del pedido (obligatoria en la UE). Para activarlo mira README → "E-posta".')}</p>
      ${me.mail ? `<button type="button" class="btn ghost sm" id="testMail">${L('Test e-postası gönder', 'Enviar email de prueba')}</button>` : ''}</div>
    <div class="box"><h3>${L('Ödeme yöntemleri', 'Métodos de pago')}</h3>
      <p class="notice" style="margin-bottom:14px">${L('Kart ile ödeme', 'Pago con tarjeta')}: ${me.stripe ? `<b style="color:var(--ok)">${L('Açık (Stripe bağlı)', 'Activado (Stripe conectado)')}</b>` : L('Kapalı — açmak için sunucuyu <code>STRIPE_SECRET_KEY</code> ile başlat (README).', 'Desactivado — para activarlo arranca el servidor con <code>STRIPE_SECRET_KEY</code> (README).')}<br>
      ${L('Bizum ve havale: aşağıyı doldurursan ödeme sayfasında görünür. Hiçbiri yoksa müşteri "ödemeyi sonra konuşalım" seçeneğiyle sipariş verir.',
        'Bizum y transferencia: si rellenas los datos de abajo salen en la página de pago. Si no hay ningún método, el cliente pide con la opción "acordamos el pago después".')}</p>
      ${f('bizum_phone', L('Bizum telefon numarası', 'Teléfono de Bizum'))}
      <div class="grid2">${f('iban', 'IBAN')}${f('iban_holder', L('Hesap sahibi', 'Titular de la cuenta'))}</div>
      ${f('iban_bic', L('SWIFT / BIC (isteğe bağlı)', 'SWIFT / BIC (opcional)'))}
      <p class="muted small" style="margin:14px 0 6px">${L("Stripe ödeme sayfasında kartın yanında (önce Stripe Dashboard → Settings → Payment methods'ta aç; Stripe reddederse müşteri sadece kartla öder):",
        'En la página de pago de Stripe, junto a la tarjeta (actívalos antes en Stripe Dashboard → Settings → Payment methods; si Stripe los rechaza, el cliente paga solo con tarjeta):')}</p>
      <label class="chk"><input type="checkbox" id="spPaypal" ${s.stripe_paypal === '1' ? 'checked' : ''} ${me.stripe ? '' : 'disabled'}> PayPal</label>
      <label class="chk"><input type="checkbox" id="spRevolut" ${s.stripe_revolut === '1' ? 'checked' : ''} ${me.stripe ? '' : 'disabled'}> Revolut Pay</label></div>
    <div class="box"><h3>${L('Şirket bilgileri (yasal sayfalarda görünür)', 'Datos del titular (salen en las páginas legales)')}</h3>
      <div class="grid2">${f('company_name', L('Ticari ad (sitede görünen)', 'Nombre comercial (el que sale en la web)'))}${f('company_holder', L('Yasal ad soyad (Titular)', 'Nombre y apellidos legales (Titular)'))}</div>
      <div class="grid2">${f('company_nif', 'NIF / NIE')}${f('company_address', L('Adres', 'Dirección'))}</div></div>
    <button class="btn">${L('Kaydet', 'Guardar')}</button>
  </form>`;
  $('#sf').addEventListener('submit', async e => {
    e.preventDefault();
    const body = {};
    $$('input', e.target).forEach(i => {
      if (!i.name) return;
      body[i.name] = i.dataset.money !== undefined ? String(Math.round((parseFloat(i.value.replace(',', '.')) || 0) * 100)) : i.value;
    });
    body.ship_pt_on = $('#ptOn').checked ? '1' : '0';
    body.stripe_paypal = $('#spPaypal').checked ? '1' : '0';
    body.stripe_revolut = $('#spRevolut').checked ? '1' : '0';
    try { await send('/api/admin/settings', body); toast(L('Kaydedildi', 'Guardado')); }
    catch (err) { toast(err.message); }
  });
  $('#testMail')?.addEventListener('click', async () => {
    try { await send('/api/admin/test-mail', {}, 'POST'); toast(L('Gönderildi — gelen kutunu kontrol et', 'Enviado — revisa tu bandeja de entrada')); }
    catch (err) { toast(err.message); }
  });
}

// Language switch in the top bar: shows the OTHER language; redraws the current screen
function drawLang() {
  document.documentElement.lang = LANG;
  const b = $('#lang');
  b.textContent = LANG === 'es' ? 'TR' : 'ES';
  b.title = LANG === 'es' ? 'Türkçe' : 'Español';
  b.setAttribute('aria-label', b.title);
  $('#logout').textContent = L('Çıkış', 'Salir');
}
$('#lang').addEventListener('click', () => {
  // an open product editor or finance form would lose what was typed
  if (($('.peditor') || $('#ff')) && !confirm(L('Kaydedilmemiş değişiklikler kaybolabilir. Dil değiştirilsin mi?', 'Se pueden perder los cambios sin guardar. ¿Cambiar de idioma?'))) return;
  LANG = LANG === 'es' ? 'tr' : 'es';
  try { localStorage.setItem(LANG_KEY, LANG); } catch { /* private mode: this visit only */ }
  drawLang();
  // a click on the tab bar (not on a tab) lets an open product editor remove its listeners (editProduct → cleanup)
  $('#tabs').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  if ($('#logout').hidden) showLogin(); else { drawTabs(); show(); }
});
drawLang();
start();
})();

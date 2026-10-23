// mail.js — transactional e-mails (order confirmation, status updates, withdrawal, password reset)
// Works with any SMTP provider (Brevo, your domain's mail host, Gmail app password…).
// Configure with environment variables:
//   SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER, SMTP_PASS, MAIL_FROM ("Vornetic <info@vornetic.com>")
// Without them the shop still works; e-mails are just skipped (and logged).
const nodemailer = require('nodemailer');

const enabled = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const transporter = enabled ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;
const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || '';

if (!enabled) console.warn('⚠  E-mail is off (SMTP_* not set). Order confirmations will not be sent.');

async function send(to, subject, html) {
  if (!enabled || !to) return false;
  try {
    await transporter.sendMail({ from: FROM, to, subject, html, text: toText(html) });
    return true;
  } catch (e) {
    console.error('Mail error:', e.message);
    return false;
  }
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const eur = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const toText = html => html
  .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, (m, href, label) => label === href ? href : `${label} (${href})`)
  .replace(/\s*\n\s*/g, ' ').replace(/<\/td>/g, '   ').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|div|tr|h\d)>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/^[ \t]+|[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

function layout(body, s) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1c1c1e;max-width:600px;margin:0 auto;font-size:15px;line-height:1.5">
  <div style="background:#000;color:#fff;padding:16px 20px;font-weight:bold;letter-spacing:3px">VORNETIC</div>
  <div style="padding:20px;border:1px solid #e5e5e2;border-top:0">${body}</div>
  <p style="color:#6e6e73;font-size:12px;padding:12px 20px">${esc(s.company_name)}${s.company_nif ? ' · NIF ' + esc(s.company_nif) : ''}${s.company_address ? ' · ' + esc(s.company_address) : ''} · ${esc(s.shop_email)}</p>
</div>`;
}

const L = {
  en: {
    conf_subject: ref => `Order ${ref} received — Vornetic`,
    hello: n => `Hello ${n},`,
    conf_intro: 'Thank you for your order. This is your order confirmation.',
    paid_intro: 'We have received your payment. We are preparing your order.',
    order: 'Order', product: 'Product', qty: 'Qty', price: 'Price', subtotal: 'Subtotal', shipping: 'Shipping', total: 'Total (VAT incl.)', free: 'Free',
    ship_to: 'Shipping address', payment: 'Payment',
    pay_bizum: (p, a, r) => `Please send <b>${a}</b> by Bizum to <b>${p}</b> with the concept <b>${r}</b>. We ship as soon as it arrives.`,
    pay_transfer: (i, h, a, r) => `Please transfer <b>${a}</b> to IBAN <b>${i}</b>${h ? ` (${h})` : ''} with the concept <b>${r}</b>. We ship as soon as it arrives.`,
    pay_contact: 'We will contact you shortly with the payment details.',
    pay_card: 'Paid by card.',
    rights: (base) => `You can withdraw from this purchase within 14 days of delivery without giving a reason: <a href="${base}/withdraw">withdraw from contract here</a>. Made-to-measure EVO mats are excluded unless faulty. Terms of sale: <a href="${base}/info/terms">${base}/info/terms</a>.`,
    account: base => `You can follow your order in <a href="${base}/account/orders">your account</a>.`,
    paid_subject: ref => `Payment received — order ${ref}`,
    shipped_subject: ref => `Your order ${ref} is on its way`,
    shipped_intro: 'Good news: your order has been shipped.',
    tracking: 'Tracking number',
    cancelled_subject: ref => `Order ${ref} cancelled`,
    cancelled_intro: 'Your order has been cancelled. If you already paid, we will refund you in full. Reply to this e-mail if you have any question.',
    expired_subject: ref => `Order ${ref} cancelled — payment not received`,
    expired_intro: 'We have cancelled your order because we did not receive the payment within 5 days, as stated in our terms of sale. If you have paid in the meantime, reply to this e-mail and we will sort it out (we will send the order or refund you in full).',
    charged_cancelled_subject: ref => `Payment received for cancelled order ${ref} — refund on its way`,
    charged_cancelled_intro: a => `We received your card payment of <b>${a}</b>, but this order had already been cancelled, so it will <b>not</b> be shipped. We will refund the full amount to your card. Reply to this e-mail if you have any question.`,
    wd_subject: ref => `Withdrawal received — order ${ref}`,
    wd_intro: (ref, when) => `We have received your withdrawal from order <b>${ref}</b> on ${when}.`,
    wd_next: 'We will send you the return instructions shortly. We will refund the amount within 14 days of receiving the products back.',
    reset_subject: 'Reset your password — Vornetic',
    reset_body: link => `Click the link below to choose a new password. It is valid for 1 hour.<br><br><a href="${link}">${link}</a><br><br>If you did not ask for this, ignore this e-mail.`,
    bye: 'Thank you,<br>Vornetic',
  },
  es: {
    conf_subject: ref => `Pedido ${ref} recibido — Vornetic`,
    hello: n => `Hola ${n}:`,
    conf_intro: 'Gracias por tu pedido. Esta es la confirmación de tu compra.',
    paid_intro: 'Hemos recibido tu pago. Estamos preparando tu pedido.',
    order: 'Pedido', product: 'Producto', qty: 'Ud.', price: 'Precio', subtotal: 'Subtotal', shipping: 'Envío', total: 'Total (IVA incl.)', free: 'Gratis',
    ship_to: 'Dirección de envío', payment: 'Pago',
    pay_bizum: (p, a, r) => `Envía <b>${a}</b> por Bizum al <b>${p}</b> con el concepto <b>${r}</b>. Enviamos en cuanto lo recibamos.`,
    pay_transfer: (i, h, a, r) => `Haz una transferencia de <b>${a}</b> al IBAN <b>${i}</b>${h ? ` (${h})` : ''} con el concepto <b>${r}</b>. Enviamos en cuanto la recibamos.`,
    pay_contact: 'Te contactaremos en breve con los datos de pago.',
    pay_card: 'Pagado con tarjeta.',
    rights: (base) => `Puedes desistir de esta compra en los 14 días siguientes a la entrega sin dar explicaciones: <a href="${base}/withdraw">desistir del contrato aquí</a>. Las alfombrillas EVO a medida quedan excluidas salvo defecto. Condiciones de venta: <a href="${base}/info/terms">${base}/info/terms</a>.`,
    account: base => `Puedes seguir tu pedido en <a href="${base}/account/orders">tu cuenta</a>.`,
    paid_subject: ref => `Pago recibido — pedido ${ref}`,
    shipped_subject: ref => `Tu pedido ${ref} está en camino`,
    shipped_intro: 'Buenas noticias: hemos enviado tu pedido.',
    tracking: 'Número de seguimiento',
    cancelled_subject: ref => `Pedido ${ref} cancelado`,
    cancelled_intro: 'Tu pedido ha sido cancelado. Si ya habías pagado, te devolveremos el importe completo. Responde a este email si tienes cualquier duda.',
    expired_subject: ref => `Pedido ${ref} cancelado — no hemos recibido el pago`,
    expired_intro: 'Hemos cancelado tu pedido porque no hemos recibido el pago en 5 días, como indican nuestras condiciones de venta. Si ya has pagado, responde a este email y lo solucionamos (te enviamos el pedido o te devolvemos el importe completo).',
    charged_cancelled_subject: ref => `Pago recibido para el pedido cancelado ${ref} — te lo devolvemos`,
    charged_cancelled_intro: a => `Hemos recibido tu pago con tarjeta de <b>${a}</b>, pero este pedido ya estaba cancelado, así que <b>no</b> se enviará. Te devolveremos el importe completo a tu tarjeta. Responde a este email si tienes cualquier duda.`,
    wd_subject: ref => `Desistimiento recibido — pedido ${ref}`,
    wd_intro: (ref, when) => `Hemos recibido tu desistimiento del pedido <b>${ref}</b> el ${when}.`,
    wd_next: 'Te enviaremos en breve las instrucciones de devolución. Te devolveremos el importe en un máximo de 14 días desde que recibamos los productos.',
    reset_subject: 'Cambia tu contraseña — Vornetic',
    reset_body: link => `Pulsa el enlace para elegir una nueva contraseña. Es válido durante 1 hora.<br><br><a href="${link}">${link}</a><br><br>Si no lo has pedido tú, ignora este email.`,
    bye: 'Gracias,<br>Vornetic',
  },
};
const T = lang => L[lang === 'en' ? 'en' : 'es'];

function itemsTable(o, lang) {
  const t = T(lang);
  const items = JSON.parse(o.items);
  const row = (a, b, c, bold) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${a}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${b}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right${bold ? ';font-weight:bold' : ''}">${c}</td></tr>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
    <tr style="color:#6e6e73"><td>${t.product}</td><td style="text-align:center">${t.qty}</td><td style="text-align:right">${t.price}</td></tr>
    ${items.map(i => {
      const name = lang === 'es' && i.name_es ? i.name_es : i.name;
      const opts = lang === 'es' && i.options_es ? i.options_es : i.options || [];
      return row(`<b>${esc(name)}</b>${i.car ? `<br><span style="color:#6e6e73">${esc(i.car)}</span>` : ''}${opts.length ? `<br><span style="color:#6e6e73">${esc(opts.join(' · '))}</span>` : ''}`,
        i.qty, eur(i.unit_cents * i.qty));
    }).join('')}
    ${row(t.subtotal, '', eur(o.subtotal_cents))}
    ${row(t.shipping, '', o.shipping_cents ? eur(o.shipping_cents) : t.free)}
    ${row(t.total, '', eur(o.total_cents), true)}
  </table>`;
}
const address = o => `${esc(o.customer_name)}<br>${esc(o.address)}<br>${esc(o.zip)} ${esc(o.city)}${o.province ? ', ' + esc(o.province) : ''} (${esc(o.country)})<br>${esc(o.phone)}`;

function paymentLine(o, s, lang) {
  const t = T(lang), a = eur(o.total_cents);
  if (o.payment_method === 'bizum') return t.pay_bizum(esc(s.bizum_phone), a, esc(o.ref));
  if (o.payment_method === 'transfer') return t.pay_transfer(esc(s.iban), esc(s.iban_holder), a, esc(o.ref));
  if (o.payment_method === 'card') return t.pay_card;
  return t.pay_contact;
}

// ---------- Customer e-mails ----------
function orderConfirmation(o, s, base) {
  const t = T(o.lang);
  const intro = o.payment_method === 'card' ? t.paid_intro : t.conf_intro;
  return send(o.email, t.conf_subject(o.ref), layout(`
    <p>${t.hello(esc(o.customer_name))}</p><p>${intro}</p>
    <p><b>${t.order}: ${esc(o.ref)}</b></p>
    ${itemsTable(o, o.lang)}
    <p><b>${t.payment}</b><br>${paymentLine(o, s, o.lang)}</p>
    <p><b>${t.ship_to}</b><br>${address(o)}</p>
    ${o.user_id ? `<p>${t.account(base)}</p>` : ''}
    <p style="font-size:13px;color:#6e6e73">${t.rights(base)}</p>
    <p>${t.bye}</p>`, s));
}

function statusUpdate(o, s, base) {
  const t = T(o.lang);
  if (o.status === 'paid' && o.payment_method !== 'card') {
    return send(o.email, t.paid_subject(o.ref), layout(`<p>${t.hello(esc(o.customer_name))}</p><p>${t.paid_intro}</p>
      <p><b>${t.order}: ${esc(o.ref)}</b></p>${itemsTable(o, o.lang)}<p>${t.bye}</p>`, s));
  }
  if (o.status === 'shipped') {
    return send(o.email, t.shipped_subject(o.ref), layout(`<p>${t.hello(esc(o.customer_name))}</p><p>${t.shipped_intro}</p>
      <p><b>${t.order}: ${esc(o.ref)}</b>${o.tracking ? `<br>${t.tracking}: <b>${esc(o.tracking)}</b>` : ''}</p>
      <p><b>${t.ship_to}</b><br>${address(o)}</p>
      ${o.user_id ? `<p>${t.account(base)}</p>` : ''}<p>${t.bye}</p>`, s));
  }
  if (o.status === 'cancelled') {
    return send(o.email, t.cancelled_subject(o.ref), layout(`<p>${t.hello(esc(o.customer_name))}</p><p>${t.cancelled_intro}</p>
      <p><b>${t.order}: ${esc(o.ref)}</b></p><p>${t.bye}</p>`, s));
  }
  return Promise.resolve(false);
}

function withdrawalAck(w, o, s) {
  const t = T(o.lang);
  const when = new Date(w.created_at.replace(' ', 'T') + 'Z').toLocaleString(o.lang === 'en' ? 'en-GB' : 'es-ES', { timeZone: 'Europe/Madrid' });
  return send(w.email, t.wd_subject(o.ref), layout(`<p>${t.hello(esc(w.name))}</p>
    <p>${t.wd_intro(esc(o.ref), esc(when))}</p>${w.message ? `<p style="color:#6e6e73">“${esc(w.message)}”</p>` : ''}
    <p>${t.wd_next}</p><p>${t.bye}</p>`, s));
}

function passwordReset(email, lang, link, s) {
  const t = T(lang);
  return send(email, t.reset_subject, layout(`<p>${t.reset_body(esc(link))}</p><p>${t.bye}</p>`, s));
}

// ---------- Shop e-mails (to you) ----------
function shopNewOrder(o, s, base) {
  return send(s.shop_email, `🛒 Yeni sipariş ${o.ref} — ${eur(o.total_cents)}`, layout(`
    <p><b>${esc(o.ref)}</b> · ${esc(o.payment_method)} · ${eur(o.total_cents)}</p>
    ${itemsTable(o, 'es')}
    <p>${address(o)}<br>${esc(o.email)}</p>
    ${o.notes ? `<p><i>${esc(o.notes)}</i></p>` : ''}
    <p><a href="${base}/admin">Panel</a></p>`, s));
}
function shopWithdrawal(w, o, s, base) {
  return send(s.shop_email, `↩ Cayma talebi — ${o.ref}`, layout(`
    <p><b>${esc(o.ref)}</b> · ${esc(w.name)} · ${esc(w.email)}</p>
    ${w.message ? `<p>${esc(w.message)}</p>` : ''}${itemsTable(o, 'es')}<p><a href="${base}/admin">Panel</a></p>`, s));
}
// A card payment arrived for an order that was already cancelled: tell the customer it won't
// ship and will be refunded, and tell the shop a refund is owed.
function chargedAfterCancel(o, s) {
  const t = T(o.lang);
  return send(o.email, t.charged_cancelled_subject(o.ref), layout(`<p>${t.hello(esc(o.customer_name))}</p>
    <p>${t.charged_cancelled_intro(eur(o.total_cents))}</p><p><b>${t.order}: ${esc(o.ref)}</b></p><p>${t.bye}</p>`, s));
}
function shopChargedAfterCancel(o, s, base) {
  return send(s.shop_email, `⚠ İptal edilmiş sipariş ödendi — ${o.ref} — ${eur(o.total_cents)} iade et`, layout(`
    <p><b>${esc(o.ref)}</b> iptal edilmişti ama kartla ${eur(o.total_cents)} ödendi.
    Parayı müşteriye geri öde ve panelde "İade ekle" ile kaydet.</p>
    <p>${esc(o.customer_name)} · ${esc(o.email)}</p><p><a href="${base}/admin">Panel</a></p>`, s));
}
function test(s) {
  return send(s.shop_email, 'Vornetic — test e-mail', layout('<p>E-posta ayarları çalışıyor ✔</p>', s));
}

// A Bizum/transfer order was cancelled for non-payment within 5 days (terms of sale), after the
// admin checked the bank/Bizum. Returns true if the mail server accepted it (see flushExpiryMails).
function orderExpired(o, s) {
  const t = T(o.lang);
  return send(o.email, t.expired_subject(o.ref), layout(`<p>${t.hello(esc(o.customer_name))}</p><p>${t.expired_intro}</p>
    <p><b>${t.order}: ${esc(o.ref)}</b></p><p>${t.bye}</p>`, s));
}

module.exports = { enabled, orderConfirmation, statusUpdate, orderExpired, withdrawalAck, passwordReset, shopNewOrder, shopWithdrawal,
  chargedAfterCancel, shopChargedAfterCancel, test };

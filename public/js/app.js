/* Vornetic store — small single-page app, no dependencies */
(() => {
'use strict';

/* ================= i18n ================= */
const T = {
  en: {
    nav_car: 'Shop by car', nav_xenon: 'Xenon', nav_led: 'LED', nav_mats: 'Car mats', nav_home: 'Home',
    hero_title: 'Lighting and mats for your car',
    hero_lead: 'Xenon and LED bulbs, universal mats and EVO mats made to measure. Shipped from Spain.',
    finder_title: 'Find your car', brand: 'Brand', model: 'Model', gen: 'Generation', year: 'Year', engine: 'Engine',
    choose_brand: 'Brand', choose_model: 'Model', choose_gen: 'Generation', choose_year: 'Year',
    choose_engine: 'Engine (optional)',
    show: 'Show products', my_car: 'Your car', change: 'Change',
    not_listed: 'Car not listed? Message us and we will check it.',
    categories: 'Categories', all_products: 'All products',
    cat_xenon: 'Xenon bulbs', cat_led: 'LED bulbs', cat_mats: 'Car mats',
    cat_xenon_sub: 'D1S, D2S, D3S and more · 4 quality levels', cat_led_sub: 'H1, H4, H7, H11, 9005, 9006', cat_mats_sub: 'Universal and custom-fit EVO',
    fits_car: 'Made for your car', fits_all: 'Fits most cars', from: 'from', sale: 'Sale', out: 'Sold out', made_for: 'Made to measure',
    trust1: 'Fast shipping', trust1s: 'Dispatched in 24–48 h', made_days: 'Made to order · ships in 3–5 working days',
    trust2: '3-year guarantee', trust2s: 'Legal guarantee in the EU',
    trust3: '14-day returns', trust3s: 'No questions asked',
    trust4: 'Secure payment', trust4s: 'Card, Bizum or transfer',
    evo_for: 'EVO custom mats for your car', universal_title: 'Universal mats', lighting_title: 'Lighting',
    lighting_note: "Not sure which bulb your car uses? The code is printed on your current bulb, or send us a WhatsApp with your car.",
    add: 'Add to cart', added: 'Added to cart', view_cart: 'View cart', qty: 'Quantity',
    select_car_first: 'Select your car (brand, model, generation and year) to order these mats.',
    please_choose: 'Please choose', sold_out: 'Sold out', tax_incl: 'VAT included', not_available: 'Not available in this combination',
    cart: 'Cart', cart_empty: 'Your cart is empty.', keep_shopping: 'Continue shopping', remove: 'Remove',
    subtotal: 'Subtotal', shipping: 'Shipping', free: 'Free', total: 'Total', checkout: 'Checkout',
    ship_calc: 'Calculated at checkout', free_over: 'Free shipping over',
    contact_details: 'Contact', shipping_address: 'Shipping address',
    full_name: 'Full name', email: 'Email', phone: 'Phone', address: 'Address (street, number, floor)',
    city: 'City', zip: 'Postcode', province: 'Province / region', country: 'Country', notes: 'Order notes (optional)',
    payment: 'Payment', pay_card: 'Card, Apple Pay or Google Pay', pay_card_s: 'Secure payment via Stripe',
    pay_bizum: 'Bizum', pay_bizum_s: 'Send the amount after placing the order',
    pay_transfer: 'Bank transfer', pay_transfer_s: 'We ship once the payment arrives',
    pay_contact: 'Pay after confirmation', pay_contact_s: 'We will contact you with the payment details',
    place_order: 'Buy now', pay_now: 'Pay now', order_summary: 'Order summary',
    accept: 'By placing the order you accept our', terms: 'terms of sale', and: 'and', privacy: 'privacy policy',
    have_account: 'Have an account?', login_faster: 'Log in to fill in your details automatically.',
    thanks: 'Thank you for your order!', order_ref: 'Order number', paid_ok: 'Payment received. We will email you when it ships.',
    paid_cancelled: 'We received your payment, but this order had already been cancelled, so it will not be shipped. We will refund the full amount to your card and contact you by email.',
    pay_pending: 'We could not confirm the payment yet. If you were charged, we will confirm it by email.',
    bizum_do: 'Send the total by Bizum to this number. Write your order number in the concept.',
    transfer_do: 'Transfer the total to this account. Write your order number in the concept.',
    contact_do: 'We have received your order and will contact you shortly with the payment details.',
    amount: 'Amount', concept: 'Concept', holder: 'Account holder',
    cancelled: 'Payment was cancelled. Your cart is still here.',
    info: 'Information', contact: 'Contact',
    l_shipping: 'Shipping', l_returns: 'Returns & guarantee', l_terms: 'Terms of sale', l_privacy: 'Privacy policy', l_legal: 'Legal notice',
    footer_about: 'Car lighting and mats. Simple products, honest prices.',
    not_found: 'Page not found.', back_home: 'Back to home', error: 'Something went wrong', whatsapp: 'WhatsApp',
    account: 'My account', login: 'Log in', register: 'Create account', logout: 'Log out',
    password: 'Password', password_hint: 'At least 8 characters',
    my_orders: 'My orders', my_details: 'My details', my_car_tab: 'My car', change_password: 'Password',
    current_password: 'Current password', new_password: 'New password', save: 'Save', saved: 'Saved',
    no_orders: "You haven't placed any orders yet.", tracking: 'Tracking', placed_on: 'Placed on',
    hello: 'Hello', forgot: 'Forgot your password? Write to us and we will help you.',
    car_saved_hint: 'We use your car to show you the right products and to fill in EVO orders.',
    err_email_taken: 'There is already an account with this email.', err_bad_login: 'Wrong email or password.',
    err_password_short: 'The password must have at least 8 characters.', err_bad_password: 'The current password is not correct.',
    err_email: 'Please enter a valid email.', err_name: 'Please enter your name.',
    st_pending: 'Awaiting payment', st_paid: 'Paid — preparing', st_shipped: 'Shipped', st_delivered: 'Delivered', st_cancelled: 'Cancelled',
    free_ship_over: 'Free shipping over', add_more: 'Add {x} more and shipping is free', ship_es_label: 'mainland Spain',
    zip_hint: 'We ship to mainland Spain, the Balearic Islands and Portugal.',
    err_no_shipping: 'We ship to mainland Spain, the Balearic Islands and Portugal. We cannot ship to the Canary Islands, Ceuta or Melilla yet. Please check your postcode.',
    err_checkout_in_progress: 'Your order is already being processed. Please wait a few seconds and try again.',
    err_withdraw_not_found: 'We could not find an order with this number and email.',
    err_withdraw_fields: 'Please fill in your name, email and order number.',
    err_bad_token: 'This link is not valid any more. Ask for a new one.',
    withdraw_link: 'Withdraw from contract here', withdraw_title: 'Withdraw from your purchase',
    withdraw_intro: 'You can withdraw from your purchase within 14 days of delivery without giving a reason. Fill in this form and we will confirm it by email.',
    withdraw_ref: 'Order number (e.g. VN-1A2B3C)', withdraw_msg: 'Products you are returning or comments (optional)',
    withdraw_confirm: 'Confirm withdrawal', withdraw_done: 'We have received your withdrawal',
    withdraw_done_s: 'Order {ref} · received on {when}. We will contact you with the return instructions.',
    withdraw_note: 'Made-to-measure EVO mats cannot be returned unless they are faulty or do not match the car you ordered.',
    safety_title: 'Product safety information', manufacturer: 'Manufacturer', eu_resp: 'Responsible person in the EU', distributor: 'Seller',
    forgot_link: 'Forgot your password?', forgot_title: 'Reset your password',
    forgot_intro: 'Enter your email and we will send you a link to choose a new password.', send_link: 'Send link',
    forgot_sent: 'If there is an account with this email, you will receive a link in a few minutes. Check your spam folder too.',
    new_password_title: 'Choose a new password', back_login: 'Back to log in',
    soon: 'Coming soon', soon_short: 'soon', soon_note: 'This product will be available very soon.',
    notify_wa: 'Tell me when it arrives', notify_msg: 'Please tell me when it arrives', cat_empty: 'New products are coming soon.',
    bulbs_title: 'Bulbs for your car', b_low: 'Low beam (halogen)', b_high: 'High beam', b_fog: 'Fog lights',
    b_xenon: 'Xenon headlights (factory)', b_h4: 'Headlights (low + high beam)', b_see: 'See', b_none: 'Not sold here',
    bulbs_note: 'Guide only: some versions use other bulbs. Check the code printed on your current bulb before ordering.',
    bulbs_unknown: "We don't have the bulb list for this car yet. The code is printed on your current bulb, or ask us and we will tell you.",
    ask_wa: 'Ask on WhatsApp', your_car_uses: 'Your {car}: {list}', showing: 'Showing products for', show_all: 'Show all',
    countries: { ES: 'Spain', PT: 'Portugal', FR: 'France', IT: 'Italy', DE: 'Germany', NL: 'Netherlands', BE: 'Belgium', AT: 'Austria', IE: 'Ireland', LU: 'Luxembourg' },
  },
  es: {
    nav_car: 'Buscar por coche', nav_xenon: 'Xenón', nav_led: 'LED', nav_mats: 'Alfombrillas', nav_home: 'Inicio',
    hero_title: 'Iluminación y alfombrillas para tu coche',
    hero_lead: 'Bombillas xenón y LED, alfombrillas universales y alfombrillas EVO a medida. Enviamos desde España.',
    finder_title: 'Busca tu coche', brand: 'Marca', model: 'Modelo', gen: 'Generación', year: 'Año', engine: 'Motor',
    choose_brand: 'Marca', choose_model: 'Modelo', choose_gen: 'Generación', choose_year: 'Año',
    choose_engine: 'Motor (opcional)',
    show: 'Ver productos', my_car: 'Tu coche', change: 'Cambiar',
    not_listed: '¿No encuentras tu coche? Escríbenos y lo comprobamos.',
    categories: 'Categorías', all_products: 'Todos los productos',
    cat_xenon: 'Bombillas xenón', cat_led: 'Bombillas LED', cat_mats: 'Alfombrillas',
    cat_xenon_sub: 'D1S, D2S, D3S y más · 4 niveles de calidad', cat_led_sub: 'H1, H4, H7, H11, 9005, 9006', cat_mats_sub: 'Universales y EVO a medida',
    fits_car: 'Hecho para tu coche', fits_all: 'Válido para la mayoría de coches', from: 'desde', sale: 'Oferta', out: 'Agotado', made_for: 'A medida',
    trust1: 'Envío rápido', trust1s: 'Sale en 24–48 h', made_days: 'Fabricado bajo pedido · sale en 3–5 días laborables',
    trust2: '3 años de garantía', trust2s: 'Garantía legal en la UE',
    trust3: 'Devolución 14 días', trust3s: 'Sin dar explicaciones',
    trust4: 'Pago seguro', trust4s: 'Tarjeta, Bizum o transferencia',
    evo_for: 'Alfombrillas EVO a medida para tu coche', universal_title: 'Alfombrillas universales', lighting_title: 'Iluminación',
    lighting_note: '¿No sabes qué bombilla lleva tu coche? El código viene impreso en tu bombilla actual, o escríbenos por WhatsApp con tu coche.',
    add: 'Añadir al carrito', added: 'Añadido al carrito', view_cart: 'Ver carrito', qty: 'Cantidad',
    select_car_first: 'Selecciona tu coche (marca, modelo, generación y año) para pedir estas alfombrillas.',
    please_choose: 'Por favor, elige', sold_out: 'Agotado', tax_incl: 'IVA incluido', not_available: 'No disponible en esta combinación',
    cart: 'Carrito', cart_empty: 'Tu carrito está vacío.', keep_shopping: 'Seguir comprando', remove: 'Eliminar',
    subtotal: 'Subtotal', shipping: 'Envío', free: 'Gratis', total: 'Total', checkout: 'Finalizar compra',
    ship_calc: 'Se calcula al finalizar', free_over: 'Envío gratis a partir de',
    contact_details: 'Contacto', shipping_address: 'Dirección de envío',
    full_name: 'Nombre y apellidos', email: 'Email', phone: 'Teléfono', address: 'Dirección (calle, número, piso)',
    city: 'Ciudad', zip: 'Código postal', province: 'Provincia', country: 'País', notes: 'Notas del pedido (opcional)',
    payment: 'Pago', pay_card: 'Tarjeta, Apple Pay o Google Pay', pay_card_s: 'Pago seguro con Stripe',
    pay_bizum: 'Bizum', pay_bizum_s: 'Envía el importe después de hacer el pedido',
    pay_transfer: 'Transferencia bancaria', pay_transfer_s: 'Enviamos cuando recibimos el pago',
    pay_contact: 'Pagar tras confirmación', pay_contact_s: 'Te contactamos con los datos de pago',
    place_order: 'Comprar ahora', pay_now: 'Pagar ahora', order_summary: 'Resumen del pedido',
    accept: 'Al hacer el pedido aceptas nuestras', terms: 'condiciones de venta', and: 'y la', privacy: 'política de privacidad',
    have_account: '¿Tienes cuenta?', login_faster: 'Inicia sesión y rellenamos tus datos automáticamente.',
    thanks: '¡Gracias por tu pedido!', order_ref: 'Número de pedido', paid_ok: 'Pago recibido. Te avisaremos por email cuando salga.',
    paid_cancelled: 'Hemos recibido tu pago, pero este pedido ya estaba cancelado, así que no se enviará. Te devolveremos el importe completo a tu tarjeta y te escribiremos por email.',
    pay_pending: 'Aún no hemos podido confirmar el pago. Si se ha cobrado, te lo confirmaremos por email.',
    bizum_do: 'Envía el total por Bizum a este número. Pon tu número de pedido en el concepto.',
    transfer_do: 'Haz una transferencia del total a esta cuenta. Pon tu número de pedido en el concepto.',
    contact_do: 'Hemos recibido tu pedido y te contactaremos en breve con los datos de pago.',
    amount: 'Importe', concept: 'Concepto', holder: 'Titular',
    cancelled: 'El pago se ha cancelado. Tu carrito sigue aquí.',
    info: 'Información', contact: 'Contacto',
    l_shipping: 'Envíos', l_returns: 'Devoluciones y garantía', l_terms: 'Condiciones de venta', l_privacy: 'Política de privacidad', l_legal: 'Aviso legal',
    footer_about: 'Iluminación y alfombrillas para tu coche. Productos sencillos, precios honestos.',
    not_found: 'Página no encontrada.', back_home: 'Volver al inicio', error: 'Algo ha ido mal', whatsapp: 'WhatsApp',
    account: 'Mi cuenta', login: 'Iniciar sesión', register: 'Crear cuenta', logout: 'Cerrar sesión',
    password: 'Contraseña', password_hint: 'Mínimo 8 caracteres',
    my_orders: 'Mis pedidos', my_details: 'Mis datos', my_car_tab: 'Mi coche', change_password: 'Contraseña',
    current_password: 'Contraseña actual', new_password: 'Nueva contraseña', save: 'Guardar', saved: 'Guardado',
    no_orders: 'Todavía no has hecho ningún pedido.', tracking: 'Seguimiento', placed_on: 'Fecha',
    hello: 'Hola', forgot: '¿Has olvidado tu contraseña? Escríbenos y te ayudamos.',
    car_saved_hint: 'Usamos tu coche para mostrarte los productos adecuados y rellenar los pedidos EVO.',
    err_email_taken: 'Ya existe una cuenta con este email.', err_bad_login: 'Email o contraseña incorrectos.',
    err_password_short: 'La contraseña debe tener al menos 8 caracteres.', err_bad_password: 'La contraseña actual no es correcta.',
    err_email: 'Introduce un email válido.', err_name: 'Introduce tu nombre.',
    st_pending: 'Pendiente de pago', st_paid: 'Pagado — en preparación', st_shipped: 'Enviado', st_delivered: 'Entregado', st_cancelled: 'Cancelado',
    free_ship_over: 'Envío gratis desde', add_more: 'Añade {x} más y el envío es gratis', ship_es_label: 'península',
    zip_hint: 'Enviamos a España peninsular, Baleares y Portugal.',
    err_no_shipping: 'Enviamos a España peninsular, Baleares y Portugal. Todavía no podemos enviar a Canarias, Ceuta ni Melilla. Revisa tu código postal.',
    err_checkout_in_progress: 'Tu pedido ya se está procesando. Espera unos segundos y vuelve a intentarlo.',
    err_withdraw_not_found: 'No encontramos ningún pedido con este número y email.',
    err_withdraw_fields: 'Rellena tu nombre, email y número de pedido.',
    err_bad_token: 'Este enlace ya no es válido. Pide uno nuevo.',
    withdraw_link: 'Desistir del contrato aquí', withdraw_title: 'Desistir de tu compra',
    withdraw_intro: 'Puedes desistir de tu compra en los 14 días siguientes a la entrega sin dar explicaciones. Rellena este formulario y te lo confirmaremos por email.',
    withdraw_ref: 'Número de pedido (ej. VN-1A2B3C)', withdraw_msg: 'Productos que devuelves o comentarios (opcional)',
    withdraw_confirm: 'Confirmar desistimiento', withdraw_done: 'Hemos recibido tu desistimiento',
    withdraw_done_s: 'Pedido {ref} · recibido el {when}. Te contactaremos con las instrucciones de devolución.',
    withdraw_note: 'Las alfombrillas EVO a medida no admiten devolución salvo que tengan un defecto o no correspondan al coche que pediste.',
    safety_title: 'Información de seguridad del producto', manufacturer: 'Fabricante', eu_resp: 'Responsable en la UE', distributor: 'Vendedor',
    forgot_link: '¿Has olvidado tu contraseña?', forgot_title: 'Recuperar contraseña',
    forgot_intro: 'Escribe tu email y te enviaremos un enlace para elegir una nueva contraseña.', send_link: 'Enviar enlace',
    forgot_sent: 'Si existe una cuenta con este email, recibirás un enlace en unos minutos. Mira también en la carpeta de spam.',
    new_password_title: 'Elige una nueva contraseña', back_login: 'Volver a iniciar sesión',
    soon: 'Próximamente', soon_short: 'pronto', soon_note: 'Este producto estará disponible muy pronto.',
    notify_wa: 'Avísame cuando llegue', notify_msg: 'Avísame cuando llegue', cat_empty: 'Muy pronto tendremos productos aquí.',
    bulbs_title: 'Bombillas de tu coche', b_low: 'Luz de cruce (halógena)', b_high: 'Luz de carretera', b_fog: 'Antiniebla',
    b_xenon: 'Faros xenón (de serie)', b_h4: 'Faros (cruce + carretera)', b_see: 'Ver', b_none: 'No disponible',
    bulbs_note: 'Orientativo: algunas versiones llevan otras bombillas. Comprueba el código impreso en tu bombilla actual antes de pedir.',
    bulbs_unknown: 'Todavía no tenemos la lista de bombillas de este coche. El código viene impreso en tu bombilla actual, o pregúntanos y te lo decimos.',
    ask_wa: 'Preguntar por WhatsApp', your_car_uses: 'Tu {car}: {list}', showing: 'Productos para', show_all: 'Ver todos',
    countries: { ES: 'España', PT: 'Portugal', FR: 'Francia', IT: 'Italia', DE: 'Alemania', NL: 'Países Bajos', BE: 'Bélgica', AT: 'Austria', IE: 'Irlanda', LU: 'Luxemburgo' },
  },
};

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let LANG = store.get('lang', null) || ((navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en');
const t = k => T[LANG][k] ?? T.en[k] ?? k;
const L = obj => (obj && (obj[LANG] || obj.en)) || '';
const errText = msg => T[LANG]['err_' + msg] || msg;

/* ================= helpers ================= */
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const eur = c => (c / 100).toLocaleString(LANG === 'es' ? 'es-ES' : 'en-IE', { style: 'currency', currency: 'EUR' });
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const date = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(LANG === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || t('error'));
  return data;
}
const post = (url, body, method = 'POST') => api(url, { method, body: JSON.stringify(body || {}) });

let CONFIG = null, PRODUCTS = null, CATS = null, CARS = null, BULBS = null, ME;
const loadConfig = async () => CONFIG || (CONFIG = await api('/api/config'));
const loadProducts = async () => PRODUCTS || (PRODUCTS = await api('/api/products'));
const loadCats = async () => CATS || (CATS = await api('/api/categories'));
const loadCars = async () => CARS || (CARS = await api('/api/cars'));
const loadBulbs = async () => BULBS || (BULBS = await api('/api/bulbs'));
const loadMe = async () => {
  if (ME !== undefined) return ME;
  ME = (await api('/api/account/me')).user;
  if (ME?.car && !myCar.get()) myCar.set(ME.car, true);
  return ME;
};
const byId = id => PRODUCTS && PRODUCTS.find(p => p.id === id);

const ICON = {
  car: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14v-5l-2-5H7l-2 5z"/><path d="M3 12h18"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>',
  truck: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  lock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  check: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
  wa: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
};

/* ================= my car ================= */
const myCar = {
  get() { const c = store.get('vcar2', null); return c && c.brand && c.model && c.gen && c.year ? c : null; },
  set(c, fromServer) {
    store.set('vcar2', c);
    if (!fromServer && ME) post('/api/account/me', { car: c }, 'PUT').then(r => { ME = r.user; }).catch(() => {});
  },
  clear() { store.del('vcar2'); },
  label: c => c ? `${c.brand} ${c.model} ${c.gen} · ${c.year}${c.engine ? ' · ' + c.engine : ''}` : '',
};

/* ================= product options & variants ================= */
// A selection is { optionId: valueId }. Same rules as catalog.js on the server.
const valOf = (p, oid, vid) => p.options.find(o => o.id === oid)?.values.find(v => v.id === vid);
const isComplete = (p, sel) => p.options.every(o => sel[o.id]);
const comboKey = (p, sel) => p.options.map(o => sel[o.id]).join('|');
const combosCache = new WeakMap();
function allCombos(p) {
  if (combosCache.has(p)) return combosCache.get(p);
  let out = [[]];
  for (const o of p.options) {
    const next = [];
    for (const prev of out) for (const v of o.values) next.push([...prev, v.id]);
    out = next;
  }
  out = p.options.length ? out.slice(0, 1000) : [];
  combosCache.set(p, out);
  return out;
}
function comboPrice(p, ids) {
  const c = p.combos[ids.join('|')];
  if (c && Number.isInteger(c.price)) return c.price;
  return p.base_cents + ids.reduce((a, id, i) => a + (p.options[i].values.find(v => v.id === id)?.delta || 0), 0);
}
function comboSellable(p, ids) {
  if (p.combos[ids.join('|')]?.off) return false;
  return ids.every((id, i) => !p.options[i].values.find(v => v.id === id)?.soon);
}
const fitsSel = (p, ids, sel) => ids.every((id, i) => !sel[p.options[i].id] || sel[p.options[i].id] === id);
// 'ok' | 'soon' (coming soon) | 'off' (not sold together with the other choices)
function valueState(p, sel, oid, vid) {
  if (valOf(p, oid, vid)?.soon) return 'soon';
  const test = { ...sel, [oid]: vid };
  return allCombos(p).some(ids => fitsSel(p, ids, test) && comboSellable(p, ids)) ? 'ok' : 'off';
}
// Exact price for a full selection, lowest possible price for a partial one, null if nothing can be bought
function unitPrice(p, sel) {
  if (!p.options.length) return p.base_cents;
  const prices = allCombos(p).filter(ids => fitsSel(p, ids, sel) && comboSellable(p, ids)).map(ids => comboPrice(p, ids));
  return prices.length ? Math.min(...prices) : null;
}
// Photos / videos for the current choice: the combination's own media, else the chosen values' media, then the general gallery
function mediaFor(p, sel) {
  if (isComplete(p, sel) && p.options.length) {
    const m = p.combos[comboKey(p, sel)]?.media;
    if (m?.length) return dedupeMedia([...m, ...p.media]);
  }
  const own = [];
  for (const o of p.options) { const v = valOf(p, o.id, sel[o.id]); if (v?.media?.length) own.push(...v.media); }
  return dedupeMedia([...own, ...p.media]);
}
const dedupeMedia = list => { const seen = new Set(); return list.filter(m => !seen.has(m.src) && seen.add(m.src)); };
const firstImage = list => (list.find(m => m.type === 'image') || {}).src;

/* ================= bulb finder ================= */
const bulbsFor = c => (c && BULBS && BULBS[`${c.brand}|${c.model}|${c.gen}`]) || null;
// Does an option value stand for this bulb code? ("9006 (HB4)" matches HB4 and 9006)
const valueIs = (v, code) => v.en.toUpperCase().split(/[\s()\/,]+/).filter(Boolean).includes(code.toUpperCase());
function optionFor(p, code) {
  for (const o of p.options) {
    const v = o.values.find(x => valueIs(x, code));
    if (v) return [o.id, v.id];
  }
  return null;
}
const productsFor = code => PRODUCTS.filter(p => p.fitment !== 'car' && optionFor(p, code));
function bulbLink(code) {
  const list = productsFor(code);
  if (!list.length) return null;
  return list.length === 1 ? `/p/${list[0].slug}?o=${encodeURIComponent(code)}` : `/c/${list[0].category}?o=${encodeURIComponent(code)}`;
}
function bulbRows(b) {
  const rows = [];
  if (b.low) rows.push([b.low === 'H4' && !b.high ? t('b_h4') : t('b_low'), b.low]);
  if (b.high) rows.push([t('b_high'), b.high]);
  if (b.fog) rows.push([t('b_fog'), b.fog]);
  if (b.xenon) rows.push([t('b_xenon'), b.xenon]);
  return rows;
}
function bulbBox(c) {
  const b = bulbsFor(c);
  const wa = waLink(`${t('bulbs_title')}: ${myCar.label(c)}`);
  if (!b) return `<div class="box bulbs"><h3>${esc(t('bulbs_title'))}</h3><p class="muted small" style="margin:0">${esc(t('bulbs_unknown'))}</p>
    ${wa ? `<a class="btn ghost sm" style="margin-top:12px" href="${wa}" target="_blank" rel="noopener">${esc(t('ask_wa'))}</a>` : ''}</div>`;
  return `<div class="box bulbs"><h3>${esc(t('bulbs_title'))}</h3>
    ${bulbRows(b).map(([label, code]) => {
      const href = bulbLink(code);
      return `<div class="brow"><span>${esc(label)}</span><b>${esc(code)}</b>${href
        ? `<a class="btn sm" href="${href}" data-link>${esc(t('b_see'))} ${esc(code)} →</a>`
        : `<span class="muted small">${esc(t('b_none'))}</span>`}</div>`;
    }).join('')}
    <p class="muted small" style="margin:12px 0 0">${esc(t('bulbs_note'))}${wa ? ` <a class="link" href="${wa}" target="_blank" rel="noopener">${esc(t('ask_wa'))}</a>` : ''}</p></div>`;
}

/* ================= cart ================= */
const cart = {
  get: () => store.get('vcart4', []),
  save(items) { store.set('vcart4', items); updateBadge(); },
  key: (id, sel, car) => JSON.stringify([id, sel, car ? myCar.label(car) : '']),
  add(p, qty, sel, car) {
    const clean = Object.fromEntries(p.options.map(o => [o.id, sel[o.id]]));
    const items = cart.get();
    const key = cart.key(p.id, clean, car);
    const ex = items.find(i => i.key === key);
    if (ex) ex.qty = Math.min(10, ex.qty + qty);
    else items.push({ key, id: p.id, qty, options: clean, car: p.fitment === 'car' ? car : null });
    cart.save(items);
  },
  setQty(key, q) { const items = cart.get(); const it = items.find(i => i.key === key); if (it) it.qty = Math.max(1, Math.min(10, q)); cart.save(items); },
  remove(key) { cart.save(cart.get().filter(i => i.key !== key)); },
  clear() { cart.save([]); },
  count: () => cart.get().reduce((a, i) => a + i.qty, 0),
};
function updateBadge() {
  const b = document.getElementById('cartBadge');
  const n = cart.count();
  b.hidden = !n; b.textContent = n;
}
// Cart lines with current product data. Drops lines that can no longer be bought.
function cartLines() {
  const lines = [];
  for (const it of cart.get()) {
    const p = byId(it.id);
    if (!p || p.status !== 'available') continue;
    const sel = it.options || {};
    if (!isComplete(p, sel)) continue;
    const unit = unitPrice(p, sel);
    if (unit == null) continue;
    const labels = p.options.map(o => `${L(o)}: ${L(valOf(p, o.id, sel[o.id]))}`);
    const img = firstImage(mediaFor(p, sel)) || p.image;
    lines.push({ ...it, p, unit, labels, img, sum: unit * it.qty });
  }
  return lines;
}
// Same rules as the server: 'es' mainland Spain, 'ib' Balearics, 'pt' Portugal, null = not served / incomplete
function shipZone(country, zip) {
  const z = String(zip || '').replace(/\s/g, '');
  if (country === 'PT') return /^\d{4}-?\d{3}$/.test(z) ? 'pt' : null;
  if (country !== 'ES' || !/^\d{5}$/.test(z)) return null;
  const p = z.slice(0, 2);
  if (['35', '38', '51', '52'].includes(p)) return null;
  return p === '07' ? 'ib' : 'es';
}
const zipComplete = (country, zip) => (country === 'PT' ? /^\d{4}-?\d{3}$/ : /^\d{5}$/).test(String(zip || '').replace(/\s/g, ''));
function shippingFor(zone, subtotal) {
  const sh = CONFIG.shipping;
  if (zone === 'es') return sh.free_es && subtotal >= sh.free_es ? 0 : sh.es;
  return sh.free_far && subtotal >= sh.free_far ? 0 : zone === 'ib' ? sh.ib : sh.pt;
}

/* ================= router ================= */
function go(path, replace) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  render();
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

const routes = [
  [/^\/$/, viewHome],
  [/^\/car$/, viewCar],
  [/^\/c\/([\w-]+)$/, viewCategory],
  [/^\/p\/([\w-]+)$/, viewProduct],
  [/^\/cart$/, viewCart],
  [/^\/checkout$/, viewCheckout],
  [/^\/checkout\/success$/, viewStripeReturn],
  [/^\/order\/([\w-]+)$/, viewOrderDone],
  [/^\/account(?:\/(orders|details|car|password|reset))?$/, viewAccount],
  [/^\/withdraw$/, viewWithdraw],
  [/^\/info\/(shipping|returns|terms|privacy|legal)$/, viewLegal],
];

let renderId = 0;
const stale = id => id !== renderId;
async function render() {
  const id = ++renderId;
  const path = location.pathname.replace(/\/+$/, '') || '/';
  document.body.classList.remove('has-buybar');
  try { await Promise.all([loadConfig(), loadProducts(), loadCats(), loadCars(), loadBulbs(), loadMe()]); } catch {}
  if (stale(id)) return;
  chrome(path);
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try { await fn(...m.slice(1)); }
      catch (e) { app.innerHTML = `<div class="wrap page"><div class="notice err">${esc(e.message)}</div></div>`; }
      if (!history.state?.keepScroll) window.scrollTo(0, 0);
      return;
    }
  }
  viewNotFound();
}
function rerenderInPlace() { history.replaceState({ keepScroll: true }, '', location.href); render(); }

/* ================= layout chrome ================= */
function chrome(path) {
  document.documentElement.lang = LANG;
  const links = [['/car', t('nav_car')], ...(CATS || []).map(c => [`/c/${c.slug}`, L(c.name)])];
  const html = links.map(([h, l]) => `<a href="${h}" data-link class="${path === h ? 'on' : ''}">${esc(l)}</a>`).join('');
  $('#nav').innerHTML = html;
  $('#navMobile').innerHTML = html;
  $$('.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === LANG));
  $('#accBtn').setAttribute('aria-label', t('account'));
  updateBadge();
  footer();
}
$$('.lang button').forEach(b => b.addEventListener('click', () => {
  LANG = b.dataset.lang; store.set('lang', LANG);
  rerenderInPlace();
}));

function waLink(text) {
  return CONFIG?.whatsapp ? `https://wa.me/${CONFIG.whatsapp}${text ? '?text=' + encodeURIComponent(text) : ''}` : '';
}
function footer() {
  if (!CONFIG) return;
  const wa = waLink();
  $('#footer').innerHTML = `
    <div><div class="brand">VORNETIC</div><p>${esc(t('footer_about'))}</p></div>
    <div>
      <h4>${esc(t('info'))}</h4>
      <a href="/info/shipping" data-link>${esc(t('l_shipping'))}</a>
      <a href="/info/returns" data-link>${esc(t('l_returns'))}</a>
      <a href="/info/terms" data-link>${esc(t('l_terms'))}</a>
      <a href="/info/privacy" data-link>${esc(t('l_privacy'))}</a>
      <a href="/info/legal" data-link>${esc(t('l_legal'))}</a>
      <a href="/withdraw" data-link>${esc(t('withdraw_link'))}</a>
    </div>
    <div>
      <h4>${esc(t('contact'))}</h4>
      ${CONFIG.email ? `<a href="mailto:${esc(CONFIG.email)}">${esc(CONFIG.email)}</a>` : ''}
      ${wa ? `<a href="${wa}" target="_blank" rel="noopener">${esc(t('whatsapp'))}: +${esc(CONFIG.whatsapp)}</a>` : ''}
      ${CONFIG.company.address ? `<span>${esc(CONFIG.company.address)}</span>` : ''}
      <a href="/account" data-link style="margin-top:8px">${esc(t('account'))}</a>
    </div>
    <div class="copy">© ${new Date().getFullYear()} ${esc(CONFIG.company.name || 'Vornetic')}</div>`;
  if (wa && !$('.wa-float')) {
    const f = document.createElement('a');
    f.className = 'wa-float'; f.target = '_blank'; f.rel = 'noopener'; f.setAttribute('aria-label', 'WhatsApp');
    f.innerHTML = ICON.wa; f.href = wa;
    document.body.appendChild(f);
  }
}

function toast(html) {
  $$('.toast').forEach(x => x.remove());
  const el = document.createElement('div');
  el.className = 'toast'; el.innerHTML = html;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
const setTitle = s => { document.title = s ? `${s} — Vornetic` : 'Vornetic — Car Lighting & Mats'; };

/* ================= components ================= */
const catBySlug = slug => (CATS || []).find(c => c.slug === slug);
function priceHtml(p) {
  return `<div class="price">${p.from ? `<span class="from">${esc(t('from'))}</span>` : ''}${eur(p.price_cents)}${p.old_price_cents ? `<span class="old">${eur(p.old_price_cents)}</span>` : ''}</div>`;
}
function card(p, o) {
  const tag = p.fitment === 'car' ? t('made_for') : L(catBySlug(p.category)?.name);
  const pill = p.status === 'soon' ? `<span class="pill soon">${esc(t('soon'))}</span>`
    : !p.in_stock ? `<span class="pill out">${esc(t('out'))}</span>`
    : p.fitment === 'car' ? `<span class="pill dark">EVO</span>`
    : p.old_price_cents ? `<span class="pill">${esc(t('sale'))}</span>` : '';
  return `<a class="card${p.status === 'soon' ? ' is-soon' : ''}" href="/p/${esc(p.slug)}${o ? '?o=' + encodeURIComponent(o) : ''}" data-link>
    <div class="ph"><img src="${esc(p.image || '/img/favicon.png')}" alt="${esc(L(p.name))}" loading="lazy">${pill}</div>
    <div class="body"><span class="tag">${esc(tag)}</span><h3>${esc(L(p.name))}</h3>${priceHtml(p)}</div>
  </a>`;
}
const gridHtml = (list, o) => `<div class="grid">${list.map(p => card(p, o)).join('')}</div>`;

// Brand → model → generation → year → engine. onChange({brand, model, gen, year, engine} | null)
function mountCarSelect(root, initial, onChange) {
  root.innerHTML = ['brand', 'model', 'gen', 'year', 'engine'].map(k =>
    `<select class="in" data-k="${k}" aria-label="${esc(t(k))}"></select>`).join('');
  const s = Object.fromEntries($$('select', root).map(el => [el.dataset.k, el]));
  const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  const cur = { brand: '', model: '', gen: '', year: '', engine: '', ...(initial || {}) };
  const gens = () => CARS[cur.brand]?.[cur.model] || [];
  const genObj = () => gens().find(g => g.gen === cur.gen);
  function fill() {
    s.brand.innerHTML = opt('', t('choose_brand')) + Object.keys(CARS).map(b => opt(b, b, b === cur.brand)).join('');
    s.model.disabled = !cur.brand;
    s.model.innerHTML = opt('', t('choose_model')) + Object.keys(CARS[cur.brand] || {}).map(m => opt(m, m, m === cur.model)).join('');
    s.gen.disabled = !cur.model;
    s.gen.innerHTML = opt('', t('choose_gen')) + gens().map(g => opt(g.gen, `${g.gen} (${g.from}–${g.to})`, g.gen === cur.gen)).join('');
    const g = genObj();
    s.year.disabled = !g;
    let years = '';
    if (g) for (let y = g.to; y >= g.from; y--) years += opt(y, y, String(y) === String(cur.year));
    s.year.innerHTML = opt('', t('choose_year')) + years;
    s.engine.disabled = !g || !g.engines.length;
    s.engine.innerHTML = opt('', t('choose_engine')) + (g ? g.engines.map(e => opt(e, e, e === cur.engine)).join('') : '');
  }
  fill();
  root.addEventListener('change', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    cur[k] = e.target.value;
    const order = ['brand', 'model', 'gen', 'year', 'engine'];
    // reset the steps after the one that changed (the engine survives a year change)
    order.slice(order.indexOf(k) + 1).forEach(x => { if (!(k === 'year' && x === 'engine')) cur[x] = ''; });
    if (k === 'model' && gens().length === 1) cur.gen = gens()[0].gen;
    fill();
    const done = cur.brand && cur.model && cur.gen && cur.year;
    onChange(done ? { brand: cur.brand, model: cur.model, gen: cur.gen, year: +cur.year, engine: cur.engine } : null);
  });
}

function finderBox({ title = true } = {}) {
  return `<div class="finder">
    ${title ? `<h3>${ICON.car} ${esc(t('finder_title'))}</h3>` : ''}
    <div class="car-row"><div id="carSel" style="display:contents"></div>
      <button class="btn" id="carGo" disabled>${esc(t('show'))}</button></div>
    ${CONFIG.whatsapp ? `<p class="muted small" style="margin:12px 0 0"><a class="link" href="${waLink()}" target="_blank" rel="noopener">${esc(t('not_listed'))}</a></p>` : ''}
  </div>`;
}
function bindFinder(after = () => go('/car')) {
  let chosen = myCar.get();
  const btn = $('#carGo');
  btn.disabled = !chosen;
  mountCarSelect($('#carSel'), chosen, c => { chosen = c; btn.disabled = !c; });
  btn.addEventListener('click', () => { if (chosen) { myCar.set(chosen); after(); } });
}

function trustHtml() {
  const items = [[ICON.truck, 'trust1'], [ICON.shield, 'trust2'], [ICON.back, 'trust3'], [ICON.lock, 'trust4']];
  const title = k => k === 'trust1' && CONFIG.shipping.free_es ? `${t('free_ship_over')} ${eur(CONFIG.shipping.free_es)}` : t(k);
  return `<div class="trust">${items.map(([i, k]) => `<div>${i}<p style="margin:0"><b>${esc(title(k))}</b><span>${esc(t(k + 's'))}</span></p></div>`).join('')}</div>`;
}
function myCarBar(c) {
  return `<div class="mycar"><div><span class="muted">${esc(t('my_car'))}:</span> <b>${esc(myCar.label(c))}</b></div>
    <div><a class="btn sm" href="/car" data-link>${esc(t('show'))}</a> <button class="chip-btn" id="carChange">${esc(t('change'))}</button></div></div>`;
}
function bindCarArea() {
  if ($('#carSel')) bindFinder();
  $('#carChange')?.addEventListener('click', () => { myCar.clear(); rerenderInPlace(); });
}

/* ================= views ================= */
async function viewHome() {
  setTitle('');
  const evo = PRODUCTS.filter(p => p.fitment === 'car');
  const rest = PRODUCTS.filter(p => p.fitment !== 'car').sort((a, b) => (a.status === 'soon') - (b.status === 'soon'));
  const c = myCar.get();
  const catImage = cat => cat.image || PRODUCTS.find(p => p.category === cat.slug)?.image || '/img/favicon.png';
  app.innerHTML = `
    <section class="hero"><div class="wrap hero-in">
      <h1>${esc(t('hero_title'))}</h1>
      <p class="lead">${esc(t('hero_lead'))}</p>
      ${c ? myCarBar(c) : finderBox()}
    </div></section>

    <section class="wrap section">
      <div class="section-head"><h2>${esc(t('categories'))}</h2></div>
      <div class="cats">
        ${CATS.map(cat => `
          <a class="cat" href="/c/${esc(cat.slug)}" data-link><img src="${esc(catImage(cat))}" alt="" loading="lazy">
            <div><h3 style="margin:0 0 2px">${esc(L(cat.name))}</h3><small>${esc(L(cat.desc))}</small></div></a>`).join('')}
      </div>
    </section>

    <section class="wrap section" style="padding-top:0">
      <div class="section-head"><h2>${esc(t('all_products'))}</h2></div>
      ${gridHtml([...evo, ...rest])}
    </section>

    <section class="wrap section" style="padding-top:0">${trustHtml()}</section>`;
  bindCarArea();
}

async function viewCategory(slug) {
  const cat = catBySlug(slug);
  if (!cat) return viewNotFound();
  setTitle(L(cat.name));
  const o = new URLSearchParams(location.search).get('o');
  let list = PRODUCTS.filter(p => p.category === slug)
    .sort((a, b) => (b.fitment === 'car') - (a.fitment === 'car') || (a.status === 'soon') - (b.status === 'soon'));
  if (o) list = list.filter(p => optionFor(p, o));
  const hasCarFit = list.some(p => p.fitment === 'car');
  const c = myCar.get();
  app.innerHTML = `<div class="wrap page">
    <h1>${esc(L(cat.name))}</h1>
    ${L(cat.desc) ? `<p class="muted" style="max-width:720px">${esc(L(cat.desc))}</p>` : ''}
    ${o ? `<p class="mycar" style="margin:14px 0 22px"><span>${esc(t('showing'))} <b>${esc(o)}</b></span><a class="link" href="/c/${esc(slug)}" data-link>${esc(t('show_all'))}</a></p>`
      : hasCarFit ? `<div style="margin:18px 0 24px">${c ? myCarBar(c) : finderBox()}</div>` : '<div style="height:12px"></div>'}
    ${list.length ? gridHtml(list, o) : `<p class="muted">${esc(t('cat_empty'))}</p>`}
  </div>`;
  if (hasCarFit && !o) bindCarArea();
}

async function viewCar() {
  const c = myCar.get();
  setTitle(t('nav_car'));
  if (!c) {
    app.innerHTML = `<div class="wrap page"><h1>${esc(t('nav_car'))}</h1><div style="margin-top:18px">${finderBox({ title: false })}</div></div>`;
    bindFinder(() => rerenderInPlace());
    return;
  }
  const evo = PRODUCTS.filter(p => p.fitment === 'car');
  const groups = CATS.map(cat => [cat, PRODUCTS.filter(p => p.category === cat.slug && p.fitment !== 'car')]).filter(([, l]) => l.length);
  app.innerHTML = `<div class="wrap page">
    <div class="mycar" style="margin-bottom:20px"><div><span class="muted">${esc(t('my_car'))}:</span> <b>${esc(myCar.label(c))}</b></div>
      <button class="chip-btn" id="carChange">${esc(t('change'))}</button></div>
    ${bulbBox(c)}
    <div style="height:20px"></div>
    ${evo.length ? `<h2>${esc(t('evo_for'))}</h2>${gridHtml(evo)}<div style="height:36px"></div>` : ''}
    ${groups.map(([cat, list]) => `<h2>${esc(L(cat.name))}</h2>${gridHtml(list)}<div style="height:36px"></div>`).join('')}
  </div>`;
  $('#carChange').addEventListener('click', () => { myCar.clear(); rerenderInPlace(); });
}

// Swipeable gallery (photos + videos). Returns { show(list) }.
function mountGallery(root, name) {
  let current = '';
  const playIcon = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  function show(list) {
    const sig = list.map(m => m.src).join('|');
    if (sig === current) return;
    current = sig;
    if (!list.length) list = [{ type: 'image', src: '/img/favicon.png' }];
    root.innerHTML = `
      <div class="slides">${list.map((m, i) => `<div class="slide">${m.type === 'video'
        ? `<video src="${esc(m.src)}" controls playsinline muted preload="metadata"></video>`
        : `<img src="${esc(m.src)}" alt="${esc(name)}" ${i ? 'loading="lazy"' : ''}>`}</div>`).join('')}</div>
      ${list.length > 1 ? `<div class="dots">${list.map((m, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>
      <div class="thumbs">${list.map((m, i) => `<button type="button" class="${i ? '' : 'on'}${m.type === 'video' ? ' vthumb' : ''}" data-i="${i}" aria-label="${i + 1}">${m.type === 'video'
        ? playIcon : `<img src="${esc(m.src)}" alt="" loading="lazy">`}</button>`).join('')}</div>` : ''}`;
    const slides = $('.slides', root);
    const mark = i => {
      $$('.thumbs button', root).forEach((b, k) => b.classList.toggle('on', k === i));
      $$('.dots span', root).forEach((d, k) => d.classList.toggle('on', k === i));
    };
    slides.addEventListener('scroll', () => {
      const i = Math.round(slides.scrollLeft / slides.clientWidth);
      mark(i);
      $$('video', slides).forEach((v, k) => { if (!v.paused && v.closest('.slide') !== slides.children[i]) v.pause(); });
    }, { passive: true });
    $$('.thumbs button', root).forEach(b => b.addEventListener('click', () => {
      slides.scrollTo({ left: +b.dataset.i * slides.clientWidth, behavior: 'smooth' });
    }));
  }
  return { show };
}

async function viewProduct(slug) {
  const id = renderId;
  const p = await api('/api/products/' + encodeURIComponent(slug));
  if (stale(id)) return;
  setTitle(L(p.name));
  const cat = catBySlug(p.category);
  const soon = p.status === 'soon';
  const canBuy = !soon && p.in_stock;
  const sel = {};
  let car = p.fitment === 'car' ? myCar.get() : null;
  let qty = 1;
  document.body.classList.add('has-buybar');

  app.innerHTML = `<div class="wrap">
    <div class="crumbs"><a href="/" data-link>${esc(t('nav_home'))}</a> / ${cat ? `<a href="/c/${esc(cat.slug)}" data-link>${esc(L(cat.name))}</a>` : ''}</div>
    <div class="pdp">
      <div class="gallery" id="gallery"></div>
      <div class="pinfo">
        <span class="muted small">${esc(p.fitment === 'car' ? t('fits_car') : L(cat?.name))}</span>
        <h1 class="ptitle">${esc(L(p.name))}</h1>
        <div class="price" id="price"></div>
        ${soon ? `<div class="notice soon-note">${esc(t('soon_note'))}${CONFIG.whatsapp ? ` <a class="link" href="${waLink(`${t('notify_msg')}: ${L(p.name)}`)}" target="_blank" rel="noopener">${esc(t('notify_wa'))}</a>` : ''}</div>` : ''}
        ${p.fitment === 'car' ? `<div class="carbox"><h3>${ICON.car} ${esc(t('finder_title'))}</h3><div class="car-row" id="pCar"></div>
          ${CONFIG.whatsapp ? `<p class="muted small" style="margin:10px 0 0"><a class="link" href="${waLink(L(p.name))}" target="_blank" rel="noopener">${esc(t('not_listed'))}</a></p>` : ''}</div>` : ''}
        ${p.options.map(o => `<div class="opt-group" data-o="${esc(o.id)}">
          <span>${esc(L(o))}: <b data-chosen></b></span>
          <div class="opts">${o.values.map(v => `<button type="button" class="opt" data-v="${esc(v.id)}">${esc(L(v))}${v.soon
            ? `<small>${esc(t('soon_short'))}</small>` : ''}</button>`).join('')}</div>
        </div>`).join('')}
        <div id="pErr"></div>
        <div class="buy-row">
          <div class="qty"><button type="button" data-q="-1" aria-label="-">−</button><input id="qty" type="number" min="1" max="10" value="1" aria-label="${esc(t('qty'))}"><button type="button" data-q="1" aria-label="+">+</button></div>
          <button class="btn" id="addBtn" ${canBuy ? '' : 'disabled'}>${esc(soon ? t('soon') : p.in_stock ? t('add') : t('sold_out'))}</button>
        </div>
        <p class="muted small">${esc(t('tax_incl'))} · ${esc(p.fitment === 'car' ? t('made_days') : t('trust1s'))}</p>
        <div class="desc">${esc(L(p.desc))}</div>
        <details class="safety">
          <summary>${esc(t('safety_title'))}</summary>
          ${p.manufacturer ? `<p><b>${esc(t('manufacturer'))}</b><br>${esc(p.manufacturer)}</p>` : ''}
          ${p.eu_responsible ? `<p><b>${esc(t('eu_resp'))}</b><br>${esc(p.eu_responsible)}</p>` : ''}
          <p><b>${esc(t('distributor'))}</b><br>${esc(CONFIG.company.name)}${CONFIG.company.address ? ', ' + esc(CONFIG.company.address) : ''} · ${esc(CONFIG.email)}</p>
          ${L(p.safety) ? `<p style="white-space:pre-line">${esc(L(p.safety))}</p>` : ''}
        </details>
      </div>
    </div>
  </div>`;

  const gallery = mountGallery($('#gallery'), L(p.name));

  // Preselect: options with one value, and ?o=H7 from the bulb finder
  p.options.forEach(o => { if (o.values.length === 1 && !o.values[0].soon) sel[o.id] = o.values[0].id; });
  const pre = new URLSearchParams(location.search).get('o');
  const preHit = pre && optionFor(p, pre);
  if (preHit) sel[preHit[0]] = preHit[1];

  // "Your BMW 3 Series E90: Xenon D1S" when the saved car uses a bulb this product has
  const myBulbs = p.fitment !== 'car' ? bulbsFor(myCar.get()) : null;
  const fits = myBulbs ? bulbRows(myBulbs).filter(([, code]) => optionFor(p, code)) : [];
  if (fits.length) $('#price').insertAdjacentHTML('afterend', `<p class="notice ok" style="margin:-8px 0 16px">${esc(t('your_car_uses')
    .replace('{car}', myCar.label(myCar.get())).replace('{list}', fits.map(([l, code]) => `${l} ${code}`).join(' · ')))}</p>`);

  const refresh = () => {
    const unit = unitPrice(p, sel);
    const complete = isComplete(p, sel);
    $('#price').innerHTML = unit == null ? `<span class="muted" style="font-size:16px">${esc(t('not_available'))}</span>`
      : `${!complete && p.from ? `<span class="from">${esc(t('from'))}</span>` : ''}${eur(unit)}${p.old_price_cents && complete && unit === p.base_cents ? `<span class="old">${eur(p.old_price_cents)}</span>` : ''}`;
    $$('.opt-group').forEach(g => {
      const oid = g.dataset.o;
      $$('.opt', g).forEach(b => {
        const st = valueState(p, sel, oid, b.dataset.v);
        b.classList.toggle('on', sel[oid] === b.dataset.v);
        b.classList.toggle('is-soon', st === 'soon');
        b.disabled = st !== 'ok';
      });
      $('[data-chosen]', g).textContent = sel[oid] ? L(valOf(p, oid, sel[oid])) : '';
    });
    gallery.show(mediaFor(p, sel));
  };
  refresh();

  $$('.opt-group').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('.opt'); if (!b || b.disabled) return;
    const oid = g.dataset.o;
    sel[oid] = b.dataset.v;
    // drop other choices that are no longer possible with this one
    p.options.forEach(o => { if (o.id !== oid && sel[o.id] && valueState(p, sel, o.id, sel[o.id]) !== 'ok') delete sel[o.id]; });
    $('#pErr').innerHTML = ''; refresh();
  }));
  const qIn = $('#qty');
  $$('[data-q]').forEach(b => b.addEventListener('click', () => { qty = Math.max(1, Math.min(10, (+qIn.value || 1) + +b.dataset.q)); qIn.value = qty; }));
  qIn.addEventListener('change', () => { qty = Math.max(1, Math.min(10, +qIn.value || 1)); qIn.value = qty; });
  if (p.fitment === 'car') mountCarSelect($('#pCar'), car, c => { car = c; if (c) myCar.set(c); $('#pErr').innerHTML = ''; });

  $('#addBtn').addEventListener('click', () => {
    const err = m => { $('#pErr').innerHTML = `<p class="notice err">${esc(m)}</p>`; $('#pErr').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    if (p.fitment === 'car' && !car) return err(t('select_car_first'));
    const missing = p.options.find(o => !sel[o.id]);
    if (missing) return err(`${t('please_choose')}: ${L(missing)}`);
    if (unitPrice(p, sel) == null) return err(t('not_available'));
    cart.add(p, qty, { ...sel }, car);
    toast(`${esc(t('added'))} <a href="/cart" data-link>${esc(t('view_cart'))} →</a>`);
  });
}

function summaryHtml(lines, shipping, shipNote) {
  const sub = lines.reduce((a, l) => a + l.sum, 0);
  return `
    <div class="row"><span>${esc(t('subtotal'))}</span><span>${eur(sub)}</span></div>
    <div class="row"><span>${esc(t('shipping'))}${shipNote ? ` <small class="muted">(${esc(shipNote)})</small>` : ''}</span><span>${shipping === null ? `<span class="muted">${esc(t('ship_calc'))}</span>` : shipping ? eur(shipping) : esc(t('free'))}</span></div>
    <div class="row total"><span>${esc(t('total'))}</span><span>${eur(sub + (shipping || 0))}</span></div>
    <p class="muted" style="font-size:13px;margin:4px 0 0">${esc(t('tax_incl'))}</p>`;
}
function lineHtml(l, editable) {
  return `<div class="line" data-key="${esc(l.key)}">
    <a href="/p/${esc(l.p.slug)}" data-link><img src="${esc(l.img || '/img/favicon.png')}" alt=""></a>
    <div>
      <a href="/p/${esc(l.p.slug)}" data-link><b style="font-weight:600">${esc(L(l.p.name))}</b></a>
      ${l.car ? `<div class="meta">${esc(myCar.label(l.car))}</div>` : ''}
      ${l.labels.map(x => `<div class="meta">${esc(x)}</div>`).join('')}
      ${editable ? '' : `<div class="meta">× ${l.qty}</div>`}
    </div>
    <div class="right">
      <b>${eur(l.sum)}</b>
      ${editable ? `<div class="qty"><button data-d="-1" aria-label="-">−</button><input value="${l.qty}" readonly aria-label="${esc(t('qty'))}"><button data-d="1" aria-label="+">+</button></div>
      <button class="rm">${esc(t('remove'))}</button>` : ''}
    </div>
  </div>`;
}

async function viewCart() {
  setTitle(t('cart'));
  const lines = cartLines();
  if (!lines.length) {
    app.innerHTML = `<div class="wrap empty"><h1>${esc(t('cart'))}</h1><p class="muted">${esc(t('cart_empty'))}</p><a class="btn" href="/" data-link>${esc(t('keep_shopping'))}</a></div>`;
    return;
  }
  const sub = lines.reduce((a, l) => a + l.sum, 0);
  const freeEs = CONFIG.shipping.free_es;
  const freeNote = freeEs && sub < freeEs ? `<p class="notice" style="margin-top:14px">${esc(t('add_more').replace('{x}', eur(freeEs - sub)))} (${esc(t('ship_es_label'))})</p>` : '';
  app.innerHTML = `<div class="wrap page">
    <h1>${esc(t('cart'))}</h1>
    <div class="cart-layout">
      <div>${lines.map(l => lineHtml(l, true)).join('')}
        <p style="margin-top:18px"><a class="link" href="/" data-link>← ${esc(t('keep_shopping'))}</a></p></div>
      <aside class="summary">${summaryHtml(lines, shippingFor('es', sub), t('ship_es_label'))}
        <a class="btn block" style="margin-top:16px" href="/checkout" data-link>${esc(t('checkout'))}</a>${freeNote}</aside>
    </div>
  </div>`;
  $$('.line').forEach(row => {
    const key = row.dataset.key;
    row.addEventListener('click', e => {
      const d = e.target.closest('[data-d]');
      if (d) { const it = cart.get().find(i => i.key === key); cart.setQty(key, it.qty + +d.dataset.d); rerenderInPlace(); }
      if (e.target.closest('.rm')) { cart.remove(key); rerenderInPlace(); }
    });
  });
}

async function viewCheckout() {
  setTitle(t('checkout'));
  const lines = cartLines();
  if (!lines.length) return go('/cart', true);
  const fromAccount = ME ? Object.fromEntries(Object.entries({
    email: ME.email, phone: ME.phone, customer_name: ME.name, address: ME.address, zip: ME.zip, city: ME.city,
    province: ME.province, country: ME.country }).filter(([, v]) => v)) : {};
  const saved = { ...store.get('vaddr', {}), ...fromAccount };
  const methods = ['card', 'bizum', 'transfer', 'contact'].filter(m => CONFIG.payments[m]);
  const cancelled = new URLSearchParams(location.search).has('cancelled');
  const f = (name, label, attrs = '') => `<label class="f"><span>${esc(label)}</span><input class="in" name="${name}" value="${esc(saved[name] || '')}" ${attrs}></label>`;

  app.innerHTML = `<div class="wrap page">
    <h1>${esc(t('checkout'))}</h1>
    ${cancelled ? `<p class="notice err">${esc(t('cancelled'))}</p>` : ''}
    ${!ME ? `<p class="notice" style="margin-bottom:16px">${esc(t('have_account'))} <a class="link" href="/account?next=/checkout" data-link>${esc(t('login'))}</a> — ${esc(t('login_faster'))}</p>` : ''}
    <form class="cart-layout" id="coForm" novalidate>
      <div>
        <div class="box"><h3>${esc(t('contact_details'))}</h3>
          <div class="grid2">${f('email', t('email'), 'type="email" autocomplete="email" required')}${f('phone', t('phone'), 'type="tel" autocomplete="tel" required')}</div>
        </div>
        <div class="box"><h3>${esc(t('shipping_address'))}</h3>
          ${f('customer_name', t('full_name'), 'autocomplete="name" required')}
          ${f('address', t('address'), 'autocomplete="street-address" required')}
          <div class="grid2">${f('zip', t('zip'), 'autocomplete="postal-code" inputmode="numeric" required')}${f('city', t('city'), 'autocomplete="address-level2" required')}</div>
          <div class="grid2">${f('province', t('province'), 'autocomplete="address-level1"')}
            <label class="f"><span>${esc(t('country'))}</span><select class="in" name="country">
              ${CONFIG.countries.map(c => `<option value="${c}"${(saved.country || 'ES') === c ? ' selected' : ''}>${esc(t('countries')[c] || c)}</option>`).join('')}
            </select></label></div>
          <label class="f" style="margin:0"><span>${esc(t('notes'))}</span><textarea class="in" name="notes" maxlength="500"></textarea></label>
          <p class="muted small" style="margin:10px 0 0">${esc(t('zip_hint'))}</p>
        </div>
        <div class="box"><h3>${esc(t('payment'))}</h3>
          <div class="pay">${methods.map((m, i) => `<label><input type="radio" name="payment_method" value="${m}" ${i ? '' : 'checked'}>
            <span><b style="font-weight:600">${esc(t('pay_' + m))}</b><small>${esc(t('pay_' + m + '_s'))}</small></span></label>`).join('')}</div>
        </div>
      </div>
      <aside class="summary">
        <h3>${esc(t('order_summary'))}</h3>
        ${lines.map(l => lineHtml(l, false)).join('')}
        <div style="height:14px"></div>
        <div id="coSum"></div>
        <div id="coErr" style="margin-top:12px"></div>
        <button class="btn block" style="margin-top:14px" id="coBtn">${esc(t('place_order'))}</button>
        <p class="muted" style="font-size:12px;margin:12px 0 0">${esc(t('accept'))} <a class="link" href="/info/terms" data-link>${esc(t('terms'))}</a> ${esc(t('and'))} <a class="link" href="/info/privacy" data-link>${esc(t('privacy'))}</a>.</p>
      </aside>
    </form>
  </div>`;

  const form = $('#coForm');
  const sub = lines.reduce((a, l) => a + l.sum, 0);
  const upd = () => {
    const country = form.country.value, zip = form.zip.value;
    const zone = shipZone(country, zip);
    const blocked = zipComplete(country, zip) && !zone;
    $('#coSum').innerHTML = summaryHtml(lines, zone ? shippingFor(zone, sub) : null);
    $('#coErr').innerHTML = blocked ? `<p class="notice err">${esc(t('err_no_shipping'))}</p>` : '';
    $('#coBtn').textContent = form.payment_method?.value === 'card' ? t('pay_now') : t('place_order');
  };
  upd();
  form.addEventListener('change', upd);
  form.zip.addEventListener('input', upd);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const required = ['email', 'phone', 'customer_name', 'address', 'zip', 'city'];
    $$('.in', form).forEach(i => i.classList.remove('err'));
    const miss = required.find(k => !String(data[k] || '').trim());
    if (miss) { form[miss].classList.add('err'); form[miss].focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) { form.email.classList.add('err'); form.email.focus(); return; }
    if (!shipZone(data.country, data.zip)) {
      form.zip.classList.add('err'); form.zip.focus();
      $('#coErr').innerHTML = `<p class="notice err">${esc(t('err_no_shipping'))}</p>`; return;
    }

    const { notes, payment_method, ...addr } = data;
    store.set('vaddr', addr);
    const btn = $('#coBtn'); btn.disabled = true;
    try {
      const body = { ...data, lang: LANG, items: cart.get().map(i => ({ id: i.id, qty: i.qty, options: i.options, car: i.car })) };
      let res;
      try { res = await post('/api/orders', { ...body, checkout_id: checkoutAttempt(body) }); }
      catch (err) {
        // that attempt can't be continued (its payment page expired, or the order changed): start a new one, once
        if (!['checkout_changed', 'checkout_ended'].includes(err.message)) throw err;
        store.del('vcheckout');
        res = await post('/api/orders', { ...body, checkout_id: checkoutAttempt(body) });
      }
      if (res.redirect) { location.href = res.redirect; return; }   // (the attempt is kept: "back" from Stripe continues it)
      store.del('vcheckout');
      cart.clear();
      try { sessionStorage.setItem('vorder', JSON.stringify(res)); } catch {}
      PRODUCTS = null; ME = undefined;
      go('/order/' + res.ref, true);
    } catch (err) {
      $('#coErr').innerHTML = `<p class="notice err">${esc(errText(err.message))}</p>`;
      btn.disabled = false;
    }
  });
}

// One random ID per checkout attempt, kept in this browser (all tabs) while the cart and the form stay
// the same, also after coming back from the Stripe page. The server answers a repeat of the same
// attempt with the order it already made, so a double click, a refresh, a second tab or "back" from
// Stripe never makes a second order. Only a short hash of the cart and form is stored, not the data.
function checkoutAttempt(body) {
  const fp = hashText(JSON.stringify(body));
  let a = store.get('vcheckout', null);
  if (!a || a.fp !== fp || !a.id) { a = { id: newCheckoutId(), fp }; store.set('vcheckout', a); }
  return a.id;
}
const newCheckoutId = () => crypto.randomUUID ? crypto.randomUUID()
  : [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
// FNV-1a, 32 bit: enough to notice that the cart or the form changed
const hashText = t => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16); };

async function viewStripeReturn() {
  const q = new URLSearchParams(location.search);
  app.innerHTML = `<div class="loading">…</div>`;
  try {
    const res = await post('/api/orders/confirm', { ref: q.get('ref'), session_id: q.get('session_id') });
    store.del('vcheckout');
    cart.clear();
    PRODUCTS = null;
    try { sessionStorage.setItem('vorder', JSON.stringify(res)); } catch {}
    go('/order/' + res.ref, true);
  } catch (e) {
    app.innerHTML = `<div class="wrap page"><p class="notice err">${esc(t('pay_pending'))}</p></div>`;
  }
}

// Which message the card return page shows: payment received, payment received for an order that
// had been cancelled (it will be refunded), or payment not confirmed yet
function cardResultKey(o) {
  const paid = o.paid ?? o.status === 'paid';
  if (paid && o.status === 'cancelled') return 'paid_cancelled';
  return paid ? 'paid_ok' : 'pay_pending';
}

async function viewOrderDone(ref) {
  setTitle(t('thanks'));
  let o = null;
  try { o = JSON.parse(sessionStorage.getItem('vorder') || 'null'); } catch {}
  if (!o || o.ref !== ref) o = { ref };
  const kv = (k, v) => `<div class="kv"><span class="muted">${esc(k)}</span><b>${esc(v)}</b></div>`;
  let body = '';
  if (o.payment_method === 'card') body = `<p>${esc(t(cardResultKey(o)))}</p>`;
  else if (o.payment_method === 'bizum') body = `<p>${esc(t('bizum_do'))}</p><div class="box paybox">${kv('Bizum', o.bizum_phone)}${kv(t('amount'), eur(o.total_cents))}${kv(t('concept'), o.ref)}</div>`;
  else if (o.payment_method === 'transfer') body = `<p>${esc(t('transfer_do'))}</p><div class="box paybox">${kv('IBAN', o.iban)}${o.iban_holder ? kv(t('holder'), o.iban_holder) : ''}${kv(t('amount'), eur(o.total_cents))}${kv(t('concept'), o.ref)}</div>`;
  else if (o.payment_method === 'contact') body = `<p>${esc(t('contact_do'))}</p>`;
  app.innerHTML = `<div class="wrap page"><div class="done">
    <div class="check">${ICON.check}</div>
    <h1>${esc(t('thanks'))}</h1>
    <p class="muted">${esc(t('order_ref'))}: <b style="color:var(--text)">${esc(ref)}</b></p>
    ${body}
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:12px">
      ${ME ? `<a class="btn" href="/account/orders" data-link>${esc(t('my_orders'))}</a>` : ''}
      <a class="btn ghost" href="/" data-link>${esc(t('back_home'))}</a>
    </div>
  </div></div>`;
}

/* ---------- Account ---------- */
async function viewAccount(tab) {
  if (tab === 'reset') return viewReset();
  if (!ME) return viewAuth();
  tab = tab || 'orders';
  setTitle(t('account'));
  const tabs = [['orders', t('my_orders')], ['details', t('my_details')], ['car', t('my_car_tab')], ['password', t('change_password')]];
  app.innerHTML = `<div class="wrap page" style="max-width:860px">
    <div class="section-head"><div><h1 style="margin:0">${esc(t('account'))}</h1><p class="muted" style="margin:4px 0 0">${esc(t('hello'))}, ${esc(ME.name)} · ${esc(ME.email)}</p></div>
      <button class="btn ghost sm" id="logout">${esc(t('logout'))}</button></div>
    <nav class="tabs-line">${tabs.map(([k, l]) => `<a href="/account/${k}" data-link class="${k === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>
    <div id="accBody"></div>
  </div>`;
  $('#logout').addEventListener('click', async () => {
    await post('/api/account/logout');
    ME = null; myCar.clear(); store.del('vaddr');
    go('/');
  });
  const body = $('#accBody');
  const msg = (el, html, cls = 'ok') => { el.innerHTML = `<p class="notice ${cls}" style="margin-top:12px">${html}</p>`; };

  if (tab === 'orders') {
    const id = renderId;
    const orders = await api('/api/account/orders');
    if (stale(id)) return;
    body.innerHTML = orders.length ? orders.map(o => `<div class="order-card">
      <div class="head"><div><b style="font-weight:600">${esc(o.ref)}</b> <span class="muted small">· ${esc(t('placed_on'))} ${esc(date(o.created_at))}</span></div>
        <span class="status ${esc(o.status)}">${esc(t('st_' + o.status))}</span></div>
      ${o.items.map(i => {
        const nm = LANG === 'es' && i.name_es ? i.name_es : i.name;
        const op = LANG === 'es' && i.options_es ? i.options_es : i.options || [];
        return `<div class="small" style="padding:4px 0">${i.qty}× ${esc(nm)} — ${eur(i.unit_cents * i.qty)}
        ${i.car ? `<div class="muted">${esc(i.car)}</div>` : ''}${op.length ? `<div class="muted">${esc(op.join(' · '))}</div>` : ''}</div>`;
      }).join('')}
      <div class="small" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
        <b style="font-weight:600">${esc(t('total'))}: ${eur(o.total_cents)}</b>
        <span class="muted"> · ${esc(o.address)}, ${esc(o.zip)} ${esc(o.city)}</span>
        ${o.tracking ? `<div style="margin-top:4px">${esc(t('tracking'))}: <b style="font-weight:600">${esc(o.tracking)}</b></div>` : ''}
        ${o.status !== 'cancelled' ? `<div style="margin-top:6px"><a class="link muted" href="/withdraw?ref=${encodeURIComponent(o.ref)}" data-link>${esc(t('withdraw_link'))}</a></div>` : ''}
      </div></div>`).join('')
      : `<p class="muted">${esc(t('no_orders'))}</p><a class="btn" href="/" data-link>${esc(t('keep_shopping'))}</a>`;
  }

  if (tab === 'details') {
    const f = (name, label, attrs = '') => `<label class="f"><span>${esc(label)}</span><input class="in" name="${name}" value="${esc(ME[name] || '')}" ${attrs}></label>`;
    body.innerHTML = `<form id="detForm" class="box">
      <div class="grid2">${f('name', t('full_name'), 'autocomplete="name"')}${f('phone', t('phone'), 'type="tel" autocomplete="tel"')}</div>
      ${f('address', t('address'), 'autocomplete="street-address"')}
      <div class="grid2">${f('zip', t('zip'), 'autocomplete="postal-code"')}${f('city', t('city'), 'autocomplete="address-level2"')}</div>
      <div class="grid2">${f('province', t('province'))}
        <label class="f"><span>${esc(t('country'))}</span><select class="in" name="country">
          ${CONFIG.countries.map(c => `<option value="${c}"${(ME.country || 'ES') === c ? ' selected' : ''}>${esc(t('countries')[c] || c)}</option>`).join('')}
        </select></label></div>
      <button class="btn">${esc(t('save'))}</button><div id="detMsg"></div></form>`;
    $('#detForm').addEventListener('submit', async e => {
      e.preventDefault();
      try { ME = (await post('/api/account/me', Object.fromEntries(new FormData(e.target)), 'PUT')).user; msg($('#detMsg'), esc(t('saved'))); }
      catch (err) { msg($('#detMsg'), esc(errText(err.message)), 'err'); }
    });
  }

  if (tab === 'car') {
    let chosen = myCar.get() || ME.car;
    body.innerHTML = `<div class="finder"><p class="muted small" style="margin-top:0">${esc(t('car_saved_hint'))}</p>
      <div class="car-row"><div id="accCar" style="display:contents"></div><button class="btn" id="carSave" ${chosen ? '' : 'disabled'}>${esc(t('save'))}</button></div>
      <div id="carMsg"></div></div>`;
    mountCarSelect($('#accCar'), chosen, c => { chosen = c; $('#carSave').disabled = !c; });
    $('#carSave').addEventListener('click', async () => {
      if (!chosen) return;
      store.set('vcar2', chosen);
      try { ME = (await post('/api/account/me', { car: chosen }, 'PUT')).user; msg($('#carMsg'), `${esc(t('saved'))} · <a class="link" href="/car" data-link>${esc(t('show'))}</a>`); }
      catch (err) { msg($('#carMsg'), esc(err.message), 'err'); }
    });
  }

  if (tab === 'password') {
    body.innerHTML = `<form id="pwForm" class="box" style="max-width:420px">
      <label class="f"><span>${esc(t('current_password'))}</span><input class="in" type="password" name="current" autocomplete="current-password" required></label>
      <label class="f"><span>${esc(t('new_password'))} · ${esc(t('password_hint'))}</span><input class="in" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn">${esc(t('save'))}</button><div id="pwMsg"></div></form>`;
    $('#pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      try { await post('/api/account/password', Object.fromEntries(new FormData(e.target)), 'PUT'); e.target.reset(); msg($('#pwMsg'), esc(t('saved'))); }
      catch (err) { msg($('#pwMsg'), esc(errText(err.message)), 'err'); }
    });
  }
}

function viewAuth() {
  const params = new URLSearchParams(location.search);
  const nextRaw = params.get('next') || '';
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/account';
  let mode = params.get('mode') === 'register' ? 'register' : 'login';
  setTitle(t('account'));
  const draw = () => {
    if (mode === 'forgot') return drawForgot();
    app.innerHTML = `<div class="wrap page"><div class="auth">
      <nav class="tabs-line"><button data-m="login" class="${mode === 'login' ? 'on' : ''}">${esc(t('login'))}</button>
        <button data-m="register" class="${mode === 'register' ? 'on' : ''}">${esc(t('register'))}</button></nav>
      <form id="authForm" class="box" novalidate>
        ${mode === 'register' ? `<label class="f"><span>${esc(t('full_name'))}</span><input class="in" name="name" autocomplete="name" required></label>` : ''}
        <label class="f"><span>${esc(t('email'))}</span><input class="in" type="email" name="email" autocomplete="email" required></label>
        <label class="f"><span>${esc(t('password'))}${mode === 'register' ? ' · ' + esc(t('password_hint')) : ''}</span>
          <input class="in" type="password" name="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" required></label>
        <div id="authErr"></div>
        <button class="btn block">${esc(mode === 'register' ? t('register') : t('login'))}</button>
        ${mode === 'login' ? `<p class="small" style="margin:14px 0 0"><button type="button" class="chip-btn" data-m="forgot" style="padding:0">${esc(t('forgot_link'))}</button></p>` : ''}
      </form>
    </div></div>`;
    $$('[data-m]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      const btn = $('button.btn', e.target); btn.disabled = true;
      try {
        const res = await post('/api/account/' + mode, { ...data, lang: LANG });
        afterLogin(res.user, next);
      } catch (err) {
        $('#authErr').innerHTML = `<p class="notice err" style="margin-bottom:14px">${esc(errText(err.message))}</p>`;
        btn.disabled = false;
      }
    });
  };
  const drawForgot = () => {
    app.innerHTML = `<div class="wrap page"><div class="auth">
      <h1 style="font-size:24px">${esc(t('forgot_title'))}</h1>
      <form id="fgForm" class="box" novalidate>
        <p class="muted small" style="margin-top:0">${esc(t('forgot_intro'))}</p>
        <label class="f"><span>${esc(t('email'))}</span><input class="in" type="email" name="email" autocomplete="email" required></label>
        <div id="fgMsg"></div>
        <button class="btn block">${esc(t('send_link'))}</button>
        <p class="small" style="margin:14px 0 0"><button type="button" class="chip-btn" id="fgBack" style="padding:0">${esc(t('back_login'))}</button></p>
      </form></div></div>`;
    $('#fgBack').addEventListener('click', () => { mode = 'login'; draw(); });
    $('#fgForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('button.btn', e.target); btn.disabled = true;
      try {
        const r = await post('/api/account/forgot', { email: e.target.email.value, lang: LANG });
        $('#fgMsg').innerHTML = r.mail
          ? `<p class="notice ok" style="margin-bottom:14px">${esc(t('forgot_sent'))}</p>`
          : `<p class="notice" style="margin-bottom:14px">${CONFIG.whatsapp ? `<a class="link" href="${waLink()}" target="_blank" rel="noopener">${esc(t('forgot'))}</a>` : esc(t('forgot'))}</p>`;
      } catch (err) {
        $('#fgMsg').innerHTML = `<p class="notice err" style="margin-bottom:14px">${esc(errText(err.message))}</p>`;
        btn.disabled = false;
      }
    });
  };
  draw();
}
function afterLogin(user, next) {
  ME = user;
  if (ME.car && !myCar.get()) myCar.set(ME.car, true);
  else if (!ME.car && myCar.get()) myCar.set(myCar.get());
  go(next, true);
}

function viewReset() {
  const token = new URLSearchParams(location.search).get('token') || '';
  setTitle(t('forgot_title'));
  app.innerHTML = `<div class="wrap page"><div class="auth">
    <h1 style="font-size:24px">${esc(t('new_password_title'))}</h1>
    <form id="rsForm" class="box" novalidate>
      <label class="f"><span>${esc(t('new_password'))} · ${esc(t('password_hint'))}</span><input class="in" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <div id="rsMsg"></div>
      <button class="btn block">${esc(t('save'))}</button>
    </form></div></div>`;
  $('#rsForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const r = await post('/api/account/reset', { token, password: e.target.password.value });
      afterLogin(r.user, '/account');
    } catch (err) {
      $('#rsMsg').innerHTML = `<p class="notice err" style="margin-bottom:14px">${esc(errText(err.message))}${err.message === 'bad_token' ? ` <a class="link" href="/account" data-link>${esc(t('forgot_link'))}</a>` : ''}</p>`;
    }
  });
}

/* ---------- Right of withdrawal: "Withdraw from contract here" ---------- */
function viewWithdraw() {
  const ref = new URLSearchParams(location.search).get('ref') || '';
  setTitle(t('withdraw_title'));
  const v = k => esc(ME?.[k] || '');
  app.innerHTML = `<div class="wrap page" style="max-width:620px">
    <h1>${esc(t('withdraw_title'))}</h1>
    <p class="muted">${esc(t('withdraw_intro'))}</p>
    <form id="wdForm" class="box" novalidate>
      <label class="f"><span>${esc(t('withdraw_ref'))}</span><input class="in" name="ref" value="${esc(ref)}" required autocapitalize="characters"></label>
      <div class="grid2">
        <label class="f"><span>${esc(t('full_name'))}</span><input class="in" name="name" value="${v('name')}" autocomplete="name" required></label>
        <label class="f"><span>${esc(t('email'))}</span><input class="in" type="email" name="email" value="${v('email')}" autocomplete="email" required></label>
      </div>
      <label class="f"><span>${esc(t('withdraw_msg'))}</span><textarea class="in" name="message" maxlength="1000"></textarea></label>
      <p class="muted small">${esc(t('withdraw_note'))}</p>
      <div id="wdErr"></div>
      <button class="btn block">${esc(t('withdraw_confirm'))}</button>
    </form>
  </div>`;
  $('#wdForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const btn = $('button.btn', e.target); btn.disabled = true;
    try {
      const r = await post('/api/withdraw', data);
      const when = new Date(r.at.replace(' ', 'T') + 'Z').toLocaleString(LANG === 'es' ? 'es-ES' : 'en-GB');
      app.innerHTML = `<div class="wrap page"><div class="done">
        <div class="check">${ICON.check}</div>
        <h1>${esc(t('withdraw_done'))}</h1>
        <p class="muted">${esc(t('withdraw_done_s').replace('{ref}', r.ref).replace('{when}', when))}</p>
        <a class="btn ghost" href="/" data-link style="margin-top:12px">${esc(t('back_home'))}</a>
      </div></div>`;
      window.scrollTo(0, 0);
    } catch (err) {
      $('#wdErr').innerHTML = `<p class="notice err" style="margin-bottom:14px">${esc(errText(err.message))}</p>`;
      btn.disabled = false;
    }
  });
}

/* ---------- Info pages (short, editable here) ---------- */
function legalText(page) {
  const c = CONFIG.company, sh = CONFIG.shipping;
  const who = `${esc(c.name)}${c.nif ? ` (NIF ${esc(c.nif)})` : ''}${c.address ? `, ${esc(c.address)}` : ''}`;
  const mail = esc(CONFIG.email);
  const pt = CONFIG.countries.includes('PT');
  const fee = (cents, free, lang) => cents ? `${eur(cents)}${free ? (lang === 'es' ? ` (gratis desde ${eur(free)})` : ` (free from ${eur(free)})`) : ''}` : (lang === 'es' ? 'gratis' : 'free');
  const wd = lang => `<a class="link" href="/withdraw" data-link>${lang === 'es' ? 'Desistir del contrato aquí' : 'Withdraw from contract here'}</a>`;
  const P = {
    en: {
      shipping: ['Shipping', `<p>Orders are dispatched in 24–48 working hours (custom EVO mats: 3–5 working days, made to order). You will receive the tracking number by email and in your account.</p>
        <ul>
          <li>Mainland Spain: ${fee(sh.es, sh.free_es, 'en')} · 1–3 working days</li>
          <li>Balearic Islands: ${fee(sh.ib, sh.free_far, 'en')} · 2–5 working days</li>
          ${pt ? `<li>Portugal: ${fee(sh.pt, sh.free_far, 'en')} · 2–5 working days</li>` : ''}
        </ul>
        <p>For now we do not ship to the Canary Islands, Ceuta, Melilla or other countries. If you need it, write to us at ${mail}.</p>`],
      returns: ['Returns & guarantee', `<h2>Right of withdrawal (14 days)</h2>
        <p>You can withdraw from your purchase within <b>14 days</b> from the day you receive it, without giving a reason. The easiest way is the online form: ${wd('en')}. You can also send us any clear statement by email to ${mail}, for example:</p>
        <p class="notice">To ${who}: I hereby give notice that I withdraw from my contract for the following goods: [products], ordered on [date] / received on [date]. Order number: [VN-…]. Name: […]. Address: […]. Date: […].</p>
        <p>Send the products back unused, in their original packaging, within 14 days of telling us. <b>The cost of returning the products is paid by the customer</b>, unless the product is faulty or we sent the wrong item. We refund the price of the products and the standard delivery cost within 14 days of receiving them back, using the same payment method.</p>
        <p><b>Custom-fit EVO mats</b> are made to measure for your car. As personalised products, they cannot be returned unless they are faulty or do not match the car you ordered.</p>
        <h2>Guarantee</h2>
        <p>All products have the <b>3-year legal guarantee</b>. If something fails, contact us and we will repair, replace or refund it. In that case we pay the shipping costs.</p>`],
      terms: ['Terms of sale', `<p>These terms apply to purchases on this website, operated by ${who}. Contact: ${mail}.</p>
        <p>Prices are in euros and include VAT. Shipping costs are shown before you pay. The contract is formed when you receive the order confirmation by email.</p>
        <p>We ship to mainland Spain, the Balearic Islands${pt ? ' and Portugal' : ''}. Payment methods available are shown at checkout. Orders paid by Bizum or bank transfer are shipped once the payment is received; unpaid orders are cancelled after 5 days.</p>
        <p>You have the right of withdrawal described in our <a class="link" href="/info/returns" data-link>returns policy</a> (${wd('en')}) and the 3-year legal guarantee.</p>
        <p>These terms are governed by Spanish law. If you are a consumer, you may go to the courts of your place of residence.</p>`],
      privacy: ['Privacy policy', `<p>Controller: ${who}. Contact: ${mail}.</p>
        <p>We only collect the data needed to manage your account and to process and ship your orders (name, address, email, phone and, if you add it, your car). Legal basis: performance of the contract. We keep it while your account is active and for as long as tax law requires.</p>
        <p>We share your data only with the carrier, our email provider (to send you the order emails) and, for card payments, with Stripe. We do not sell your data or send advertising without your consent.</p>
        <p>This website uses only one technical cookie to keep you logged in. It does not use tracking or advertising cookies. Your cart and language are saved in your browser.</p>
        <p>You can access, correct or delete your data (including your account) by writing to ${mail}. You may also complain to the Spanish Data Protection Agency (aepd.es).</p>`],
      legal: ['Legal notice', `<p>Owner of this website: ${who}. Email: ${mail}.</p><p>All content of this website belongs to its owner. Use of the website implies acceptance of these terms.</p>`],
    },
    es: {
      shipping: ['Envíos', `<p>Los pedidos salen en 24–48 horas laborables (alfombrillas EVO a medida: 3–5 días laborables, se fabrican bajo pedido). Recibirás el número de seguimiento por email y en tu cuenta.</p>
        <ul>
          <li>España peninsular: ${fee(sh.es, sh.free_es, 'es')} · 1–3 días laborables</li>
          <li>Baleares: ${fee(sh.ib, sh.free_far, 'es')} · 2–5 días laborables</li>
          ${pt ? `<li>Portugal: ${fee(sh.pt, sh.free_far, 'es')} · 2–5 días laborables</li>` : ''}
        </ul>
        <p>Por ahora no enviamos a Canarias, Ceuta, Melilla ni a otros países. Si lo necesitas, escríbenos a ${mail}.</p>`],
      returns: ['Devoluciones y garantía', `<h2>Derecho de desistimiento (14 días)</h2>
        <p>Puedes desistir de tu compra en los <b>14 días</b> siguientes al día en que la recibes, sin dar explicaciones. Lo más fácil es el formulario online: ${wd('es')}. También puedes enviarnos cualquier declaración clara por email a ${mail}, por ejemplo:</p>
        <p class="notice">A la atención de ${who}: Por la presente le comunico que desisto de mi contrato de venta de los siguientes bienes: [productos], pedidos el [fecha] / recibidos el [fecha]. Número de pedido: [VN-…]. Nombre: […]. Dirección: […]. Fecha: […].</p>
        <p>Devuelve los productos sin usar y en su embalaje original en los 14 días siguientes a comunicárnoslo. <b>El coste de la devolución corre a cargo del cliente</b>, salvo que el producto sea defectuoso o te hayamos enviado uno equivocado. Te devolvemos el precio de los productos y el coste del envío estándar en un máximo de 14 días desde que los recibimos, por el mismo medio de pago.</p>
        <p>Las <b>alfombrillas EVO a medida</b> se fabrican para tu coche. Al ser productos personalizados, no admiten devolución salvo que tengan un defecto o no correspondan al coche que pediste.</p>
        <h2>Garantía</h2>
        <p>Todos los productos tienen la <b>garantía legal de 3 años</b>. Si algo falla, contáctanos y lo reparamos, sustituimos o te devolvemos el dinero. En ese caso pagamos nosotros los envíos.</p>`],
      terms: ['Condiciones de venta', `<p>Estas condiciones se aplican a las compras en esta web, gestionada por ${who}. Contacto: ${mail}.</p>
        <p>Los precios están en euros e incluyen IVA. Los gastos de envío se muestran antes de pagar. El contrato se perfecciona cuando recibes la confirmación del pedido por email.</p>
        <p>Enviamos a España peninsular, Baleares${pt ? ' y Portugal' : ''}. Los métodos de pago disponibles se muestran al finalizar la compra. Los pedidos pagados por Bizum o transferencia se envían al recibir el pago; los pedidos no pagados se cancelan a los 5 días.</p>
        <p>Tienes el derecho de desistimiento descrito en nuestra <a class="link" href="/info/returns" data-link>política de devoluciones</a> (${wd('es')}) y la garantía legal de 3 años.</p>
        <p>Estas condiciones se rigen por la ley española. Si eres consumidor, puedes acudir a los tribunales de tu domicilio.</p>`],
      privacy: ['Política de privacidad', `<p>Responsable: ${who}. Contacto: ${mail}.</p>
        <p>Solo recogemos los datos necesarios para gestionar tu cuenta y tramitar y enviar tus pedidos (nombre, dirección, email, teléfono y, si lo añades, tu coche). Base legal: ejecución del contrato. Los conservamos mientras tu cuenta esté activa y el tiempo que exige la normativa fiscal.</p>
        <p>Solo compartimos tus datos con la empresa de transporte, nuestro proveedor de email (para enviarte los correos del pedido) y, en pagos con tarjeta, con Stripe. No vendemos tus datos ni enviamos publicidad sin tu consentimiento.</p>
        <p>Esta web solo usa una cookie técnica para mantener tu sesión iniciada. No usa cookies de seguimiento ni de publicidad. Tu carrito y tu idioma se guardan en tu navegador.</p>
        <p>Puedes acceder, rectificar o suprimir tus datos (incluida tu cuenta) escribiendo a ${mail}. También puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).</p>`],
      legal: ['Aviso legal', `<p>Titular de esta web: ${who}. Email: ${mail}.</p><p>Todos los contenidos de esta web pertenecen a su titular. El uso de la web implica la aceptación de estas condiciones.</p>`],
    },
  };
  return P[LANG][page];
}
async function viewLegal(page) {
  const [title, html] = legalText(page);
  setTitle(title);
  app.innerHTML = `<div class="wrap page prose"><h1>${esc(title)}</h1>${html}</div>`;
}

function viewNotFound() {
  setTitle('404');
  app.innerHTML = `<div class="wrap empty"><h1>404</h1><p class="muted">${esc(t('not_found'))}</p><a class="btn" href="/" data-link>${esc(t('back_home'))}</a></div>`;
}

render();
})();

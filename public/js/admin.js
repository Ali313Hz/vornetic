/* Vornetic — satıcı paneli */
(() => {
'use strict';
const root = document.getElementById('root');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const eur = c => (c / 100).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const toEuro = c => c == null ? '' : (c / 100).toFixed(2);
const day = s => (s || '').slice(0, 16);

async function api(url, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const r = await fetch(url, { headers: isForm ? {} : { 'Content-Type': 'application/json' }, ...opts });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('Oturum kapandı'); }
  if (!r.ok) throw new Error(d.error || 'Hata');
  return d;
}
const send = (url, body, method = 'PUT') => api(url, { method, body: JSON.stringify(body) });
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

const STATUS = { pending: 'Ödeme bekliyor', paid: 'Ödendi — gönderilecek', shipped: 'Kargoda', delivered: 'Teslim edildi', cancelled: 'İptal' };
const PAY = { card: 'Kart (Stripe)', bizum: 'Bizum', transfer: 'Havale', contact: 'İletişimle ödeme' };
const TABS = { orders: 'Siparişler', customers: 'Müşteriler', withdrawals: 'Cayma', products: 'Ürünler', categories: 'Kategoriler', bulbs: 'Ampuller', stats: 'Özet', settings: 'Ayarlar' };
let ME = {};
let tab = 'orders';

function showLogin() {
  $('#tabs').innerHTML = ''; $('#logout').hidden = true;
  root.innerHTML = `<form id="lf" class="box" style="max-width:380px;margin:60px auto">
    <h2>Satıcı paneli</h2>
    <label class="f"><span>Şifre</span><input class="in" type="password" name="password" autofocus autocomplete="current-password"></label>
    <div id="lerr"></div><button class="btn block">Giriş</button></form>`;
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
function drawTabs() {
  $('#tabs').innerHTML = Object.entries(TABS).map(([k, v]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${v}${
    k === 'withdrawals' && ME.open_withdrawals ? ` <span class="badge" style="position:static;display:inline-grid">${ME.open_withdrawals}</span>` : ''}</button>`).join('');
}
async function refreshMe() { try { ME = await api('/api/admin/me'); drawTabs(); } catch {} }
$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { tab = b.dataset.t; drawTabs(); show(); } });
$('#logout').addEventListener('click', async () => { await send('/api/admin/logout', {}, 'POST'); showLogin(); });

function show() {
  root.innerHTML = '<p class="muted">Yükleniyor…</p>';
  window.scrollTo(0, 0);
  ({ orders: viewOrders, customers: viewCustomers, withdrawals: viewWithdrawals, products: viewProducts, categories: viewCategories, bulbs: viewBulbs, stats: viewStats, settings: viewSettings })[tab]().catch(e => {
    root.innerHTML = `<p class="notice err">${esc(e.message)}</p>`;
  });
}

/* ---------- Siparişler ---------- */
let orderFilter = '', orderSearch = '';
async function viewOrders() {
  const orders = await api('/api/admin/orders' + (orderFilter ? '?status=' + orderFilter : ''));
  root.innerHTML = `
    <div class="section-head"><h2>Siparişler</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="in search" id="os" placeholder="Ara: isim, e-posta, sipariş no" value="${esc(orderSearch)}">
        <select class="in" id="of" style="width:auto">
          <option value="">Hepsi</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === orderFilter ? ' selected' : ''}>${v}</option>`).join('')}
        </select></div></div>
    <div id="olist"></div>`;
  const draw = () => {
    const q = orderSearch.toLowerCase();
    const list = q ? orders.filter(o => [o.ref, o.customer_name, o.email, o.phone, o.city].join(' ').toLowerCase().includes(q)) : orders;
    $('#olist').innerHTML = list.length ? list.map(orderHtml).join('') : '<p class="muted">Sipariş yok.</p>';
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
        toast(r.mailed ? 'Kaydedildi · müşteriye e-posta gitti' : 'Kaydedildi'); after();
      } catch (e) { toast(e.message); }
    });
    $('[data-cust]', el)?.addEventListener('click', () => { tab = 'customers'; drawTabs(); viewCustomer(+$('[data-cust]', el).dataset.cust); });
  });
}
function waUrl(phone, text) {
  const p = (phone || '').replace(/[^\d]/g, '');
  return p ? `https://wa.me/${p.length === 9 ? '34' + p : p}?text=${encodeURIComponent(text)}` : '';
}
function orderHtml(o) {
  const items = JSON.parse(o.items);
  const wa = waUrl(o.phone, `Vornetic — ${o.ref}`);
  return `<div class="order" data-id="${o.id}">
    <div class="order-head">
      <div><b>${esc(o.ref)}</b> · <span class="muted">${esc(day(o.created_at))}</span> · <span class="muted">${esc(o.lang.toUpperCase())}</span>
        ${o.user_id ? ` · <button class="chip-btn small" data-cust="${o.user_id}">kayıtlı müşteri →</button>` : ' · <span class="muted small">misafir</span>'}</div>
      <div>${o.withdrawals ? '<span class="status pending">↩ Cayma talebi</span> ' : ''}<span class="status ${esc(o.status)}">${STATUS[o.status]}</span></div>
    </div>
    <div class="order-cols">
      <div class="items">${items.map(i => `<div><b>${i.qty}× ${esc(i.name)}</b> — ${eur(i.unit_cents * i.qty)}
        ${i.car ? `<small>🚗 ${esc(i.car)}</small>` : ''}${(i.options || []).map(x => `<small>${esc(x)}</small>`).join('')}</div>`).join('')}
        <div style="border:0">Kargo: ${eur(o.shipping_cents)} · <b>Toplam: ${eur(o.total_cents)}</b> · ${PAY[o.payment_method] || esc(o.payment_method)}</div>
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
      <select class="in sts">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === o.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
      <input class="in trk" placeholder="Kargo takip no (Kargoda yapmadan önce yaz)" value="${esc(o.tracking)}" style="min-width:260px">
      <button class="btn sm save">Kaydet</button>
    </div>
  </div>`;
}

/* ---------- Müşteriler ---------- */
let custSearch = '';
const carText = c => { try { const x = typeof c === 'string' ? JSON.parse(c) : c; return x ? `${x.brand} ${x.model} ${x.gen} · ${x.year}${x.engine ? ' · ' + x.engine : ''}` : ''; } catch { return ''; } };
async function viewCustomers() {
  const list = await api('/api/admin/customers');
  root.innerHTML = `
    <div class="section-head"><h2>Müşteriler <span class="muted" style="font-weight:400">(${list.length})</span></h2>
      <input class="in search" id="cs" placeholder="Ara: isim, e-posta, telefon, şehir" value="${esc(custSearch)}"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Müşteri</th><th>İletişim</th><th>Adres</th><th>Araba</th><th>Sipariş</th><th>Harcama</th><th>Kayıt</th></tr></thead>
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
      : '<tr><td colspan="7" class="muted">Henüz kayıtlı müşteri yok.</td></tr>';
    $$('tr.click').forEach(tr => tr.addEventListener('click', () => viewCustomer(+tr.dataset.id)));
  };
  draw();
  $('#cs').addEventListener('input', e => { custSearch = e.target.value; draw(); });
}

async function viewCustomer(id) {
  root.innerHTML = '<p class="muted">Yükleniyor…</p>';
  const { user: u, orders } = await api('/api/admin/customers/' + id);
  const wa = waUrl(u.phone, `Hola ${u.name}, te escribimos de Vornetic.`);
  const spent = orders.filter(o => ['paid', 'shipped', 'delivered'].includes(o.status)).reduce((a, o) => a + o.total_cents, 0);
  root.innerHTML = `
    <div class="section-head"><h2>${esc(u.name)}</h2><button class="btn ghost sm" id="back">← Müşteriler</button></div>
    <div class="order-cols" style="margin-bottom:20px">
      <div class="box" style="margin:0">
        <h3>İletişim</h3>
        <p style="margin:0 0 6px"><a class="link" href="mailto:${esc(u.email)}">${esc(u.email)}</a></p>
        <p style="margin:0 0 6px">${esc(u.phone) || '<span class="muted">Telefon yok</span>'} ${wa ? `· <a class="link" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p>
        <p class="muted small" style="margin:0">Kayıt: ${esc(day(u.created_at))} · ${orders.length} sipariş · ödenen ${eur(spent)}</p>
      </div>
      <div class="box" style="margin:0">
        <h3>Adres ve araba</h3>
        <p style="margin:0 0 6px">${u.address ? `${esc(u.address)}<br>${esc(u.zip)} ${esc(u.city)}${u.province ? ', ' + esc(u.province) : ''} · ${esc(u.country)}` : '<span class="muted">Adres kaydedilmemiş</span>'}</p>
        <p style="margin:0">🚗 ${esc(carText(u.car)) || '<span class="muted">Araba kaydedilmemiş</span>'}</p>
      </div>
    </div>
    <h3>Siparişleri</h3>
    <div id="custOrders">${orders.length ? orders.map(orderHtml).join('') : '<p class="muted">Bu müşterinin siparişi yok.</p>'}</div>
    <div class="box" style="margin-top:24px">
      <h3>Hesap</h3>
      <p class="muted small">Müşteri şifresini unutursa geçici bir şifre belirleyip ona WhatsApp/e-posta ile gönder; müşteri girişten sonra kendi değiştirebilir.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="in" id="newPw" placeholder="Yeni geçici şifre (en az 8)" style="max-width:280px">
        <button class="btn sm" id="setPw">Şifreyi ayarla</button>
        <button class="btn danger sm" id="delU" style="margin-left:auto">Hesabı sil</button>
      </div>
    </div>`;
  $('#back').addEventListener('click', show);
  bindOrderCards($('#custOrders'), () => viewCustomer(id));
  $('#setPw').addEventListener('click', async () => {
    try { await send(`/api/admin/customers/${id}/password`, { password: $('#newPw').value }); toast('Şifre değişti'); $('#newPw').value = ''; }
    catch (e) { toast(e.message); }
  });
  $('#delU').addEventListener('click', async () => {
    if (!confirm('Bu müşteri hesabı silinsin mi? Siparişleri kayıtlarda kalır.')) return;
    await api('/api/admin/customers/' + id, { method: 'DELETE' }); toast('Silindi'); show();
  });
}

/* ---------- Cayma talepleri ---------- */
async function viewWithdrawals() {
  const list = await api('/api/admin/withdrawals');
  root.innerHTML = `
    <div class="section-head"><h2>Cayma talepleri</h2></div>
    <p class="notice" style="margin-bottom:16px">Müşteri "Desistir del contrato aquí" formunu doldurunca burada görünür ve müşteriye otomatik onay e-postası gider.
    Yapman gereken: müşteriye iade adresini yaz, ürün gelince parayı 14 gün içinde geri öde, siparişi "İptal" yap (stok geri eklenir), sonra burada "Tamamlandı" işaretle.
    EVO (kişiye özel) ürünlerde kusur yoksa cayma hakkı yok.</p>
    ${list.length ? list.map(w => {
      const items = JSON.parse(w.items);
      const wa = waUrl(w.phone, `Vornetic — ${w.ref}`);
      return `<div class="order" data-id="${w.id}" style="${w.handled ? 'opacity:.55' : ''}">
        <div class="order-head"><div><b>${esc(w.ref)}</b> · <span class="muted">${esc(day(w.created_at))}</span> · ${esc(w.name)}</div>
          <span class="status ${w.handled ? 'delivered' : 'pending'}">${w.handled ? 'Tamamlandı' : 'Bekliyor'}</span></div>
        <div class="small">${items.map(i => `${i.qty}× ${esc(i.name)}${i.car ? ' (' + esc(i.car) + ')' : ''}`).join(' · ')} · Toplam ${eur(w.total_cents)} · sipariş durumu: ${STATUS[w.order_status]}</div>
        ${w.message ? `<p class="notice" style="margin-top:8px">${esc(w.message)}</p>` : ''}
        <div class="order-actions">
          <a class="link small" href="mailto:${esc(w.email)}">${esc(w.email)}</a>${wa ? ` · <a class="link small" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          <button class="btn ghost sm hd" style="margin-left:auto">${w.handled ? 'Geri al' : 'Tamamlandı'}</button>
        </div></div>`;
    }).join('') : '<p class="muted">Cayma talebi yok.</p>'}`;
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
  const why = { format: 'biçim hatalı (4 parça olmalı, | ile ayrılmış)', car: 'araba listede yok — marka/model/kasa cars.txt ile birebir aynı olmalı', key: 'anahtar hatalı (low, high, fog, xenon)' };
  const errs = e => e.length ? `<div class="notice err" style="margin-bottom:12px">${e.length} satır kullanılmıyor:<br>${e.map(([n, line, r]) =>
    `Satır ${n}: <span class="mono">${esc(line)}</span> — ${why[r]}`).join('<br>')}</div>` : '';
  root.innerHTML = `
    <div class="section-head"><h2>Ampul listesi <span class="muted" style="font-weight:400">(${d.count} araba)</span></h2></div>
    <p class="notice" style="margin-bottom:12px">Müşteri arabasını seçince "Bombillas de tu coche" kutusunda bu bilgiler görünür ve doğru ürüne gider.
    Listede olmayan arabada müşteriye "ampulündeki kodu kontrol et veya WhatsApp'tan sor" yazar.<br>
    <b>İlk liste benim bilgime dayanıyor — satıştan önce kendi bildiklerinle kontrol et.</b> Emin olmadığın satırı sil ya da anahtarı çıkar.</p>
    <div class="help">Biçim:  Marka | Model | Kasa | low=H7, high=H1, fog=H11, xenon=D1S
low = kısa far (halojen) · high = uzun far · fog = sis · xenon = fabrikadan xenonlu araçta kısa far
H4 tek ampulle kısa+uzun far demek: sadece low=H4 yaz.
Marka / model / kasa adını "Araç seç" listesindekiyle birebir aynı yaz (ör. BMW | 3 Series | E90/E91/E92/E93).</div>
    <div id="bErr">${errs(d.errors)}</div>
    <textarea class="in mono" id="bText" rows="24" spellcheck="false">${esc(d.text)}</textarea>
    <div class="row-end" style="margin-top:12px"><button class="btn" id="bSave">Kaydet</button></div>`;
  $('#bSave').addEventListener('click', async () => {
    try {
      const r = await send('/api/admin/bulbs', { text: $('#bText').value });
      $('#bErr').innerHTML = errs(r.errors);
      toast(`Kaydedildi · ${r.count} araba`);
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
async function uploadFiles(files) {
  const list = [...files];
  if (!list.length) return [];
  const big = list.some(f => f.type.startsWith('video/'));
  const note = document.createElement('div');
  note.className = 'toast'; note.textContent = big ? 'Video yükleniyor… sayfayı kapatma' : 'Yükleniyor…';
  document.body.appendChild(note);
  try {
    const fd = new FormData();
    for (const f of list) fd.append('files', await shrinkImage(f));
    const r = await api('/api/admin/upload', { method: 'POST', body: fd });
    if (r.media.length < list.length) toast('Bazı dosyalar alınmadı (fotoğraf en fazla 12 MB, video MP4/WEBM)');
    return r.media;
  } catch (e) { toast(e.message); return []; }
  finally { note.remove(); }
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
    <div class="section-head"><h2>Kategoriler</h2><button class="btn sm" id="newCat">+ Yeni kategori</button></div>
    <p class="muted small">Sıra küçük olan menüde önce görünür. Gizli kategori menüde ve sitede görünmez.</p>
    <div class="cat-list">${CATS.map(c => `<div class="prow">
      <img src="${esc(c.image || '/img/favicon.png')}" alt="">
      <div><b>${esc(c.name_es)}</b> <span class="muted">/ ${esc(c.name_en)}</span> ${c.active ? '' : '<span class="status cancelled">Gizli</span>'}<br>
        <span class="muted small">${c.products} ürün · sıra ${c.sort} · adres /c/${esc(c.slug)}</span></div>
      <div class="row-end"><button class="btn ghost sm" data-edit="${esc(c.slug)}">Düzenle</button></div>
    </div>`).join('')}</div>`;
  $('#newCat').addEventListener('click', () => editCategory(null));
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => editCategory(CATS.find(c => c.slug === b.dataset.edit))));
}
function editCategory(c) {
  const isNew = !c;
  c = c ? { ...c } : { name_es: '', name_en: '', desc_es: '', desc_en: '', image: '', sort: (CATS.length + 1) * 10, active: 1 };
  root.innerHTML = `<div class="box" style="max-width:760px">
    <div class="section-head"><h2>${isNew ? 'Yeni kategori' : esc(c.name_es)}</h2><button class="btn ghost sm" id="back">← Kategoriler</button></div>
    <div class="grid2">
      <label class="f"><span>İsim — İspanyolca</span><input class="in" id="cNameEs" value="${esc(c.name_es)}" placeholder="ej. Pantallas"></label>
      <label class="f"><span>İsim — İngilizce</span><input class="in" id="cNameEn" value="${esc(c.name_en)}" placeholder="e.g. Screens"></label>
    </div>
    <label class="f"><span>Kısa açıklama — İspanyolca (kategori sayfasında ve Google'da görünür)</span><textarea class="in" id="cDescEs" rows="2">${esc(c.desc_es)}</textarea></label>
    <label class="f"><span>Kısa açıklama — İngilizce</span><textarea class="in" id="cDescEn" rows="2">${esc(c.desc_en)}</textarea></label>
    <div class="grid2">
      <label class="f"><span>Sıra</span><input class="in" id="cSort" type="number" value="${esc(c.sort)}"></label>
      <label class="chk" style="margin-top:28px"><input type="checkbox" id="cActive" ${c.active ? 'checked' : ''}> Sitede göster</label>
    </div>
    <p class="muted small" style="margin-bottom:6px">Kategori fotoğrafı (ana sayfadaki kutu)</p>
    <div class="mtiles" id="cImg">${c.image ? `<div class="mtile"><img src="${esc(c.image)}" alt=""><button class="mx" data-x>✕</button></div>` : ''}
      <label class="mtile add">+ Fotoğraf<input type="file" accept="image/*" hidden></label></div>
    <div class="savebar">
      ${!isNew ? `<button class="btn danger sm" id="cDel">Sil</button>` : ''}
      <button class="btn" id="cSave">Kaydet</button>
    </div></div>`;
  const drawImg = () => {
    $('#cImg').innerHTML = `${c.image ? `<div class="mtile"><img src="${esc(c.image)}" alt=""><button class="mx" data-x>✕</button></div>` : ''}
      <label class="mtile add">+ Fotoğraf<input type="file" accept="image/*" hidden></label>`;
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
      toast('Kaydedildi'); show();
    } catch (e) { toast(e.message); }
  });
  $('#cDel')?.addEventListener('click', async () => {
    if (!confirm('Kategori silinsin mi?')) return;
    try { await api('/api/admin/categories/' + c.slug, { method: 'DELETE' }); toast('Silindi'); show(); }
    catch (e) { toast(e.message); }
  });
}

/* ---------- Ürünler ---------- */
const STATUS_P = { available: 'Satışta', soon: 'Yakında', hidden: 'Gizli' };
async function viewProducts() {
  const [list] = await Promise.all([api('/api/admin/products'), loadCats()]);
  const groups = CATS.map(c => [c, list.filter(p => p.category === c.slug)]);
  root.innerHTML = `
    <div class="section-head"><h2>Ürünler</h2><button class="btn sm" id="newP">+ Yeni ürün</button></div>
    ${groups.map(([c, ps]) => `<h3 class="grp">${esc(c.name_es)} <span class="muted">(${ps.length})</span></h3>
      ${ps.length ? ps.map(p => `<div class="prow" data-id="${p.id}">
        <img src="${esc(p.media.find(m => m.type === 'image')?.src || '/img/favicon.png')}" alt="">
        <div><b>${esc(p.name_es)}</b> <span class="status ${p.status === 'available' ? 'delivered' : p.status === 'soon' ? 'paid' : 'cancelled'}">${STATUS_P[p.status] || p.status}</span><br>
          <span class="muted small">${eur(p.price_cents)}${p.options.length ? ' · ' + p.options.map(o => `${o.values.length} ${esc(o.es)}`).join(' × ') : ''}${p.fitment === 'car' ? ' · arabaya özel' : ''}</span>
          <div class="stock">Stok <button class="sbtn" data-d="-1" aria-label="azalt">−</button><b>${p.stock}</b><button class="sbtn" data-d="1" aria-label="artır">+</button>${p.stock <= 3 && p.status === 'available' ? ' <span class="status pending">az kaldı</span>' : ''}</div></div>
        <div class="row-end"><a class="btn ghost sm" href="/p/${esc(p.slug)}" target="_blank">Gör</a><button class="btn sm" data-edit>Düzenle</button></div>
      </div>`).join('') : '<p class="muted small">Bu kategoride ürün yok.</p>'}`).join('')}`;
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
      ${list.map((m, i) => `<div class="mtile">${mediaThumb(m)}${ctx === 'p' && i === 0 ? '<span class="main">Ana</span>' : ''}
        <div class="mctl">${i ? `<button type="button" data-act="mleft" data-i="${i}" aria-label="sola">‹</button>` : ''}${i < list.length - 1 ? `<button type="button" data-act="mright" data-i="${i}" aria-label="sağa">›</button>` : ''}</div>
        <button type="button" class="mx" data-act="mdel" data-i="${i}" aria-label="kaldır">✕</button></div>`).join('')}
      <label class="mtile add">+ Fotoğraf / video<input type="file" accept="image/*,video/mp4,video/webm" multiple hidden data-up="${ctx}"></label>
    </div>
    ${withPicker && library().length ? `<p class="muted small" style="margin:10px 0 6px">Ya da üründeki fotoğraflardan seç:</p>
      <div class="mtiles pick">${library().map(m => `<button type="button" class="mtile${list.some(x => x.src === m.src) ? ' on' : ''}" data-act="mpick" data-ctx="${ctx}" data-src="${esc(m.src)}">${mediaThumb(m)}</button>`).join('')}</div>` : ''}`;
  };

  const valueRow = (o, oi, v, vi) => {
    const ctx = `v:${oi}:${vi}`;
    return `<div class="vrow${v.soon ? ' soon' : ''}">
      <input class="in" data-k="ves" data-oi="${oi}" data-vi="${vi}" value="${esc(v.es)}" placeholder="İspanyolca" aria-label="Değer İspanyolca">
      <input class="in" data-k="ven" data-oi="${oi}" data-vi="${vi}" value="${esc(v.en === v.es ? '' : v.en)}" placeholder="İngilizce (aynıysa boş)" aria-label="Değer İngilizce">
      <label class="delta"><span>+€</span><input class="in" data-k="vdelta" data-oi="${oi}" data-vi="${vi}" inputmode="decimal" value="${v.delta ? euro(v.delta) : ''}" placeholder="0"></label>
      <button type="button" class="btn ghost sm${openMedia === ctx ? ' on' : ''}" data-act="vmedia" data-ctx="${ctx}">📷 ${v.media.length || ''}</button>
      <button type="button" class="btn ghost sm${v.soon ? ' on' : ''}" data-act="vsoon" data-oi="${oi}" data-vi="${vi}" title="Henüz elimde yok">Yakında</button>
      <button type="button" class="btn ghost sm" data-act="vdel" data-oi="${oi}" data-vi="${vi}" aria-label="Sil">✕</button>
      ${openMedia === ctx ? `<div class="vmedia"><p class="small" style="margin:0 0 8px"><b>${esc(v.es || 'Bu değer')}</b> seçilince gösterilecek fotoğraf ve videolar:</p>${tiles(ctx, true)}</div>` : ''}
    </div>`;
  };

  const optionsHtml = () => `
    ${P.options.map((o, oi) => `<div class="optcard">
      <div class="opthead">
        <input class="in" data-k="oes" data-oi="${oi}" value="${esc(o.es)}" placeholder="Seçenek adı (ej. Color)" aria-label="Seçenek adı İspanyolca">
        <input class="in" data-k="oen" data-oi="${oi}" value="${esc(o.en)}" placeholder="İngilizce (e.g. Colour)" aria-label="Seçenek adı İngilizce">
        <button type="button" class="btn ghost sm" data-act="odel" data-oi="${oi}">Seçeneği sil</button>
      </div>
      <div class="vlist">${o.values.map((v, vi) => valueRow(o, oi, v, vi)).join('')}</div>
      <div class="vadd"><input class="in" data-k="vnew" data-oi="${oi}" placeholder="Yeni değer ekle — birden fazlası için virgül: D1S, D2S, D3S">
        <button type="button" class="btn sm" data-act="vadd" data-oi="${oi}">Ekle</button></div>
    </div>`).join('')}
    ${P.options.length < 3 ? `<div class="presets"><span class="muted small">Seçenek ekle:</span>
      ${OPTION_PRESETS.map(([es, en], i) => `<button type="button" class="chip" data-act="oadd" data-i="${i}">${esc(es)}</button>`).join('')}
      <button type="button" class="chip" data-act="oadd" data-i="-1">+ Başka</button></div>` : ''}`;

  const combosHtml = () => {
    const rows = allCombos();
    if (!rows.length) return '';
    const off = rows.filter(r => P.combos[keyOf(r)]?.off).length;
    const q = comboFilter.toLowerCase();
    const shown = q ? rows.filter(r => r.map(v => v.es).join(' ').toLowerCase().includes(q)) : rows;
    return `<details class="box" ${openMedia?.startsWith('c:') || comboFilter ? 'open' : ''}>
      <summary><b>Kombinasyonlar</b> <span class="muted">(${rows.length}${off ? ` · ${off} kapalı` : ''})</span></summary>
      <p class="muted small">Satmadığın birleşimi kapat (ör. D2R + 8000K). Fiyat alanı boşsa otomatik hesaplanır (ana fiyat + farklar). İstersen bir birleşime özel fiyat ya da fotoğraf ver.</p>
      ${rows.length > 12 ? `<input class="in" data-k="cfilter" value="${esc(comboFilter)}" placeholder="Ara: ör. D2R" style="margin-bottom:10px">` : ''}
      <div class="ctable">${shown.slice(0, 300).map(r => {
        const k = keyOf(r), c = P.combos[k] || {}, ctx = `c:${k}`;
        return `<div class="crow${c.off ? ' off' : ''}">
          <span class="clabel">${r.map(v => esc(v.es)).join(' · ')}</span>
          <label class="delta"><span>€</span><input class="in" data-k="cprice" data-key="${esc(k)}" inputmode="decimal" value="${Number.isInteger(c.price) ? euro(c.price) : ''}" placeholder="${euro(basePrice(r))}"></label>
          <button type="button" class="btn ghost sm${openMedia === ctx ? ' on' : ''}" data-act="vmedia" data-ctx="${ctx}">📷 ${(c.media || []).length || ''}</button>
          <button type="button" class="btn sm ${c.off ? 'ghost' : ''}" data-act="ctoggle" data-key="${esc(k)}">${c.off ? 'Kapalı' : 'Satışta'}</button>
          ${openMedia === ctx ? `<div class="vmedia">${tiles(ctx, true)}</div>` : ''}
        </div>`;
      }).join('')}</div></details>`;
  };

  const draw = () => {
    const y = window.scrollY;
    root.innerHTML = `<div class="peditor">
      <div class="section-head"><h2>${isNew ? 'Yeni ürün' : esc(P.name_es || 'Ürün')}</h2><button type="button" class="btn ghost sm" data-act="back">← Ürünler</button></div>

      <div class="box">
        <div class="grid2">
          <label class="f"><span>Ürün adı — İspanyolca</span><input class="in" data-f="name_es" value="${esc(P.name_es)}" placeholder="ej. Bombilla Xenón Pro"></label>
          <label class="f"><span>Ürün adı — İngilizce</span><input class="in" data-f="name_en" value="${esc(P.name_en)}" placeholder="e.g. Xenon Bulb Pro"></label>
        </div>
        <div class="grid2">
          <label class="f"><span>Kategori</span><select class="in" data-f="category">${CATS.map(c => `<option value="${esc(c.slug)}"${c.slug === P.category ? ' selected' : ''}>${esc(c.name_es)}</option>`).join('')}</select></label>
          <div class="f"><span class="lbl">Durum</span><div class="seg">${Object.entries(STATUS_P).map(([k, l]) => `<button type="button" data-act="status" data-v="${k}" class="${P.status === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        </div>
        <div class="f"><span class="lbl">Tip</span><div class="seg">
          <button type="button" data-act="fit" data-v="universal" class="${P.fitment !== 'car' ? 'on' : ''}">Universal</button>
          <button type="button" data-act="fit" data-v="car" class="${P.fitment === 'car' ? 'on' : ''}">Arabaya özel (müşteri arabasını seçer)</button></div></div>
        <p class="muted small" style="margin:0">Yakında = sitede görünür, "Próximamente" yazar, satın alınamaz. Gizli = sitede görünmez.</p>
      </div>

      <div class="box"><h3>Fiyat ve stok</h3>
        <div class="grid3">
          <label class="f"><span>Fiyat (€)</span><input class="in" data-f="price_cents" data-money inputmode="decimal" value="${euro(P.price_cents)}"></label>
          <label class="f"><span>Stok</span><input class="in" data-f="stock" type="number" min="0" value="${P.stock}"></label>
          <label class="f"><span>Sıra</span><input class="in" data-f="sort" type="number" value="${P.sort}"></label>
        </div>
        <label class="f" style="margin:0"><span>İndirimden önceki fiyat (€) — sadece son 30 günde gerçekten uyguladığın en düşük fiyat. Emin değilsen boş bırak.</span>
          <input class="in" data-f="old_price_cents" data-money inputmode="decimal" value="${P.old_price_cents ? euro(P.old_price_cents) : ''}" placeholder="boş"></label>
      </div>

      <div class="box"><h3>Fotoğraf ve videolar</h3>
        <p class="muted small" style="margin-top:0">İlk sıradaki ana fotoğraftır. Telefonla çektiğin fotoğraflar otomatik küçültülür. Video: MP4.</p>
        ${tiles('p', false)}
      </div>

      <div class="box"><h3>Seçenekler (varyantlar)</h3>
        <p class="muted small" style="margin-top:0">Ör. "Casquillo": D1S, D2S… — her değere fiyat farkı, kendi fotoğraf/videosu ve "Yakında" işareti verebilirsin. Seçeneği olmayan ürün için boş bırak.</p>
        ${optionsHtml()}
      </div>

      ${combosHtml()}

      <div class="box"><h3>Açıklama</h3>
        <label class="f"><span>İspanyolca</span><textarea class="in" data-f="desc_es" rows="7">${esc(P.desc_es)}</textarea></label>
        <label class="f" style="margin:0"><span>İngilizce</span><textarea class="in" data-f="desc_en" rows="7">${esc(P.desc_en)}</textarea></label>
      </div>

      <details class="box"><summary><b>Ürün güvenliği bilgisi</b> <span class="muted">(AB kuralı — ürün sayfasında görünür)</span></summary>
        <div class="grid2" style="margin-top:12px">
          <label class="f"><span>Üretici — ad, adres, e-posta/web (kutunun etiketinde)</span><textarea class="in" data-f="manufacturer" rows="3">${esc(P.manufacturer)}</textarea></label>
          <label class="f"><span>AB'deki sorumlu kişi — üretici AB dışındaysa (ithalatçı / toptancı)</span><textarea class="in" data-f="eu_responsible" rows="3">${esc(P.eu_responsible)}</textarea></label>
        </div>
        <label class="f"><span>Güvenlik uyarıları — İspanyolca</span><textarea class="in" data-f="safety_es" rows="3">${esc(P.safety_es)}</textarea></label>
        <label class="f" style="margin:0"><span>Güvenlik uyarıları — İngilizce</span><textarea class="in" data-f="safety_en" rows="3">${esc(P.safety_en)}</textarea></label>
      </details>

      <div class="savebar">
        ${!isNew ? `<button type="button" class="btn danger sm" data-act="delete">Sil</button><a class="btn ghost sm" href="/p/${esc(P.slug)}" target="_blank">Sitede gör</a>` : ''}
        <span id="pErr" class="small" style="color:var(--bad)"></span>
        <button type="button" class="btn" data-act="save">Kaydet</button>
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
    if (a === 'back') { if (!dirty || confirm('Kaydedilmemiş değişiklikler var. Çıkılsın mı?')) { cleanup(); show(); } return; }
    dirty = true;
    if (a === 'status') P.status = b.dataset.v;
    if (a === 'fit') P.fitment = b.dataset.v;
    if (a === 'oadd') {
      const pr = OPTION_PRESETS[+b.dataset.i] || ['', ''];
      P.options.push({ id: newId(), es: pr[0], en: pr[1], values: [] });
    }
    if (a === 'odel' && confirm('Bu seçenek ve tüm değerleri silinsin mi?')) { P.options.splice(oi, 1); P.combos = {}; }
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
      if (!confirm('Ürün kalıcı olarak silinsin mi? (Sadece saklamak için Durum → Gizli yap.)')) return;
      await api('/api/admin/products/' + P.id, { method: 'DELETE' }); cleanup(); toast('Silindi'); show(); return;
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
      dirty = false; cleanup(); toast('Kaydedildi'); show();
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
async function viewStats() {
  const s = await api('/api/admin/stats');
  root.innerHTML = `
    <div class="stats">
      <div><b>${s.pending}</b><span>Ödeme bekleyen</span></div>
      <div><b>${s.to_ship}</b><span>Gönderilecek</span></div>
      <div><b>${s.orders_30d}</b><span>Sipariş (30 gün)</span></div>
      <div><b>${eur(s.revenue_30d)}</b><span>Ödenen ciro (30 gün)</span></div>
      <div><b>${s.customers}</b><span>Kayıtlı müşteri</span></div>
    </div>
    <div class="box"><h3>Ürün görüntülenmeleri</h3>
      <table><tr><th>Ürün</th><th>7 gün</th><th>30 gün</th></tr>
      ${s.views.map(v => `<tr><td>${esc(v.name)}</td><td>${v.d7 || 0}</td><td>${v.d30 || 0}</td></tr>`).join('')}</table>
    </div>`;
}

/* ---------- Ayarlar ---------- */
async function viewSettings() {
  const [s, me] = await Promise.all([api('/api/admin/settings'), api('/api/admin/me')]);
  const f = (k, label, extra = '') => `<label class="f"><span>${label}</span><input class="in" name="${k}" value="${esc(s[k])}" ${extra}></label>`;
  const m = (k, label) => `<label class="f"><span>${label}</span><input class="in" name="${k}" data-money inputmode="decimal" value="${toEuro(Number(s[k]))}"></label>`;
  root.innerHTML = `<form id="sf" style="max-width:820px">
    <h2>Ayarlar</h2>
    <div class="box"><h3>İletişim</h3><div class="grid2">
      ${f('shop_email', 'E-posta')}${f('whatsapp', 'WhatsApp (ülke kodu ile, sadece rakam: 34600111222)')}</div></div>
    <div class="box"><h3>Kargo</h3>
      <p class="muted small" style="margin-top:0">Kanarya, Ceuta ve Melilla otomatik kapalı (posta koduna göre) — oralara KDV ve gümrük farklı.</p>
      <div class="grid2">${m('ship_es_cents', 'İspanya yarımada (€)')}${m('free_es_cents', 'Yarımadada bu tutardan sonra ücretsiz (€) — 0 = hiç')}</div>
      <div class="grid2">${m('ship_ib_cents', 'Balear Adaları (€)')}${m('ship_pt_cents', 'Portekiz (€)')}</div>
      <div class="grid2">${m('free_far_cents', 'Balear/Portekiz bu tutardan sonra ücretsiz (€) — 0 = hiç')}
        <label class="chk" style="margin-top:26px"><input type="checkbox" id="ptOn" ${s.ship_pt_on !== '0' ? 'checked' : ''}> Portekiz'e gönder</label></div></div>
    <div class="box"><h3>E-posta</h3>
      <p class="notice" style="margin:0 0 12px">${me.mail ? '<b style="color:var(--ok)">Açık</b> — sipariş onayı, ödeme/kargo/iptal bildirimleri, cayma onayı ve şifre sıfırlama e-postaları gidiyor. Yeni siparişler yukarıdaki e-posta adresine bildirilir.'
        : '<b style="color:var(--bad)">Kapalı</b> — müşterilere sipariş onayı gitmiyor (AB\'de zorunlu). Açmak için README → "E-posta" bölümüne bak.'}</p>
      ${me.mail ? '<button type="button" class="btn ghost sm" id="testMail">Test e-postası gönder</button>' : ''}</div>
    <div class="box"><h3>Ödeme yöntemleri</h3>
      <p class="notice" style="margin-bottom:14px">Kart ile ödeme: ${me.stripe ? '<b style="color:var(--ok)">Açık (Stripe bağlı)</b>' : 'Kapalı — açmak için sunucuyu <code>STRIPE_SECRET_KEY</code> ile başlat (README).'}<br>
      Bizum ve havale: aşağıyı doldurursan ödeme sayfasında görünür. Hiçbiri yoksa müşteri "ödemeyi sonra konuşalım" seçeneğiyle sipariş verir.</p>
      ${f('bizum_phone', 'Bizum telefon numarası')}
      <div class="grid2">${f('iban', 'IBAN')}${f('iban_holder', 'Hesap sahibi')}</div></div>
    <div class="box"><h3>Şirket bilgileri (yasal sayfalarda görünür)</h3>
      <div class="grid2">${f('company_name', 'Ad / şirket adı')}${f('company_nif', 'NIF / NIE')}</div>
      ${f('company_address', 'Adres')}</div>
    <button class="btn">Kaydet</button>
  </form>`;
  $('#sf').addEventListener('submit', async e => {
    e.preventDefault();
    const body = {};
    $$('input', e.target).forEach(i => {
      if (!i.name) return;
      body[i.name] = i.dataset.money !== undefined ? String(Math.round((parseFloat(i.value.replace(',', '.')) || 0) * 100)) : i.value;
    });
    body.ship_pt_on = $('#ptOn').checked ? '1' : '0';
    try { await send('/api/admin/settings', body); toast('Kaydedildi'); }
    catch (err) { toast(err.message); }
  });
  $('#testMail')?.addEventListener('click', async () => {
    try { await send('/api/admin/test-mail', {}, 'POST'); toast('Gönderildi — gelen kutunu kontrol et'); }
    catch (err) { toast(err.message); }
  });
}

start();
})();

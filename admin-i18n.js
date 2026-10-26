// admin-i18n.js — the admin panel's server messages in Turkish or Spanish.
// The panel sends "X-Admin-Lang: tr | es"; adminLang() wraps res.json on /api/admin so the
// messages written in the code (Turkish, a few English) go out in that language. Only text
// fields are touched: error, errors[].msg, warnings[], duplicates[].reason, ignored[].reason.
// A message not listed here goes out unchanged (never an empty or wrong one).
// Each entry: [message or RegExp, Turkish, Spanish]; $1… are the RegExp's groups.
const MESSAGES = [
  // login and session
  ['Not authorised', 'Oturum kapandı, tekrar giriş yap', 'La sesión ha caducado, vuelve a entrar'],
  ['Wrong password', 'Şifre yanlış', 'Contraseña incorrecta'],
  ['Admin login disabled: set ADMIN_PASSWORD on the server', 'Panel girişi kapalı: sunucuda ADMIN_PASSWORD ayarla',
    'Acceso al panel desactivado: configura ADMIN_PASSWORD en el servidor'],
  ['Too many requests, try again later', 'Çok fazla deneme, biraz sonra tekrar dene', 'Demasiados intentos, inténtalo más tarde'],
  ['Not found', 'Bulunamadı', 'No encontrado'],
  // e-mail
  ['E-posta ayarlı değil (SMTP_* ortam değişkenleri)', null, 'El email no está configurado (variables de entorno SMTP_*)'],
  ['Gönderilemedi — sunucu kaydına bak', null, 'No se pudo enviar — revisa el registro del servidor'],
  ['Bu siparişle ilgili bir e-posta şu an gönderiliyor. Birkaç saniye sonra tekrar dene.', null,
    'Se está enviando un email de este pedido. Inténtalo de nuevo en unos segundos.'],
  // uploads, categories, products
  ['Sadece JPG, PNG, WEBP fotoğraf veya MP4, WEBM video', null, 'Solo fotos JPG, PNG, WEBP o vídeos MP4, WEBM'],
  ['İki dilde isim zorunlu', null, 'El nombre es obligatorio en los dos idiomas'],
  ['Kategori seç', null, 'Elige una categoría'],
  [/^Bu kategoride (\d+) ürün var\. Önce ürünleri başka kategoriye taşı\.$/, null,
    'Esta categoría tiene $1 productos. Muévelos primero a otra categoría.'],
  // orders
  ['Geçersiz ödeme kontrolü', null, 'Comprobación de pago no válida'],
  ['Bu siparişte ödeme kontrolü yok', null, 'Este pedido no tiene comprobación de pago'],
  ['Önceki cevabı değiştirmek için onay gerekli', null, 'Hace falta confirmar para cambiar la respuesta anterior'],
  ['Bu ödeme kontrolden gelmiyor; buradan silinemez', null, 'Este pago no viene de la comprobación; no se puede quitar aquí'],
  ['Bu siparişte iade kaydı var; "ödenmemişti" yapılamaz', null, 'Este pedido tiene devoluciones registradas; no se puede marcar "no estaba pagado"'],
  ['İadeyi "İade ekle" ile kaydet', null, 'Registra la devolución con "Añadir devolución"'],
  ['Bu siparişin ödemesi kayıtlı; "Ödeme bekliyor" yapılamaz. Para geri verildiyse siparişi iptal edip iade ekle.', null,
    'Este pedido tiene el pago registrado; no puede volver a "Pendiente de pago". Si devolviste el dinero, cancélalo y añade la devolución.'],
  ['Stripe ödeme sayfası şu an kapatılıyor. Birkaç saniye sonra tekrar dene.', null,
    'Se está cerrando la página de pago de Stripe. Inténtalo de nuevo en unos segundos.'],
  [/^Stok yetersiz: (.+) \(stokta (\d+), gereken (\d+)\)$/, null, 'Stock insuficiente: $1 (hay $2, hacen falta $3)'],
  ['Kontrol başarısız', null, 'La comprobación ha fallado'],
  ['Onay gerekli', null, 'Hace falta confirmar'],
  ['Bu sipariş 5 günü geçmiş bir Bizum/havale siparişi değil', null, 'Este pedido no es un pedido de Bizum/transferencia de más de 5 días'],
  ['Sipariş artık ödeme bekliyor durumunda değil (ödendi ya da iptal edildi)', null,
    'El pedido ya no está pendiente de pago (se ha pagado o cancelado)'],
  ['Kart ödemeleri Stripe üzerinden kaydedilir', null, 'Los pagos con tarjeta se registran a través de Stripe'],
  ['Bu eski sipariş için "ödenmiş miydi?" sorusunu cevapla', null, 'Responde primero "¿estaba pagado?" para este pedido antiguo'],
  ['Geçersiz ödeme tarihi (ör. 2026-10-23)', null, 'Fecha de pago no válida (ej. 2026-10-23)'],
  ['Ödeme tarihi gelecekte olamaz', null, 'La fecha de pago no puede estar en el futuro'],
  ['Ödeme tarihi sipariş tarihinden önce olamaz', null, 'La fecha de pago no puede ser anterior al pedido'],
  ['Bu sipariş iptal değil ya da ödemesi zaten kayıtlı', null, 'Este pedido no está cancelado o ya tiene el pago registrado'],
  ['İade tutarı 0’dan büyük olmalı (ör. 12,50)', null, 'La devolución debe ser mayor que 0 (ej. 12,50)'],
  ['Ödenmemiş siparişte iade olamaz', null, 'No se puede devolver un pedido no pagado'],
  [/^İade, kalan tutarı aşamaz \(en fazla (.+) €\)$/, null, 'La devolución no puede superar lo que queda (máximo $1 €)'],
  ['En az 8 karakter', null, 'Mínimo 8 caracteres'],
  // finance
  ['Tür "income" ya da "expense" olmalı', null, 'El tipo debe ser "income" o "expense"'],
  ['Geçerli bir tarih gir (YYYY-AA-GG)', null, 'Escribe una fecha válida (AAAA-MM-DD)'],
  ['Tutar 0,01 € ile 1.000.000 € arasında olmalı', null, 'El importe debe estar entre 0,01 € y 1.000.000 €'],
  ['Ülke 2 harf olmalı (ör. ES, PT, FR)', null, 'El país deben ser 2 letras (ej. ES, PT, FR)'],
  ['CSV bozuk: kapanmamış tırnak (")', null, 'CSV dañado: comilla (") sin cerrar'],
  ['Dosya boş', null, 'El archivo está vacío'],
  ['CSV dosyası boş', null, 'El archivo CSV está vacío'],
  ['İçe aktarma başarısız; hiçbir satır kaydedilmedi', null, 'La importación ha fallado; no se ha guardado ninguna fila'],
  [/^"(.*)" sütunu tanınmadı, yok sayıldı$/, null, 'Columna "$1" no reconocida, se ignora'],
  [/^Eksik sütun: (.+) \(gerekli: type, date, amount, category\)$/, null, 'Faltan columnas: $1 (necesarias: type, date, amount, category)'],
  [/^En fazla (\d+) satır; dosyayı böl$/, null, 'Máximo $1 filas; divide el archivo'],
  ['Web sitesi satırı: web satışları siparişlerden otomatik gelir', null, 'Fila de la web: las ventas web vienen solas de los pedidos'],
  ['Formül gibi başlayan metin (=, +, -, @) kabul edilmez; metinse başına \' koy', null,
    'No se acepta texto que empiece como una fórmula (=, +, -, @); si es texto, pon \' delante'],
  [/^Tür anlaşılmadı: "(.*)" \(gelir \/ gider\)$/, null, 'Tipo no reconocido: "$1" (ingreso / gasto)'],
  [/^Tarih anlaşılmadı: "(.*)" \(YYYY-AA-GG veya GG\/AA\/YYYY\)$/, null, 'Fecha no reconocida: "$1" (AAAA-MM-DD o DD/MM/AAAA)'],
  [/^Tutar anlaşılmadı: "(.*)" \(ör\. 12,50\)$/, null, 'Importe no reconocido: "$1" (ej. 12,50)'],
  [/^Kategori anlaşılmadı: "(.*)"$/, null, 'Categoría no reconocida: "$1"'],
  [/^Bu referansla \((.*)\) aynı tarih ve tutarda kayıt zaten var$/, null, 'Ya hay un registro con esta referencia ($1), la misma fecha e importe'],
  ['Tüm alanları aynı olan kayıt zaten var', null, 'Ya hay un registro con todos los campos iguales'],
  [/^Satır (\d+): aynı gün, tutar ve kategoride kayıtlı bir işlem var \(referans\/not farklı\) — aynı işlemse bu satırı sil\.$/, null,
    'Fila $1: ya hay un movimiento el mismo día, importe y categoría (referencia/nota distinta) — si es el mismo, borra esta fila.'],
  [/^Satır (.+) birebir aynı — gerçekten ayrı işlemler mi\? Değilse fazlasını sil\.$/, null,
    'Las filas $1 son idénticas — ¿de verdad son movimientos distintos? Si no, borra las sobrantes.'],
  [/^Satır (.+): kelime içinde "\?" var — Türkçe harfler kaybolmuş olabilir\. Dosya UTF-8 değil\. Excel'de "Farklı Kaydet → CSV UTF-8 \(virgülle ayrılmış\)" seçip tekrar yükle\.$/, null,
    'Filas $1: hay "?" dentro de palabras — puede que se hayan perdido letras con acento. El archivo no es UTF-8. En Excel elige "Guardar como → CSV UTF-8 (delimitado por comas)" y súbelo de nuevo.'],
];

function translate(msg, lang) {
  if (typeof msg !== 'string' || (lang !== 'es' && lang !== 'tr')) return msg;
  for (const [from, tr, es] of MESSAGES) {
    const to = lang === 'es' ? es : tr;
    if (!to) continue;                       // Turkish source text: already right in Turkish
    if (typeof from === 'string' ? msg === from : from.test(msg)) return typeof from === 'string' ? to : msg.replace(from, to);
  }
  return msg;
}

// Express middleware for /api/admin: translate the text fields of every JSON answer
function adminLang(req, res, next) {
  const lang = String(req.get('x-admin-lang') || '').toLowerCase();
  if (lang !== 'es' && lang !== 'tr') return next();
  const json = res.json.bind(res);
  res.json = body => {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      body = { ...body };
      if (typeof body.error === 'string') body.error = translate(body.error, lang);
      if (Array.isArray(body.errors)) body.errors = body.errors.map(e => e && typeof e.msg === 'string' ? { ...e, msg: translate(e.msg, lang) } : e);
      if (Array.isArray(body.warnings)) body.warnings = body.warnings.map(w => translate(w, lang));
      for (const k of ['duplicates', 'ignored']) {
        if (Array.isArray(body[k])) body[k] = body[k].map(e => e && typeof e.reason === 'string' ? { ...e, reason: translate(e.reason, lang) } : e);
      }
    }
    return json(body);
  };
  next();
}

module.exports = { translate, adminLang, MESSAGES };

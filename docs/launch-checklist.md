# Lansman kontrol listesi / Lista de comprobación antes de abrir la tienda

Durum: **site henüz lansmana hazır değil.** Bu liste neyin gerçekten kontrol edildiğini, neyin senin bilgine, kimlik bilgine ya da kararına bağlı olduğunu ve neyin burada doğrulanamadığını ayırır. Hiçbir madde tahmin edilerek "tamam" yazılmadı. Son kontrol: 12 Kasım 2026, dal `feat/evo-price-list`.

## 1. Kodda ve testte doğrulananlar
| Konu | Sonuç | Nasıl kontrol edildi |
|---|---|---|
| Üretimde varsayılan panel şifresi | Giriş kapalı (503 "Admin login disabled") | Sunucu `NODE_ENV=production` ile, `ADMIN_PASSWORD` olmadan başlatıldı |
| Üretimde `PUBLIC_URL` yoksa | Sunucu başlamıyor (çıkış kodu 1) | Aynı yöntem |
| Düz http isteği (üretimde) | 301 → https adresi | Aynı yöntem |
| Güvenlik başlıkları | CSP (`default-src 'self'`, dış kaynak yok), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`; `X-Powered-By` yok | Yanıt başlıkları okundu |
| Bağımlılık açıkları | `npm audit --omit=dev`: **0 açık** (12 Kasım 2026) | Komut çalıştırıldı |
| Arama motorları | `sitemap.xml` ürün sayfalarını içeriyor; `robots.txt` `/admin`, `/api`, sepet, ödeme sayfalarını engelliyor; sepet/hesap sayfaları `noindex` | Çalışan sunucudan okundu |
| EVO ödeme güvenliği | EVO bir **talep**, sipariş değil: sepet/sipariş yolu sunucuda reddediliyor, Stripe'a hiçbir şey gitmiyor, stok ayrılmıyor | `test/purchase-guards.test.js`, `test/evo-requests.test.js` |
| EVO ölçüm kuralı | Şablonu olmayan araç sadece posta kodu `28…` ise (Madrid) kabul ediliyor; dışarısı sunucuda reddediliyor | `test/evo-requests.test.js` + tarayıcı |
| Eski veriyi koruma | Güncelleme hiçbir ürünü, fiyatı, fotoğrafı değiştirmiyor | `test/evo-requests.test.js` (eski veritabanı taklidi) |

## 2. Senin bilgin, kimlik bilgin veya kararın gerekenler
**İş / yasal bilgi (uydurulmadı, boş bırakıldı):**
1. **Titular** (yasal ad soyad), **NIF/NIE**, gerçek **adres**: panel → Ayarlar. Şu an NIF ve Titular boş, adres `Madrid, España`.
2. **Ödeme alma yolu**: Stripe anahtarları ve webhook sırrı, Bizum numarası, IBAN + hesap sahibi + BIC. Şu an hepsi boş/kapalı. PayPal ve Revolut Pay önce Stripe Dashboard'da açılmalı.
3. **E-posta (SMTP)**: şu an kapalı. EVO talep onayı ve sipariş e-postaları buna bağlı. Katalogdaki adres `info@vornetic.es`, sitedeki `info@vornetic.com`: hangisi doğru?
4. **Ürün güvenliği bilgisi**: ürün düzenleyicide "Üretici" ve "AB'deki sorumlu kişi" alanları boş.
5. **Yasal metinler**: kargo ("EVO 3–5 iş günü"), iade/cayma ("EVO'da sadece kusur"), şartlar, gizlilik, çerez metni bir avukat/gestoría tarafından okunmalı. EVO artık talep + olası ölçüm olduğu için "3–5 iş günü" ifadesi hâlâ doğru mu?
6. **Gizlilik**: EVO talebinde toplanan verilerin (araç, iletişim, belediye, mesaj) **saklama süresi** ve **hukuki dayanağı** metne yazılmadı (bilmediğim için); sadece neyin toplandığı ve ne için kullanıldığı yazıldı.
7. **EVO fotoğrafları**: ürün sayfasında hâlâ çizim var; PDF'teki görseller alınmadı.

**EVO iş kararları (panel → EVO):**
8. **Zeekr**: İspanya'da satılan model listesini onayla; sonra her model için "Onaylı şablon" ekle ve "beklemede" satırını sil. O zamana kadar her Zeekr talebi elle incelemeye düşer.
9. **Şablon ayrıntıları** (benim çıkarımım, panelden düzeltilebilir): BMW E90 → *sedan*; Kia Sportage → *SUV (5 koltuk)*; Ford Transit/Tourneo Custom Kombi 310 L2 → büyüklük *orta van*, uzunluk L2, konfigürasyon *Kombi*; Fiat Ducato 35 L3H3 → *büyük van*, L3, H3, konfigürasyon *boş yük zemini*. Koltuk sayıları şablona bağlı değil; talepte yazılır ve sen onaylarsın.
10. **"Madrid bölgesi"**: şimdilik posta kodu `28` (Comunidad de Madrid). Sadece şehir mi demek istedin? Panel → Ayarlar → "EVO: zona de medición" içinden değişir.
11. **Onaylanan talep nasıl ödenecek?** Şu an otomatik yol yok (talep → sen onaylarsın → müşteriye elle ödeme bilgisi). Stripe linki/Bizum/havale akışı istersen ayrı bir iş.
12. **Fiyatlar**: PDF'ten alındı; üçüncü sıra fiyatları (+15/+20 €) ve "yük zemini sadece teklif" benim yorumum.

**Yayına alma (sunucu):**
13. Güçlü `ADMIN_PASSWORD`, `.env`, `PUBLIC_URL`, Nginx + HTTPS sertifikası. Nginx şablonunda **HSTS yok**: HTTPS'in sorunsuz çalıştığını görünce eklemeye karar ver.
14. **Sunucu dışı şifreli yedek** (`scripts/backup-offsite.sh`, `age` + `rclone`) ve bir **geri yükleme denemesi**.
15. Canlı mağazadaki EVO ürünü eski seçeneklerle duruyor: yeni kod kurulunca önce yedek al, sonra EVO ürününü yeni tanıma geçir (diğer ürünlere dokunmaz). Bu yapılmadan EVO talepleri "seçenek geçersiz" hatası verir.

## 3. Burada doğrulanamayanlar
- Gerçek Stripe/PayPal/Revolut ödemeleri, gerçek e-posta teslimi (testlerde sahte SMTP/Stripe kullanıldı).
- Gerçek telefon fotoğrafları; WEBP yönelimi Chrome dışı tarayıcılarda.
- Canlı sunucu, Nginx ve sertifika; gerçek mobil cihazda dokunma.
- Erişilebilirlik denetimi (ekran okuyucu ile) ve sayfa hızı ölçümü.

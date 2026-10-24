# Vornetic — Online Mağaza

Xenon, LED, 3 universal paspas ve arabaya özel EVO paspas satan, kendi sunucunda çalışan sade mağaza.
Müşteri tarafı **İngilizce + İspanyolca** (tarayıcı diline göre otomatik açılır, üstten EN/ES ile değişir). Satıcı paneli Türkçe.

## Çalıştırma

**En kolayı:** klasördeki `baslat.bat` dosyasına çift tıkla. Site tarayıcıda kendiliğinden açılır (pencereyi kapatınca site durur).

Ya da terminalde:

```bash
npm install
npm start
```

- Mağaza: http://localhost:3300
- Panel: http://localhost:3300/admin (varsayılan şifre: `vornetic2026` — **canlıya almadan değiştir**)

Node.js **22.9+** gerekir (dahili SQLite ve `.env` desteği).

## Ayarlar dosyası (`.env`)

Gizli ayarlar (panel şifresi, e-posta, Stripe) `.env` dosyasında durur:

1. `.env.example` dosyasını kopyala, adını `.env` yap.
2. İçini doldur, siteyi kapatıp yeniden aç.

`.env` gizlidir; kimseyle paylaşma, internete yükleme.

## E-posta (yasal olarak gerekli — sipariş onayı)

Site şu e-postaları otomatik gönderir: sipariş onayı (müşteriye) · sana "yeni sipariş" · ödendi · kargoya verildi (+ takip no) · iptal · cayma onayı · şifre sıfırlama.

Ücretsiz ve kolay yol: **Brevo** (günde 300 e-posta ücretsiz):

1. https://www.brevo.com → ücretsiz hesap aç.
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain** → `vornetic.com`. Brevo'nun verdiği DNS kayıtlarını (TXT/CNAME) alan adının DNS ayarlarına ekle, "Verify" de. (Bunu yapmazsan e-postalar spam'e düşer.)
3. **Senders** → `info@vornetic.com` ekle.
4. **SMTP & API → SMTP** sekmesi → "Generate a new SMTP key".
5. `.env` dosyasına yaz:
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=(Brevo'nun SMTP sayfasındaki "Login")
   SMTP_PASS=(oluşturduğun SMTP anahtarı)
   MAIL_FROM=Vornetic <info@vornetic.com>
   ```
6. Siteyi yeniden başlat → **Panel → Ayarlar → E-posta → "Test e-postası gönder"**.

Alan adının kendi e-posta sağlayıcısı (ör. hosting firmasının SMTP'si) da aynı şekilde kullanılabilir.

## Kargo

Panel → Ayarlar → Kargo. Varsayılan:

| Bölge | Ücret | Ücretsiz |
|---|---|---|
| İspanya yarımada | 3,95 € | 40 € üstü |
| Balear Adaları | 7,95 € | 80 € üstü |
| Portekiz (kapatılabilir) | 7,95 € | 80 € üstü |

Kanarya, Ceuta ve Melilla posta koduna göre otomatik engellenir (oralarda KDV/gümrük farklı). Başka AB ülkesi yok — KDV (OSS) ve ambalaj/atık kayıtlarıyla uğraşmamak için.
İade kargosunu müşteri öder (kusurlu/yanlış ürün hariç) — bu, iade sayfasında yazıyor.

## Neler var

**Mağaza**
- Açık renkli, sade tasarım
- **Araca göre alışveriş**: marka → model → kasa (ör. BMW 3 Serisi E46 / E90 / F30 / G20) → yıl → motor (isteğe bağlı)
- **Ampul bulucu**: araba seçilince kısa far / uzun far / sis / xenon ampul tipleri görünür, tek tıkla doğru ürüne (doğru seçenek işaretli) gider. Liste **Panel → Ampuller**'den düzenlenir.
- **Müşteri hesabı**: kayıt/giriş, siparişler + takip no, adres, araba, şifre değiştirme, **e-postayla şifre sıfırlama**
- Xenon 4 kalite seviyesi (fiyat listesine göre), LED AKE F9A, 3 universal paspas, EVO
- **Yasal parçalar**: "Comprar ahora" butonu · sipariş onay e-postası · **"Desistir del contrato aquí" cayma formu** (footer'da ve her siparişte) · ürün güvenliği bilgisi (GPSR) her ürün sayfasında · kargo/iade/koşullar/gizlilik/yasal uyarı (iki dilde) · çerez yok
- **Google için**: her ürünün kendi başlığı/açıklaması, `sitemap.xml`, `robots.txt`, ürün bilgisi (fiyat, stok) Google formatında

**Panel (`/admin`)**
- **Ürünler**: düğmelerle ürün ekleme/düzenleme — isim (ES/EN), kategori, durum (**Satışta / Yakında / Gizli**), fiyat, stok, fotoğraf ve **video**. Seçenekler (ör. Casquillo: D1S, D2S…): her değere fiyat farkı, kendi fotoğraf/videosu ve "Yakında" işareti. Satılmayan kombinasyonu tek tıkla kapat (ör. D2R + 8000K). Listeden hızlı stok −/+.
- **Kategoriler**: yeni kategori aç (menüde otomatik çıkar), isim/açıklama/fotoğraf/sıra, gizle.
- **Siparişler**: durum değişince müşteriye otomatik e-posta (ödendi / kargoda + takip no / iptal)
- **Müşteriler**: iletişim, adres, araba, siparişler, harcama
- **Cayma**: müşterilerin cayma talepleri (yeni talep sayısı sekmede görünür)
- Ürün sayfasında ayrıca **üretici / AB sorumlusu / güvenlik uyarıları** (AB kuralı)
- **Ayarlar**: kargo, ödeme, şirket bilgileri, e-posta durumu + test

## İlk yapılacaklar

1. **Panel → Ayarlar**: NIF/NIE ve adres, Bizum (Bizum Negocios) ve/veya IBAN.
2. **E-posta**'yı kur (yukarıda).
3. **Panel → Ürünler → her ürün → "Ürün güvenliği bilgisi"**: kutunun etiketindeki üretici adı/adresi. Ürünleri İspanya'daki bir toptancıdan aldıysan "AB'deki sorumlu kişi"ye onun adını/adresini yaz.
4. `.env` içinde `ADMIN_PASSWORD`'u değiştir.
5. Kartla ödeme istersen: [Stripe](https://dashboard.stripe.com) → `STRIPE_SECRET_KEY` (önce `sk_test_...` ile dene, test kartı 4242 4242 4242 4242).

## Yayına alma

Site veritabanını diske yazdığı için **kalıcı diski olan** bir sunucu gerekir (Vercel gibi sunucusuz servisler uygun değil).

En kolay/ucuz: **Hetzner** veya **OVH** VPS (~4-5 €/ay, AB içinde):
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
# projeyi kopyala, .env dosyasını oluştur (PUBLIC_URL=https://vornetic.com ve NODE_ENV=production ekle), sonra:
npm ci            # package-lock.json'daki sürümlerin aynısını kurar
pm2 start npm --name vornetic -- start
pm2 save && pm2 startup
```
HTTPS için Nginx + Certbot (ücretsiz) — müşteri şifreleri olduğu için **HTTPS şart**. Alan adının DNS A kaydını sunucu IP'sine yönlendir.

**Nginx ayarı:** hazır dosya `docs/nginx-vornetic.conf` — dosyanın başındaki adımları sırayla uygula (önce ücretsiz Let's Encrypt sertifikası, sonra dosyayı kur). Ubuntu 20.04/22.04/24.04 ve Debian 11/12 paketlerindeki Nginx (1.18 veya yenisi) ile uyumludur; `nginx -v` ile kontrol et. Önemli kurallar:
- Port 80 (http) her zaman `https://` adresine **yönlendirilir**; uygulamaya http ile hiçbir şey gitmez.
- Bilinmeyen alan adları / IP ile gelen istekler kapatılır (`return 444`), sahte `Host` başlığı uygulamaya ulaşmaz.
- Nginx `X-Forwarded-Proto` ve `X-Forwarded-For` başlıklarını **üzerine yazar** (`$scheme`, `$remote_addr`).
- Nginx ve uygulama **aynı sunucuda** olmalı: canlıda uygulama sadece `127.0.0.1:3300` adresini dinler ve bu başlıklara sadece aynı makineden gelirse güvenir. Uygulama yine de http ile gelen bir istek alırsa sayfayı https'e yönlendirir, giriş/sipariş/panel gibi diğer istekleri işlemeden reddeder (403 "HTTPS required").
- Yükleme sınırı: panel fotoğraf/videoları **tek tek** yükler (fotoğraf en fazla 12 MB, video en fazla 80 MB), bu yüzden Nginx'te `client_max_body_size 81m` yeterli. Sınırı değiştirirsen `server.js` içindeki `MAX_VIDEO_MB` ile birlikte değiştir.
- `HOST` ile dinleme adresi değiştirilebilir (ör. `HOST=0.0.0.0`) ama gerek yok; değiştirirsen sunucunun güvenlik duvarında 3300 portunu dışarıya kapat.

**`PUBLIC_URL` canlıda zorunlu:** `NODE_ENV=production` iken `PUBLIC_URL` yoksa, `https://` ile başlamıyorsa, adresten sonra yol, `?` veya `#` içeriyorsa (ör. `/magaza`), alan adı ya da port geçersizse site **açılmaz** ve kayıtta nedenini yazar (girilen değeri yazmaz — içinde şifre olabilir). Şifre sıfırlama, sipariş e-postaları, Stripe dönüş sayfaları ve sitemap linkleri sadece bu adresten üretilir; böylece sahte bir `Host` başlığıyla müşteriye başka bir siteye giden link gönderilemez. Canlıda site ayrıca tarayıcılara `Strict-Transport-Security` başlığı gönderir (bir yıl boyunca sadece https).

Yayına aldıktan sonra:
- **Google Search Console** → siteyi ekle → `https://vornetic.com/sitemap.xml` gönder.
- **Google Merchant Center** → ücretsiz Google Alışveriş listelemesi.

## Yedek

**Sunucuda (otomatik):** veritabanının bir kopyası **her saat** `data/backups/` içine alınır: son 48 saatin hepsi ve 30 güne kadar her günden bir tane. Ama bunlar aynı diskte durur; disk ya da sunucu giderse bunlar da gider. Bu yüzden **sunucu dışına şifreli kopya şart.**

### Sunucu dışına şifreli yedek (ücretsiz: `age` + `rclone`)
`scripts/backup-offsite.sh` her çalıştığında:
1. En yeni saatlik kopyayı **kontrol eder** (`restore-check`).
2. Kopyayı ürün fotoğraflarıyla (`data/uploads/`) birlikte paketler.
3. Paketi **senin açık anahtarınla şifreler** (`age`). Sunucu kendi yedeğini açamaz; sunucuya biri girse bile eski yedekleri okuyamaz.
4. Şifreli dosyayı bulut depona kopyalar (`rclone`) ve oradaki eski dosyaları siler (varsayılan: 30 günden eski).

Şifresiz hiçbir şey göndermez. Sorun olursa hata verir. Panel de uyarı gösterir: 2 gün boyunca hiç başarılı yedek yoksa, ya da saatlik veritabanı yedekleri çalışsa bile 2 gündür fotoğraflarla birlikte tam yedek alınamadıysa.

**Kurulum (bir kez):**
1. **Kendi bilgisayarında** (sunucuda değil) bir anahtar oluştur: `age-keygen -o vornetic-yedek-anahtari.txt`
   - Ekranda çıkan `Public key: age1...` satırı açık anahtardır; sunucuya bu gider.
   - Dosyanın kendisi (`AGE-SECRET-KEY-...`) özel anahtardır. **Sunucuya koyma.** İki ayrı yerde sakla (ör. şifre yöneticisi ve bir USB). Bu anahtar kaybolursa yedekler açılamaz.
2. Sunucuda araçları kur (Ubuntu 22.04+ / Debian 12): `sudo apt install age rclone`
3. Bulut depoyu bağla: `rclone config`
   - Ör. Google Drive, OneDrive, Backblaze B2. Ücretsiz kotalar sağlayıcıya göre değişir; güncel koşullara bak.
   - Verdiğin isim, ör. `gdrive`, aşağıda kullanılır.
4. `cp scripts/backup.env.example scripts/backup.env`, sonra `AGE_RECIPIENT=age1...` (1. adımdaki açık anahtar) ve `RCLONE_REMOTE=gdrive:vornetic-yedek` değerlerini yaz.
   - **Veri klasörü:** betik onu sitenin bulduğu gibi bulur: önce ortam değişkeni, sonra sitenin `.env` dosyasındaki `DATA_DIR` (göreli ise site klasörüne göre), yoksa `data/`. Böylece cron'dan çalışınca da aynı klasörü yedekler. `DATA_DIR`'i sadece `.env` içine yaz, `backup.env` içine yazma. `.env` kabuk kodu olarak çalıştırılmaz; Node'un kendi `.env` okuyucusuyla okunur.
   - Cron `node`'u bulamazsa (ör. nvm ile kurulduysa), `backup.env` içine tam yolunu yaz: `NODE_BIN=/yol/node`.
5. Dene: `scripts/backup-offsite.sh` (en sonda "Off-site backup OK" yazmalı; dosya bulut deposunda görünmeli).
6. Zamanla (`crontab -e`). Her saat yalnız veritabanı, her gece fotoğraflarla birlikte tam yedek:
   ```
   20 * * * *  /yol/vornetic/scripts/backup-offsite.sh --db-only
   40 3 * * *  /yol/vornetic/scripts/backup-offsite.sh
   ```

### Geri yükleme (ayda bir dene)
1. Kendi bilgisayarında en yeni dosyayı indir: `rclone copy gdrive:vornetic-yedek/vornetic-full-...tar.gz.age .`
2. Aç: `age -d -i vornetic-yedek-anahtari.txt vornetic-full-...tar.gz.age | tar xz`
3. Kontrol et: `npm run restore-check -- store-....db` ("OK" ve ürün/sipariş sayıları görünmeli).
4. Sunucuda:
   1. Siteyi durdur: `pm2 stop vornetic`.
   2. Eski `data/store.db*` dosyalarını bir kenara taşı.
   3. Kopyayı `data/store.db` olarak koy; `uploads/` klasörünü `data/uploads/` yerine koy.
   4. Başlat: `pm2 start vornetic`.
   5. Sitede son siparişleri kontrol et.

## Ortam değişkenleri (`.env`)

| Değişken | Açıklama |
|---|---|
| `ADMIN_PASSWORD` | Panel şifresi |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | E-posta |
| `STRIPE_SECRET_KEY` | Kart ödemesi (boşsa kart kapalı) |
| `PUBLIC_URL` | Sitenin adresi, ör. `https://vornetic.com` (e-posta linkleri, Stripe, sitemap). **Canlıda zorunlu**, `https://` ile ve yolsuz |
| `NODE_ENV=production` | Canlıda ayarla (güvenli çerezler, HSTS, `PUBLIC_URL` kontrolü) |
| `PORT` | Varsayılan 3300 |
| `HOST` | Dinleme adresi. Canlıda varsayılan `127.0.0.1` (sadece Nginx üzerinden erişilir); genelde ayarlama |
| `DATA_DIR` | Veritabanı/fotoğraf klasörü (varsayılan `./data`) |

## Ampul listesi

Panel → **Ampuller**. Her satır bir araba:
```
BMW | 3 Series | E90/E91/E92/E93 | low=H7, high=H7, fog=H11, xenon=D1S
```
`low` kısa far (halojen) · `high` uzun far · `fog` sis · `xenon` fabrikadan xenonlu araçta kısa far. H4 için sadece `low=H4`.
İlk liste (72 araba) tahmine dayalı — kendi bildiklerinle kontrol et. Listede olmayan arabada müşteriye WhatsApp'tan sorması söylenir.

## Araba listesi

`data/cars.txt` — düz metin, kolay düzenlenir:
```
# BMW
3 Series | E90/E91/E92/E93 | 2005-2013 | 316i, 318i, 320i, 325i, 330i, 320d
```
Satır ekle/değiştir, sunucuyu yeniden başlat.

## Ürün kataloğu

İlk açılışta ürünler `seed.js` dosyasından yüklenir. Sonrasında her şeyi panelden yönet.

## Eski sürüm

İlk site `_old_version/` klasöründe duruyor. İhtiyacın yoksa silebilirsin.

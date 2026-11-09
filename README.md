# Dijital İkiz — 3B Rehber Haritası (İstanbul / Bursa)

Fiziki harita + yükseklik haritasından üretilen, çevrimdışı çalışan, dokunmatik uyumlu 3B rehber uygulaması.
Three.js ile yazıldı. Hiçbir sunucu veya derleme (build) adımı gerekmez; statik dosyalardır.

## Klasör yapısı

```
istanbul-dijital-ikiz/
├── index.html                ← giriş sayfası
├── manifest.webmanifest      ← PWA (ana ekrana ekle) tanımı
├── sw.js                     ← Service Worker: çevrimdışı önbellek  (güncellemede VERSION'ı artırın)
├── css/style.css             ← arayüz stilleri (lejant, kart, mobil düzen)
├── js/
│   ├── config.js             ← bölge, koordinat dönüşümü, katman listesi ve renkleri
│   ├── main.js               ← sahne, kamera, OrbitControls, etkileşim, PWA
│   ├── terrain.js            ← 3B zemin (displacement map + harita dokusu)
│   ├── layers.js             ← pinler, fay/sınır şeritleri, dokunarak seçme
│   └── ui.js                 ← lejant, arama, bilgi kartı, ipucu
├── data/
│   ├── data.js               ← OSM + Vikipedi verisi  (tools/fetch_osm.py üretir)
│   └── curated.js            ← SİZİN notlarınız, kendi pinleriniz, fay hatları
├── assets/
│   ├── harita_4096.jpg       ← masaüstü dokusu
│   ├── harita_2048.jpg       ← mobil dokusu
│   └── yukseklik.png         ← temizlenmiş, hizalanmış yükseklik haritası
├── icons/                    ← uygulama ikonları
├── vendor/                   ← Three.js r169 (yerel kopya, CDN gerekmez)
└── tools/
    ├── prepare_maps.py       ← kaynak görselleri web'e hazırlar ve hizalar
    ├── fetch_osm.py          ← Overpass API'den veri çeker → data/data.js
    └── hizalama_kontrol.png  ← hizalama kontrol görüntüsü (yayınlanması gerekmez)
```

## Koordinatlar (bounding box)

| Bölge | Kuzeybatı (K, D) | Güneydoğu (K, D) | Not |
|---|---|---|---|
| İstanbul (bu harita) | 41.602, 27.930 | 40.735, 29.975 | HGM haritası Transvers Merkator (merkez meridyen 29°). Köşeler 7 grid kesişiminden ölçüldü, hata ≈1 px. |
| Bursa | 40.66, 28.10 | 39.55, 29.98 | İl sınırını kapsayan yaklaşık kutu. Bursa haritanız gelince kullanılır. |

Heightmap dosyasının kapsamı (27.32–30.77 D, 40.52–41.71 K) kara/deniz maskeleri karşılaştırılarak
otomatik bulundu ve fiziki haritaya piksel piksel yeniden örneklendi.

## 1) Yerelde çalıştırma

ES modülleri `file://` ile açılmaz; küçük bir yerel sunucu gerekir:

```bash
cd istanbul-dijital-ikiz
python -m http.server 8000
```
Tarayıcıda: http://localhost:8000

## 2) Veriyi güncelleme (OpenStreetMap + Vikipedi)

```bash
python tools/fetch_osm.py                 # İstanbul (≈3–6 dk, Vikipedi özetleri dahil)
python tools/fetch_osm.py --vikipedi-yok  # yalnızca OSM, daha hızlı
python tools/fetch_osm.py --bolge bursa   # Bursa (il kodu TR-16)
```
Ek kurulum gerekmez (yalnızca Python standart kütüphanesi). Çıktı `data/data.js`'dir; her noktada
`lat/lon`, harita koordinatı `u/v` (0–1) ve Three.js düzlem koordinatı `x/y` bulunur. Script
`wikipedia`, `wikidata`, `description`, `inscription`, `start_date`, `architect` etiketlerini alır,
Türkçe Vikipedi özetini indirip dosyaya gömer — böylece internet olmadan da bilgi verilir.

**Kendi notlarınız:** `data/curated.js` dosyasını düzenleyin (örnekler içinde). `notes` bölümüne
`'Süleymaniye Camii': 'anlatım notum…'` yazarsanız o noktanın kartında "Rehber notu" olarak çıkar.

## 3) Başka bölge (Bursa) için

1. Bursa fiziki haritası ve heightmap'i bir CBS programından (QGIS) **aynı kapsamla**, EPSG:4326 olarak dışa aktarın.
2. `tools/prepare_maps.py` içinde `bursa` kaydındaki `bbox` ve `hm_extent` değerlerini dışa aktarım kapsamınıza göre düzeltin, sonra:
   `python tools/prepare_maps.py --bolge bursa --fiziki bursa_fiziki.jpg --yukseklik bursa_heightmap.png`
3. `js/config.js` → `ACTIVE_REGION = 'bursa'` ve `maxElevationM` değerini scriptin yazdığı sayıyla güncelleyin.
4. `python tools/fetch_osm.py --bolge bursa`
5. `sw.js` içinde `VERSION`'ı artırın. En temizi her şehir için klasörü kopyalayıp ayrı depo açmaktır.

## 4) GitHub Pages'e yükleme (tek link + çevrimdışı)

1. https://github.com adresinde ücretsiz hesap açın.
2. Sağ üst **+ → New repository**. Ad: `istanbul-3d` · **Public** · Create.
3. **uploading an existing file** bağlantısına tıklayın ve bu klasörün **içindekileri** (index.html dahil,
   klasörün kendisini değil) sürükleyip bırakın. `tools/` klasörünü yüklemeniz gerekmez. **Commit changes**.
4. Depoda **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch: `main` / `(root)` → **Save**.
5. 1–2 dakika sonra adres: `https://KULLANICIADINIZ.github.io/istanbul-3d/`
6. Bu linkten bir QR kod üretip (ör. telefonun kamera/paylaş menüsü veya herhangi bir QR üreticisi) tur broşürüne koyun.

**Misafirin yapacağı:** Linki internet varken **bir kez** açar → ekranda "Çevrimdışı kullanıma hazır ✓" görünür.
- Android/Chrome: menü → *Ana ekrana ekle* (veya paneldeki **Ana ekrana ekle** düğmesi).
- iPhone/Safari: Paylaş → *Ana Ekrana Ekle*.
Bundan sonra uçak modunda bile açılır. (Vikipedi görselleri ve "Yol tarifi" bağlantıları internet ister; metinler istemez.)

**Güncelleme:** Dosyaları değiştirip tekrar yükleyin ve `sw.js` içindeki `VERSION = 'v1'` değerini `v2` yapın.
Misafirler bir sonraki çevrimiçi açılışta yeni sürümü alır.

Alternatifler: Netlify Drop (https://app.netlify.com/drop — klasörü sürükle bırak) veya Cloudflare Pages; adımlar aynı mantıktadır.

## Telif notu

`istanbul_fiziki.jpg`, MSB Harita Genel Müdürlüğü'nün telifli ürünüdür; haritanın kenarında yazılı izin
olmadan çoğaltılamayacağı belirtilir. Herkese açık bir siteye (GitHub Pages public) ve ticari tur
kullanımında yayınlamadan önce HGM'den izin alın veya açık lisanslı bir altlık (ör. OpenTopoMap,
Copernicus DEM'den üretilmiş gölgelendirme) kullanın. OSM verisi ODbL, Vikipedi metinleri CC BY-SA'dır;
uygulamadaki atıf satırını kaldırmayın.

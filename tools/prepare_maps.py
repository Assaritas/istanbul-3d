# -*- coding: utf-8 -*-
"""
prepare_maps.py — Kaynak haritaları web'e hazırlar.

Yaptıkları:
  1. Fiziki haritayı (HGM) iç çerçevesinden kırpar, 4096 ve 2048 px genişlikte JPG üretir
     (mobil cihazlar 4096 px dokuyu taşıyamayabilir, 2048 onlar için).
  2. Yükseklik haritasındaki (heightmap) camgöbeği kıyı / yol çizgilerini temizler
     (aksi halde 3D zeminde duvar gibi çıkıntılar oluşur).
  3. Yükseklik haritasını, fiziki haritanın projeksiyonuna piksel piksel yeniden örnekler.
     Böylece iki görüntü Three.js'te birebir üst üste oturur.
  4. PWA ikonlarını üretir.

Kullanım (proje klasöründen):
    pip install pillow numpy
    python tools/prepare_maps.py --fiziki "C:/.../istanbul_fiziki.jpg" --yukseklik "C:/.../istanbul_heightmap2.png"

Coğrafi referans (georeference) değerleri aşağıdaki BOLGELER sözlüğündedir ve
js/config.js ile tools/fetch_osm.py içindeki değerlerle AYNI olmalıdır.
"""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# İstanbul HGM 1:140.000 fiziki haritası (7143 x 4138 px JPG) için ölçülmüş değerler.
#  - Harita Transvers Merkator; 28°, 28°30', 29°, 29°30' meridyenleri ile 41° ve
#    41°30' paralellerinin 7 kesişim noktasından en küçük kareler ile kalibre edildi
#    (artık hata ~1 px).
#  - Heightmap kapsamı, kara/deniz maskeleri karşılaştırılarak otomatik bulundu
#    (Web Merkator, %94 örtüşme).
# ---------------------------------------------------------------------------
BOLGELER = {
    "istanbul": {
        "proj": "tm",
        "cm": 29.0, "lat0": 41.0,
        "ax": [258709.761824907, -55.177506321615056, 3731.934191622961],
        "ay": [-83.7635797713604, -257724.2195880867, 2844.3501798741345],
        "frame": [114, 114, 7029, 4025],          # fiziki haritanın iç çerçevesi (px)
        "hm_extent": [27.319375, 30.765, 41.714375, 40.520625],  # B, D, K, G
        "hm_proj": "merc",
    },
    # Bursa için kendi haritanız geldiğinde: "proj": "bbox" ile basit enlem/boylam
    # kutusu kullanılır (harita bir CBS programından EPSG:4326 olarak dışa aktarıldıysa doğru sonuç verir).
    "bursa": {
        "proj": "bbox",
        "bbox": [28.10, 39.55, 29.98, 40.66],        # B, G, D, K
        "hm_extent": [28.10, 29.98, 40.66, 39.55],
        "hm_proj": "lin",
    },
}


def lonlat_to_px(b, lon, lat):
    """Coğrafi koordinat -> fiziki harita pikseli (tam çözünürlük)."""
    if b["proj"] == "tm":
        l = np.radians(np.asarray(lon) - b["cm"])
        p = np.radians(np.asarray(lat))
        x = np.arctanh(np.cos(p) * np.sin(l))
        y = np.arctan2(np.tan(p), np.cos(l)) - math.radians(b["lat0"])
        ax, ay = b["ax"], b["ay"]
        return ax[0] * x + ax[1] * y + ax[2], ay[0] * x + ay[1] * y + ay[2]
    raise ValueError


def px_to_lonlat(b, px, py):
    ax, ay = b["ax"], b["ay"]
    M = np.linalg.inv(np.array([[ax[0], ax[1]], [ay[0], ay[1]]]))
    dx, dy = px - ax[2], py - ay[2]
    X = M[0, 0] * dx + M[0, 1] * dy
    Y = M[1, 0] * dx + M[1, 1] * dy
    D = Y + math.radians(b["lat0"])
    lat = np.degrees(np.arcsin(np.sin(D) / np.cosh(X)))
    lon = b["cm"] + np.degrees(np.arctan2(np.sinh(X), np.cos(D)))
    return lon, lat


def merc(lat):
    return np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


def clean_lines(rgb):
    """Camgöbeği (cyan) vektör çizgilerini maskele ve komşu piksellerden doldur."""
    r, g, b = [rgb[..., i].astype(np.int16) for i in range(3)]
    mask = ((g - r) > 12) | ((b - r) > 12)
    h = rgb[..., 0].astype(np.float32)
    h[mask] = 0
    known = ~mask
    print(f"  temizlenecek çizgi pikseli: {mask.sum():,}")
    it = 0
    while (~known).any() and it < 60:
        it += 1
        acc = np.zeros_like(h)
        cnt = np.zeros_like(h)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                acc += np.roll(np.roll(h * known, dy, 0), dx, 1)
                cnt += np.roll(np.roll(known.astype(np.float32), dy, 0), dx, 1)
        fill = (~known) & (cnt > 0)
        h[fill] = acc[fill] / cnt[fill]
        known = known | fill
    return h


def bilinear(img, u, v):
    H, W = img.shape
    u = np.clip(u, 0, W - 1.001)
    v = np.clip(v, 0, H - 1.001)
    x0 = np.floor(u).astype(int); y0 = np.floor(v).astype(int)
    fx = u - x0; fy = v - y0
    a = img[y0, x0]; b_ = img[y0, x0 + 1]; c = img[y0 + 1, x0]; d = img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b_ * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bolge", default="istanbul", choices=BOLGELER.keys())
    ap.add_argument("--fiziki", required=True)
    ap.add_argument("--yukseklik", required=True)
    ap.add_argument("--hm-genislik", type=int, default=1024, help="çıktı yükseklik haritası genişliği")
    ap.add_argument("--beyaz-metre", type=float, default=1600,
                    help="kaynak heightmap'te saf beyazın karşılığı (m). İstanbul dosyasında en parlak nokta Kartepe ≈1600 m")
    a = ap.parse_args()
    b = BOLGELER[a.bolge]
    out = os.path.join(ROOT, "assets")
    os.makedirs(out, exist_ok=True)

    print("1) Fiziki harita kırpılıyor…")
    fz = Image.open(a.fiziki).convert("RGB")
    if b["proj"] == "tm":
        fz = fz.crop(tuple(b["frame"]))
    FW, FH = fz.size
    for w in (4096, 2048):
        h = round(FH * w / FW)
        fz.resize((w, h), Image.LANCZOS).save(os.path.join(out, f"harita_{w}.jpg"), quality=86, optimize=True, progressive=True)
        print(f"  assets/harita_{w}.jpg  {w}x{h}")

    print("2) Yükseklik haritası temizleniyor…")
    hm = np.asarray(Image.open(a.yukseklik).convert("RGB"))
    hclean = clean_lines(hm)
    HH, HW = hclean.shape

    print("3) Fiziki harita projeksiyonuna yeniden örnekleniyor…")
    ow = a.hm_genislik
    oh = round(FH * ow / FW)
    jj, ii = np.meshgrid(np.arange(ow), np.arange(oh))
    if b["proj"] == "tm":
        px = b["frame"][0] + (jj + 0.5) / ow * FW
        py = b["frame"][1] + (ii + 0.5) / oh * FH
        lon, lat = px_to_lonlat(b, px, py)
    else:
        w_, s_, e_, n_ = b["bbox"]
        lon = w_ + (jj + 0.5) / ow * (e_ - w_)
        lat = n_ - (ii + 0.5) / oh * (n_ - s_)
    W_, E_, N_, S_ = b["hm_extent"]
    u = (lon - W_) / (E_ - W_) * HW - 0.5
    if b["hm_proj"] == "merc":
        v = (merc(N_) - merc(lat)) / (merc(N_) - merc(S_)) * HH - 0.5
    else:
        v = (N_ - lat) / (N_ - S_) * HH - 0.5
    res = bilinear(hclean, u, v)
    # kenar ötesi -> 0
    res[(u < 0) | (u > HW - 1) | (v < 0) | (v > HH - 1)] = 0
    gmax = float(res.max())
    # 0–255 aralığına ger: hassasiyet kaybı olmaz, displacementScale doğrudan "en yüksek nokta" olur.
    stretched = np.clip(res * (255.0 / max(gmax, 1)), 0, 255)
    print(f"  kaynak gri aralığı: 0 – {gmax:.0f}  (beyaz=255 ≈ {a.beyaz_metre} m kabulüyle en yüksek ≈ {gmax / 255 * a.beyaz_metre:.0f} m)")
    print(f"  >>> js/config.js içindeki maxElevationM değerini bu sayıyla güncelleyin.")
    Image.fromarray(stretched.astype(np.uint8), "L").save(os.path.join(out, "yukseklik.png"), optimize=True)
    print(f"  assets/yukseklik.png  {ow}x{oh}")

    # Kontrol görüntüsü: yükseklik kenarları fiziki harita üzerine
    chk = fz.resize((ow, oh), Image.BILINEAR).convert("RGB")
    edge = np.abs(np.diff((res > 2).astype(np.int8), axis=0, prepend=0)) | np.abs(np.diff((res > 2).astype(np.int8), axis=1, prepend=0))
    arr = np.asarray(chk).copy()
    arr[edge > 0] = [255, 0, 0]
    Image.fromarray(arr).save(os.path.join(ROOT, "tools", "hizalama_kontrol.png"))
    print("  tools/hizalama_kontrol.png (kırmızı = heightmap kıyı çizgisi; fiziki kıyıyla örtüşmeli)")

    print("4) İkonlar üretiliyor…")
    icons = os.path.join(ROOT, "icons")
    os.makedirs(icons, exist_ok=True)
    cx, cy = FW * 0.56, FH * 0.55
    side = FH * 0.42
    crop = fz.crop((int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2)))
    for s in (192, 512):
        ic = crop.resize((s, s), Image.LANCZOS).convert("RGBA")
        m = Image.new("L", (s, s), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, s, s), radius=s // 5, fill=255)
        bg = Image.new("RGBA", (s, s), (15, 27, 42, 255))
        bg.paste(ic, (0, 0), m)
        bg.convert("RGB").save(os.path.join(icons, f"icon-{s}.png"))
    print("Bitti.")


if __name__ == "__main__":
    sys.exit(main())

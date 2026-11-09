# -*- coding: utf-8 -*-
"""
fetch_osm.py — OpenStreetMap (Overpass API) verisini çekip data/data.js olarak kaydeder.

Sadece Python standart kütüphanesi kullanılır (ek kurulum gerekmez).

Kullanım (proje klasöründen):
    python tools/fetch_osm.py                      # İstanbul, Vikipedi özetleriyle
    python tools/fetch_osm.py --bolge bursa        # Bursa (il sınırı: TR-16)
    python tools/fetch_osm.py --vikipedi-yok       # Vikipedi özetlerini indirme (daha hızlı)

Çıktı:  data/data.js  ->  window.MAP_DATA = { meta, points:[...], lines:[...] }
Her nokta için hem enlem/boylam hem de haritaya göre normalize edilmiş u,v (0–1) ve
Three.js düzlem koordinatı x,z verilir. Dönüşüm js/config.js ile birebir aynıdır.
"""
import argparse
import concurrent.futures as cf
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "DijitalIkizRehber/1.0 (offline tur rehberi haritasi; python-urllib)"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# ---------------------------------------------------------------------------
# Bölge tanımları — js/config.js ve tools/prepare_maps.py ile AYNI tutun.
#   bbox: harita kutusu [Batı, Güney, Doğu, Kuzey] (veri bu kutuyla da kırpılır)
#   iso : il sınırı için ISO 3166-2 kodu (Overpass "area" sorgusu)
# ---------------------------------------------------------------------------
BOLGELER = {
    "istanbul": {
        "iso": "TR-34",
        "bbox": [27.93, 40.735, 29.975, 41.602],
        "proj": "tm", "cm": 29.0, "lat0": 41.0,
        "ax": [258709.761824907, -55.177506321615056, 3731.934191622961],
        "ay": [-83.7635797713604, -257724.2195880867, 2844.3501798741345],
        "frame": [114, 114, 7029, 4025],
    },
    "bursa": {
        "iso": "TR-16",
        # Bursa il sınırlarını kapsayan yaklaşık kutu:
        # KB köşe: 40.66 K, 28.10 D  (Marmara kıyısı / Karacabey batısı)
        # GD köşe: 39.55 K, 29.98 D  (Harmancık-Keles güneyi / İnegöl doğusu)
        "bbox": [28.10, 39.55, 29.98, 40.66],
        "proj": "bbox",
    },
}

PLANE_WIDTH = 100.0  # Three.js'te haritanın genişliği (birim). Yükseklik orana göre.

# ---------------------------------------------------------------------------
# Katmanlar: (katman_id, Overpass filtre satırları)
# {A} il alanı, {B} bbox ile değiştirilir.
# ---------------------------------------------------------------------------
KATMANLAR = {
    "antik": [
        'nwr["historic"~"^(archaeological_site|tumulus|ruins)$"]["name"]({A})',
        'nwr["site_type"~"tumulus|settlement|fortification"]["name"]({A})',
    ],
    "tarihi": [
        'nwr["historic"~"^(castle|fort|city_walls|citywalls|caravanserai|aqueduct|palace|tower|monument|bath|hammam)$"]["name"]({A})',
        'nwr["building"~"^(caravanserai|madrasa|palace)$"]["name"]({A})',
        'nwr["amenity"="public_bath"]["historic"]["name"]({A})',
        'nwr["name"~"[Mm]edrese|[Kk]ervansaray|[Bb]edesten"]["building"]({A})',
        'nwr["name"~" Han[ıi]?$"]["historic"]({A})',
    ],
    "muze": [
        'nwr["tourism"="museum"]["name"]({A})',
    ],
    "camiler": [
        # Tarihi camiler: tarihî/koruma etiketi veya Vikipedi bağlantısı olanlar
        'nwr["amenity"="place_of_worship"]["religion"="muslim"]["name"]["wikipedia"]({A})',
        'nwr["amenity"="place_of_worship"]["religion"="muslim"]["name"]["wikidata"]({A})',
        'nwr["amenity"="place_of_worship"]["religion"="muslim"]["name"]["historic"]({A})',
        'nwr["amenity"="place_of_worship"]["religion"="muslim"]["name"]["heritage"]({A})',
    ],
    "kiliseler": [
        'nwr["amenity"="place_of_worship"]["religion"~"^(christian|jewish)$"]["name"]({A})',
        'nwr["historic"~"^(church|monastery|synagogue)$"]["name"]({A})',
    ],
    "turbeler": [
        'nwr["historic"~"^(tomb|mausoleum)$"]["name"]({A})',
        'nwr["building"="tomb"]["name"]({A})',
        'nwr["tomb"]["name"]({A})',
    ],
    "dogal": [
        'nwr["natural"~"^(waterfall|cave_entrance|spring|cliff|bay|cape|beach)$"]["name"]({A})',
        'nwr["waterway"="waterfall"]["name"]({A})',
        'nwr["boundary"~"^(national_park|protected_area)$"]["name"]({A})',
        'nwr["leisure"="nature_reserve"]["name"]({A})',
        'nwr["natural"="water"]["water"~"^(lake|reservoir|lagoon)$"]["name"]({A})',
        'nwr["natural"="wood"]["name"~"[Oo]rman"]({A})',
    ],
    "zirveler": [
        'node["natural"~"^(peak|hill|volcano)$"]["name"]({A})',
    ],
    "ulasim": [
        'nwr["aerialway"~"^(cable_car|gondola|mixed_lift)$"]({A})',
        'nwr["aerialway"="station"]["name"]({A})',
        'nwr["aeroway"="aerodrome"]["name"]({A})',
        'nwr["railway"="station"]["name"]["station"!~"subway|light_rail|tram|monorail|funicular"]({A})',
        'nwr["amenity"="ferry_terminal"]["name"]({A})',
    ],
}

# Hat (çizgi) katmanları: geometri ile birlikte çekilir
HATLAR = {
    "faylar": ['way["geological"="fault"]({B})', 'way["fault"]({B})'],
    "teleferik": ['way["aerialway"~"^(cable_car|gondola|mixed_lift)$"]({A})'],
}

ALT_TUR = {  # açılır pencerede gösterilecek Türkçe tür adları
    "archaeological_site": "Ören yeri", "tumulus": "Höyük / Tümülüs", "ruins": "Kalıntı",
    "castle": "Kale", "fort": "Kale / Tabya", "city_walls": "Sur", "citywalls": "Sur",
    "caravanserai": "Han / Kervansaray", "aqueduct": "Su kemeri", "palace": "Saray",
    "tower": "Kule", "monument": "Anıt", "bath": "Hamam", "hammam": "Hamam",
    "madrasa": "Medrese", "museum": "Müze", "tomb": "Türbe", "mausoleum": "Türbe",
    "church": "Kilise", "monastery": "Manastır", "synagogue": "Sinagog",
    "waterfall": "Şelale", "cave_entrance": "Mağara", "spring": "Kaynak", "cliff": "Yalıyar",
    "bay": "Koy", "cape": "Burun", "beach": "Plaj", "national_park": "Milli park",
    "protected_area": "Korunan alan", "nature_reserve": "Tabiat parkı / rezerv",
    "lake": "Göl", "reservoir": "Baraj gölü", "lagoon": "Lagün", "wood": "Orman",
    "peak": "Zirve", "hill": "Tepe", "volcano": "Volkan",
    "cable_car": "Teleferik", "gondola": "Teleferik", "mixed_lift": "Teleferik", "station": "İstasyon",
    "aerodrome": "Havalimanı", "ferry_terminal": "İskele",
}


# ---------------------------------------------------------------------------
# Koordinat dönüşümü (js/config.js -> lonLatToUV ile aynı)
# ---------------------------------------------------------------------------
def make_projector(b):
    if b["proj"] == "tm":
        ax, ay, (x0, y0, x1, y1) = b["ax"], b["ay"], b["frame"]

        def f(lon, lat):
            l = math.radians(lon - b["cm"]); p = math.radians(lat)
            x = math.atanh(math.cos(p) * math.sin(l))
            y = math.atan2(math.tan(p), math.cos(l)) - math.radians(b["lat0"])
            px = ax[0] * x + ax[1] * y + ax[2]
            py = ay[0] * x + ay[1] * y + ay[2]
            return (px - x0) / (x1 - x0), (py - y0) / (y1 - y0)
        aspect = (b["frame"][3] - b["frame"][1]) / (b["frame"][2] - b["frame"][0])
    else:
        w, s, e, n = b["bbox"]

        def f(lon, lat):
            return (lon - w) / (e - w), (n - lat) / (n - s)
        # eşit alanlı görünüm için enlem düzeltmesi
        aspect = (n - s) / ((e - w) * math.cos(math.radians((n + s) / 2)))
    return f, aspect


# ---------------------------------------------------------------------------
# HTTP yardımcıları
# ---------------------------------------------------------------------------
def http_get(url, data=None, timeout=200, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as ex:  # noqa
            last = ex
            time.sleep(3 * (i + 1))
    raise last


class OverpassHatasi(RuntimeError):
    pass


def overpass(query, zorunlu=True):
    """Sunucuları sırayla dener. zorunlu=False ise hata yerine boş sonuç döner."""
    body = urllib.parse.urlencode({"data": query}).encode()
    for tur in range(2):
        for url in OVERPASS:
            try:
                return json.loads(http_get(url, body, retries=2))
            except Exception as ex:
                print(f"   ! {url.split('/')[2]} başarısız: {ex}")
        if tur == 0:
            print("   … 20 sn bekleyip yeniden deneniyor")
            time.sleep(20)
    if zorunlu:
        raise SystemExit("Overpass sunucularına ulaşılamadı. Biraz sonra tekrar deneyin.")
    print("   ! Bu katman atlandı (sunucu yanıt vermedi). Script'i daha sonra tekrar çalıştırabilirsiniz.")
    return {"elements": []}


def build_query(filters, b, out="center tags"):
    w, s, e, n = b["bbox"]
    bb = f"{s},{w},{n},{e}"
    lines = []
    for flt in filters:
        lines.append(flt.replace("({A})", "(area.il)(" + bb + ")").replace("({B})", "(" + bb + ")") + ";")
    return (f'[out:json][timeout:180];\narea["ISO3166-2"="{b["iso"]}"]["admin_level"="4"]->.il;\n(\n  '
            + "\n  ".join(lines) + f"\n);\nout {out};")


# ---------------------------------------------------------------------------
def rdp(pts, eps):
    """Ramer–Douglas–Peucker çizgi sadeleştirme."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x1 * y0 - y1 * x0) / L
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
    return [pts[0], pts[-1]]


def tag_kind(t):
    for k in ("historic", "tourism", "building", "natural", "waterway", "boundary", "leisure",
              "aerialway", "aeroway", "railway", "amenity", "water"):
        v = t.get(k)
        if v and v in ALT_TUR:
            if k == "natural" and v == "water":
                continue
            return ALT_TUR[v]
    if t.get("water") in ALT_TUR:
        return ALT_TUR[t["water"]]
    if t.get("amenity") == "place_of_worship":
        return {"muslim": "Cami / Mescit", "christian": "Kilise", "jewish": "Sinagog"}.get(t.get("religion"), "İbadet yeri")
    return ""


def clean_name(t):
    return t.get("name:tr") or t.get("name") or t.get("official_name") or ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bolge", default="istanbul", choices=BOLGELER.keys())
    ap.add_argument("--vikipedi-yok", action="store_true", help="Vikipedi özetlerini indirme")
    ap.add_argument("--cikti", default=os.path.join(ROOT, "data", "data.js"))
    a = ap.parse_args()
    b = BOLGELER[a.bolge]
    proj, aspect = make_projector(b)
    PLANE_H = PLANE_WIDTH * aspect

    def place(lon, lat):
        u, v = proj(lon, lat)
        return round(u, 5), round(v, 5)

    def inside(u, v):
        return -0.001 <= u <= 1.001 and -0.001 <= v <= 1.001

    points, seen = [], set()
    for layer, filters in KATMANLAR.items():
        print(f"» {layer}: Overpass sorgusu…")
        res = overpass(build_query(filters, b))
        n0 = len(points)
        for el in res.get("elements", []):
            t = el.get("tags", {})
            name = clean_name(t)
            if not name and layer != "ulasim":
                continue
            if layer == "ulasim" and not name:
                name = "Teleferik hattı"
            if "lat" in el:
                lat, lon = el["lat"], el["lon"]
            elif "center" in el:
                lat, lon = el["center"]["lat"], el["center"]["lon"]
            else:
                continue
            u, v = place(lon, lat)
            if not inside(u, v):
                continue
            key = (name.lower(), round(lat, 3), round(lon, 3))
            if key in seen:
                continue
            seen.add(key)
            p = {
                "id": f'{el["type"][0]}{el["id"]}',
                "layer": layer, "name": name, "kind": tag_kind(t),
                "lat": round(lat, 6), "lon": round(lon, 6), "u": u, "v": v,
                "x": round((u - 0.5) * PLANE_WIDTH, 3), "y": round((v - 0.5) * PLANE_H, 3),
            }
            for src, dst in (("description:tr", "desc"), ("description", "desc"), ("inscription", "inscription"),
                             ("wikipedia", "wikipedia"), ("wikidata", "wikidata"), ("start_date", "date"),
                             ("ele", "ele"), ("heritage", "heritage"), ("website", "web"), ("architect", "architect"),
                             ("name:en", "name_en"), ("opening_hours", "hours"), ("iata", "iata")):
                if t.get(src) and dst not in p:
                    p[dst] = t[src][:600]
            points.append(p)
        print(f"   {len(points) - n0} kayıt")
        time.sleep(1.5)  # Overpass'a nazik davran

    # Zirveler: yalnızca yüksekliği olan veya Vikipedi'si olanlar (çok fazla isimsiz tepe olabiliyor)
    # Diğer katmanlarda tekrarlanan (ör. hem müze hem cami) kayıtlar korunur; açılır pencerede tür bilgisi farklıdır.

    # ---- Hatlar (sınırlar, faylar, teleferik) ----
    lines = []

    def add_way_geom(layer, el, name, eps=0.00035):
        g = el.get("geometry") or []
        pts = [(q["lon"], q["lat"]) for q in g if q]
        if len(pts) < 2:
            return
        pts = rdp(pts, eps)
        uv = [place(lo, la) for lo, la in pts]
        if not any(inside(u, v) for u, v in uv):
            return
        lines.append({"layer": layer, "name": name, "uv": [c for pair in uv for c in pair]})

    for layer, filters in HATLAR.items():
        print(f"» {layer}: Overpass sorgusu…")
        res = overpass(build_query(filters, b, out="geom tags"), zorunlu=False)
        for el in res.get("elements", []):
            if el["type"] == "way":
                add_way_geom(layer, el, clean_name(el.get("tags", {})), eps=0.0002)
        time.sleep(1.5)

    print("» il sınırı: Overpass sorgusu…")
    res = overpass(f'[out:json][timeout:180];\nrel["ISO3166-2"="{b["iso"]}"]["admin_level"="4"];\nway(r);\nout geom;', zorunlu=False)
    il_ids = set()
    for el in res.get("elements", []):
        if el["type"] == "way":
            il_ids.add(el["id"])
            add_way_geom("il_siniri", el, "")
    time.sleep(1.5)
    print("» ilçe sınırları: Overpass sorgusu…")
    res = overpass(f'[out:json][timeout:180];\narea["ISO3166-2"="{b["iso"]}"]["admin_level"="4"]->.il;\n'
                   f'rel["boundary"="administrative"]["admin_level"="6"](area.il);\nway(r);\nout geom;', zorunlu=False)
    for el in res.get("elements", []):
        if el["type"] == "way" and el["id"] not in il_ids:
            add_way_geom("ilce_siniri", el, "")
    print(f"   {len(lines)} hat")

    # ---- Vikipedi özetleri (çevrimdışı bilgi için) ----
    if not a.vikipedi_yok:
        fetch_wikipedia(points)

    # ---- Kaydet ----
    w, s, e, n = b["bbox"]
    data = {
        "meta": {
            "bolge": a.bolge, "olusturma": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "bbox": {"kuzeybati": [n, w], "guneydogu": [s, e]},
            "plane": {"width": PLANE_WIDTH, "height": round(PLANE_H, 4)},
            "kaynak": "© OpenStreetMap katkıcıları (ODbL) · Vikipedi (CC BY-SA)",
        },
        "points": points, "lines": lines,
    }
    os.makedirs(os.path.dirname(a.cikti), exist_ok=True)
    with open(a.cikti, "w", encoding="utf-8") as f:
        f.write("// Bu dosya tools/fetch_osm.py tarafından otomatik üretildi. Elle düzenlemeyin;\n")
        f.write("// kendi notlarınızı data/curated.js dosyasına ekleyin.\n")
        f.write("window.MAP_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    from collections import Counter
    c = Counter(p["layer"] for p in points)
    print("\nÖzet:", dict(c), f"| hat: {len(lines)}")
    print(f"Kaydedildi: {a.cikti}  ({os.path.getsize(a.cikti) / 1024:.0f} KB)")


def fetch_wikipedia(points):
    """wikipedia / wikidata etiketlerinden Türkçe Vikipedi özetini indirir."""
    print("» Vikipedi: başlıklar çözülüyor…")
    need_wd = {}
    for p in points:
        wp = p.get("wikipedia", "")
        m = re.match(r"^([a-z\-]+):(.+)$", wp)
        if m and m.group(1) == "tr":
            p["_tr"] = m.group(2)
        elif p.get("wikidata"):
            need_wd.setdefault(p["wikidata"], []).append(p)
        elif m:
            p["_other"] = (m.group(1), m.group(2))
    ids = [q for q in need_wd if re.match(r"^Q\d+$", q)]
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        url = ("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=trwiki|enwiki&ids="
               + "|".join(chunk))
        try:
            ents = json.loads(http_get(url, timeout=60)).get("entities", {})
        except Exception as ex:
            print("   ! wikidata:", ex)
            continue
        for qid, ent in ents.items():
            sl = ent.get("sitelinks", {})
            for p in need_wd.get(qid, []):
                if "trwiki" in sl:
                    p["_tr"] = sl["trwiki"]["title"]
                elif "enwiki" in sl:
                    p["_other"] = ("en", sl["enwiki"]["title"])
        time.sleep(0.5)

    jobs = []
    for p in points:
        if p.get("_tr"):
            jobs.append((p, "tr", p["_tr"]))
        elif p.get("_other"):
            jobs.append((p, p["_other"][0], p["_other"][1]))
    print(f"» Vikipedi: {len(jobs)} özet indiriliyor…")

    def one(job):
        p, lang, title = job
        url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"), safe="")
        try:
            js = json.loads(http_get(url, timeout=30, retries=2))
        except Exception:
            return
        ext = (js.get("extract") or "").strip()
        if ext:
            if len(ext) > 900:
                ext = ext[:900].rsplit(" ", 1)[0] + "…"
            p["wiki"] = {"lang": lang, "title": js.get("title", title), "text": ext,
                         "url": js.get("content_urls", {}).get("mobile", {}).get("page", "")}
            th = js.get("thumbnail", {}).get("source")
            if th:
                p["wiki"]["thumb"] = th  # yalnızca çevrimiçiyken gösterilir
    done = 0
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        for _ in ex.map(one, jobs):
            done += 1
            if done % 100 == 0:
                print(f"   {done}/{len(jobs)}")
    for p in points:
        p.pop("_tr", None); p.pop("_other", None)
    print(f"   {sum(1 for p in points if 'wiki' in p)} noktaya özet eklendi")


if __name__ == "__main__":
    sys.exit(main())

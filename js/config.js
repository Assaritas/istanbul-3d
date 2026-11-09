// =============================================================================
//  config.js — Bölge, coğrafi referans ve katman ayarları
//  tools/prepare_maps.py ve tools/fetch_osm.py içindeki değerlerle AYNI olmalıdır.
// =============================================================================

export const REGIONS = {
  istanbul: {
    title: 'İstanbul',
    subtitle: 'Dijital İkiz · Yer Şekilleri, Tarih ve Coğrafya',
    // Haritanın kapladığı yaklaşık kutu (bilgi amaçlı; asıl hizalama aşağıdaki TM dönüşümüyle)
    //   Kuzeybatı: 41.602 K, 27.930 D   ·   Güneydoğu: 40.735 K, 29.975 D
    bbox: { west: 27.93, south: 40.735, east: 29.975, north: 41.602 },
    // HGM haritası Transvers Merkator; graticule kesişimlerinden ölçülen afin katsayılar
    proj: 'tm', cm: 29.0, lat0: 41.0,
    ax: [258709.761824907, -55.177506321615056, 3731.934191622961],
    ay: [-83.7635797713604, -257724.2195880867, 2844.3501798741345],
    frame: [114, 114, 7029, 4025],
    maxElevationM: 660,          // prepare_maps.py çıktısında yazan "en yüksek" değer
    textures: { hi: 'assets/harita_4096.jpg', lo: 'assets/harita_2048.jpg', height: 'assets/yukseklik.png' },
  },
  bursa: {
    title: 'Bursa',
    subtitle: 'Dijital İkiz · Uludağ\'dan Marmara\'ya',
    // Bursa il sınırlarını kapsayan yaklaşık kutu
    //   Kuzeybatı: 40.66 K, 28.10 D (Mudanya–Karacabey kıyısı, İmralı dahil)
    //   Güneydoğu: 39.55 K, 29.98 D (Harmancık–Keles güneyi, İnegöl doğusu)
    bbox: { west: 28.10, south: 39.55, east: 29.98, north: 40.66 },
    proj: 'bbox',
    maxElevationM: 2543,         // Uludağ Kara Tepe
    textures: { hi: 'assets/harita_4096.jpg', lo: 'assets/harita_2048.jpg', height: 'assets/yukseklik.png' },
  },
};

// >>> Bölge değiştirmek için yalnızca bu satırı değiştirin <<<
export const ACTIVE_REGION = 'istanbul';
export const REGION = REGIONS[ACTIVE_REGION];

export const PLANE_WIDTH = 100; // Three.js birimi; 1 birim ≈ 1,7 km (İstanbul)

/** Haritanın en/boy oranı (yükseklik / genişlik) */
export const PLANE_ASPECT = (() => {
  const r = REGION;
  if (r.proj === 'tm') return (r.frame[3] - r.frame[1]) / (r.frame[2] - r.frame[0]);
  const { west, south, east, north } = r.bbox;
  return (north - south) / ((east - west) * Math.cos(((north + south) / 2) * Math.PI / 180));
})();
export const PLANE_HEIGHT = PLANE_WIDTH * PLANE_ASPECT;

/** Enlem/boylam -> harita dokusu koordinatı (u: 0 batı → 1 doğu, v: 0 kuzey → 1 güney) */
export function lonLatToUV(lon, lat) {
  const r = REGION;
  if (r.proj === 'tm') {
    const d = Math.PI / 180;
    const l = (lon - r.cm) * d, p = lat * d;
    const x = Math.atanh(Math.cos(p) * Math.sin(l));
    const y = Math.atan2(Math.tan(p), Math.cos(l)) - r.lat0 * d;
    const px = r.ax[0] * x + r.ax[1] * y + r.ax[2];
    const py = r.ay[0] * x + r.ay[1] * y + r.ay[2];
    const [x0, y0, x1, y1] = r.frame;
    return [(px - x0) / (x1 - x0), (py - y0) / (y1 - y0)];
  }
  const { west, south, east, north } = r.bbox;
  return [(lon - west) / (east - west), (north - lat) / (north - south)];
}

/** u,v -> Three.js dünya koordinatı (x doğu, z güney) */
export function uvToXZ(u, v) {
  return [(u - 0.5) * PLANE_WIDTH, (v - 0.5) * PLANE_HEIGHT];
}

// -----------------------------------------------------------------------------
//  Katmanlar  (id'ler fetch_osm.py çıktısındaki "layer" alanıyla eşleşir)
// -----------------------------------------------------------------------------
export const LAYER_GROUPS = [
  { title: 'Tarih ve Kültür', layers: [
    { id: 'antik',    label: 'Antik Kentler ve Ören Yerleri', color: '#c2410c', type: 'point', on: true },
    { id: 'tarihi',   label: 'Kale, Sur, Han, Medrese',       color: '#a16207', type: 'point', on: true },
    { id: 'muze',     label: 'Müzeler',                       color: '#7c3aed', type: 'point', on: true },
  ]},
  { title: 'İnanç Mirası', layers: [
    { id: 'camiler',   label: 'Tarihi Camiler',            color: '#0f766e', type: 'point', on: true },
    { id: 'kiliseler', label: 'Kiliseler ve Sinagoglar',   color: '#1d4ed8', type: 'point', on: false },
    { id: 'turbeler',  label: 'Türbeler',                  color: '#65a30d', type: 'point', on: false },
  ]},
  { title: 'Doğa ve Coğrafya', layers: [
    { id: 'dogal',    label: 'Doğal Güzellikler',  color: '#059669', type: 'point', on: true },
    { id: 'zirveler', label: 'Dağ ve Tepeler',     color: '#78350f', type: 'point', on: false },
    { id: 'faylar',   label: 'Fay Hatları',        color: '#dc2626', type: 'line',  on: true, width: 0.22 },
  ]},
  { title: 'Ulaşım', layers: [
    { id: 'ulasim',    label: 'Havalimanı, Gar, İskele', color: '#db2777', type: 'point', on: false },
    { id: 'teleferik', label: 'Teleferik Hatları',       color: '#be185d', type: 'line',  on: false, width: 0.12 },
  ]},
  { title: 'Sınırlar', layers: [
    { id: 'il_siniri',   label: 'İl Sınırı',    color: '#6b21a8', type: 'line', on: true,  width: 0.16 },
    { id: 'ilce_siniri', label: 'İlçe Sınırları', color: '#9333ea', type: 'line', on: false, width: 0.06 },
  ]},
  { title: 'Rehber', layers: [
    { id: 'rehber', label: 'Rehber Notlarım', color: '#e11d48', type: 'point', on: true },
  ]},
];

export const ALL_LAYERS = LAYER_GROUPS.flatMap(g => g.layers);
export const LAYER_BY_ID = Object.fromEntries(ALL_LAYERS.map(l => [l.id, l]));

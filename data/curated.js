// =============================================================================
//  curated.js — REHBERİN KENDİ İÇERİĞİ (elle düzenlenir; fetch_osm.py bu dosyaya dokunmaz)
//
//  points : Kendi pinleriniz. layer verilmezse "Rehber Notlarım" katmanına düşer.
//           İsterseniz layer: 'antik' | 'tarihi' | 'muze' | 'camiler' | 'dogal' ... yazabilirsiniz.
//  lines  : Elle çizilen hatlar (fay hatları, tur güzergâhı vb.). coords: [[boylam, enlem], ...]
//  notes  : OSM'den gelen bir noktaya rehber notu ekler. Anahtar = nokta adı (kartta görünen)
//           veya OSM kimliği (ör. "w123456"). Not, kartta Vikipedi özetinin üstünde görünür.
// =============================================================================
window.CURATED = {
  points: [
    {
      name: 'Tur buluşma noktası — Sultanahmet Meydanı',
      lat: 41.00583, lon: 28.97660,
      note: 'Örnek rehber pini. Kendi buluşma noktalarınızı, fotoğraf duraklarınızı ve anlatım notlarınızı bu dosyaya ekleyin.',
    },
    {
      name: '17 Ağustos 1999 Gölcük Depremi merkez üssü (Mw 7,4)',
      lat: 40.760, lon: 29.970, layer: 'dogal', kind: 'Deprem merkez üssü',
      note: 'Kuzey Anadolu Fayı\'nın İzmit Körfezi segmentinde gerçekleşti. Marmara bölgesinde yapı ve afet bilincini kökten değiştiren olay.',
    },
  ],

  lines: [
    {
      layer: 'faylar',
      name: 'Kuzey Anadolu Fayı — Marmara (Kuzey) kolu, yaklaşık güzergâh',
      // MTA Diri Fay Haritası ve deniz tabanı çalışmalarından sadeleştirilmiş, anlatım amaçlı yaklaşık hat.
      coords: [
        [27.90, 40.825], [28.05, 40.838], [28.20, 40.852], [28.35, 40.866], [28.50, 40.874],
        [28.65, 40.876], [28.78, 40.862], [28.90, 40.840], [29.00, 40.815], [29.07, 40.790],
        [29.12, 40.760], [29.17, 40.735], [29.30, 40.722], [29.45, 40.715], [29.60, 40.712],
        [29.75, 40.712], [29.90, 40.718], [30.00, 40.722],
      ],
    },
  ],

  notes: {
    // 'Süleymaniye Camii': 'Mimar Sinan\'ın "kalfalık eserim" dediği yapı. Avluda gruba 10 dk serbest zaman.',
  },
};

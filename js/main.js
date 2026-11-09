// =============================================================================
//  main.js — Uygulama girişi: sahne, kamera, kontroller, etkileşim, PWA
// =============================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { REGION, PLANE_WIDTH, PLANE_HEIGHT, LAYER_BY_ID, lonLatToUV } from './config.js';
import { createTerrain } from './terrain.js';
import { LayerManager } from './layers.js';
import * as UI from './ui.js';

const lowPower = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
const coarse = matchMedia('(pointer: coarse)').matches;

document.title = `${REGION.title} · Dijital İkiz`;
document.querySelector('#brand-title').textContent = REGION.title;
document.querySelector('#brand-sub').textContent = REGION.subtitle;

// ---------------------------------------------------------------- Renderer
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower || devicePixelRatio < 2, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1a26);
scene.fog = new THREE.Fog(0x0e1a26, 140, 260);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 600);
const HOME = { pos: new THREE.Vector3(0, 62, 58), target: new THREE.Vector3(0, 0, 2) };
camera.position.copy(HOME.pos);

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-40, 60, -30);   // kuzeybatıdan ışık (haritacılık geleneği)
scene.add(sun);

// ---------------------------------------------------------------- Kontroller
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.screenSpacePanning = false;            // harita gibi: zemine paralel kaydır
controls.minDistance = 4;
controls.maxDistance = 150;
controls.maxPolarAngle = THREE.MathUtils.degToRad(78);
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.zoomToCursor = true;
controls.update();

// Kameranın harita dışına kaçmasını engelle
const LIM = new THREE.Vector3(PLANE_WIDTH / 2, 0, PLANE_HEIGHT / 2);
controls.addEventListener('change', () => {
  const t = controls.target;
  const cx = THREE.MathUtils.clamp(t.x, -LIM.x, LIM.x) - t.x;
  const cz = THREE.MathUtils.clamp(t.z, -LIM.z, LIM.z) - t.z;
  if (cx || cz) { t.x += cx; t.z += cz; camera.position.x += cx; camera.position.z += cz; }
  t.y = 0;
  needsRender = true;
});

// ---------------------------------------------------------------- Render döngüsü (yalnızca gerektiğinde)
let needsRender = true;
let fly = null;
function loop(now) {
  requestAnimationFrame(loop);
  if (fly) {
    const k = Math.min(1, (now - fly.t0) / fly.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    controls.target.lerpVectors(fly.fromT, fly.toT, e);
    camera.position.lerpVectors(fly.fromP, fly.toP, e);
    if (k >= 1) fly = null;
    needsRender = true;
  }
  if (controls.update() || needsRender) {
    renderer.render(scene, camera);
    needsRender = false;
  }
}

/** shift > 0: nokta ekranın üst kısmında kalsın (mobilde alttaki kart kapatmasın) */
function flyTo(target, distance = 14, dur = 900, shift = 0) {
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.45) { dir.y = 0.45; dir.normalize(); }
  const toT = new THREE.Vector3(target.x, 0, target.z);
  if (shift) {
    const back = new THREE.Vector3(dir.x, 0, dir.z);
    if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
    toT.addScaledVector(back.normalize(), distance * shift);
  }
  fly = {
    t0: performance.now(), dur,
    fromT: controls.target.clone(), toT,
    fromP: camera.position.clone(),
    toP: toT.clone().addScaledVector(dir, distance),
  };
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  needsRender = true;
});

// ---------------------------------------------------------------- Veri birleştirme
function collectData() {
  const D = window.MAP_DATA || { points: [], lines: [] };
  const C = window.CURATED || { points: [], lines: [], notes: {} };
  const points = D.points.slice();
  const lines = D.lines.slice();
  for (const p of C.points || []) {
    const [u, v] = lonLatToUV(p.lon, p.lat);
    points.push({ layer: 'rehber', kind: 'Rehber notu', ...p, u, v });
  }
  for (const l of C.lines || []) {
    const uv = [];
    for (const [lon, lat] of l.coords) uv.push(...lonLatToUV(lon, lat));
    lines.push({ layer: l.layer, name: l.name, uv });
  }
  const notes = C.notes || {};
  for (const p of points) {
    const n = notes[p.id] || notes[p.name];
    if (n) p.note = n;
  }
  return { points, lines, meta: D.meta };
}

// ---------------------------------------------------------------- Başlat
let terrain, layers, panel;

async function init() {
  UI.setLoading('Harita dokuları yükleniyor…');
  terrain = await createTerrain(renderer, { lowPower });
  scene.add(terrain.group);

  UI.setLoading('Katmanlar hazırlanıyor…');
  const data = collectData();
  layers = new LayerManager(scene, terrain, camera, renderer);

  // Yükseklik ayarı: "abartı" katsayısı -> displacementScale
  const { west, east, north, south } = REGION.bbox;
  const kmPerUnit = (east - west) * 111.32 * Math.cos((north + south) / 2 * Math.PI / 180) / PLANE_WIDTH;
  const realScale = REGION.maxElevationM / 1000 / kmPerUnit;   // abartı ×1 için displacementScale
  const slider = document.querySelector('#exag');
  const out = document.querySelector('#exag-val');
  const applyExag = () => {
    const ex = parseFloat(slider.value);
    const s = ex * realScale;
    terrain.setScale(s);
    out.textContent = `×${ex}  ·  ölçek ${s.toFixed(2)}`;
  };
  applyExag();
  layers.build(data.points, data.lines);
  let raf = 0;
  slider.addEventListener('input', () => {
    applyExag();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { layers.updateHeights(); needsRender = true; });
    needsRender = true;
  });

  panel = UI.setupPanel();
  UI.buildLegend(layers, {
    onToggle: (id, on) => { layers.setVisible(id, on); needsRender = true; },
  });
  UI.setupSearch(layers.allItems(), { onPick: (it) => openItem(it, true) });

  document.querySelector('#btn-home').addEventListener('click', () => {
    fly = { t0: performance.now(), dur: 900, fromT: controls.target.clone(), toT: HOME.target.clone(),
            fromP: camera.position.clone(), toP: HOME.pos.clone() };
  });
  document.querySelector('#btn-top').addEventListener('click', () => {
    const t = controls.target.clone();
    const d = camera.position.distanceTo(t);
    fly = { t0: performance.now(), dur: 700, fromT: t.clone(), toT: t.clone(),
            fromP: camera.position.clone(), toP: new THREE.Vector3(t.x, d, t.z + 0.01) };
  });

  const dataInfo = document.querySelector('#data-info');
  dataInfo.textContent = data.meta
    ? `Veri: ${data.points.length} nokta · güncelleme ${data.meta.olusturma}`
    : 'Henüz OSM verisi yok — tools/fetch_osm.py çalıştırın.';
  document.querySelector('#quality').textContent = `Doku: ${terrain.quality}`;

  setupPointer();
  UI.setLoading('', true);
  requestAnimationFrame(loop);

  // Derin bağlantı: ?yer=Ayasofya  → o noktaya uçar ve kartını açar (misafire belirli bir yeri göstermek için)
  const q = new URLSearchParams(location.search).get('yer');
  if (q) {
    const key = q.toLocaleLowerCase('tr');
    const all = layers.allItems();
    const hit = all.find(i => i.name.toLocaleLowerCase('tr') === key) || all.find(i => i.name.toLocaleLowerCase('tr').includes(key));
    if (hit) setTimeout(() => openItem(hit, true), 300);
  }
}

function openItem(item, fly_) {
  const def = LAYER_BY_ID[item.layer];
  if (def && !layers.layers[item.layer].visible) {
    layers.setVisible(item.layer, true);
    UI.buildLegend(layers, { onToggle: (id, on) => { layers.setVisible(id, on); needsRender = true; } });
  }
  layers.select(item);
  const narrow = panel.isNarrow();
  if (fly_ || narrow) {
    const dist = fly_ ? 12 : camera.position.distanceTo(controls.target);
    flyTo({ x: item._pos[0], z: item._pos[2] }, dist, fly_ ? 900 : 500, narrow ? 0.42 : 0);
  }
  if (narrow) panel.close();
  UI.showTooltip(null);
  UI.showCard(item, { onClose: () => { layers.select(null); needsRender = true; } });
  needsRender = true;
}

// ---------------------------------------------------------------- Dokunma / fare
function setupPointer() {
  let down = null, hoverRaf = 0, last = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    down = null;
    if (moved > 8 || !quick) return;                 // sürükleme, tıklama değil
    const hit = layers.pick(e.clientX, e.clientY, e.pointerType === 'touch' ? 28 : 16);
    if (hit) openItem(hit, false);
    else { UI.hideCard(); layers.select(null); needsRender = true; }
  });
  if (!coarse) {
    canvas.addEventListener('pointermove', (e) => {
      last = e;
      if (hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        if (down && (last.buttons & 1)) { UI.showTooltip(null); return; }
        const hit = layers.pick(last.clientX, last.clientY, 14);
        canvas.style.cursor = hit ? 'pointer' : '';
        UI.showTooltip(hit, last.clientX, last.clientY);
      });
    });
    canvas.addEventListener('pointerleave', () => UI.showTooltip(null));
  }
}

// ---------------------------------------------------------------- PWA: çevrimdışı önbellek + kurulum
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const announce = () => UI.toast('Çevrimdışı kullanıma hazır ✓ İnternet olmadan da açılır.');
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', announce, { once: true });
    }
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          UI.toast('Yeni sürüm indirildi. Sayfayı yenileyince güncellenecek.', 5000);
        }
      });
    });
  }).catch(() => {});
}

let deferredPrompt = null;
const installBtn = document.querySelector('#btn-install');
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; installBtn.hidden = false; });
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null; installBtn.hidden = true;
});
const shareBtn = document.querySelector('#btn-share');
if (navigator.share) {
  shareBtn.hidden = false;
  shareBtn.addEventListener('click', () => navigator.share({ title: document.title, url: location.href }).catch(() => {}));
}
addEventListener('offline', () => UI.toast('Çevrimdışısınız — harita ve bilgiler önbellekten çalışıyor.'));

init().catch((err) => {
  console.error(err);
  UI.setLoading('Yüklenemedi: ' + err.message + ' (Dosyayı doğrudan açtıysanız bir yerel sunucu kullanın — README’ye bakın.)');
});

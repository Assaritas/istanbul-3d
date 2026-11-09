// =============================================================================
//  terrain.js — 3B zemin: fiziki harita dokusu + yükseklik (displacement) haritası
// =============================================================================
import * as THREE from 'three';
import { REGION, PLANE_WIDTH, PLANE_HEIGHT } from './config.js';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel yüklenemedi: ' + src));
    img.src = src;
  });
}

/** Yükseklik haritasından teğet uzayı normal haritası üretir (kabartma ışığı için). */
function buildNormalMap(H, w, h) {
  const data = new Uint8Array(w * h * 4);
  const cell = PLANE_WIDTH / w;          // bir pikselin dünya birimi
  const at = (x, y) => H[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) / (2 * cell);
      const dy = (at(x, y + 1) - at(x, y - 1)) / (2 * cell); // satır güneye doğru artar
      // ölçek 1'deki eğim; materyal normalScale ile abartı uygulanır
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.flipY = true;            // DataTexture'da varsayılan false; görüntülerle aynı yönde olsun
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export async function createTerrain(renderer, { lowPower }) {
  const maxTex = renderer.capabilities.maxTextureSize;
  const useHi = !lowPower && maxTex >= 4096;
  const [mapImg, hImg] = await Promise.all([
    loadImage(useHi ? REGION.textures.hi : REGION.textures.lo),
    loadImage(REGION.textures.height),
  ]);

  // --- Yükseklikleri CPU'ya al (pinlerin zemine oturması için) ---
  const w = hImg.naturalWidth, h = hImg.naturalHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(hImg, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = px[i * 4] / 255;

  // --- Dokular ---
  const map = new THREE.Texture(mapImg);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  map.needsUpdate = true;

  const disp = new THREE.Texture(hImg);
  disp.needsUpdate = true;

  const normalMap = buildNormalMap(H, w, h);

  // --- Geometri ---
  const segX = useHi ? 640 : 300;
  const segY = Math.round(segX * PLANE_HEIGHT / PLANE_WIDTH);
  const geo = new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT, segX, segY);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshPhongMaterial({
    map,
    displacementMap: disp,
    displacementScale: 3,
    normalMap,
    normalScale: new THREE.Vector2(3, 3),
    shininess: 0,
    specular: 0x000000,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain';

  // Diorama tabanı (haritanın altında koyu kaide)
  const baseH = 1.6;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(PLANE_WIDTH, baseH, PLANE_HEIGHT),
    new THREE.MeshLambertMaterial({ color: 0x1b2a3a })
  );
  base.position.y = -baseH / 2 - 0.01;

  const group = new THREE.Group();
  group.add(mesh, base);

  /** Bilineer yükseklik örnekleme (0–1). u: batı→doğu, v: kuzey→güney */
  function sample01(u, v) {
    const x = Math.min(Math.max(u, 0), 1) * (w - 1);
    const y = Math.min(Math.max(v, 0), 1) * (h - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0, fy = y - y0;
    const a = H[y0 * w + x0], b = H[y0 * w + x1], c = H[y1 * w + x0], d = H[y1 * w + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  return {
    group,
    mesh,
    material: mat,
    quality: useHi ? 'yüksek' : 'mobil',
    get scale() { return mat.displacementScale; },
    setScale(s) {
      mat.displacementScale = s;
      mat.normalScale.set(Math.max(s, 0.0001), Math.max(s, 0.0001));
    },
    heightAt(u, v) { return sample01(u, v) * mat.displacementScale; },
  };
}

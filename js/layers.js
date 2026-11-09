// =============================================================================
//  layers.js — Pinler (noktalar), hatlar (fay, sınır) ve ekran-uzayı seçimi
// =============================================================================
import * as THREE from 'three';
import { ALL_LAYERS, LAYER_BY_ID, uvToXZ } from './config.js';

const PIN_LIFT = 0.55;     // pinin zeminden yüksekliği (dünya birimi)
const LINE_LIFT = 0.06;    // hatların zeminden yüksekliği
const MAX_SEG = 0.45;      // hatlar zemini takip etsin diye segmentleri böl

/** Katman rengiyle yuvarlak pin dokusu */
function markerTexture(color, ring = false) {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (ring) {
    g.strokeStyle = '#fff'; g.lineWidth = 6;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2); g.stroke();
  } else {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(s / 2, s / 2 + 2, s / 2 - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = color;
    g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 11, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.arc(s / 2, s / 2, 6, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LayerManager {
  constructor(scene, terrain, camera, renderer) {
    this.scene = scene; this.terrain = terrain; this.camera = camera; this.renderer = renderer;
    this.layers = {};   // id -> { def, items, points, stalks, ribbon, visible }
    this.root = new THREE.Group();
    scene.add(this.root);
    this._v = new THREE.Vector3();
    this.pinPx = 22;

    this.selection = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
      new THREE.PointsMaterial({ map: markerTexture('#e11d48', true), size: 44, sizeAttenuation: false,
        transparent: true, depthTest: false })
    );
    this.selection.renderOrder = 10;
    this.selection.visible = false;
    this.root.add(this.selection);
  }

  /** points: [{layer,u,v,name,...}], lines: [{layer,name,uv:[u,v,u,v...]}] */
  build(points, lines) {
    for (const def of ALL_LAYERS) {
      this.layers[def.id] = { def, items: [], lines: [], visible: def.on };
    }
    for (const p of points) if (this.layers[p.layer]) this.layers[p.layer].items.push(p);
    for (const l of lines) if (this.layers[l.layer]) this.layers[l.layer].lines.push(l);

    const pr = this.renderer.getPixelRatio();
    for (const L of Object.values(this.layers)) {
      const { def } = L;
      if (def.type === 'point' && L.items.length) {
        const n = L.items.length;
        const pg = new THREE.BufferGeometry();
        pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        L.points = new THREE.Points(pg, new THREE.PointsMaterial({
          map: markerTexture(def.color), size: this.pinPx * pr, sizeAttenuation: false,
          transparent: true, alphaTest: 0.4, depthWrite: false,
        }));
        L.points.renderOrder = 5;
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
        L.stalks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.85 }));
        this.root.add(L.points, L.stalks);
        L.points.frustumCulled = L.stalks.frustumCulled = false;
      }
      if (def.type === 'line' && L.lines.length) {
        L.ribbon = this._buildRibbon(L.lines, def.width || 0.1, def.color);
        this.root.add(L.ribbon);
      }
      // nokta katmanı içinde hat da olabilir (ör. teleferik) – yok sayılır
      this._applyVisibility(L);
    }
    this.updateHeights();
  }

  _buildRibbon(lines, width, color) {
    // Polylines -> düz şerit (WebGL'de kalın çizgi yok; şerit mobilde de aynı görünür)
    const polys = [];
    for (const l of lines) {
      let cur = [];
      for (let i = 0; i < l.uv.length; i += 2) {
        const u = l.uv[i], v = l.uv[i + 1];
        if (u < -0.002 || u > 1.002 || v < -0.002 || v > 1.002) {
          if (cur.length > 1) polys.push(cur);
          cur = [];
          continue;
        }
        if (cur.length) {
          const [pu, pv] = cur[cur.length - 1];
          const [ax, az] = uvToXZ(pu, pv), [bx, bz] = uvToXZ(u, v);
          const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / MAX_SEG);
          for (let s = 1; s < steps; s++) cur.push([pu + (u - pu) * s / steps, pv + (v - pv) * s / steps]);
        }
        cur.push([u, v]);
      }
      if (cur.length > 1) polys.push(cur);
    }
    let nv = 0, ni = 0;
    for (const p of polys) { nv += p.length * 2; ni += (p.length - 1) * 6; }
    const pos = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vi = 0, ii = 0;
    const half = width / 2;
    for (const p of polys) {
      const start = vi;
      for (let k = 0; k < p.length; k++) {
        const a = uvToXZ(...p[Math.max(0, k - 1)]), b = uvToXZ(...p[Math.min(p.length - 1, k + 1)]);
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const [x, z] = uvToXZ(...p[k]);
        for (const side of [-1, 1]) {
          const px = x - dz * half * side, pz = z + dx * half * side;
          pos[vi * 3] = px; pos[vi * 3 + 2] = pz;
          uvs[vi * 2] = px; uvs[vi * 2 + 1] = pz; // dünya xz'sini sakla (yükseklik için)
          vi++;
        }
        if (k > 0) {
          const a0 = start + (k - 1) * 2, b0 = start + k * 2;
          idx.set([a0, a0 + 1, b0, a0 + 1, b0 + 1, b0], ii); ii += 6;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.userData.xz = uvs;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false,
    }));
    m.renderOrder = 3;
    m.frustumCulled = false;
    return m;
  }

  /** Yükseklik ölçeği değişince pin/hat yüksekliklerini güncelle */
  updateHeights() {
    const T = this.terrain;
    for (const L of Object.values(this.layers)) {
      if (L.points) {
        const P = L.points.geometry.attributes.position.array;
        const S = L.stalks.geometry.attributes.position.array;
        L.items.forEach((it, i) => {
          const [x, z] = uvToXZ(it.u, it.v);
          const y = T.heightAt(it.u, it.v);
          it._pos = [x, y + PIN_LIFT, z];
          P.set(it._pos, i * 3);
          S.set([x, y, z, x, y + PIN_LIFT, z], i * 6);
        });
        L.points.geometry.attributes.position.needsUpdate = true;
        L.stalks.geometry.attributes.position.needsUpdate = true;
      }
      if (L.ribbon) {
        const g = L.ribbon.geometry, P = g.attributes.position.array, xz = g.userData.xz;
        const { PLANE_W, PLANE_H } = this._planeDims();
        for (let i = 0; i < P.length / 3; i++) {
          const u = xz[i * 2] / PLANE_W + 0.5, v = xz[i * 2 + 1] / PLANE_H + 0.5;
          P[i * 3 + 1] = T.heightAt(u, v) + LINE_LIFT;
        }
        g.attributes.position.needsUpdate = true;
      }
    }
    if (this.selected) this.select(this.selected);
  }

  _planeDims() {
    const p = this.terrain.mesh.geometry.parameters;
    return { PLANE_W: p.width, PLANE_H: p.height };
  }

  _applyVisibility(L) {
    for (const o of [L.points, L.stalks, L.ribbon]) if (o) o.visible = L.visible;
  }

  setVisible(id, on) {
    const L = this.layers[id];
    if (!L) return;
    L.visible = on;
    this._applyVisibility(L);
    if (this.selected && this.selected.layer === id && !on) this.select(null);
  }

  count(id) {
    const L = this.layers[id];
    if (!L) return 0;
    return L.def.type === 'line' ? L.lines.length : L.items.length;
  }

  allItems() { return Object.values(this.layers).flatMap(L => L.items); }

  select(item) {
    this.selected = item;
    if (!item) { this.selection.visible = false; return; }
    this.selection.geometry.attributes.position.array.set(item._pos);
    this.selection.geometry.attributes.position.needsUpdate = true;
    this.selection.material.map.dispose();
    this.selection.material.map = markerTexture(LAYER_BY_ID[item.layer]?.color || '#e11d48', true);
    this.selection.material.size = 44 * this.renderer.getPixelRatio();
    this.selection.visible = true;
  }

  /** Ekran koordinatına en yakın görünür pini bul (CSS piksel) */
  pick(clientX, clientY, radius) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    let best = null, bestD = radius * radius;
    const v = this._v, cam = this.camera;
    for (const L of Object.values(this.layers)) {
      if (!L.visible || !L.points) continue;
      for (const it of L.items) {
        v.set(it._pos[0], it._pos[1], it._pos[2]).project(cam);
        if (v.z > 1) continue;
        const sx = (v.x + 1) / 2 * rect.width, sy = (1 - v.y) / 2 * rect.height;
        const d = (sx - mx) ** 2 + (sy - my) ** 2;
        if (d < bestD) { bestD = d; best = it; }
      }
    }
    return best;
  }
}

// =============================================================================
//  ui.js — Lejant, katman anahtarları, arama, bilgi kartı, ipucu, bildirim
// =============================================================================
import { LAYER_GROUPS, LAYER_BY_ID } from './config.js';

const $ = (sel) => document.querySelector(sel);

/** Güvenli DOM üretici (OSM verisi innerHTML'e asla gitmez) */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const trLower = (s) => (s || '').toLocaleLowerCase('tr');
const fold = (s) => trLower(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

export function buildLegend(layers, { onToggle }) {
  const host = $('#layer-list');
  host.textContent = '';
  for (const g of LAYER_GROUPS) {
    const visible = g.layers.filter(l => layers.count(l.id) > 0);
    if (!visible.length) continue;
    const sec = el('section', 'lg-group');
    sec.append(el('h3', null, g.title));
    for (const l of visible) {
      const row = el('label', 'lg-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = layers.layers[l.id].visible;
      cb.addEventListener('change', () => onToggle(l.id, cb.checked));
      const sw = el('span', 'lg-switch');
      sw.style.setProperty('--c', l.color);
      const sym = el('span', l.type === 'line' ? 'lg-sym line' : 'lg-sym dot');
      sym.style.setProperty('--c', l.color);
      const name = el('span', 'lg-name', l.label);
      const cnt = el('span', 'lg-count', String(layers.count(l.id)));
      row.append(cb, sym, name, cnt, sw);
      sec.append(row);
    }
    host.append(sec);
  }
}

export function setupPanel() {
  const panel = $('#panel'), btn = $('#panel-toggle');
  const narrow = matchMedia('(max-width: 720px)').matches;
  const setOpen = (o) => {
    panel.classList.toggle('open', o);
    btn.setAttribute('aria-expanded', String(o));
  };
  setOpen(!narrow);
  btn.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  $('#panel-close').addEventListener('click', () => setOpen(false));
  return { close: () => setOpen(false), isNarrow: () => matchMedia('(max-width: 720px)').matches };
}

export function setupSearch(items, { onPick }) {
  const input = $('#search'), list = $('#search-results');
  const index = items.map(it => ({ it, key: fold(it.name + ' ' + (it.name_en || '') + ' ' + (it.kind || '')) }));
  const render = () => {
    const q = fold(input.value.trim());
    list.textContent = '';
    if (q.length < 2) { list.hidden = true; return; }
    const hits = [];
    for (const r of index) {
      const pos = r.key.indexOf(q);
      if (pos >= 0) hits.push([pos === 0 ? 0 : 1, r.it.wiki ? 0 : 1, r.it]);
      if (hits.length > 400) break;
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].name.localeCompare(b[2].name, 'tr'));
    for (const [, , it] of hits.slice(0, 12)) {
      const b = el('button', 'sr-item');
      b.type = 'button';
      const dot = el('span', 'lg-sym dot');
      dot.style.setProperty('--c', LAYER_BY_ID[it.layer]?.color || '#888');
      b.append(dot, el('span', 'sr-name', it.name), el('span', 'sr-kind', it.kind || LAYER_BY_ID[it.layer]?.label || ''));
      b.addEventListener('click', () => { list.hidden = true; input.blur(); onPick(it); });
      list.append(b);
    }
    if (!hits.length) list.append(el('div', 'sr-empty', 'Sonuç bulunamadı'));
    list.hidden = false;
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') list.querySelector('.sr-item')?.click();
    if (e.key === 'Escape') { input.value = ''; render(); }
  });
}

// ---------------- İpucu (hover) ----------------
const tip = () => $('#tooltip');
export function showTooltip(item, x, y) {
  const t = tip();
  if (!item) { t.hidden = true; return; }
  t.textContent = '';
  t.append(el('strong', null, item.name));
  if (item.kind) t.append(el('span', null, item.kind));
  t.hidden = false;
  const r = t.getBoundingClientRect();
  const nx = Math.min(window.innerWidth - r.width - 8, x + 14);
  const ny = Math.max(8, y - r.height - 10);
  t.style.transform = `translate(${nx}px, ${ny}px)`;
}

// ---------------- Bilgi kartı (popup) ----------------
export function showCard(item, { onClose }) {
  const card = $('#card'), body = $('#card-body');
  body.textContent = '';
  const def = LAYER_BY_ID[item.layer];
  card.style.setProperty('--c', def?.color || '#e11d48');

  const head = el('div', 'card-head');
  head.append(el('span', 'chip', item.kind || def?.label || ''));
  if (item.date) head.append(el('span', 'chip ghost', 'Tarih: ' + item.date));
  if (item.ele) head.append(el('span', 'chip ghost', item.ele + ' m'));
  body.append(head);
  body.append(el('h2', 'card-title', item.name));
  if (item.name_en && item.name_en !== item.name) body.append(el('p', 'card-sub', item.name_en));

  if (item.wiki?.thumb && navigator.onLine) {
    const img = el('img', 'card-img');
    img.loading = 'lazy'; img.alt = ''; img.src = item.wiki.thumb;
    img.onerror = () => img.remove();
    body.append(img);
  }
  if (item.note) {
    const n = el('div', 'card-note');
    n.append(el('b', null, 'Rehber notu'), el('p', null, item.note));
    body.append(n);
  }
  if (item.wiki?.text) {
    body.append(el('p', 'card-text', item.wiki.text));
    body.append(el('p', 'card-src', item.wiki.lang === 'tr' ? 'Kaynak: Vikipedi' : `Kaynak: Vikipedi (${item.wiki.lang})`));
  }
  if (item.desc) body.append(el('p', 'card-text', item.desc));
  if (item.inscription) body.append(el('p', 'card-text quote', item.inscription));
  if (!item.wiki?.text && !item.desc && !item.note && !item.inscription) {
    body.append(el('p', 'card-text muted', 'Bu nokta için kayıtlı açıklama yok. data/curated.js dosyasına rehber notu ekleyebilirsiniz.'));
  }

  const meta = el('dl', 'card-meta');
  const addMeta = (k, v) => { if (v) { meta.append(el('dt', null, k), el('dd', null, v)); } };
  addMeta('Mimar', item.architect);
  addMeta('Ziyaret', item.hours);
  addMeta('Koordinat', item.lat != null ? `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}` : '');
  if (meta.childNodes.length) body.append(meta);

  const links = el('div', 'card-links');
  const link = (txt, href) => { const a = el('a', 'btn', txt); a.href = href; a.target = '_blank'; a.rel = 'noopener'; links.append(a); };
  if (item.lat != null) link('Yol tarifi', `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lon}`);
  if (item.wiki?.url) link('Vikipedi', item.wiki.url);
  if (item.web && /^https?:\/\//.test(item.web)) link('Web sitesi', item.web);
  if (item.id && /^[nwr]\d+$/.test(item.id)) {
    const type = { n: 'node', w: 'way', r: 'relation' }[item.id[0]];
    link('OSM', `https://www.openstreetmap.org/${type}/${item.id.slice(1)}`);
  }
  if (links.childNodes.length) body.append(links);

  card.hidden = false;
  requestAnimationFrame(() => card.classList.add('show'));
  $('#card-close').onclick = () => { hideCard(); onClose?.(); };
  body.scrollTop = 0;
}

export function hideCard() {
  const card = $('#card');
  card.classList.remove('show');
  setTimeout(() => { if (!card.classList.contains('show')) card.hidden = true; }, 220);
}

export function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.classList.remove('show'); setTimeout(() => (t.hidden = true), 300); }, ms);
}

export function setLoading(text, done = false) {
  const l = $('#loader');
  if (done) { l.classList.add('done'); setTimeout(() => l.remove(), 600); return; }
  $('#loader-text').textContent = text;
}

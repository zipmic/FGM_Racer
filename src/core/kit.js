import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// Shared geometry/material factory with caching, so 17 vehicles + the world reuse GPU resources.

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough ?? 0.6,
      metalness: opts.metal ?? 0.05,
      flatShading: opts.flat ?? false,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.ei ?? 1,
      transparent: opts.opacity !== undefined && opts.opacity < 1,
      opacity: opts.opacity ?? 1,
      side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: opts.depthWrite ?? true,
    });
    matCache.set(key, m);
  }
  return m;
}
/** Unique (non-cached) material for things whose color/emissive animates. */
export function umat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.6,
    metalness: opts.metal ?? 0.05,
    flatShading: opts.flat ?? false,
    emissive: opts.emissive ?? '#000000',
    emissiveIntensity: opts.ei ?? 1,
    transparent: opts.opacity !== undefined && opts.opacity < 1,
    opacity: opts.opacity ?? 1,
    side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
  });
}
export function glow(color, intensity = 2) {
  return mat(color, { emissive: color, ei: intensity, rough: 0.4 });
}

const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}
export const G = {
  box: (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  rbox: (w, h, d, r = 0.2, seg = 3) =>
    cached(`rb${w},${h},${d},${r},${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999)),
  cyl: (rt, rb, h, seg = 16, open = false) => cached(`c${rt},${rb},${h},${seg},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)),
  sphere: (r, ws = 16, hs = 12) => cached(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs)),
  hemi: (r, ws = 16) => cached(`h${r},${ws}`, () => new THREE.SphereGeometry(r, ws, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
  cone: (r, h, seg = 12) => cached(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)),
  torus: (r, t, rs = 8, ts = 20, arc = Math.PI * 2) => cached(`t${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)),
  capsule: (r, l, cs = 6, rs = 12) => cached(`p${r},${l}`, () => new THREE.CapsuleGeometry(r, l, cs, rs)),
  ico: (r, d = 0) => cached(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  dodeca: (r) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0)),
  plane: (w, h) => cached(`pl${w},${h}`, () => new THREE.PlaneGeometry(w, h)),
  ring: (ri, ro, seg = 24) => cached(`r${ri},${ro},${seg}`, () => new THREE.RingGeometry(ri, ro, seg)),
  circle: (r, seg = 24) => cached(`ci${r},${seg}`, () => new THREE.CircleGeometry(r, seg)),
};

/** Create a mesh, add it to parent, set position/rotation/scale. */
export function mk(geo, material, parent, p = [0, 0, 0], r = [0, 0, 0], s = null) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(p[0], p[1], p[2]);
  m.rotation.set(r[0], r[1], r[2]);
  if (s !== null) {
    if (typeof s === 'number') m.scale.setScalar(s);
    else m.scale.set(s[0], s[1], s[2]);
  }
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
export function grp(parent, p = [0, 0, 0], r = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  g.rotation.set(r[0], r[1], r[2]);
  if (parent) parent.add(g);
  return g;
}

/** Canvas texture with text, used for banners, screens, signs and holograms. */
export function textCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.canvas = c;
  tex.userData.ctx = ctx;
  return tex;
}

export function bannerTexture(text, { bg = '#16161d', fg = '#ffffff', accent = '#ff3e7f', w = 1024, h = 192, font = 'Impact, "Arial Black", sans-serif', stripes = false } = {}) {
  return textCanvas(w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (stripes) {
      const sz = h / 4;
      for (let x = 0; x < w; x += sz) {
        for (let y = 0; y < h; y += sz) {
          if (((x + y) / sz) % 2 === 0) { ctx.fillStyle = '#111'; ctx.fillRect(x, y, sz, sz); }
          else { ctx.fillStyle = '#f4f4f4'; ctx.fillRect(x, y, sz, sz); }
        }
      }
    }
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.08);
    ctx.fillRect(0, h * 0.92, w, h * 0.08);
    ctx.font = `${Math.floor(h * 0.62)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = h * 0.06;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, w / 2, h * 0.53);
    ctx.fillStyle = fg;
    ctx.fillText(text, w / 2, h * 0.53);
  });
}

export function checkerTexture(n = 8, a = '#111', b = '#f2f2f2') {
  return textCanvas(256, 256, (ctx) => {
    const s = 256 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      ctx.fillStyle = (i + j) % 2 ? a : b;
      ctx.fillRect(i * s, j * s, s, s);
    }
  });
}

export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  return textCanvas(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  });
}

export function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; }
  });
  return obj;
}

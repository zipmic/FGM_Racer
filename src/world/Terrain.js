import * as THREE from 'three';
import { smooth, hash, lerp, clamp } from '../core/math.js';
import { ROAD_HALF, QUARRY_CENTER, TUNNEL_CENTER } from './Track.js';

export const WATER_LEVEL = -14;

// Path the winner takes after the finish line: past the grandstands, through the
// parking lot, out of the gate and on towards the horizon.
export const ESCAPE_POINTS = [
  [0, 3], [150, 3], [300, 2], [440, 0], [560, 0], [660, 0], [820, 12], [1100, 40], [1500, 70],
  [2100, 30], [2800, -90], [3600, -160], [4600, -60], [5800, 120], [7200, 60], [8800, -120],
  [10600, 40], [12800, 180], [15500, 60], [18500, -80], [22000, 60], [26000, 0],
];

const RIVER = [
  [-60, -6000], [-160, -2600], [-215, -1300], [-245, -650], [-250, -318], [-275, -215], [-320, -160],
];
const LAKE = { x: -340, z: -150, r: 62 };

function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const h = (a, b) => (hash(a, b, seed) / 4294967296) * 2 - 1;
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, z, oct, seed) {
  let amp = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valueNoise(x * f, z * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

function distToPolyline(x, z, pts) {
  let best = Infinity, bestT = 0, acc = 0, along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const L = Math.sqrt(L2);
    let t = ((x - ax) * dx + (z - az) * dz) / L2;
    t = clamp(t);
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) { best = d; bestT = acc + t * L; }
    acc += L;
  }
  along = bestT;
  return { d: Math.sqrt(best), along };
}

function buildAxis(center, coreHalf, coreStep, growth, extent) {
  const pos = [];
  for (let v = 0; v <= coreHalf + 1e-6; v += coreStep) pos.push(v);
  let step = coreStep, v = pos[pos.length - 1];
  while (v < extent) {
    step *= growth;
    v += step;
    pos.push(v);
  }
  const neg = pos.slice(1).map((p) => -p).reverse();
  return Float64Array.from([...neg, ...pos].map((p) => p + center));
}

export class Terrain {
  constructor(track) {
    this.track = track;
    this.escapeCurve = new THREE.CatmullRomCurve3(
      ESCAPE_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal'
    );
    this.escapeCurve.arcLengthDivisions = 8000;
    this.escapeLength = this.escapeCurve.getLength();
    // polyline for distance queries
    this.escapePoly = this.escapeCurve.getSpacedPoints(400).map((p) => [p.x, p.z]);

    this.xs = buildAxis(-250, 1300, 10, 1.075, 32000);
    this.zs = buildAxis(-150, 1300, 10, 1.075, 32000);
    this.nx = this.xs.length;
    this.nz = this.zs.length;
    this.h = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.h[j * this.nx + i] = this.computeHeight(this.xs[i], this.zs[j]);
      }
    }
    this._buildEscapeTable();
  }

  natural(x, z) {
    const r = Math.hypot(x + 250, z + 150);
    const amp = 5 + smooth((r - 600) / 2600) * 80 + smooth((r - 5000) / 9000) * 520;
    let h = fbm(x * 0.0016, z * 0.0016, 4, 11) * amp;
    // ridged mountains far away
    const ridge = 1 - Math.abs(fbm(x * 0.00028, z * 0.00028, 3, 77));
    h += ridge * ridge * smooth((r - 7000) / 9000) * 900;
    h += 6 * smooth((r - 400) / 1500);
    return h;
  }

  computeHeight(x, z) {
    let h = this.natural(x, z);

    // Tunnel mountain
    const tm = Math.hypot(x - TUNNEL_CENTER.x, z - TUNNEL_CENTER.y);
    if (tm < 200) h += 62 * Math.pow(Math.cos((tm / 200) * Math.PI * 0.5), 2);

    // River + infield lake
    const rv = distToPolyline(x, z, RIVER).d;
    if (rv < 90) h = lerp(-24, h, smooth((rv - 22) / 60));
    const lk = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (lk < LAKE.r + 50) h = lerp(-24, h, smooth((lk - LAKE.r) / 50));

    // Quarry inside turn 1 (the AI's "genius shortcut")
    const q = Math.hypot(x - QUARRY_CENTER.x, z - QUARRY_CENTER.y);
    if (q < 64) h = lerp(-42, Math.min(h, 1), smooth((q - 48) / 14));

    // Escape valley towards the horizon
    if (x > 300) {
      const { d } = distToPolyline(x, z, this.escapePoly);
      const W = 70 + 0.035 * x;
      const floor = 6 + 10 * Math.sin(x / 420) * smooth((x - 750) / 400) + 26 * (0.5 + 0.5 * Math.sin(x / 1300 + 1)) * smooth((x - 900) / 600);
      h = lerp(floor * smooth((x - 650) / 300), h, smooth((d - W) / (W * 1.5)));
    }

    // Flat areas: start/finish straight surroundings, run-off and parking lot
    const flatRect = (x0, x1, z0, z1, blend, target = 0) => {
      const dx = Math.max(x0 - x, 0, x - x1);
      const dz = Math.max(z0 - z, 0, z - z1);
      const d = Math.hypot(dx, dz);
      if (d < blend) h = lerp(target, h, smooth(d / blend));
    };
    flatRect(-760, 240, -95, 140, 60);
    flatRect(240, 720, -38, 95, 45);

    // Flatten under the track
    const near = this.track.nearest(x, z, 2);
    if (near) {
      const d = Math.sqrt(near.d2);
      const i = near.i;
      const flag = this.track.flags[i];
      const ty = this.track.pos[i * 3 + 1];
      if (flag === 2) {
        // tunnel: narrow steep cut, tube + rocks sit in it
        if (d < 30) h = lerp(ty - 0.3, h, smooth((d - 18) / 12));
      } else if (flag === 1) {
        h = Math.min(h, lerp(ty - 4, h, smooth((d - 14) / 30)));
      } else if (d < 17 + 55) {
        h = lerp(ty - 0.3, h, smooth((d - ROAD_HALF - 3) / 55));
      }
    }
    return h;
  }

  _findCell(arr, v) {
    let lo = 0, hi = arr.length - 1;
    if (v <= arr[0]) return 0;
    if (v >= arr[hi]) return hi - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= v) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Exact height of the rendered (triangulated) terrain at (x, z). */
  heightAt(x, z) {
    const i = this._findCell(this.xs, x), j = this._findCell(this.zs, z);
    const x0 = this.xs[i], x1 = this.xs[i + 1], z0 = this.zs[j], z1 = this.zs[j + 1];
    const u = clamp((x - x0) / (x1 - x0)), v = clamp((z - z0) / (z1 - z0));
    const nx = this.nx;
    const a = this.h[j * nx + i], b = this.h[j * nx + i + 1];
    const c = this.h[(j + 1) * nx + i], d = this.h[(j + 1) * nx + i + 1];
    // triangles: (a, b, c) and (b, d, c) — diagonal from b to c
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  groundAt(x, z) {
    return Math.max(this.heightAt(x, z) + 0.3, WATER_LEVEL);
  }

  buildMesh() {
    const nx = this.nx, nz = this.nz;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 3);
    const c = new THREE.Color();
    const grassA = new THREE.Color('#6fae3c'), grassB = new THREE.Color('#4e8f30'), grassC = new THREE.Color('#9cc24a');
    const sand = new THREE.Color('#d8c48a'), rock = new THREE.Color('#8a8378'), snow = new THREE.Color('#f4f6fb');
    const dark = new THREE.Color('#3d6a2a'), quarry = new THREE.Color('#a39b8c');
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = this.xs[i], z = this.zs[j], y = this.h[k];
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        const n = fbm(x * 0.01, z * 0.01, 2, 5) * 0.5 + 0.5;
        c.copy(grassA).lerp(grassB, n).lerp(grassC, clamp(fbm(x * 0.003, z * 0.003, 2, 9) * 0.8));
        // slope
        const i2 = Math.min(i + 1, nx - 1), j2 = Math.min(j + 1, nz - 1);
        const sx = (this.h[j * nx + i2] - y) / Math.max(1, this.xs[i2] - x);
        const sz = (this.h[j2 * nx + i] - y) / Math.max(1, this.zs[j2] - z);
        const slope = Math.hypot(sx, sz);
        if (slope > 0.55) c.lerp(rock, smooth((slope - 0.55) / 0.5));
        if (y < WATER_LEVEL + 4) c.lerp(sand, smooth((WATER_LEVEL + 4 - y) / 4));
        if (y > 330) c.lerp(snow, smooth((y - 330) / 120));
        if (Math.hypot(x - QUARRY_CENTER.x, z - QUARRY_CENTER.y) < 60) c.lerp(quarry, 0.85);
        if (y > 120 && y < 330) c.lerp(dark, 0.35);
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
        idx[p++] = a; idx[p++] = cc; idx[p++] = b;
        idx[p++] = b; idx[p++] = cc; idx[p++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'terrain';
    return mesh;
  }

  // ---- escape path (distance → position on terrain) ----
  _buildEscapeTable() {
    const n = Math.ceil(this.escapeLength / 4);
    this.escN = n;
    this.escStep = this.escapeLength / n;
    this.escPos = new Float32Array((n + 1) * 3);
    const p = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      this.escapeCurve.getPointAt(i / n, p);
      this.escPos[i * 3] = p.x;
      this.escPos[i * 3 + 2] = p.z;
    }
    // smoothed height following the terrain (so speed bumps look like hills, not jitter)
    const raw = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const x = this.escPos[i * 3], z = this.escPos[i * 3 + 2];
      raw[i] = this.groundAt(x, z) - 0.3;
    }
    for (let i = 0; i <= n; i++) {
      let s = 0, w = 0;
      for (let k = -3; k <= 3; k++) {
        const j = Math.min(n, Math.max(0, i + k));
        s += raw[j]; w++;
      }
      this.escPos[i * 3 + 1] = Math.max(raw[i], s / w);
    }
  }

  escapeFrame(d, out) {
    const f = clamp(d / this.escStep, 0, this.escN - 1e-4);
    const i = Math.floor(f), k = f - i;
    const P = this.escPos, a = i * 3, b = (i + 1) * 3;
    out.pos.set(P[a] + (P[b] - P[a]) * k, P[a + 1] + (P[b + 1] - P[a + 1]) * k, P[a + 2] + (P[b + 2] - P[a + 2]) * k);
    const extra = Math.max(0, d - this.escapeLength);
    const ia = Math.max(0, i - 1) * 3, ib = Math.min(this.escN, i + 2) * 3;
    out.tan.set(P[ib] - P[ia], P[ib + 1] - P[ia + 1], P[ib + 2] - P[ia + 2]).normalize();
    if (extra > 0) out.pos.addScaledVector(out.tan, extra);
    out.right.set(-out.tan.z, 0, out.tan.x).normalize();
    out.up.crossVectors(out.right, out.tan).normalize();
    out.curv = 0;
    return out;
  }
}

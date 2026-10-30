import * as THREE from 'three';

export const ROAD_HALF = 15;

// Closed racing loop. s = 0 is the start/finish line at the origin, the race runs towards +X.
// Final straight approaches from the west, turn 1 is a big left hairpin in the east,
// the back section has a hill, a bridge over the river, a chicane and a tunnel.
const CONTROL = [
  [0, 0, 0],
  [125, 0, 0],
  [250, 0, 0],
  [349, 0, -41],
  [390, 0, -140],
  [349, 0, -239],
  [250, 0, -280],
  [150, 2, -292],
  [40, 9, -318],
  [-80, 5, -326],
  [-170, 6, -318],
  [-250, 6, -318],
  [-330, 6, -318],
  [-430, 2, -292],
  [-515, 0, -338],
  [-600, 0, -300],
  [-685, 0, -336],
  [-770, 0, -326],
  [-835, 0, -284],
  [-858, 0, -215],
  [-862, 0, -140],
  [-850, 0, -72],
  [-815, 0, -22],
  [-760, 0, 0],
  [-640, 0, 0],
  [-480, 0, 0],
  [-320, 0, 0],
  [-160, 0, 0],
];

export const TUNNEL_CENTER = new THREE.Vector2(-858, -178);
export const QUARRY_CENTER = new THREE.Vector2(255, -140);
export const RIVER_X = -250;

export class Track {
  constructor() {
    const pts = CONTROL.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = 6000;
    this.length = this.curve.getLength();
    this.step = 2;
    this.n = Math.ceil(this.length / this.step);
    this.step = this.length / this.n;
    const n = this.n;
    this.pos = new Float32Array(n * 3);
    this.tan = new Float32Array(n * 3);
    this.right = new Float32Array(n * 3);
    this.up = new Float32Array(n * 3);
    this.curv = new Float32Array(n);
    this.flags = new Uint8Array(n); // 1 bridge, 2 tunnel
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3(), t = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3();
    const heading = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const uu = i / n;
      this.curve.getPointAt(uu, p);
      this.curve.getTangentAt(uu, t).normalize();
      r.crossVectors(t, up).normalize();
      u.crossVectors(r, t).normalize();
      p.toArray(this.pos, i * 3);
      t.toArray(this.tan, i * 3);
      r.toArray(this.right, i * 3);
      u.toArray(this.up, i * 3);
      heading[i] = Math.atan2(t.z, t.x);
      if (p.x < -175 && p.x > -330 && p.z < -250) this.flags[i] = 1;
      if (Math.hypot(p.x - TUNNEL_CENTER.x, p.z - TUNNEL_CENTER.y) < 70) this.flags[i] = 2;
    }
    for (let i = 0; i < n; i++) {
      let d = heading[(i + 2) % n] - heading[(i - 2 + n) % n];
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curv[i] = d / (4 * this.step);
    }
    // smooth curvature
    const c2 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -4; k <= 4; k++) s += this.curv[(i + k + n) % n];
      c2[i] = s / 9;
    }
    this.curv = c2;
    this.bridgeRange = this._range(1);
    this.tunnelRange = this._range(2);
    this._buildHash();
  }

  _range(flag) {
    let a = -1, b = -1;
    for (let i = 0; i < this.n; i++) {
      if (this.flags[i] === flag) {
        if (a < 0) a = i;
        b = i;
      }
    }
    return [a * this.step, b * this.step];
  }

  wrap(s) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Track frame at progress s. Writes into out = {pos, tan, right, up, curv} (Vector3s). */
  frame(s, out) {
    const f = this.wrap(s) / this.step;
    const i0 = Math.floor(f) % this.n;
    const i1 = (i0 + 1) % this.n;
    const k = f - Math.floor(f);
    const P = this.pos, T = this.tan, R = this.right, U = this.up;
    const a = i0 * 3, b = i1 * 3;
    out.pos.set(P[a] + (P[b] - P[a]) * k, P[a + 1] + (P[b + 1] - P[a + 1]) * k, P[a + 2] + (P[b + 2] - P[a + 2]) * k);
    out.tan.set(T[a] + (T[b] - T[a]) * k, T[a + 1] + (T[b + 1] - T[a + 1]) * k, T[a + 2] + (T[b + 2] - T[a + 2]) * k).normalize();
    out.right.set(R[a] + (R[b] - R[a]) * k, R[a + 1] + (R[b + 1] - R[a + 1]) * k, R[a + 2] + (R[b + 2] - R[a + 2]) * k).normalize();
    out.up.set(U[a] + (U[b] - U[a]) * k, U[a + 1] + (U[b + 1] - U[a + 1]) * k, U[a + 2] + (U[b + 2] - U[a + 2]) * k).normalize();
    out.curv = this.curv[i0] + (this.curv[i1] - this.curv[i0]) * k;
    return out;
  }

  makeFrame() {
    return { pos: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), curv: 0 };
  }

  point(s, lateral = 0, height = 0, out = new THREE.Vector3()) {
    const f = this.frame(s, this._tmpF || (this._tmpF = this.makeFrame()));
    return out.copy(f.pos).addScaledVector(f.right, lateral).addScaledVector(f.up, height);
  }

  _buildHash() {
    this.cell = 40;
    this.hashMap = new Map();
    for (let i = 0; i < this.n; i++) {
      const x = this.pos[i * 3], z = this.pos[i * 3 + 2];
      const key = (Math.floor(x / this.cell) + 500) * 1000 + Math.floor(z / this.cell) + 500;
      let arr = this.hashMap.get(key);
      if (!arr) this.hashMap.set(key, (arr = []));
      arr.push(i);
    }
  }

  /** nearest sample to (x, z) within ~2 cells; returns {i, d2} or null */
  nearest(x, z, range = 2) {
    if (x < -1000 || x > 520 || z < -480 || z > 140) return null;
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let dx = -range; dx <= range; dx++) {
      for (let dz = -range; dz <= range; dz++) {
        const arr = this.hashMap.get((cx + dx + 500) * 1000 + cz + dz + 500);
        if (!arr) continue;
        for (const i of arr) {
          const ex = this.pos[i * 3] - x, ez = this.pos[i * 3 + 2] - z;
          const d2 = ex * ex + ez * ez;
          if (d2 < bd) { bd = d2; best = i; }
        }
      }
    }
    return best < 0 ? null : { i: best, d2: bd, s: best * this.step };
  }
}

/** Start grid slot k (0 = pole). Three across, staggered rows behind the line. */
export function gridSlot(k) {
  const row = Math.floor(k / 3), col = k % 3;
  return { s: -12 - row * 11 - col * 2.2, lateral: [-8.5, 0, 8.5][col] };
}

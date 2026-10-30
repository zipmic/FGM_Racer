// Small deterministic math toolkit shared by every system.

export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, invLerp(a, b, v));
export const smooth = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
export const smoother = (t) => {
  t = clamp(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInCubic = (t) => Math.pow(clamp(t), 3);
export const easeInOutCubic = (t) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOutBack = (t) => {
  t = clamp(t);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  t = clamp(t);
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};
/** 0 → 1 → 0 bump over [a, b] with soft edges of width e */
export const window01 = (x, a, b, e = 0.15) => smooth((x - a) / e) * (1 - smooth((x - (b - e)) / e));

export const TAU = Math.PI * 2;

/** mulberry32 – tiny deterministic PRNG */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    h ^= (n * 2654435761) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Cheap smooth value noise (deterministic) */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = (hash(i, seed) / 4294967296) * 2 - 1;
  const b = (hash(i + 1, seed) / 4294967296) * 2 - 1;
  return lerp(a, b, f * f * (3 - 2 * f));
}

/**
 * 1D keyframe curve. keys: [[x, y], ...] sorted by x.
 * mode 'monotone' = Fritsch–Carlson monotone cubic (no overshoot, C1)
 * mode 'ease'     = smoothstep between keys (zero velocity at every key)
 * mode 'linear'
 */
export class Curve1D {
  constructor(keys, mode = 'monotone') {
    this.mode = mode;
    this.set(keys);
  }
  set(keys) {
    const k = keys.slice().sort((a, b) => a[0] - b[0]);
    // merge duplicates
    const xs = [], ys = [];
    for (const [x, y] of k) {
      if (xs.length && Math.abs(x - xs[xs.length - 1]) < 1e-6) ys[ys.length - 1] = y;
      else { xs.push(x); ys.push(y); }
    }
    this.xs = xs;
    this.ys = ys;
    const n = xs.length;
    this.m = new Array(n).fill(0);
    if (this.mode === 'monotone' && n > 1) {
      const d = [];
      for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
      this.m[0] = d[0];
      this.m[n - 1] = d[n - 2];
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) this.m[i] = 0;
        else {
          const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
          const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
          this.m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
        }
      }
    }
    return this;
  }
  at(x) {
    const xs = this.xs, ys = this.ys, n = xs.length;
    if (n === 0) return 0;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid; else hi = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    if (this.mode === 'linear') return lerp(ys[lo], ys[hi], t);
    if (this.mode === 'ease') return lerp(ys[lo], ys[hi], t * t * (3 - 2 * t));
    const t2 = t * t, t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h * this.m[lo] +
      (-2 * t3 + 3 * t2) * ys[hi] +
      (t3 - t2) * h * this.m[hi]
    );
  }
}

/** Uniformly sampled table y(x) for fast lookup of integrated quantities */
export class Table {
  constructor(x0, dx, values) {
    this.x0 = x0;
    this.dx = dx;
    this.v = values;
  }
  at(x) {
    const f = (x - this.x0) / this.dx;
    const n = this.v.length;
    if (f <= 0) return this.v[0];
    if (f >= n - 1) {
      // linear extrapolation from the last slope
      const slope = (this.v[n - 1] - this.v[n - 2]) / this.dx;
      return this.v[n - 1] + slope * (x - (this.x0 + (n - 1) * this.dx));
    }
    const i = Math.floor(f);
    return lerp(this.v[i], this.v[i + 1], f - i);
  }
  slope(x) {
    const h = this.dx;
    return (this.at(x + h) - this.at(x - h)) / (2 * h);
  }
}

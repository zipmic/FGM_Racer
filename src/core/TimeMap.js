import { Curve1D } from './math.js';

/**
 * Timeline Manager core: maps film time t (what the audience sees, seconds)
 * to story time τ (what the world simulates). Slow motion = rate < 1.
 * Rate keys are authored in film time and linearly interpolated.
 * Everything in the world is a pure function of τ, so seeking is free and
 * every playback is identical.
 */
export class TimeMap {
  constructor(rateKeys, duration) {
    this.duration = duration;
    this.rateCurve = new Curve1D(rateKeys.length ? rateKeys : [[0, 1]], 'linear');
    this.dt = 1 / 240;
    const n = Math.ceil((duration + 30) / this.dt) + 2;
    this.tauTable = new Float64Array(n);
    let tau = 0;
    for (let i = 0; i < n; i++) {
      this.tauTable[i] = tau;
      const t = i * this.dt;
      tau += 0.5 * (this.rate(t) + this.rate(t + this.dt)) * this.dt;
    }
  }
  rate(t) {
    return this.rateCurve.at(t);
  }
  tau(t) {
    if (t <= 0) return t;
    const f = t / this.dt;
    const i = Math.floor(f);
    const n = this.tauTable.length;
    if (i >= n - 1) return this.tauTable[n - 1] + (t - (n - 1) * this.dt);
    return this.tauTable[i] + (this.tauTable[i + 1] - this.tauTable[i]) * (f - i);
  }
  /** inverse map (τ is strictly increasing because rate > 0) */
  tOf(tau) {
    if (tau <= 0) return tau;
    const tbl = this.tauTable;
    let lo = 0, hi = tbl.length - 1;
    if (tau >= tbl[hi]) return hi * this.dt + (tau - tbl[hi]);
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tbl[mid] <= tau) lo = mid; else hi = mid;
    }
    const f = (tau - tbl[lo]) / Math.max(1e-9, tbl[hi] - tbl[lo]);
    return (lo + f) * this.dt;
  }
}

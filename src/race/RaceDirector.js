import * as THREE from 'three';
import { buildVehicle } from '../vehicles/designs.js';
import { clamp, smooth, lerp } from '../core/math.js';
import { ROAD_HALF } from '../world/Track.js';

/**
 * Race Director runtime: evaluates every racer's pose as a pure function of
 * story time, applies crashes, drives vehicle animation and reports standings.
 */
export class RaceDirector {
  constructor(plan, world, fx, scene) {
    this.plan = plan;
    this.world = world;
    this.track = world.track;
    this.terrain = world.terrain;
    this.fx = fx;
    this.root = new THREE.Group();
    this.root.name = 'racers';
    scene.add(this.root);
    this.models = plan.racers.map((r) => {
      const m = buildVehicle(r.type, r.color);
      m.wheelScale = r.type === 'scooter' ? 1.45 : 1;
      m.root.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
      this.root.add(m.root);
      return m;
    });
    this._F = this.track.makeFrame();
    this._F2 = this.track.makeFrame();
    this._m = new THREE.Matrix4();
    this._cacheTau = null;
    this._sArr = new Float64Array(plan.racers.length);
    this._lArr = new Float64Array(plan.racers.length);
    this.baseCache = new Map();
    this.ctx = plan.racers.map(() => null);
    fx.clear();
    this._setupCrashes();
    this._setupEmitters();
  }

  dispose() {
    this.root.parent?.remove(this.root);
  }

  // ------------------------------------------------------------------ pure pose functions
  isCrashed(i, tau) {
    const c = this.plan.racers[i].crash;
    return !!c && tau >= c.tau;
  }

  _fillPack(tau) {
    if (this._cacheTau === tau) return;
    this._cacheTau = tau;
    const p = this.plan;
    for (let i = 0; i < p.racers.length; i++) {
      this._sArr[i] = p.progress(i, tau);
      this._lArr[i] = p.lateral(i, tau);
    }
  }

  repel(i, tau) {
    this._fillPack(tau);
    const p = this.plan;
    const si = this._sArr[i], li = this._lArr[i];
    const wi = this.models[i].W;
    let push = 0;
    for (let j = 0; j < p.racers.length; j++) {
      if (j === i || this.isCrashed(j, tau)) continue;
      const ds = this._sArr[j] - si;
      const reach = (this.models[i].L + this.models[j].L) * 0.5 + 1.5;
      if (Math.abs(ds) > reach) continue;
      const dl = li - this._lArr[j];
      const need = (wi + this.models[j].W) * 0.5 + 0.8;
      if (Math.abs(dl) >= need) continue;
      const w = 1 - Math.abs(ds) / reach;
      const dir = dl !== 0 ? Math.sign(dl) : i < j ? -1 : 1;
      push += dir * (need - Math.abs(dl)) * 0.55 * smooth(w * 1.5);
    }
    return push;
  }

  /** Racing pose (not crashed) at story time tau. */
  racingPose(i, tau, out = {}) {
    const p = this.plan;
    out.pos = out.pos || new THREE.Vector3();
    out.quat = out.quat || new THREE.Quaternion();
    out.f = out.f || new THREE.Vector3();
    out.r = out.r || new THREE.Vector3();
    out.u = out.u || new THREE.Vector3();
    const h = 0.02;
    const s = p.progress(i, tau);
    const sA = p.progress(i, tau - h), sB = p.progress(i, tau + h);
    const lBase = p.lateral(i, tau);
    const lat = clamp(lBase + (tau > p.tauGO - 0.5 ? this.repel(i, tau) : 0), -ROAD_HALF + 1.5, ROAD_HALF - 1.5);
    const dl = p.lateral(i, tau + h) - p.lateral(i, tau - h);
    const ds = Math.max(0.0001, sB - sA);
    const F = this._F;
    const escape = p.ending === 'escape' && i === p.W && s > p.L;
    if (escape) {
      this.terrain.escapeFrame(s - p.L, F);
      const fade = 1 - smooth((s - p.L) / 60);
      out.pos.copy(F.pos).addScaledVector(F.right, (lat - 3) * fade);
    } else {
      this.track.frame(s, F);
      out.pos.copy(F.pos).addScaledVector(F.right, lat);
    }
    const yaw = Math.atan2(dl, ds);
    out.f.copy(F.tan).multiplyScalar(Math.cos(yaw)).addScaledVector(F.right, Math.sin(yaw)).normalize();
    out.u.copy(F.up);
    out.r.crossVectors(out.f, out.u).normalize();
    out.quat.setFromRotationMatrix(this._m.makeBasis(out.f, out.u, out.r));
    out.s = s;
    out.lat = lat;
    out.speed = ds / (2 * h);
    out.curv = F.curv;
    out.trackTan = out.trackTan || new THREE.Vector3();
    out.trackTan.copy(F.tan);
    out.trackRight = out.trackRight || new THREE.Vector3();
    out.trackRight.copy(F.right);
    out.escape = escape;
    return out;
  }

  crashBase(i) {
    let b = this.baseCache.get(i);
    if (!b) {
      const c = this.plan.racers[i].crash;
      b = this.racingPose(i, c.tau, {});
      b.quat = b.quat.clone();
      this.baseCache.set(i, b);
    }
    return b;
  }

  /** World root pose of racer i at crash age `age` (works before and after onset). */
  rootAt(i, age) {
    const c = this.plan.racers[i].crash;
    const ctx = this.ctx[i];
    if (!c || age < 0 || !ctx) {
      const r = this.racingPose(i, (c ? c.tau : 0) + age, {});
      return { pos: r.pos.clone(), quat: r.quat.clone() };
    }
    const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    c.def.pose(ctx, age, out);
    return out;
  }

  /** Any-time pose: racing or crashed. */
  poseAt(i, tau, out = {}) {
    const c = this.plan.racers[i].crash;
    if (c && tau >= c.tau) {
      const r = this.rootAt(i, tau - c.tau);
      out.pos = (out.pos || new THREE.Vector3()).copy(r.pos);
      out.quat = (out.quat || new THREE.Quaternion()).copy(r.quat);
      const b = this.crashBase(i);
      out.f = (out.f || new THREE.Vector3()).copy(b.f);
      out.r = (out.r || new THREE.Vector3()).copy(b.r);
      out.u = (out.u || new THREE.Vector3()).copy(b.u);
      out.trackTan = (out.trackTan || new THREE.Vector3()).copy(b.f);
      out.trackRight = (out.trackRight || new THREE.Vector3()).copy(b.r);
      out.s = b.s;
      out.speed = 0;
      out.crashed = true;
      return out;
    }
    this.racingPose(i, tau, out);
    out.crashed = false;
    return out;
  }

  // ------------------------------------------------------------------ setup
  _setupCrashes() {
    const p = this.plan;
    const W = this.world;
    W.clearProps();
    const tm = p.timeMap;
    const extraEvents = [];
    p.racers.forEach((r, i) => {
      if (!r.crash) return;
      const c = r.crash;
      const ctx = {
        i,
        racer: r,
        model: this.models[i],
        plan: p,
        world: W,
        fx: this.fx,
        director: this,
        tauC: c.tau,
        tC: c.t,
        explodeAge: c.explodeAge,
        rams: c.rams !== undefined,
        at: (storyOffset) => tm.tOf(c.tau + storyOffset),
        ground: (x, z) => this.terrain.groundAt(x, z),
        rootAt: (age) => this.rootAt(i, age),
      };
      Object.defineProperty(ctx, 'base', { get: () => this.crashBase(i) });
      this.ctx[i] = ctx;
    });
    // second pass: setup needs every context to exist (rams look at each other)
    p.racers.forEach((r, i) => {
      const ctx = this.ctx[i];
      if (!ctx) return;
      if (r.crash.rammedBy !== undefined) {
        const other = p.racers[r.crash.rammedBy];
        ctx.rammedAt = other.crash.tau - r.crash.tau;
      }
      r.crash.def.setup?.(ctx);
      if (ctx.events) extraEvents.push(...ctx.events);
    });
    p.allEvents = [...p.events, ...extraEvents].sort((a, b) => a.t - b.t);
    this._buildShots();
  }

  _buildShots() {
    const p = this.plan;
    const out = [...p.shots];
    for (const bk of p.crashBlocks) {
      const ctx = this.ctx[bk.i];
      const r = p.racers[bk.i];
      // the authored shots cover the crash itself; the linger after it gets a calm look at the wreck
      // (a chain reaction keeps its wide two-racer shot instead)
      const tEnd = bk.follower !== undefined ? bk.t1 : bk.t1 - bk.linger;
      let list = (r.crash.def.shots?.(ctx) || []).map((s) => ({ ...s }));
      if (bk.follower !== undefined) {
        // one wide shot keeps both racers of a chain reaction in frame
        const keep = list.filter((s) => s.t1 <= r.crash.t + 0.05);
        list = [...keep, { t0: r.crash.t - 0.05, t1: tEnd, kind: 'baseCam', racer: bk.i, racer2: bk.follower, cam: [[34, 22, 7], [36, 24, 9]], look: 'pair', fov: 52 }];
      }
      list = list.filter((s) => s.t1 > bk.t0 + 0.05 && s.t0 < tEnd - 0.05);
      list.sort((a, b) => a.t0 - b.t0);
      if (!list.length) list = [{ t0: bk.t0, t1: tEnd, kind: 'follow', racer: bk.i, offset: [[-9, 4, 3.5]], look: [0, 0, 1.5], fov: 48 }];
      list[0].t0 = bk.t0;
      list[list.length - 1].t1 = tEnd;
      for (let k = 0; k < list.length; k++) {
        list[k].t0 = Math.max(list[k].t0, bk.t0);
        list[k].t1 = Math.min(list[k].t1, tEnd);
        if (k > 0) list[k].t0 = list[k - 1].t1;
      }
      out.push(...list.filter((s) => s.t1 > s.t0 + 0.02));
      if (tEnd < bk.t1) out.push({ t0: tEnd, t1: bk.t1, kind: 'wreck', racer: bk.i, fov: 44 });
    }
    // fillers
    const F0 = p.F0;
    for (const f of p.fillers) {
      if (Math.abs(f.t0 - F0) < 0.6 || (f.t0 <= F0 + 0.3 && f.t1 > F0 + 1)) {
        const five = [p.R, p.W, ...p.final5];
        const mid = Math.min(f.t1, f.t0 + 1.7);
        out.push({ t0: f.t0, t1: mid, kind: 'aerial', racers: five, height: 30, back: 34, fov: 50 });
        const e3 = p.final5[p.final5.length - 1] ?? p.R;
        if (f.t1 > mid + 0.2) out.push({ t0: mid, t1: f.t1, kind: 'follow', racer: e3, offset: [[1, 8.5, 1.5], [-1.5, 8.5, 1.8]], look: [0, -2, 1.2], fov: 46 });
        continue;
      }
      const target = f.t0 > F0 ? p.W : f.racer;
      out.push({ ...f, kind: 'filler', racer: f.t0 > F0 ? p.W : target, style: f.t0 > F0 ? 'wclose' : f.style });
    }
    out.sort((a, b) => a.t0 - b.t0);
    // make consecutive (no gaps): stretch each shot to the next one's start
    for (let k = 0; k < out.length - 1; k++) {
      if (out[k].t1 === 0 || out[k].t1 < out[k + 1].t0) out[k].t1 = out[k + 1].t0;
      if (out[k].t1 > out[k + 1].t0) out[k].t1 = out[k + 1].t0;
    }
    p.finalShots = out.filter((s) => s.t1 > s.t0);
  }

  _setupEmitters() {
    const p = this.plan;
    const fx = this.fx;
    const tauEnd = p.timeMap.tau(p.duration);
    p.racers.forEach((r, i) => {
      if (r.type === 'monster') return;
      const end = r.crash ? r.crash.tau : tauEnd;
      const m = this.models[i];
      fx.emit({
        kind: 'dust', t0: p.tauGO + 0.2, t1: end, rate: i === p.W ? 6 : 9, count: 1, life: 0.8, scale: i === p.W ? 0.5 : 1,
        origin: (ts) => { const q = this.racingPose(i, ts, {}); return q.pos.addScaledVector(q.f, -m.L * 0.45).addScaledVector(q.u, 0.4); },
        vel: (rr, ts, v) => v.set((rr() - 0.5) * 3, 1 + rr() * 1.5, (rr() - 0.5) * 3),
      });
    });
    const W = p.W;
    if (p.special) {
      const T = p.T;
      const tl = p.timeMap.tau(T.launch);
      const wheelsAt = (ts) => { const q = this.racingPose(W, ts, {}); return q.pos.addScaledVector(q.u, 0.3); };
      fx.emit({ kind: 'spark', t0: p.timeMap.tau(T.hack + 5.0), t1: tl, rate: 140, count: 2, life: 0.35, origin: wheelsAt, vel: (rr, ts, v) => v.set((rr() - 0.5) * 6, 1 + rr() * 5, (rr() - 0.5) * 6) });
      fx.emit({ kind: 'energy', t0: p.timeMap.tau(T.hack + 5.2), t1: tl, rate: 120, count: 1, life: 0.5, origin: (ts) => { const q = this.racingPose(W, ts, {}); return q.pos.addScaledVector(q.u, 1.5); }, vel: (rr, ts, v) => v.set((rr() - 0.5) * 8, (rr() - 0.5) * 8, (rr() - 0.5) * 8) });
      fx.emit({ kind: 'energy', t0: tl, t1: tauEnd, rate: 90, count: 2, life: 0.45, origin: wheelsAt, vel: (rr, ts, v) => v.set((rr() - 0.5) * 2, rr() * 2, (rr() - 0.5) * 2) });
      fx.emit({ kind: 'spark', t0: tl, t1: p.timeMap.tau(p.tCross + 1), rate: 120, count: 2, life: 0.35, origin: wheelsAt, vel: (rr, ts, v) => v.set((rr() - 0.5) * 10, 1 + rr() * 6, (rr() - 0.5) * 10) });
      fx.emit({ kind: 'whiteSmoke', t0: tl, count: 40, life: 1.2, scale: 0.8, origin: () => wheelsAt(tl), vel: (rr, ts, v) => v.set((rr() - 0.5) * 16, rr() * 4, (rr() - 0.5) * 16) });
    } else if (p.ending === 'escape') {
      const tc = p.tauCross;
      fx.emit({ kind: 'energy', t0: tc, t1: tauEnd, rate: 90, count: 2, life: 0.45, origin: (ts) => this.racingPose(W, ts, {}).pos, vel: (rr, ts, v) => v.set((rr() - 0.5) * 2, rr() * 2, (rr() - 0.5) * 2) });
    }
    // finish celebration: confetti cannons, confetti rain, fireworks
    const tc = p.timeMap.tau(p.tCross + 0.15);
    for (const side of [-1, 1]) {
      fx.emit({ kind: 'confetti', t0: tc, count: 340, life: 4.0, origin: () => new THREE.Vector3(0, 12, side * (ROAD_HALF + 3)), vel: (rr, ts, v) => v.set(6 + rr() * 14, 8 + rr() * 16, -side * (4 + rr() * 16)) });
    }
    fx.emit({ kind: 'confetti', t0: tc + 0.3, t1: tc + 9, rate: 25, count: 6, life: 4.5, origin: (ts, k) => new THREE.Vector3(-40 + ((k * 37) % 160), 30, -20 + ((k * 53) % 50)), vel: (rr, ts, v) => v.set((rr() - 0.5) * 6, -2, (rr() - 0.5) * 6) });
    const fwCols = [['#ff4d6d', '#ffd23f'], ['#3a86ff', '#bff6ff'], ['#06d6a0', '#ffffff'], ['#bf5af2', '#ff77c8']];
    for (let k = 0; k < 8; k++) {
      const t0 = tc + 0.6 + k * 0.45;
      const o = new THREE.Vector3(-120 + k * 45, 70 + (k % 3) * 18, -70 - (k % 2) * 40);
      fx.emit({ kind: 'spark', t0, count: 90, life: 1.6, g: 6, drag: 1.4, scale: 4, color: fwCols[k % 4], origin: () => o, vel: (rr, ts, v) => v.set(rr() - 0.5, rr() - 0.5, rr() - 0.5).normalize().multiplyScalar(30 + rr() * 8) });
    }
  }

  // ------------------------------------------------------------------ per-frame
  evaluate(t, tau, camera) {
    const p = this.plan;
    const tmp = this._tmpPose || (this._tmpPose = {});
    const standings = [];
    for (let i = 0; i < p.racers.length; i++) {
      const r = p.racers[i];
      const m = this.models[i];
      const c = r.crash;
      const ctx = this.ctx[i];
      const age = c ? tau - c.tau : -Infinity;
      let sp = p.specials[i] ? { ...(p.specials[i](t) || {}) } : {};
      let racing = true;
      let s = 0, speed = 0, curv = 0;
      let scale = null, hidden = false;
      if (c && age >= 0) {
        racing = false;
        const out = { pos: m.root.position, quat: m.root.quaternion, special: null, scale: null, hidden: false };
        c.def.pose(ctx, age, out);
        if (out.special) sp = { ...sp, ...out.special };
        scale = out.scale;
        hidden = out.hidden;
        const b = this.crashBase(i);
        s = b.s;
        speed = Math.max(0, b.speed * (1 - age * 1.5));
        standings.push({ i, s: b.s, out: true, outAge: t - c.t });
      } else {
        const q = this.racingPose(i, tau, tmp);
        m.root.position.copy(q.pos);
        m.root.quaternion.copy(q.quat);
        s = q.s;
        speed = q.speed;
        curv = q.curv;
        if (c && age >= -(c.def.lead ?? 0)) c.def.pre?.(ctx, age, sp);
        standings.push({ i, s, out: false });
      }
      m.root.visible = !hidden;
      if (scale) m.root.scale.copy(scale); else m.root.scale.set(1, 1, 1);
      // wheels
      const dist = racing ? s : (c ? this.crashBase(i).s + Math.min(age, 1) * 4 : s);
      for (const w of m.wheels) w.spin.rotation.z = -dist / (w.r * m.wheelScale);
      // lean + suspension
      const lean = clamp(curv * speed * speed * 0.00055, -0.14, 0.14);
      const isScooter = r.type === 'scooter';
      m.body.rotation.x = racing ? (isScooter ? lean * 1.6 : -lean * 0.6) + Math.sin(t * 2.1 + i) * 0.01 * (isScooter ? 3 : 0) : 0;
      m.body.position.y = racing && tau > p.tauGO ? Math.abs(Math.sin(s * 0.35 + i * 1.7)) * 0.05 * clamp(speed / 40) : 0;
      if (!racing || tau <= p.tauGO) m.body.rotation.z = 0;
      else m.body.rotation.z = Math.sin(s * 0.21 + i) * 0.012;
      // idle revving before GO
      if (tau < p.tauGO && !isScooter) m.body.position.y = Math.abs(Math.sin(t * 31 + i)) * 0.04;
      m.update({ t, tau, speed, dist, racing, special: sp, camera, crashAge: age });
      if (c && c.def.parts) {
        m.root.updateMatrixWorld(true);
        c.def.parts(ctx, age);
      }
    }
    standings.sort((a, b) => b.s - a.s);
    return standings;
  }

  /** Recent winner positions (newest first) for the energy trail. */
  trailPoints(tau, count = 90, span = 1.4) {
    const pts = [];
    const tmp = {};
    for (let k = 0; k < count; k++) {
      const ta = tau - (k / (count - 1)) * span;
      const q = this.racingPose(this.plan.W, ta, tmp);
      pts.push(q.pos.clone().addScaledVector(q.u, 0.6));
    }
    return pts;
  }
}

import * as THREE from 'three';
import { clamp, smooth, lerp, noise1, easeInOutCubic, easeInCubic } from '../core/math.js';

/**
 * Camera Director: picks the active shot for film time t and evaluates it.
 * Every shot is a pure function of t, so cuts, pans and zooms are identical
 * on every playback and survive seeking.
 */
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class CameraDirector {
  constructor(plan, director, world, sm) {
    this.plan = plan;
    this.D = director;
    this.world = world;
    this.sm = sm;
    this.camera = sm.camera;
    this.shots = plan.finalShots;
    this._pose = {};
    this._pose2 = {};
    this._fr = world.track.makeFrame();
    this.focus = new THREE.Vector3();
    this.blur = 0;
    this.speedLines = 0;
    this.current = null;
    // pre-build path curves
    for (const s of this.shots) {
      if (s.kind === 'path') {
        s.posCurve = new THREE.CatmullRomCurve3(s.points.map(V), false, 'centripetal');
        s.lookCurve = new THREE.CatmullRomCurve3(s.looks.map(V), false, 'centripetal');
      }
    }
  }

  shotAt(t) {
    const sh = this.shots;
    let lo = 0, hi = sh.length - 1, best = sh[0];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sh[mid].t0 <= t) { best = sh[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  _racer(i, tau) {
    return this.D.poseAt(i, tau, (this._pose[i] ||= {}));
  }

  /** frame = racer pose with stable track-aligned axes */
  _frameOf(i, tau) {
    const q = this._racer(i, tau);
    const f = q.crashed ? q.f : q.trackTan;
    const r = q.crashed ? q.r : q.trackRight;
    return { p: q.pos, f, r, u: new THREE.Vector3(0, 1, 0), q };
  }

  _local(fr, off, out = new THREE.Vector3()) {
    return out.copy(fr.p).addScaledVector(fr.f, off[0]).addScaledVector(fr.r, off[1]).addScaledVector(fr.u, off[2]);
  }

  _lerpOff(list, u) {
    if (!Array.isArray(list[0])) return list;
    if (list.length === 1) return list[0];
    const a = list[0], b = list[1];
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  }

  update(t, tau) {
    const p = this.plan;
    const s = this.shotAt(t);
    this.current = s;
    const u = clamp((t - s.t0) / Math.max(0.001, s.t1 - s.t0));
    const ue = s.ease === 'in' ? easeInCubic(u) : smooth(u);
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    let fov = s.fov2 !== undefined ? lerp(s.fov ?? 50, s.fov2, smooth(u)) : s.fov ?? 50;
    let fog = s.fog ?? 0.0011;
    let blur = s.blur ?? 0;
    const tm = p.timeMap;

    switch (s.kind) {
      case 'path': {
        const e = easeInOutCubic(u);
        s.posCurve.getPoint(e, pos);
        s.lookCurve.getPoint(e, look);
        break;
      }
      case 'follow':
      case 'filler': {
        let off = s.offset, lk = s.look;
        if (s.kind === 'filler') [off, lk, fov] = this._fillerRig(s);
        const fr = this._frameOf(s.racer, tau);
        if (s.anchor === 'head') {
          // close-ups track the actual head so faces stay framed whatever the body does
          const m = this.D.models[s.racer];
          fr.p = (m.head || m.root).getWorldPosition(new THREE.Vector3());
        }
        this._local(fr, this._lerpOff(off, ue), pos);
        this._local(fr, lk, look);
        break;
      }
      case 'static': {
        if (typeof s.pos === 'function') pos.copy(s.pos());
        else pos.copy(s.pos instanceof THREE.Vector3 ? s.pos : V(s.pos));
        if (Array.isArray(s.look)) look.copy(V(s.look));
        else {
          const lg = s.look.lag ?? 0;
          const q = this._racer(s.look.racer, tau - lg);
          look.copy(q.pos).add(V(s.look.offset || [0, 1, 0]));
        }
        break;
      }
      case 'baseCam': {
        const b = this.D.crashBase(s.racer);
        const fr = { p: b.pos, f: b.f, r: b.r, u: b.u };
        this._local(fr, this._lerpOff(s.cam, ue), pos);
        const m = this.D.models[s.racer];
        if (s.look === 'pair') {
          const a = this._racer(s.racer, tau).pos.clone();
          const c = this._racer(s.racer2, tau).pos;
          look.copy(a.lerp(c, 0.5)).y += 1.5;
        } else if (s.look === 'steer' && m.steering) {
          m.steering.getWorldPosition(look);
        } else if (s.look === 'seat' && m.seat) {
          m.seat.getWorldPosition(look);
          look.y += 1;
        } else if (Array.isArray(s.look)) {
          this._local(fr, s.look, look);
        } else {
          look.copy(this._racer(s.racer, tau).pos);
          look.y += 1.2;
        }
        if (s.lookOffset) look.add(V(s.lookOffset));
        break;
      }
      case 'wreck': {
        // calm aftermath: high and ahead of where the wreck came to rest, looking back at it, slowly pushing in
        const b = this.D.crashBase(s.racer);
        s.p0 ||= this.D.rootAt(s.racer, tm.tau(s.t0) - p.racers[s.racer].crash.tau).pos.clone();
        const d = lerp(12, 10, ue);
        pos.copy(s.p0).addScaledVector(b.f, d).addScaledVector(b.r, -0.25 * d);
        pos.y = Math.max(s.p0.y, b.pos.y, this.D.terrain.groundAt(pos.x, pos.z)) + 7.5;
        look.copy(this._racer(s.racer, tau).pos);
        look.y += 1.2;
        break;
      }
      case 'trackcam': {
        const q = this.D.poseAt(s.racer, tm.tau(s.at), (this._pose2.tc ||= {}));
        const fr = { p: q.pos, f: q.trackTan || q.f, r: q.trackRight || q.r, u: new THREE.Vector3(0, 1, 0) };
        this._local(fr, s.place, pos);
        look.copy(this._racer(s.racer, tau).pos);
        look.y += 1.6;
        break;
      }
      case 'aerial': {
        const c = new THREE.Vector3();
        let n = 0;
        let lead = null;
        for (const i of s.racers) {
          if (this.D.isCrashed(i, tau)) continue;
          const q = this._racer(i, tau);
          c.add(q.pos);
          n++;
          if (!lead) lead = q;
        }
        if (!n) { const q = this._racer(p.W, tau); c.copy(q.pos); n = 1; lead = q; }
        c.multiplyScalar(1 / n);
        const tan = lead.trackTan || lead.f;
        const right = lead.trackRight || lead.r;
        pos.copy(c).addScaledVector(tan, -(s.back ?? 30)).addScaledVector(right, s.side ?? 8).add(new THREE.Vector3(0, s.height ?? 25, 0));
        look.copy(c).addScaledVector(tan, 8);
        break;
      }
      case 'money': {
        // side-on, close to Goth Mommy's flight path: she is shoved out, flies, explodes; the scooter streaks past
        const b = this.D.crashBase(p.R);
        pos.copy(b.pos).addScaledVector(b.f, 34).addScaledVector(b.r, -38).add(new THREE.Vector3(0, 5, 0));
        const ctxR = this.D.ctx[p.R];
        const explode = tm.tau(p.T.push) + (ctxR?.explodeAt ?? 0.5);
        const gm = this._racer(p.R, Math.min(tau, explode)).pos.clone();
        const boom = ctxR?.boomPos ? ctxR.boomPos() : gm;
        const k = smooth((tau - explode + 0.06) / 0.12);
        look.copy(gm).lerp(boom, k);
        look.y += 2 + k * 2;
        fov = lerp(46, 62, smooth((tau - explode) / 0.35));
        break;
      }
      case 'discover': {
        pos.set(30, 3.2, -16);
        const party = new THREE.Vector3(-6, 7.5, 9);
        const w = this._racer(p.W, tau).pos.clone();
        w.y += 2;
        const k = smooth((u - 0.38) / 0.22);
        look.copy(party).lerp(w, k);
        fov = lerp(48, 26, smooth((u - 0.45) / 0.4));
        blur = k > 0 && k < 1 ? 0.6 : 0;
        break;
      }
      case 'zoomout': {
        // rise above the track, then the region, then the whole landscape – the scooter keeps going
        const w = this._racer(p.W, tau).pos;
        const e = easeInOutCubic(clamp(u * 1.08));
        const trackC = new THREE.Vector3(60, 0, -80);
        const startPos = new THREE.Vector3(-650, 240, 480);
        const midPos = new THREE.Vector3(-1500, 1500, 2100);
        const endPos = new THREE.Vector3(-3600, 6600, 6200);
        if (e < 0.35) pos.copy(startPos).lerp(midPos, smooth(e / 0.35));
        else pos.copy(midPos).lerp(endPos, smooth((e - 0.35) / 0.65));
        look.copy(trackC).lerp(w, 0.62 * smooth(u * 1.4));
        fov = lerp(55, 44, e);
        fog = lerp(0.00045, 0.00003, smooth(u * 3));
        break;
      }
      case 'orbit': {
        const q = this._racer(s.racer, tau);
        const ang = (t - s.t0) * (s.speed ?? 0.35) + 0.6;
        pos.copy(q.pos).add(new THREE.Vector3(Math.cos(ang) * s.radius, s.height, Math.sin(ang) * s.radius));
        look.copy(q.pos);
        look.y += 1.5;
        break;
      }
      case 'crane': {
        const q = this._racer(s.racer, tau);
        const e = easeInOutCubic(u);
        pos.copy(q.pos).add(new THREE.Vector3(lerp(10, -60, e), lerp(5, 140, e), lerp(10, 160, e)));
        look.copy(q.pos).lerp(new THREE.Vector3(-60, 0, 0), e * 0.6);
        fog = lerp(0.0011, 0.0004, e);
        break;
      }
      default: {
        const q = this._racer(p.W, tau);
        pos.copy(q.pos).add(new THREE.Vector3(-10, 5, 5));
        look.copy(q.pos);
      }
    }

    // shake (deterministic noise in film time)
    let amp = s.shake ?? 0;
    for (const e of p.allEvents) {
      if (e.type !== 'shake') continue;
      if (e.t > t) break;
      const a = t - e.t;
      if (a < e.dur) amp += e.amp * (1 - a / e.dur) ** 2;
    }
    if (amp > 0) {
      const k = amp * 0.35;
      pos.x += noise1(t * 23, 1) * k;
      pos.y += noise1(t * 27, 2) * k;
      pos.z += noise1(t * 21, 3) * k;
      look.x += noise1(t * 19, 4) * k * 0.6;
      look.y += noise1(t * 25, 5) * k * 0.6;
    }

    const cam = this.camera;
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    if (s.roll) cam.rotateZ(s.roll);
    if (Math.abs(cam.fov - fov) > 0.001) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.focus.copy(look);
    this.fog = fog;
    this.blur = blur;
    return s;
  }

  _fillerRig(s) {
    switch (s.style) {
      case 'aerial': return [[[-26, 10, 16], [-30, 12, 18]], [10, 0, 0], 50];
      case 'side': return [[[2, 9, 1.6], [-2, 9.5, 1.9]], [0, 0, 1.2], 44];
      case 'chase': return [[[-12, 1.5, 4.5], [-13, 1, 5]], [10, 0, 1], 52];
      case 'front': return [[[13, -3, 1.2], [11, -2.5, 1.4]], [0, 0, 1.6], 46];
      case 'wclose': return [[[3.2, -2.8, 3.0], [2.6, -2.2, 2.9]], [0, 0, 2.6], 38];
      default: return [[[-12, 4, 4]], [0, 0, 1], 50];
    }
  }
}

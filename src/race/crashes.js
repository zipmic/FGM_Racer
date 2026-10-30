import * as THREE from 'three';
import { clamp, smooth, lerp, easeOutCubic, easeInCubic, rng, hash, window01 } from '../core/math.js';
import { mat, umat, glow, G, mk, grp, bannerTexture, textCanvas } from '../core/kit.js';
import { ROAD_HALF, QUARRY_CENTER } from '../world/Track.js';
import { WATER_LEVEL } from '../world/Terrain.js';
import { textSprite } from '../vehicles/parts.js';

// Scripted comic crashes. Everything is a pure function of the crash age
// (story seconds since onset; negative = build-up), so seeking is always exact.

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();

export function poseFrom(out, base, dF, dR, dU, yaw = 0, pitch = 0, roll = 0) {
  out.pos.copy(base.pos).addScaledVector(base.f, dF).addScaledVector(base.r, dR).addScaledVector(base.u, dU);
  _e.set(roll, yaw, pitch, 'YZX');
  _q.setFromEuler(_e);
  out.quat.copy(base.quat).multiply(_q);
  return out;
}
/** distance travelled when braking from v0 to 0 in T seconds */
export function skid(a, v0, T) {
  if (a <= 0) return v0 * a;
  if (a >= T) return (v0 * T) / 2;
  return v0 * a - (0.5 * v0 * a * a) / T;
}
/** height with bounces: starts at h0 going up with vy, gravity g, restitution e */
export function bounce(a, h0, vy, g = 30, e = 0.4) {
  let h = h0;
  for (let n = 0; n < 6; n++) {
    const tLand = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, h))) / g;
    if (a < tLand) return h + vy * a - 0.5 * g * a * a;
    a -= tLand;
    const vImpact = g * tLand - vy;
    h = 0;
    vy = vImpact * e;
    if (vy < 1.5) return 0;
  }
  return 0;
}

/** Place obj (whose parent's world matrix is current) at a world position/quaternion. */
export function placeWorld(obj, pos, quat, scale = null) {
  obj.parent.updateWorldMatrix(true, false);
  _mi.copy(obj.parent.matrixWorld).invert();
  _m.compose(pos, quat, scale || _v.set(1, 1, 1));
  _m.premultiply(_mi);
  _m.decompose(obj.position, obj.quaternion, obj.scale);
}

function homeOf(obj) {
  if (!obj.userData.home) obj.userData.home = { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() };
  if (!obj.userData.home.s) obj.userData.home.s = new THREE.Vector3(1, 1, 1);
  return obj.userData.home;
}
function resetObj(obj) {
  const h = homeOf(obj);
  obj.position.copy(h.p);
  obj.quaternion.copy(h.q);
  obj.scale.copy(h.s);
  obj.visible = true;
}
/** Pose of obj in root space when everything is at rest. */
function restInRoot(model, obj) {
  if (obj.userData.restRoot) return obj.userData.restRoot;
  const m = new THREE.Matrix4();
  let o = obj;
  const chain = [];
  while (o && o !== model.root) { chain.push(o); o = o.parent; }
  for (let i = chain.length - 1; i >= 0; i--) {
    const h = homeOf(chain[i]);
    m.multiply(new THREE.Matrix4().compose(h.p, h.q, h.s));
  }
  const r = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() };
  m.decompose(r.pos, r.quat, r.scale);
  obj.userData.restRoot = r;
  return r;
}
/** World pose a part had at the moment the root was at rootPose. */
function partWorld(model, obj, rootPose, out) {
  const r = restInRoot(model, obj);
  out.pos.copy(r.pos).applyQuaternion(rootPose.quat).add(rootPose.pos);
  out.quat.copy(rootPose.quat).multiply(r.quat);
  return out;
}
const P = () => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() });

/** Generic flying debris: part leaves its root at detach age and follows a ballistic tumble. */
function flyPart(ctx, obj, age, dAge, vel, opts = {}) {
  if (age < dAge) {
    resetObj(obj);
    return false;
  }
  const a = age - dAge;
  const start = (obj.userData._fly ??= {});
  if (start.key !== `${ctx.tauC}|${dAge}`) {
    start.key = `${ctx.tauC}|${dAge}`;
    start.pose = partWorld(ctx.model, obj, ctx.rootAt(dAge), P());
  }
  const g = opts.g ?? 28;
  const p = _v.copy(start.pose.pos).addScaledVector(vel, Math.min(a, opts.stopAt ?? 9));
  const ground = ctx.ground(p.x, p.z) + (opts.lift ?? 0.2);
  const h0 = start.pose.pos.y - ground;
  p.y = ground + bounce(a, h0, vel.y, g, opts.e ?? 0.35);
  const tumble = Math.min(a, opts.stopAt ?? 1.6);
  _e.set(tumble * (opts.spin ?? 7), tumble * (opts.spin ?? 7) * 0.6, tumble * (opts.spin ?? 7) * 0.3);
  const q = new THREE.Quaternion().setFromEuler(_e).premultiply(start.pose.quat);
  placeWorld(obj, p.clone(), q);
  return true;
}

function label(ctx, offset, text, opts = {}) {
  return { t: ctx.at(offset), type: 'label', text, dur: opts.dur ?? 1.6, racer: ctx.i, style: opts.style ?? 'pop', color: opts.color, y: opts.y };
}
function sfx(ctx, offset, name, vol = 1) {
  return { t: ctx.at(offset), type: 'sfx', name, vol };
}
function shake(ctx, offset, amp = 0.6, dur = 0.5) {
  return { t: ctx.at(offset), type: 'shake', amp, dur };
}

// -------------------------------------------------------------------------- generic helpers
function spinOutPose(ctx, age, out, dir = 1, turns = 1.5, T = 1.4, lat = 9) {
  const b = ctx.base;
  const d = skid(age, b.speed, T);
  const k = smooth(age / T);
  poseFrom(out, b, d, dir * lat * k, 0, dir * turns * Math.PI * 2 * easeOutCubic(age / T), 0, 0);
  return out;
}

// ============================================================================ crash catalogue
export const CRASHES = {};

// ---------------------------------------------------------------- One Piece at a Time
CRASHES.junk = {
  lead: 0,
  setup(ctx) {
    // parts come off one by one from shortly after GO until the onset
    const n = ctx.model.pieces.length + ctx.model.wheels.length;
    const start = ctx.plan.tauGO + 0.25 - ctx.tauC;
    ctx.detach = [];
    for (let k = 0; k < n; k++) ctx.detach.push(start + ((-0.15 - start) * k) / (n - 1));
    const ev = [];
    ctx.detach.forEach((a, k) => ev.push(sfx(ctx, a, k % 3 === 0 ? 'clank' : k % 3 === 1 ? 'boing' : 'clank2', 0.7)));
    ev.push(label(ctx, ctx.detach[2], 'clunk…', { style: 'small' }));
    ev.push(label(ctx, ctx.detach[Math.floor(n * 0.6)], 'uh oh', { style: 'small' }));
    ev.push(sfx(ctx, 0, 'scrape', 0.9));
    ev.push(label(ctx, 0.5, 'ONE PIECE AT A TIME', { dur: 2 }));
    ev.push(sfx(ctx, 1.2, 'sadHorn', 0.8));
    ctx.events = ev;
    ctx.fx.emit({ kind: 'spark', t0: ctx.tauC + ctx.detach[10], t1: ctx.tauC + 0.7, rate: 40, count: 3, life: 0.5, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().setY(ctx.rootAt(ts - ctx.tauC).pos.y + 0.3), vel: (r, ts, v) => v.copy(ctx.base.f).multiplyScalar(-10 - r() * 10).add(new THREE.Vector3((r() - 0.5) * 8, 4 + r() * 6, (r() - 0.5) * 8)) });
  },
  pre(ctx, age, sp) {
    const lost = ctx.detach.filter((a) => age >= a).length;
    sp.expr = lost > 8 ? { lid: 0, brow: 0.6, open: 0.6, wide: 1.25 } : lost > 3 ? { lid: 0, brow: 0.4, smile: -0.3, wide: 1.1 } : undefined;
    sp.sag = clamp((lost - ctx.model.pieces.length) / 4) * 0.5;
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const d = skid(age, b.speed, 0.9);
    poseFrom(out, b, d, 0, -0.55, Math.sin(age * 3) * 0.15 * (1 - smooth(age)), 0, 0);
    out.special = { expr: { lid: 0, brow: 0.6, open: 0.4, wide: 1.3, lookX: 0.6 }, sag: 0.5 };
    return out;
  },
  parts(ctx, age) {
    const m = ctx.model;
    const r = rng(hash(ctx.i, 77));
    const all = [...m.pieces, ...m.wheels.map((w) => w.obj)];
    all.forEach((obj, k) => {
      const dA = ctx.detach[k];
      const isWheel = k >= m.pieces.length;
      const side = (r() - 0.5) * 2;
      const vel = isWheel
        ? new THREE.Vector3().copy(ctx.base.f).multiplyScalar(ctx.base.speed * 0.25).addScaledVector(ctx.base.r, side * 5).setY(3)
        : new THREE.Vector3().copy(ctx.base.f).multiplyScalar(ctx.base.speed * 0.15).addScaledVector(ctx.base.r, side * 9).setY(6 + r() * 5);
      obj.userData.detached = flyPart(ctx, obj, age, dA, vel, { stopAt: isWheel ? 2.2 : 1.1, spin: isWheel ? 3 : 8 });
    });
    // the steering wheel keeps going on its own for a few metres
    const sw = m.steering;
    if (age < 0.05) {
      resetObj(sw);
    } else {
      const a = age - 0.05;
      const st = (sw.userData._fly ??= {});
      if (st.key !== ctx.tauC) { st.key = ctx.tauC; st.pose = partWorld(m, sw, ctx.rootAt(0.05), P()); }
      const dist = skid(a, ctx.base.speed * 0.45, 2.2);
      const p = st.pose.pos.clone().addScaledVector(ctx.base.f, dist);
      const fall = smooth((a - 1.9) / 0.6);
      p.y = ctx.ground(p.x, p.z) + lerp(0.42, 0.06, fall);
      const q = new THREE.Quaternion().copy(ctx.base.quat);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(fall * Math.PI / 2, 0, -dist / 0.38)));
      placeWorld(sw, p, q);
    }
    m.body.position.y = -(age >= 0 ? 0.55 : 0);
  },
  shots(ctx) {
    const t0 = ctx.at(ctx.detach[3]);
    return [
      { t0: ctx.at(-1.4), t1: ctx.at(0.3), kind: 'follow', racer: ctx.i, offset: [[-9, 3.5, 3.2], [-7, 2.5, 2.4]], look: [0, 0, 1.0], fov: 46, name: 'junk-chase' },
      { t0: ctx.at(0.3), t1: ctx.at(2.0), kind: 'baseCam', racer: ctx.i, cam: [[18, 4, 1.3], [24, 3, 1.0]], look: 'steer', fov: 38 },
    ].filter((s) => s.t1 > t0 - 2);
  },
};

// ---------------------------------------------------------------- Everything Is a Weapon
CRASHES.cart = {
  lead: 1.0,
  setup(ctx) {
    ctx.events = [
      label(ctx, -0.9, 'LOCK & LOAD', { style: 'small' }),
      sfx(ctx, -0.5, 'charge', 0.6),
      sfx(ctx, 0, 'cannon', 1.2),
      shake(ctx, 0, 1.2, 0.6),
      label(ctx, 0.25, 'RECOIL!', { dur: 1.4 }),
      sfx(ctx, 0.15, 'whistleDown', 0.7),
      sfx(ctx, 1.1, 'crash', 0.9),
    ];
    const muzzle = () => {
      const r = ctx.rootAt(0);
      return r.pos.clone().addScaledVector(ctx.base.f, 3.5).addScaledVector(ctx.base.u, 2.2);
    };
    ctx.fx.emit({ kind: 'fire', t0: ctx.tauC, count: 26, life: 0.5, origin: muzzle, vel: (r, ts, v) => v.copy(ctx.base.f).multiplyScalar(25 + r() * 30).add(new THREE.Vector3((r() - 0.5) * 10, (r() - 0.5) * 8, (r() - 0.5) * 10)) });
    ctx.fx.emit({ kind: 'smoke', t0: ctx.tauC, count: 30, life: 1.6, origin: muzzle, vel: (r, ts, v) => v.copy(ctx.base.f).multiplyScalar(10 + r() * 20).add(new THREE.Vector3((r() - 0.5) * 8, r() * 5, (r() - 0.5) * 8)) });
    ctx.fx.emit({ kind: 'smoke', t0: ctx.tauC, t1: ctx.tauC + 1.1, rate: 30, count: 1, life: 1.2, scale: 0.6, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().setY(ctx.rootAt(ts - ctx.tauC).pos.y + 1.5) });
    ctx.fx.emit({ kind: 'chunk', t0: ctx.tauC + 1.1, count: 14, life: 1.4, color: ['#cfd6dc', '#e63946', '#333'], origin: () => ctx.rootAt(1.1).pos, vel: (r, ts, v) => v.set((r() - 0.5) * 14, 6 + r() * 8, (r() - 0.5) * 14), scale: 0.5 });
    // cannonball
    ctx.ball = mk(G.sphere(0.5, 10, 8), mat('#111', { metal: 0.6 }), ctx.world.propsRoot);
  },
  pre(ctx, age, sp) {
    const k = smooth((age + 1.0) / 0.6);
    sp.cannonAim = k * 0.12;
    sp.expr = { lid: 0.3, brow: -0.6, smile: 0.9, open: 0.3 * k };
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    // shot backwards out of the track, tumbling
    const T = 1.1;
    const a = Math.min(age, T);
    const back = b.speed * 0.12 * a - 26 * a;
    const lat = 15 * smooth(a / T) + 4 * Math.max(0, age - T);
    const h = Math.max(0, 9 * a - 8 * a * a);
    const after = Math.max(0, age - T);
    const roll = skid(after, 6, 0.8);
    poseFrom(out, b, back - roll, lat, h, a * 1.5, a * 6.0 + (age > T ? 0 : 0), a * 1.2);
    if (age > T) {
      // lands on its side and slides
      poseFrom(out, b, back - roll, lat + roll * 0.3, 0, T * 1.5, Math.PI * 0.5, 0.3);
    }
    out.pos.y = Math.max(out.pos.y, ctx.ground(out.pos.x, out.pos.z));
    out.special = { cannonAim: 0.1, expr: { lid: 0, brow: 0.5, open: 0.8, wide: 1.3 } };
    return out;
  },
  parts(ctx, age) {
    const ball = ctx.ball;
    ball.visible = age > 0 && age < 2.5;
    if (ball.visible) {
      const r = ctx.rootAt(0);
      ball.position.copy(r.pos).addScaledVector(ctx.base.f, 4 + (ctx.base.speed + 140) * age).addScaledVector(ctx.base.u, 2.2 + age * 6);
    }
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.0), t1: ctx.at(0.05), kind: 'follow', racer: ctx.i, offset: [[6, 2.2, 1.6], [5, 2.5, 1.4]], look: [0, 0, 2.0], fov: 50, name: 'cart-front' },
      { t0: ctx.at(0.05), t1: ctx.at(1.5), kind: 'baseCam', racer: ctx.i, cam: [[-16, -9, 2.5], [-24, -11, 3.5]], look: 'racer', fov: 52 },
    ];
  },
};

// ---------------------------------------------------------------- Blind Fighting
CRASHES.tank = {
  lead: 1.7,
  side: 'right',
  setup(ctx) {
    const W = ctx.world;
    const b = ctx.base;
    const s = b.s;
    // road sign it boxes with, and the wall it drives into
    const sign = grp(W.propsRoot);
    W.placeOnTrack(sign, s - 22, ROAD_HALF + 2.4, 0);
    const post = grp(sign);
    mk(G.cyl(0.15, 0.15, 5, 8), mat('#bbb', { metal: 0.6 }), post, [0, 2.5, 0]);
    const tex = bannerTexture('SHARP TURN', { bg: '#ffd400', fg: '#111', accent: '#111', w: 512, h: 256 });
    mk(G.box(0.15, 2.0, 3.2), new THREE.MeshStandardMaterial({ map: tex }), post, [0, 5.4, 0]);
    ctx.signPost = post;
    const wall = grp(W.propsRoot);
    W.placeOnTrack(wall, s + 9, ROAD_HALF + 6.5, 0);
    mk(G.box(26, 4.5, 2), mat('#cfcac0', { rough: 0.95 }), wall, [0, 2.25, 0]);
    const ad = bannerTexture('BLIND CORNER', { bg: '#1d1d1d', accent: '#e63946' });
    mk(G.plane(24, 3), new THREE.MeshStandardMaterial({ map: ad }), wall, [0, 2.6, -1.05], [0, Math.PI, 0]).castShadow = false;
    ctx.events = [
      label(ctx, -1.6, 'TAKE THAT!', { style: 'small' }),
      sfx(ctx, -1.45, 'punch', 0.9), sfx(ctx, -1.2, 'punch', 0.9), sfx(ctx, -0.95, 'punch', 1), sfx(ctx, -0.7, 'clang', 0.9),
      sfx(ctx, 0.32, 'crash', 1.1), shake(ctx, 0.32, 0.9, 0.5),
      label(ctx, 0.45, 'BONK!', { dur: 1.2, color: '#ffe14d' }),
      sfx(ctx, 0.7, 'tweet', 0.6),
    ];
    ctx.fx.emit({ kind: 'whiteSmoke', t0: ctx.tauC + 0.32, count: 22, life: 1.5, origin: () => ctx.rootAt(0.35).pos.clone().addScaledVector(b.u, 1.5), vel: (r, ts, v) => v.set((r() - 0.5) * 10, r() * 6, (r() - 0.5) * 10) });
    ctx.fx.emit({ kind: 'chunk', t0: ctx.tauC + 0.32, count: 12, life: 1.2, color: ['#cfcac0', '#5b6b3a'], scale: 0.6, origin: () => ctx.rootAt(0.33).pos.clone().addScaledVector(b.u, 2), vel: (r, ts, v) => v.set((r() - 0.5) * 12, 6 + r() * 8, (r() - 0.5) * 12) });
    // stars circling the driver
    ctx.stars = [];
    for (let k = 0; k < 4; k++) {
      const st = textSprite('★', { color: '#ffe14d', size: 110, w: 128, h: 128 });
      st.scale.set(0.8, 0.8, 1);
      W.propsRoot.add(st);
      ctx.stars.push(st);
    }
  },
  pre(ctx, age, sp) {
    sp.punch = 1;
    sp.aim = age < -0.6 ? 0.55 : 0;
    sp.expr = { lid: 0, brow: -0.6, smile: -0.3, open: 0.5 };
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const tHit = 0.32;
    const a = Math.min(age, tHit);
    const k = a / tHit;
    const latHit = ROAD_HALF + 5.5 - b.lat;
    poseFrom(out, b, b.speed * 0.85 * a, latHit * k * k, 0, -0.55 * smooth(k * 1.5), 0, 0);
    if (age > tHit) {
      const bk = skid(age - tHit, 6, 0.4);
      poseFrom(out, b, b.speed * 0.85 * tHit - bk, latHit - bk * 0.4, 0, -0.55, 0, -0.08);
    }
    out.scale = age > tHit ? new THREE.Vector3(lerp(0.72, 0.85, smooth((age - tHit) / 0.3)), 1, 1.12) : null;
    out.special = { punch: age < tHit ? 0.8 : 0, expr: { lid: 0, brow: 0.6, open: 0.5, wide: 1.2 } };
    return out;
  },
  parts(ctx, age) {
    const sign = ctx.signPost;
    const hit = window01(age, -1.6, -0.5, 0.15);
    sign.rotation.set(Math.sin(age * 20) * 0.25 * hit + (age > -0.75 ? 0.45 : 0), 0, Math.sin(age * 23) * 0.12 * hit);
    const m = ctx.model;
    m.gloves.forEach((g, i) => {
      const vel = new THREE.Vector3().copy(ctx.base.r).multiplyScalar(4 - i * 8).addScaledVector(ctx.base.f, 6).setY(9);
      flyPart(ctx, g.gl, age, 0.33, vel, { stopAt: 1.2 });
    });
    const head = m.head;
    const show = age > 0.4;
    ctx.stars.forEach((s, k) => {
      s.visible = show;
      if (!show) return;
      head.updateWorldMatrix(true, false);
      const hp = head.getWorldPosition(_v);
      const ang = age * 6 + (k / ctx.stars.length) * Math.PI * 2;
      s.position.set(hp.x + Math.cos(ang) * 1.0, hp.y + 0.9 + Math.sin(ang * 2) * 0.1, hp.z + Math.sin(ang) * 1.0);
    });
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.75), t1: ctx.at(-0.15), kind: 'follow', racer: ctx.i, offset: [[3.5, -6.5, 2.2], [1, -7.5, 2.6]], look: [1, 2, 1.8], fov: 50, name: 'tank-side' },
      { t0: ctx.at(-0.15), t1: ctx.at(1.6), kind: 'baseCam', racer: ctx.i, cam: [[30, -2, 3.0], [31, -3, 3.4]], look: 'racer', fov: 42 },
    ];
  },
};

// ---------------------------------------------------------------- AI: genius shortcut into the quarry
CRASHES.ai = {
  lead: 1.9,
  side: 'left',
  setup(ctx) {
    const b = ctx.base;
    const qc = new THREE.Vector3(QUARRY_CENTER.x, 0, QUARRY_CENTER.y);
    const dir = qc.clone().sub(b.pos).setY(0);
    const near = dir.length() < 260;
    if (!near) dir.copy(b.r).multiplyScalar(-1);
    dir.normalize();
    const rim = near ? qc.clone().addScaledVector(dir, -55) : b.pos.clone().addScaledVector(dir, 40);
    rim.y = ctx.ground(rim.x, rim.z);
    ctx.rim = rim;
    ctx.dir = dir;
    ctx.waterY = near ? WATER_LEVEL : ctx.ground(rim.x + dir.x * 20, rim.z + dir.z * 20);
    // bezier from the track to just past the rim
    const p0 = b.pos.clone();
    const p1 = b.pos.clone().addScaledVector(b.f, 22);
    const p2 = rim.clone().addScaledVector(dir, 3);
    ctx.curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    ctx.curveLen = ctx.curve.getLength();
    ctx.tRim = ctx.curveLen / (b.speed * 0.9);
    // holographic dotted route
    const dots = new THREE.InstancedMesh(G.box(0.8, 0.15, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#2ef2d0').multiplyScalar(2), toneMapped: false }), 40);
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < 40; k++) {
      const p = ctx.curve.getPointAt(k / 39);
      p.y = ctx.ground(p.x, p.z) + 0.3;
      if (k > 34) p.addScaledVector(dir, (k - 34) * 2).setY(rim.y + 0.3);
      dots.setMatrixAt(k, m4.makeTranslation(p.x, p.y, p.z));
    }
    ctx.world.propsRoot.add(dots);
    ctx.dots = dots;
    const warn = grp(ctx.world.propsRoot);
    warn.position.copy(rim).addScaledVector(dir, -4);
    warn.lookAt(warn.position.clone().sub(dir));
    mk(G.cyl(0.12, 0.12, 3, 6), mat('#999'), warn, [-1.2, 1.5, 0]);
    mk(G.cyl(0.12, 0.12, 3, 6), mat('#999'), warn, [1.2, 1.5, 0]);
    const t = bannerTexture('DANGER: QUARRY', { bg: '#ffd400', fg: '#111', accent: '#e63946', w: 512, h: 160 });
    mk(G.plane(3.6, 1.1), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide }), warn, [0, 2.6, 0.1], [0, Math.PI, 0]);
    const hang = ctx.tRim + 0.55;
    ctx.hang = hang;
    const fallT = Math.sqrt((2 * Math.max(4, rim.y - ctx.waterY)) / 30);
    ctx.splashAge = hang + fallT;
    ctx.events = [
      sfx(ctx, -1.85, 'compute', 0.6),
      sfx(ctx, -0.95, 'success', 0.7),
      sfx(ctx, 0, 'skid', 0.6),
      label(ctx, ctx.tRim + 0.05, '…', { dur: 0.6, style: 'small' }),
      sfx(ctx, ctx.tRim + 0.25, 'uhoh', 0.8),
      sfx(ctx, hang, 'whistleDown', 0.9),
      sfx(ctx, ctx.splashAge, 'splash', 1.0),
    ];
    const splashO = () => rim.clone().addScaledVector(dir, 3 + 4 * 0.55 + 6).setY(ctx.waterY + 0.5);
    ctx.fx.emit({ kind: 'splash', t0: ctx.tauC + ctx.splashAge, count: 60, life: 1.4, origin: splashO, vel: (r, ts, v) => v.set((r() - 0.5) * 14, 14 + r() * 16, (r() - 0.5) * 14) });
    ctx.fx.emit({ kind: 'whiteSmoke', t0: ctx.tauC + ctx.splashAge, count: 16, life: 1.6, origin: splashO, vel: (r, ts, v) => v.set((r() - 0.5) * 10, 3 + r() * 4, (r() - 0.5) * 10) });
    ctx.fx.emit({ kind: 'dust', t0: ctx.tauC, t1: ctx.tauC + ctx.tRim, rate: 25, count: 2, life: 1.0, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos });
  },
  pre(ctx, age, sp) {
    sp.holo = age < -1.0 ? 'CALCULATING…' : 'SHORTCUT FOUND ✓';
    sp.face = age < -1.0 ? 'calc' : 'smug';
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const tr = ctx.tRim;
    out.special = { holo: age < tr ? '-87% DISTANCE ✓' : age < ctx.hang ? 'RECALCULATING…' : 'OH NO', face: age < tr ? 'smug' : 'panic' };
    if (age < tr) {
      const u = clamp(age / tr);
      const p = ctx.curve.getPointAt(u);
      const p2 = ctx.curve.getPointAt(Math.min(1, u + 0.02));
      p.y = ctx.ground(p.x, p.z);
      out.pos.copy(p);
      const dir = p2.sub(p).setY(0).normalize();
      out.quat.setFromRotationMatrix(_m.makeBasis(dir, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0))));
      return out;
    }
    const dir = ctx.dir;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    const a = age - tr;
    const glide = Math.min(a, 0.55) * 4 + Math.max(0, a - 0.55) * 1.5;
    out.pos.copy(ctx.rim).addScaledVector(dir, 3 + glide);
    const fall = Math.max(0, a - 0.55);
    out.pos.y = Math.max(ctx.waterY - 3 - (age - ctx.splashAge) * 1.5, ctx.rim.y - 15 * fall * fall);
    out.quat.setFromRotationMatrix(_m.makeBasis(dir, new THREE.Vector3(0, 1, 0), right));
    out.quat.multiply(_q.setFromEuler(_e.set(0, 0, -Math.min(1.1, fall * 1.6))));
    out.hidden = age > ctx.splashAge + 2.5;
    return out;
  },
  parts(ctx, age) {
    ctx.dots.visible = age > -1.0 && age < ctx.tRim + 0.3;
  },
  shots(ctx) {
    const rimCam = ctx.rim.clone().addScaledVector(ctx.dir, -3).addScaledVector(new THREE.Vector3(-ctx.dir.z, 0, ctx.dir.x), 26).setY(ctx.rim.y + 5);
    return [
      { t0: ctx.at(-1.95), t1: ctx.at(-0.2), kind: 'follow', racer: ctx.i, offset: [[-7, -5, 4.5], [-8, -4, 5.5]], look: [2, 0, 2.5], fov: 50, name: 'ai-holo' },
      { t0: ctx.at(-0.2), t1: ctx.at(ctx.splashAge + 0.9), kind: 'static', pos: rimCam, look: { racer: ctx.i, offset: [0, 1, 0], lag: 0.06 }, fov: 50, fov2: 56 },
    ];
  },
};

// ---------------------------------------------------------------- You Are the Monster
CRASHES.monster = {
  lead: 1.3,
  side: 'right',
  setup(ctx) {
    const W = ctx.world;
    const b = ctx.base;
    const town = grp(W.propsRoot);
    W.placeOnTrack(town, b.s + 30, ROAD_HALF + 32, 0);
    town.position.y = ctx.ground(town.position.x, town.position.z) - 0.2;
    ctx.town = town;
    const r = rng(31);
    const cols = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff'];
    ctx.houses = [];
    mk(G.circle(16, 24), mat('#7cc86b'), town, [0, 0.25, 0], [-Math.PI / 2, 0, 0]);
    for (let k = 0; k < 26; k++) {
      const ang = r() * Math.PI * 2, rad = 2 + r() * 12;
      const h = grp(town, [Math.cos(ang) * rad, 0.25, Math.sin(ang) * rad], [0, r() * 3, 0]);
      const big = k === 0;
      const w = big ? 2.2 : 0.8 + r() * 1.2, hh = big ? 3.5 : 0.8 + r() * 1.6;
      mk(G.box(w, hh, w * 0.8), mat(cols[k % cols.length], { rough: 0.8 }), h, [0, hh / 2, 0]);
      mk(G.cone(w * 0.75, w * 0.6, 4), mat('#c0392b', { rough: 0.7 }), h, [0, hh + w * 0.3, 0], [0, Math.PI / 4, 0]);
      if (big) mk(G.cone(0.4, 2.2, 6), mat('#eee'), h, [0, hh + 2.2, 0]);
      ctx.houses.push(h);
    }
    const sign = bannerTexture('MINI LAND', { bg: '#ff77c8', fg: '#fff', accent: '#fff', w: 512, h: 128 });
    mk(G.plane(5, 1.25), new THREE.MeshStandardMaterial({ map: sign, side: THREE.DoubleSide }), town, [-15, 2.2, 0], [0, -Math.PI / 2, 0]);
    mk(G.cyl(0.1, 0.1, 2.2, 6), mat('#777'), town, [-15, 1.1, -2]);
    mk(G.cyl(0.1, 0.1, 2.2, 6), mat('#777'), town, [-15, 1.1, 2]);
    ctx.townPos = town.position.clone();
    ctx.jumpT = 0.9;
    ctx.events = [
      label(ctx, -1.2, 'ooh… tiny city', { style: 'small' }),
      sfx(ctx, -0.8, 'grumble', 0.8),
      sfx(ctx, 0.05, 'whoosh', 0.6),
      sfx(ctx, ctx.jumpT, 'roar', 1.2),
      label(ctx, ctx.jumpT + 0.1, 'ROAAAR!', { dur: 1.5, color: '#bdb2ff' }),
    ];
    for (let k = 0; k < 8; k++) {
      const a = ctx.jumpT + 0.15 + k * 0.32;
      ctx.events.push(sfx(ctx, a, 'stomp', 0.8));
      ctx.events.push(shake(ctx, a, 0.35, 0.25));
      ctx.fx.emit({ kind: 'dust', t0: ctx.tauC + a, count: 14, life: 1.0, scale: 1.2, origin: () => ctx.townPos.clone().add(new THREE.Vector3(Math.sin(k * 2.3) * 5, 0.5, Math.cos(k * 1.7) * 5)), vel: (rr, ts, v) => v.set((rr() - 0.5) * 12, 2 + rr() * 4, (rr() - 0.5) * 12) });
    }
  },
  pre(ctx, age, sp) {
    sp.expr = { lid: 0, brow: -0.2, smile: 0.9, wide: 1.25, lookX: 0.8 };
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const J = ctx.jumpT;
    const target = ctx.townPos;
    const start = b.pos;
    if (age < J) {
      const u = smooth(age / J);
      const d = skid(age, b.speed, J * 1.6);
      const p = start.clone().addScaledVector(b.f, d);
      p.lerp(target, u * u);
      p.y = lerp(start.y, target.y, u) + Math.sin(Math.PI * clamp((age - J * 0.45) / (J * 0.55))) * 7;
      out.pos.copy(p);
      const dir = target.clone().sub(start).setY(0).normalize();
      const f = b.f.clone().lerp(dir, smooth(age / (J * 0.5))).normalize();
      out.quat.setFromRotationMatrix(_m.makeBasis(f, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0))));
    } else {
      out.pos.copy(target);
      out.pos.y += Math.abs(Math.sin((age - J) * Math.PI / 0.32)) * 0.6;
      const yaw = Math.sin((age - J) * 2) * 0.6;
      const f = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), target.clone().sub(start).setY(0).normalize()));
      out.quat.setFromRotationMatrix(_m.makeBasis(f, new THREE.Vector3(0, 1, 0), new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0))));
    }
    out.special = { custom: age >= J, expr: { lid: 0, brow: -0.6, open: age > J ? 0.9 : 0.4, wide: 1.1 } };
    return out;
  },
  parts(ctx, age) {
    const m = ctx.model;
    const J = ctx.jumpT;
    ctx.houses.forEach((h, k) => {
      const tk = J + 0.15 + k * 0.1;
      const sq = smooth((age - tk) / 0.08);
      h.scale.set(1 + sq * 0.4, 1 - sq * 0.88, 1 + sq * 0.4);
    });
    if (age >= J) {
      const a = age - J;
      m.mLegs.forEach((l, i) => {
        const ph = Math.sin(a * Math.PI / 0.32 + i * Math.PI);
        l.rotation.set(0, 0, Math.max(0, ph) * 0.9);
        l.position.x = 0;
      });
      m.mArms.forEach((ar, i) => ar.rotation.set((i ? -1 : 1) * (1.6 + Math.sin(a * 8 + i) * 0.3), 0, 0));
      m.hips.rotation.y = 0;
    }
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.35), t1: ctx.at(0.2), kind: 'follow', racer: ctx.i, offset: [[9, -7, 5], [8, -6, 6]], look: [0, 0, 5], fov: 50, name: 'monster-front' },
      { t0: ctx.at(0.2), t1: ctx.at(ctx.jumpT + 1.7), kind: 'static', pos: () => ctx.townPos.clone().addScaledVector(ctx.base.f, -26).addScaledVector(ctx.base.r, 12).setY(ctx.townPos.y + 7), look: { racer: ctx.i, offset: [0, 4, 0] }, fov: 50 },
    ];
  },
};

// ---------------------------------------------------------------- Out of Control
CRASHES.buggy = {
  lead: 0.5,
  side: 'right',
  setup(ctx) {
    const W = ctx.world;
    const b = ctx.base;
    const stack = grp(W.propsRoot);
    W.placeOnTrack(stack, b.s + 34, ROAD_HALF + 1.5, 0);
    ctx.stackPos = stack.position.clone();
    ctx.tires = [];
    const tm = mat('#1a1a1a', { rough: 0.9 });
    const rm = mat('#e63946', { rough: 0.7 });
    let k = 0;
    for (let layer = 0; layer < 4; layer++) {
      for (let x = 0; x < 4 - layer; x++) for (let z = 0; z < 2; z++) {
        const t = mk(G.torus(0.75, 0.32, 8, 14), k % 2 ? tm : rm, stack, [(x - (3 - layer) / 2) * 1.6, 0.35 + layer * 0.6, (z - 0.5) * 1.6], [Math.PI / 2, 0, 0]);
        ctx.tires.push(t);
        k++;
      }
    }
    ctx.hitT = 0.62;
    ctx.events = [
      sfx(ctx, -0.4, 'horn', 0.5),
      sfx(ctx, 0, 'skid', 1.0),
      label(ctx, 0.1, 'WHEEEE', { style: 'small' }),
      sfx(ctx, ctx.hitT, 'crash', 1),
      shake(ctx, ctx.hitT, 0.8, 0.5),
      sfx(ctx, ctx.hitT + 0.3, 'boing', 0.7), sfx(ctx, ctx.hitT + 0.6, 'boing', 0.5), sfx(ctx, ctx.hitT + 0.9, 'boing', 0.4),
    ];
    ctx.fx.emit({ kind: 'smoke', t0: ctx.tauC, t1: ctx.tauC + ctx.hitT, rate: 40, count: 1, life: 1.2, scale: 0.8, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().setY(ctx.rootAt(ts - ctx.tauC).pos.y + 0.6), vel: (r, ts, v) => v.set((r() - 0.5) * 3, 1 + r() * 2, (r() - 0.5) * 3) });
    ctx.fx.emit({ kind: 'dust', t0: ctx.tauC + ctx.hitT, count: 30, life: 1.4, scale: 1.2, origin: () => ctx.stackPos.clone().setY(ctx.stackPos.y + 1), vel: (r, ts, v) => v.set((r() - 0.5) * 16, 2 + r() * 6, (r() - 0.5) * 16) });
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const hit = ctx.hitT;
    const a = Math.min(age, hit);
    const toStack = ctx.stackPos.clone().sub(b.pos);
    const fd = toStack.dot(b.f), rd = toStack.dot(b.r);
    const k = a / hit;
    poseFrom(out, b, fd * (1 - (1 - k) * (1 - k)) * 0.92, rd * k * k * 0.92, 0, k * Math.PI * 2.6, 0, Math.sin(k * 9) * 0.1);
    if (age > hit) {
      const bk = skid(age - hit, 4, 0.3);
      poseFrom(out, b, fd * 0.92 - bk, rd * 0.92, 0, Math.PI * 2.6 + 0.2, 0.1, 0.25);
    }
    out.special = { expr: { lid: 0, brow: 0.7, open: 0.9, wide: 1.35, lookX: Math.sin(age * 20) } };
    return out;
  },
  parts(ctx, age) {
    const hit = ctx.hitT;
    const b = ctx.base;
    ctx.tires.forEach((t, k) => {
      const h = homeOf(t);
      if (age < hit) { resetObj(t); return; }
      const a = age - hit;
      const r = rng(hash(k, 913));
      const vx = (r() - 0.2) * 18, vz = (r() - 0.5) * 22, vy = 5 + r() * 9;
      const dist = Math.min(a, 1.8);
      t.position.set(h.p.x + vx * dist, h.p.y + bounce(a, 0, vy, 30, 0.55), h.p.z + vz * dist);
      t.rotation.set(Math.PI / 2 + a * 8 * r(), a * 6, 0);
    });
    const m = ctx.model;
    flyPart(ctx, m.wheels[1].obj, age, hit + 0.02, new THREE.Vector3().copy(b.f).multiplyScalar(8).setY(10), { stopAt: 1.6 });
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-0.6), t1: ctx.at(ctx.hitT + 1.3), kind: 'baseCam', racer: ctx.i, cam: [[44, 14, 2.2], [46, 16, 3.0]], look: 'racer', fov: 44 },
    ];
  },
};

// ---------------------------------------------------------------- The Floor Is Lava
CRASHES.stilts = {
  lead: 1.2,
  setup(ctx) {
    const W = ctx.world;
    const b = ctx.base;
    const fb = grp(W.propsRoot);
    ctx.bridgeDist = 30;
    W.placeOnTrack(fb, b.s + ctx.bridgeDist, 0, 0);
    const steel = mat('#5b6270', { metal: 0.6, rough: 0.4 });
    const deckY = 8.2;
    ctx.deckY = deckY;
    mk(G.box(3.2, 1.3, ROAD_HALF * 2 + 12), mat('#e9e6df', { rough: 0.8 }), fb, [0, deckY + 0.65, 0]);
    const ad = bannerTexture('THE FLOOR IS LAVA', { bg: '#1a0a00', fg: '#ffb347', accent: '#ff4500' });
    mk(G.plane(ROAD_HALF * 2 + 10, 1.25), new THREE.MeshStandardMaterial({ map: ad, emissive: '#ffffff', emissiveMap: ad, emissiveIntensity: 0.3 }), fb, [-1.62, deckY + 0.65, 0], [0, -Math.PI / 2, 0]).castShadow = false;
    for (const side of [-1, 1]) {
      mk(G.box(3, deckY + 6, 3), steel, fb, [0, (deckY + 6) / 2, side * (ROAD_HALF + 5)]);
      mk(G.box(3.2, 0.2, 0.2), steel, fb, [0, deckY + 2.4, side * (ROAD_HALF + 3)]);
    }
    for (let z = -ROAD_HALF - 4; z <= ROAD_HALF + 4; z += 2) mk(G.box(0.12, 1.2, 0.12), steel, fb, [-1.4, deckY + 1.9, z]);
    mk(G.box(0.15, 0.15, ROAD_HALF * 2 + 10), steel, fb, [-1.4, deckY + 2.5, 0]);
    const tHit = ctx.bridgeDist / b.speed - 0.05;
    ctx.tHit = tHit;
    ctx.events = [
      label(ctx, -1.1, 'THE FLOOR IS LAVA!!', { color: '#ff8a3d', dur: 1.3 }),
      sfx(ctx, -0.9, 'hop', 0.6), sfx(ctx, -0.6, 'hop', 0.7), sfx(ctx, -0.3, 'hop', 0.8),
      sfx(ctx, 0, 'boingBig', 1),
      sfx(ctx, tHit, 'smack', 1.2), shake(ctx, tHit, 0.7, 0.4),
      label(ctx, tHit + 0.1, 'SPLAT', { color: '#ffffff', dur: 1.0 }),
      sfx(ctx, tHit + 0.75, 'slide', 0.8),
      sfx(ctx, tHit + 1.35, 'crash', 0.9),
    ];
    ctx.fx.emit({ kind: 'steam', t0: ctx.tauC - 1.2, t1: ctx.tauC + 4, rate: 25, count: 2, life: 1.2, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos, vel: (r, ts, v) => v.set((r() - 0.5) * 3, 2 + r() * 3, (r() - 0.5) * 3) });
  },
  pre(ctx, age, sp) {
    const k = smooth((age + 1.2) / 1.2);
    sp.hop = Math.abs(Math.sin(age * 11)) * (0.3 + k * 1.6);
    sp.expr = { lid: 0, brow: 0.7, open: 0.7, wide: 1.35, lookY: -0.8 };
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const tH = ctx.tHit;
    const latF = 0;
    if (age < tH) {
      const h = 14 * age - 9 * age * age;
      poseFrom(out, b, b.speed * age, latF, h, 0, -0.2 * age, 0);
      out.special = { hop: 2.2, expr: { lid: 0, brow: 0.8, open: 1, wide: 1.4 } };
      return out;
    }
    const hAt = 14 * tH - 9 * tH * tH;
    const a = age - tH;
    const stick = 0.7;
    const xHit = b.speed * tH - 2.6;
    if (a < stick) {
      poseFrom(out, b, xHit, latF, hAt + Math.sin(a * 30) * 0.05 * (1 - a), 0, 0, 0);
      out.scale = new THREE.Vector3(0.45, 1.05, 1.15);
    } else {
      const f = a - stick;
      const drop = Math.max(0, hAt - 0.5 * 30 * f * f);
      poseFrom(out, b, xHit - f * 3, latF, drop, 0, Math.min(Math.PI, f * 5.5), 0);
      out.scale = new THREE.Vector3(lerp(0.45, 1, smooth(f / 0.3)), 1, 1);
    }
    out.special = { hop: 2.2, expr: { lid: 0.6, brow: 0.6, open: 0.2, wide: 0.9 } };
    return out;
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.25), t1: ctx.at(ctx.tHit + 1.9), kind: 'baseCam', racer: ctx.i, cam: [[ctx.bridgeDist + 26, -9, 6], [ctx.bridgeDist + 24, -9, 5]], look: 'racer', lookOffset: [0, 3, 0], fov: 50 },
    ];
  },
};

// ---------------------------------------------------------------- Everything Comes at a Cost
CRASHES.gold = {
  lead: 1.8,
  setup(ctx) {
    ctx.events = [
      sfx(ctx, -1.7, 'coin', 0.6), sfx(ctx, -1.3, 'coin', 0.6), sfx(ctx, -0.9, 'coin', 0.6), sfx(ctx, -0.5, 'coin', 0.6),
      label(ctx, -1.0, 'LOW FUNDS', { style: 'small', color: '#ffd84a' }),
      sfx(ctx, 0, 'brake', 1.0),
      label(ctx, 0.1, 'INSUFFICIENT FUNDS', { color: '#ff4040', dur: 1.8 }),
      sfx(ctx, 0.35, 'sadTrombone', 0.8),
    ];
    ctx.fx.emit({ kind: 'coin', t0: ctx.tauC - 1.8, t1: ctx.tauC - 0.05, rate: 10, count: 1, life: 0.8, color: '#ffcf3a', origin: (ts) => { const r = ctx.rootAt(ts - ctx.tauC); return r.pos.clone().addScaledVector(ctx.base.f, -2.8).addScaledVector(ctx.base.u, 1.1); }, vel: (r, ts, v) => v.copy(ctx.base.f).multiplyScalar(ctx.base.speed * 0.6 - 6).add(new THREE.Vector3((r() - 0.5) * 4, 5 + r() * 3, (r() - 0.5) * 4)) });
    ctx.fx.emit({ kind: 'smoke', t0: ctx.tauC, t1: ctx.tauC + 0.35, rate: 50, count: 2, life: 1.0, scale: 0.6, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().setY(ctx.rootAt(ts - ctx.tauC).pos.y + 0.3) });
  },
  pre(ctx, age, sp) {
    sp.coins = Math.max(1, Math.ceil(12 * (-age / 1.8)));
    sp.expr = age > -1.0 ? { lid: 0, brow: 0.4, smile: -0.3, wide: 1.1 } : undefined;
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const d = skid(age, b.speed, 0.38);
    const nose = Math.sin(clamp(age / 0.5) * Math.PI) * 0.22;
    const shove = ctx.rammedAt !== undefined && age > ctx.rammedAt ? skid(age - ctx.rammedAt, 14, 0.5) : 0;
    poseFrom(out, b, d + shove, 0, 0, shove * 0.06, -nose, 0);
    out.special = { coins: 0, expr: { lid: 0.3, brow: 0.6, smile: -0.8, wide: 1 } };
    return out;
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.85), t1: ctx.at(-0.05), kind: 'follow', racer: ctx.i, offset: [[5.5, 5.8, 3.4], [4.6, 5.0, 3.0]], look: [0.6, 0, 1.5], fov: 46, name: 'gold-coins' },
    ];
  },
};

// ---------------------------------------------------------------- 8-Bit RPG
CRASHES.voxel = {
  lead: 0.3,
  ram: true,
  slowmo: [0.03, 1.35, 0.3],
  setup(ctx) {
    if (!ctx.rams) {
      // a classic floating "?" brick to crash into
      const blk = grp(ctx.world.propsRoot);
      ctx.world.placeOnTrack(blk, ctx.base.s + 2.6, ctx.base.lat, 0);
      const t = textCanvas(64, 64, (c) => { c.fillStyle = '#f8a800'; c.fillRect(0, 0, 64, 64); c.fillStyle = '#7c3c00'; c.font = 'bold 44px monospace'; c.textAlign = 'center'; c.fillText('?', 32, 48); });
      t.magFilter = THREE.NearestFilter;
      mk(G.box(3, 3, 3), new THREE.MeshStandardMaterial({ map: t }), blk, [0, 1.5, 0]);
    }
    ctx.events = [
      sfx(ctx, 0, 'crash', 1),
      sfx(ctx, 0.04, 'gameOver', 1),
      shake(ctx, 0, 0.8, 0.4),
      { t: ctx.at(0.25), type: 'label', text: 'GAME OVER', dur: 2.2, racer: ctx.i, style: 'pixel', color: '#ff2a2a' },
    ];
  },
  pose(ctx, age, out) {
    poseFrom(out, ctx.base, Math.min(age, 0.05) * ctx.base.speed * 0.3, 0, 0, 0, 0, 0);
    return out;
  },
  parts(ctx, age) {
    const m = ctx.model;
    const im = m.vox;
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    m.voxHome.forEach((h, i) => {
      if (age <= 0) { mm.makeTranslation(h.x, h.y, h.z); im.setMatrixAt(i, mm); return; }
      const r = rng(hash(i, 4242));
      const vx = h.x * 6 + 6 + r() * 8 + ctx.base.speed * 0.15, vz = h.z * 9 + (r() - 0.5) * 8, vy = 4 + h.y * 4 + r() * 8;
      const a = Math.min(age, 2.2);
      p.set(h.x + vx * a, Math.max(0.25, h.y + bounce(age, 0, vy, 26, 0.35) + 0), h.z + vz * a);
      e.set(a * (2 + r() * 6), a * r() * 4, a * (1 + r() * 5));
      q.setFromEuler(e);
      mm.compose(p, q, s);
      im.setMatrixAt(i, mm);
    });
    im.instanceMatrix.needsUpdate = true;
    m.wheels.forEach((w, k) => flyPart(ctx, w.obj, age, 0.01, new THREE.Vector3().copy(ctx.base.f).multiplyScalar(10).addScaledVector(ctx.base.r, (k % 2 ? 1 : -1) * 8).setY(9), { stopAt: 1.6 }));
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-0.35), t1: ctx.at(1.6), kind: 'baseCam', racer: ctx.i, cam: [[10, 7, 2.2], [12, 9, 3.6]], look: 'racer', lookOffset: [0, 1.4, 0], fov: 48 },
    ];
  },
};

// ---------------------------------------------------------------- Find Out the Controls as You Play
CRASHES.buttons = {
  lead: 1.7,
  setup(ctx) {
    ctx.events = [
      sfx(ctx, -1.6, 'beepBoop', 0.6), sfx(ctx, -1.3, 'horn', 0.6), sfx(ctx, -1.0, 'wiper', 0.6),
      label(ctx, -1.2, 'WHAT DOES THIS DO?', { dur: 1.3 }),
      sfx(ctx, -0.25, 'click', 1),
      sfx(ctx, 0, 'eject', 1.1),
      label(ctx, 0.15, 'EJECT!', { color: '#ffe14d', dur: 1.2 }),
      sfx(ctx, 0.3, 'wee', 0.8),
      sfx(ctx, 1.6, 'pop', 0.8),
    ];
    // parachute (hidden until it opens)
    const chute = grp(ctx.model.seat);
    const canopy = mk(G.hemi(2.2, 12), mat('#ffffff', { double: true, rough: 0.8 }), chute, [0, 4.8, 0]);
    for (let k = 0; k < 6; k++) mk(G.box(0.25, 0.05, 4.4), mat('#e63946', { double: true }), chute, [0, 6.95, 0], [0, (k / 6) * Math.PI, 0]).castShadow = false;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const l = mk(G.cyl(0.02, 0.02, 4.0, 3), mat('#ddd'), chute, [Math.cos(a) * 1.05, 2.8, Math.sin(a) * 1.05]);
      l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    }
    canopy.castShadow = true;
    ctx.chute = chute;
    ctx.fx.emit({ kind: 'smoke', t0: ctx.tauC, count: 20, life: 1.2, origin: () => ctx.rootAt(0).pos.clone().addScaledVector(ctx.base.u, 1), vel: (r, ts, v) => v.set((r() - 0.5) * 6, -2 + r() * 3, (r() - 0.5) * 6) });
  },
  pre(ctx, age, sp) {
    sp.expr = age > -0.4 ? { lid: 0, brow: -0.2, smile: 0.6, wide: 1.2 } : undefined;
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    // driverless car drifts off to the left and rolls to a stop
    const d = skid(age, b.speed, 2.0);
    const lat = -16 * smooth(age / 1.6);
    poseFrom(out, b, d, lat, 0, 0.45 * smooth(age / 1.2) - 0.2 * smooth((age - 1.2) / 0.8), 0, 0);
    out.pos.y = Math.max(out.pos.y, ctx.ground(out.pos.x, out.pos.z));
    return out;
  },
  parts(ctx, age) {
    const seat = ctx.model.seat;
    ctx.chute.visible = age > 1.5;
    if (age <= 0) { resetObj(seat); ctx.chute.scale.setScalar(1); return; }
    const st = (seat.userData._fly ??= {});
    if (st.key !== ctx.tauC) { st.key = ctx.tauC; st.pose = partWorld(ctx.model, seat, ctx.rootAt(0), P()); }
    const fwd = ctx.base.speed * 0.55 * Math.min(age, 1.5) + Math.max(0, age - 1.5) * 4;
    const apex = 1.5;
    const up = age < apex ? 46 * age - 15.3 * age * age : 46 * apex - 15.3 * apex * apex - (age - apex) * 3.2;
    const p = st.pose.pos.clone().addScaledVector(ctx.base.f, fwd).setY(st.pose.pos.y + Math.max(0, up));
    const q = st.pose.quat.clone().multiply(_q.setFromEuler(_e.set(Math.sin(age * 3) * 0.2 * smooth(age - 1.5), age < apex ? age * 5 : apex * 5, 0)));
    placeWorld(seat, p, q);
    ctx.chute.scale.setScalar(smooth((age - 1.5) / 0.25) + 0.001);
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.75), t1: ctx.at(-0.05), kind: 'follow', racer: ctx.i, offset: [[3.5, 3.6, 3.6], [2.6, 2.4, 3.0]], look: [0, 0, 1.8], fov: 46, name: 'buttons-cockpit' },
      { t0: ctx.at(-0.05), t1: ctx.at(1.9), kind: 'baseCam', racer: ctx.i, cam: [[20, 13, 2.0], [26, 14, 2.6]], look: 'seat', fov: 54 },
    ];
  },
};

// ---------------------------------------------------------------- Automation
CRASHES.robot = {
  lead: 1.6,
  setup(ctx) {
    ctx.events = [
      label(ctx, -1.5, 'AUTO-REPAIR INITIATED', { color: '#ffc21a', dur: 1.6, style: 'mono' }),
      sfx(ctx, -1.4, 'robot', 0.8),
      sfx(ctx, -0.5, 'drill', 0.7),
      ...[0.1, 0.35, 0.6, 0.85, 1.1, 1.35].map((a) => sfx(ctx, a, 'clank', 0.8)),
      sfx(ctx, 1.75, 'crash', 0.8),
      label(ctx, 2.0, 'REPAIR COMPLETE ✓', { color: '#34ff7a', dur: 1.4, style: 'mono' }),
    ];
    ctx.fx.emit({ kind: 'spark', t0: ctx.tauC - 0.6, t1: ctx.tauC + 1.6, rate: 40, count: 3, life: 0.5, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().addScaledVector(ctx.base.u, 2.2) });
  },
  pre(ctx, age, sp) { sp.panic = smooth((age + 1.6) / 0.8); },
  pose(ctx, age, out) {
    const b = ctx.base;
    const d = skid(age, b.speed, 2.0);
    const drop = smooth((age - 1.6) / 0.3) * 0.8;
    poseFrom(out, b, d, 2 * smooth(age / 2), -drop, 0.2 * smooth(age / 2), 0, drop * 0.15);
    out.special = { panic: 1, armsOverride: false };
    return out;
  },
  parts(ctx, age) {
    const m = ctx.model;
    m.panels.forEach((p, k) => {
      const side = k % 2 ? 1 : -1;
      flyPart(ctx, p, age, 0.1 + k * 0.25, new THREE.Vector3().copy(ctx.base.r).multiplyScalar(side * 10).addScaledVector(ctx.base.f, ctx.base.speed * 0.3).setY(8), { stopAt: 1.4 });
    });
    m.robotArms.forEach((a, k) => flyPart(ctx, a.a1, age, 1.6 + k * 0.1, new THREE.Vector3().copy(ctx.base.r).multiplyScalar(k ? 6 : -6).setY(6), { stopAt: 1.2 }));
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.65), t1: ctx.at(2.3), kind: 'follow', racer: ctx.i, offset: [[-8, 7.5, 6], [-11, 9, 8]], look: [0, 0, 1.5], fov: 50, name: 'robot', endSlow: true },
    ];
  },
};

// ---------------------------------------------------------------- Build to Survive
CRASHES.survival = {
  lead: 1.5,
  setup(ctx) {
    const b = ctx.base;
    ctx.wallDist = 18;
    ctx.tHit = ctx.wallDist / b.speed;
    const wall = grp(ctx.world.propsRoot);
    const wallPos = b.pos.clone().addScaledVector(b.f, ctx.wallDist + 2.5);
    ctx.wallPos = wallPos;
    ctx.planks = [];
    const wood = mat('#b5835a', { rough: 0.95, flat: true });
    for (let k = 0; k < 9; k++) {
      const pl = mk(k % 4 === 3 ? G.cyl(0.6, 0.6, 1.3, 10) : G.box(0.35, 1.0 + (k % 3) * 0.3, 3.4), k % 4 === 3 ? mat('#2f6b3a') : wood, wall);
      const row = Math.floor(k / 3), col = k % 3;
      pl.userData.slot = new THREE.Vector3().copy(wallPos).addScaledVector(b.r, (col - 1) * 2.6).addScaledVector(b.u, 0.6 + row * 1.0);
      pl.userData.launch = -1.4 + k * 0.12;
      ctx.planks.push(pl);
    }
    ctx.events = [
      label(ctx, -1.45, 'BUILDING DEFENSES…', { style: 'small', color: '#ffd166' }),
      ...ctx.planks.map((pl, k) => sfx(ctx, pl.userData.launch + 0.35, 'knock', 0.6)),
      label(ctx, -0.15, '…oh.', { style: 'small' }),
      sfx(ctx, ctx.tHit, 'woodSmash', 1.1),
      sfx(ctx, ctx.tHit + 0.05, 'crash', 0.9),
      shake(ctx, ctx.tHit, 0.8, 0.5),
    ];
    ctx.fx.emit({ kind: 'chunk', t0: ctx.tauC + ctx.tHit, count: 40, life: 1.6, color: ['#b5835a', '#8a5a3c', '#d9a066'], scale: 0.7, stretch: 3, origin: () => wallPos.clone().setY(wallPos.y + 1.5), vel: (r, ts, v) => v.copy(b.f).multiplyScalar(8 + r() * 14).add(new THREE.Vector3((r() - 0.5) * 18, 5 + r() * 10, (r() - 0.5) * 18)) });
    ctx.fx.emit({ kind: 'dust', t0: ctx.tauC + ctx.tHit, count: 20, life: 1.5, scale: 1.3, origin: () => wallPos });
  },
  pre(ctx, age, sp) { sp.expr = age > -0.3 ? { lid: 0, brow: 0.6, open: 0.6, wide: 1.3 } : { lid: 0.2, brow: -0.4, smile: 0.5 }; },
  pose(ctx, age, out) {
    const b = ctx.base;
    const tH = ctx.tHit;
    if (age < tH) return poseFrom(out, b, b.speed * age, 0, 0, 0, 0, 0);
    const a = age - tH;
    const fwd = b.speed * tH + skid(a, 16, 1.0);
    const flip = Math.min(Math.PI, a * 5.5);
    const h = Math.max(0, 7 * a - 15 * a * a) + (flip > 2.5 ? 2.2 * smooth((flip - 2.5) / 0.6) : 0);
    poseFrom(out, b, fwd, 0, h, 0.3 * a, -flip, 0.2 * a);
    out.special = { expr: { lid: 0, brow: 0.7, open: 0.9, wide: 1.3 } };
    return out;
  },
  parts(ctx, age) {
    const b = ctx.base;
    ctx.planks.forEach((pl, k) => {
      const la = pl.userData.launch;
      if (age < la) { pl.visible = false; return; }
      pl.visible = true;
      const from = ctx.rootAt(la).pos.clone().addScaledVector(b.u, 3);
      const fl = 0.45;
      const u = clamp((age - la) / fl);
      const slot = pl.userData.slot;
      const p = from.clone().lerp(slot, u);
      p.y += Math.sin(u * Math.PI) * 4;
      pl.quaternion.copy(b.quat);
      pl.rotateY(u < 1 ? u * 6 : 0);
      if (age > ctx.tHit) {
        const a = age - ctx.tHit;
        const r = rng(hash(k, 55));
        p.addScaledVector(b.f, (10 + r() * 12) * Math.min(a, 1.4)).addScaledVector(b.r, (r() - 0.5) * 16 * Math.min(a, 1.4));
        p.y = Math.max(ctx.ground(p.x, p.z) + 0.3, slot.y + (6 + r() * 6) * a - 15 * a * a);
        pl.rotateX(a * 7 * r());
      }
      pl.position.copy(p);
    });
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.55), t1: ctx.at(ctx.tHit + 1.5), kind: 'baseCam', racer: ctx.i, cam: [[ctx.wallDist + 22, -12, 4], [ctx.wallDist + 20, -12, 4.5]], look: 'racer', lookOffset: [0, 1.6, 0], fov: 46 },
    ];
  },
};

// ---------------------------------------------------------------- Out of Space
CRASHES.rocket = {
  lead: 1.1,
  setup(ctx) {
    ctx.events = [
      label(ctx, -1.0, 'THRUST: 9000%', { color: '#5ad1ff', style: 'mono', dur: 1.2 }),
      sfx(ctx, -0.9, 'charge', 0.8),
      sfx(ctx, 0, 'rocket', 1.3),
      shake(ctx, 0, 1.0, 1.0),
      sfx(ctx, 3.3, 'ding', 1.0),
    ];
    const nozzle = (ts) => {
      const r = ctx.rootAt(ts - ctx.tauC);
      return new THREE.Vector3(-3.0, 1.35, 0).applyQuaternion(r.quat).add(r.pos);
    };
    ctx.fx.emit({ kind: 'fire', t0: ctx.tauC - 0.3, t1: ctx.tauC + 3.0, rate: 60, count: 2, life: 0.4, origin: nozzle, vel: (r, ts, v) => { const q = ctx.rootAt(ts - ctx.tauC).quat; return v.set(-20 - r() * 15, (r() - 0.5) * 4, (r() - 0.5) * 4).applyQuaternion(q); } });
    ctx.fx.emit({ kind: 'whiteSmoke', t0: ctx.tauC, t1: ctx.tauC + 3.0, rate: 45, count: 2, life: 3.0, scale: 1.6, origin: nozzle, vel: (r, ts, v) => v.set((r() - 0.5) * 6, -3 - r() * 4, (r() - 0.5) * 6) });
    ctx.fx.emit({ kind: 'whiteSmoke', t0: ctx.tauC, count: 40, life: 2.2, scale: 2.0, origin: () => ctx.rootAt(0).pos, vel: (r, ts, v) => v.set((r() - 0.5) * 30, r() * 4, (r() - 0.5) * 30) });
    const star = textSprite('✦', { color: '#ffffff', size: 120, w: 128, h: 128 });
    star.material.blending = THREE.AdditiveBlending;
    ctx.world.propsRoot.add(star);
    ctx.star = star;
  },
  pre(ctx, age, sp) {
    sp.thrust = 0.6 + smooth((age + 1.1) / 1.1) * 1.4;
    sp.expr = { lid: 0, brow: 0.6, open: 0.6, wide: 1.3 };
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const tilt = smooth(age / 0.35) * (Math.PI / 2 - 0.08);
    const up = 0.5 * 75 * Math.max(0, age - 0.15) ** 2;
    const fwd = skid(age, b.speed, 1.2) * 0.7;
    poseFrom(out, b, fwd, Math.sin(age * 4) * 2, up, Math.sin(age * 9) * 0.1, tilt, age * 3);
    out.hidden = age > 3.4;
    out.special = { thrust: 3, expr: { lid: 0, brow: 0.7, open: 1, wide: 1.4 } };
    return out;
  },
  parts(ctx, age) {
    const s = ctx.star;
    s.visible = age > 3.2 && age < 4.4;
    if (s.visible) {
      const r = ctx.rootAt(3.2);
      s.position.copy(r.pos);
      const k = Math.sin(clamp((age - 3.2) / 1.2) * Math.PI);
      s.scale.set(30 * k, 30 * k, 1);
      s.material.rotation = age * 2;
    }
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.15), t1: ctx.at(0.2), kind: 'follow', racer: ctx.i, offset: [[-10, -4, 2.2], [-8, -5, 1.8]], look: [0, 0, 1.4], fov: 52, name: 'rocket-chase' },
      { t0: ctx.at(0.2), t1: ctx.at(3.8), kind: 'baseCam', racer: ctx.i, cam: [[14, -14, 1.4], [14, -14, 1.6]], look: 'racer', fov: 58, fov2: 46 },
    ];
  },
};

// ---------------------------------------------------------------- Dungeon
CRASHES.dungeon = {
  lead: 1.7,
  setup(ctx) {
    ctx.events = [
      label(ctx, -1.6, 'nom?', { style: 'small' }),
      sfx(ctx, -1.2, 'chomp', 0.9), sfx(ctx, -0.6, 'chomp', 1.0),
      sfx(ctx, -0.1, 'creak', 0.9),
      label(ctx, 0.15, 'TOO MUCH MOUTH', { dur: 1.6 }),
      sfx(ctx, 0.35, 'whoa', 0.8),
      sfx(ctx, 0.9, 'crash', 1.0), shake(ctx, 0.9, 0.7, 0.4),
      sfx(ctx, 1.0, 'coins', 0.9),
    ];
    ctx.fx.emit({ kind: 'coin', t0: ctx.tauC + 0.2, t1: ctx.tauC + 1.4, rate: 35, count: 2, life: 1.4, color: '#ffcf3a', origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().addScaledVector(ctx.base.u, 2.2), vel: (r, ts, v) => v.set((r() - 0.5) * 12, 6 + r() * 8, (r() - 0.5) * 12) });
    ctx.fx.emit({ kind: 'dust', t0: ctx.tauC + 0.9, count: 24, life: 1.3, scale: 1.3, origin: () => ctx.rootAt(0.9).pos });
  },
  pre(ctx, age, sp) {
    const k = smooth((age + 1.7) / 1.7);
    sp.lid = 0.3 + k * 0.9 + Math.max(0, Math.sin(age * 9)) * 0.2 * (1 - k);
    sp.expr = { lid: 0, brow: -0.6, smile: 0.4, wide: 1.2, lookX: 1 };
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const fwd = skid(age, b.speed, 1.5);
    const tip = easeInCubic(clamp(age / 0.7)) * Math.PI * 0.95;
    const roll = smooth((age - 0.7) / 0.6) * 0.5;
    const h = Math.max(0, 4 * age - 6 * age * age) + Math.sin(tip) * 1.2;
    poseFrom(out, b, fwd, 7 * smooth(age / 1.4), h, 0.4 * smooth(age / 1.4), tip, roll);
    out.special = { lid: lerp(1.2, 2.7, smooth(age / 0.3)), expr: { lid: 0, brow: 0.7, open: 0, wide: 1.4, lookY: 1 } };
    return out;
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.75), t1: ctx.at(-0.1), kind: 'follow', racer: ctx.i, offset: [[6.5, 6.5, 3.2], [5.5, 6, 3.4]], look: [0, 1.8, 1.6], fov: 50, name: 'dungeon-eat' },
      { t0: ctx.at(-0.1), t1: ctx.at(1.9), kind: 'baseCam', racer: ctx.i, cam: [[24, 12, 2.0], [22, 13, 2.6]], look: 'racer', lookOffset: [0, 1.5, 0], fov: 46 },
    ];
  },
};

// ---------------------------------------------------------------- Femboys
CRASHES.femboy = {
  lead: 1.0,
  slowmo: [0.0, 2.2, 0.35],
  setup(ctx) {
    ctx.landT = 0.95;
    ctx.events = [
      label(ctx, -0.9, '✨ SLAY ✨', { color: '#ff77c8', dur: 1.2 }),
      sfx(ctx, -0.6, 'sparkle', 0.8),
      sfx(ctx, 0, 'wee', 0.9),
      sfx(ctx, 0.05, 'sparkle', 1.0),
      sfx(ctx, ctx.landT, 'poof', 1.1),
      label(ctx, ctx.landT + 0.05, 'FABULOUS EXIT', { color: '#ff77c8', dur: 1.6 }),
    ];
    const at = () => ctx.rootAt(ctx.landT).pos;
    ctx.fx.emit({ kind: 'glitter', t0: ctx.tauC - 1.0, t1: ctx.tauC + ctx.landT, rate: 80, count: 2, life: 0.9, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().addScaledVector(ctx.base.u, 1.2), vel: (r, ts, v) => v.set((r() - 0.5) * 6, r() * 4, (r() - 0.5) * 6) });
    ctx.fx.emit({ kind: 'confetti', t0: ctx.tauC + ctx.landT, count: 260, life: 3.2, color: ['#ff77c8', '#ffd1ec', '#ffffff', '#ff2d7a', '#c77dff'], origin: at, vel: (r, ts, v) => v.set((r() - 0.5) * 26, 8 + r() * 18, (r() - 0.5) * 26) });
    ctx.fx.emit({ kind: 'heart', t0: ctx.tauC + ctx.landT, count: 30, life: 2.6, color: ['#ff2d7a', '#ff77c8'], origin: at, vel: (r, ts, v) => v.set((r() - 0.5) * 10, 6 + r() * 8, (r() - 0.5) * 10) });
    ctx.fx.emit({ kind: 'purple', t0: ctx.tauC + ctx.landT, count: 26, life: 2.0, color: ['#ffb3df', '#ff77c8', '#ffd1ec'], scale: 0.8, origin: at, vel: (r, ts, v) => v.set((r() - 0.5) * 14, 2 + r() * 5, (r() - 0.5) * 14) });
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const L = ctx.landT;
    const a = Math.min(age, L);
    const fwd = b.speed * 0.8 * a + skid(Math.max(0, age - L), b.speed * 0.3, 0.8);
    const lat = 12 * smooth(age / (L + 0.6));
    const h = Math.max(0, 4.5 * Math.sin(Math.PI * clamp(age / L)));
    const yaw = easeOutCubic(clamp(age / (L + 0.9))) * Math.PI * 2 * 3.25;
    poseFrom(out, b, fwd, lat, h, yaw, 0, Math.sin(clamp(age / L) * Math.PI) * 0.35);
    out.special = { expr: { lid: 0.2, brow: 0.2, smile: 0.9, open: 0.4, wide: 1.1 } };
    return out;
  },
  shots(ctx) {
    return [
      { t0: ctx.at(-1.05), t1: ctx.at(-0.05), kind: 'follow', racer: ctx.i, offset: [[-6, 5.5, 2.0], [-3, 5.5, 2.2]], look: [1.5, 0, 1.2], fov: 48, name: 'fem-pass' },
      { t0: ctx.at(-0.05), t1: ctx.at(1.9), kind: 'baseCam', racer: ctx.i, cam: [[20, -8, 1.6], [21, -10, 2.4]], look: 'racer', lookOffset: [0, 1.5, 0], fov: 50, fov2: 40 },
    ];
  },
};

// ---------------------------------------------------------------- Goth Mommy (also used in the special finale)
CRASHES.goth = {
  lead: 0,
  setup(ctx) {
    const b = ctx.base;
    ctx.explodeAt = ctx.explodeAge ?? 0.5;
    const E = ctx.explodeAt;
    ctx.events = [
      sfx(ctx, 0, 'impact', 1.2),
      sfx(ctx, 0.02, 'skid', 1.0),
      sfx(ctx, 0.15, 'whoa', 0.9),
      sfx(ctx, E, 'explosion', 1.5),
      { t: ctx.at(E), type: 'flash', dur: 0.35 },
      shake(ctx, E, 2.2, 1.2),
      sfx(ctx, E + 0.12, 'bats', 1.0),
    ];
    const boom = () => ctx.rootAt(E).pos.clone().addScaledVector(b.u, 1.5);
    ctx.boomPos = boom;
    const T = ctx.tauC + E;
    ctx.fx.emit({ kind: 'flash', t0: T, count: 1, life: 0.25, scale: 1, origin: boom, vel: (r, ts, v) => v.set(0, 0, 0) });
    ctx.fx.emit({ kind: 'fireball', t0: T, count: 55, life: 1.5, scale: 1.3, origin: boom, vel: (r, ts, v) => v.set(r() - 0.5, r() * 0.8 - 0.1, r() - 0.5).normalize().multiplyScalar(8 + r() * 20) });
    ctx.fx.emit({ kind: 'fire', t0: T, count: 30, life: 0.8, scale: 1.4, origin: boom, vel: (r, ts, v) => v.set(r() - 0.5, r() * 0.8 - 0.2, r() - 0.5).normalize().multiplyScalar(14 + r() * 26) });
    ctx.fx.emit({ kind: 'purple', t0: T + 0.12, count: 60, life: 3.4, scale: 1.7, origin: boom, vel: (r, ts, v) => v.set(r() - 0.5, r() * 0.9, r() - 0.5).normalize().multiplyScalar(10 + r() * 16) });
    ctx.fx.emit({ kind: 'tire', t0: T, count: 4, life: 3.0, scale: 1.15, spin: 9, origin: boom, vel: (r, ts, v) => v.set(r() - 0.5, 0.6 + r() * 0.5, r() - 0.5).normalize().multiplyScalar(26 + r() * 10) });
    ctx.fx.emit({ kind: 'smoke', t0: T + 0.1, count: 30, life: 3.5, scale: 1.8, origin: boom, vel: (r, ts, v) => v.set((r() - 0.5) * 14, 4 + r() * 8, (r() - 0.5) * 14) });
    ctx.fx.emit({ kind: 'bat', t0: T + 0.05, count: 110, life: 3.4, color: ['#0e0b12', '#2a0f3d', '#140a1c'], scale: 1.9, origin: boom, vel: (r, ts, v) => v.set(r() - 0.5, r() * 0.8 + 0.15, r() - 0.5).normalize().multiplyScalar(16 + r() * 26) });
    ctx.fx.emit({ kind: 'spark', t0: T, count: 80, life: 1.4, origin: boom, vel: (r, ts, v) => v.set(r() - 0.5, r() * 0.9, r() - 0.5).normalize().multiplyScalar(20 + r() * 30) });
    ctx.fx.emit({ kind: 'chunk', t0: T, count: 26, life: 2.6, color: ['#121016', '#3b1458', '#c04dff', '#d9d6e6'], scale: 1.1, origin: boom, vel: (r, ts, v) => v.set(r() - 0.5, r() * 0.9 + 0.1, r() - 0.5).normalize().multiplyScalar(14 + r() * 20) });
    ctx.fx.emit({ kind: 'spark', t0: ctx.tauC, t1: ctx.tauC + 0.2, rate: 120, count: 3, life: 0.6, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos.clone().addScaledVector(b.r, 2).addScaledVector(b.u, 1.2), vel: (r, ts, v) => v.copy(b.f).multiplyScalar(-14 - r() * 10).add(new THREE.Vector3((r() - 0.5) * 8, 3 + r() * 6, (r() - 0.5) * 8)) });
    // the driver floats away under a little black parasol (nobody gets hurt in cartoons)
    const para = grp(ctx.world.propsRoot);
    mk(G.hemi(1.6, 10), mat('#141018', { double: true, rough: 0.6 }), para, [0, 3.4, 0], [0, 0, 0], [1, 0.55, 1]);
    mk(G.cyl(0.04, 0.04, 3.4, 4), mat('#c04dff'), para, [0, 1.7, 0]);
    const gal = grp(para, [0, -0.4, 0]);
    mk(G.capsule(0.4, 0.6, 4, 8), mat('#17121c'), gal, [0, 0.6, 0]);
    const hd = grp(gal, [0, 1.6, 0]);
    mk(G.sphere(0.45, 14, 10), mat('#f4e3ea'), hd);
    mk(G.hemi(0.49, 14), mat('#0b0a0f'), hd, [-0.03, 0.02, 0]);
    mk(G.rbox(0.22, 1.2, 0.9, 0.1), mat('#0b0a0f'), hd, [-0.38, -0.45, 0]);
    const { face } = { face: null };
    void face;
    ctx.para = para;
    ctx.debris = [];
    const parts = [];
    for (let k = 0; k < 4; k++) parts.push(ctx.model.wheels[k].obj);
    parts.push(...ctx.model.wings);
    ctx.debris = parts;
  },
  pose(ctx, age, out) {
    const b = ctx.base;
    const E = ctx.explodeAt;
    const a = Math.min(age, E + 0.02);
    const fwd = b.speed * 0.8 * a;
    const lat = -(22 * a + 8 * a * a);
    const h = Math.max(0, 22 * Math.max(0, a - 0.06) - 12 * Math.max(0, a - 0.06) ** 2);
    poseFrom(out, b, fwd, lat, h, -a * 7.5, a * 2.0, -a * 6.5);
    out.hidden = age > E + 0.02;
    out.special = { boost: 1, headYaw: 0.6, expr: { lid: 0, brow: 0.7, open: 0.9, wide: 1.4 } };
    return out;
  },
  parts(ctx, age) {
    const E = ctx.explodeAt;
    const p = ctx.para;
    p.visible = age > E;
    if (p.visible) {
      const a = age - E;
      const bp = ctx.boomPos();
      p.position.copy(bp).addScaledVector(ctx.base.r, -a * 4).add(new THREE.Vector3(0, 6 * Math.min(a, 0.6) - Math.max(0, a - 0.6) * 1.5, 0));
      p.rotation.set(Math.sin(a * 2.2) * 0.25, a * 0.6, Math.cos(a * 1.8) * 0.2);
    }
  },
  shots() { return []; },
};

// ---------------------------------------------------------------- generic fallbacks
CRASHES.scooter = {
  lead: 0.4,
  setup(ctx) { ctx.events = [sfx(ctx, 0, 'skid', 0.8), sfx(ctx, 0.6, 'crash', 0.7), label(ctx, 0.3, 'OOPS', {})]; },
  pose(ctx, age, out) {
    const b = ctx.base;
    poseFrom(out, b, skid(age, b.speed, 1.2), 4 * smooth(age), 0, age * 2, 0, Math.min(1.4, age * 2.5));
    return out;
  },
  shots(ctx) { return [{ t0: ctx.at(-0.5), t1: ctx.at(1.4), kind: 'baseCam', racer: ctx.i, cam: [[14, 6, 2], [15, 7, 2.5]], look: 'racer', fov: 44 }]; },
};
CRASHES.kart = {
  lead: 0.4,
  setup(ctx) {
    ctx.events = [sfx(ctx, 0, 'skid', 1), sfx(ctx, 1.0, 'crash', 0.7), label(ctx, 0.3, 'SPIN OUT!', {})];
    ctx.fx.emit({ kind: 'smoke', t0: ctx.tauC, t1: ctx.tauC + 1.2, rate: 40, count: 1, life: 1.2, origin: (ts) => ctx.rootAt(ts - ctx.tauC).pos });
  },
  pose(ctx, age, out) { return spinOutPose(ctx, age, out, 1, 2, 1.4, 14); },
  shots(ctx) { return [{ t0: ctx.at(-0.5), t1: ctx.at(1.6), kind: 'baseCam', racer: ctx.i, cam: [[26, 8, 2], [27, 9, 3]], look: 'racer', fov: 44 }]; },
};

export function crashFor(type) {
  return CRASHES[type] || CRASHES.kart;
}

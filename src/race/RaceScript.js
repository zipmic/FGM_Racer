import * as THREE from 'three';
import { Curve1D, Table, rng, hash, clamp, smooth, lerp } from '../core/math.js';
import { TimeMap } from '../core/TimeMap.js';
import { computeStandings } from '../config.js';
import { gridSlot } from '../world/Track.js';
import { crashFor } from './crashes.js';

/**
 * Race Director script builder. Turns the configuration into a complete,
 * deterministic plan: elimination schedule, slow-motion map, every racer's
 * progress/lane curves, finale tables, camera shot list and timeline events.
 */

export const GO = 7.9;
const LANES = [-6, 3, -2, 8, -9, 6, 0, -4, 10, -10, 4, -7, 9, -1, 7, -5, 2, -8, 5, -3, 1, -11, 11, -6];

// film-time budget per crash type: seconds of build-up before onset and seconds held after it
const BUDGET = {
  junk: [1.2, 1.35], cart: [0.75, 1.1], tank: [1.2, 1.05], ai: [1.1, 2.1], monster: [0.9, 1.35],
  buggy: [0.55, 1.25], stilts: [1.1, 1.8], gold: [1.1, 0.0], voxel: [0.32, 1.3], buttons: [1.15, 1.85],
  robot: [1.3, 1.9], survival: [1.05, 1.3], rocket: [1.05, 1.8], dungeon: [1.5, 1.7], femboy: [1.0, 1.7],
  goth: [0.5, 1.8], scooter: [0.5, 1.4], kart: [0.5, 1.5],
};
// pairs that happen together in one shot (follower starts `offset` s after leader)
const CHAINS = { buggy: { stilts: 0.5 }, buttons: { robot: 0.55 } };

export function buildPlan(themes, world) {
  const track = world.track;
  const L = track.length;
  const standings = computeStandings(themes);
  if (standings.length < 2) throw new Error('Der skal mindst være 2 deltagende temaer.');
  const N = standings.length;
  const plan = { L, N, GO, standings, world };

  // ------------------------------------------------------------ racers & roles
  const racers = standings.map((th, i) => ({
    i,
    name: th.name,
    color: th.color,
    type: th.vehicle,
    votes: th.votes,
    place: th.place,
    rank: i,
    crash: null,
    role: i === 0 ? 'W' : i === 1 ? 'R' : 'C',
    dKeys: [],
    lKeys: [],
    wobble: th.vehicle === 'buggy' ? 2.6 : th.vehicle === 'rocket' ? 0.8 : 0,
  }));
  plan.racers = racers;
  const W = 0, R = 1;
  plan.W = W;
  plan.R = R;
  plan.special = racers[W].type === 'scooter' && racers[R].type === 'goth';
  plan.ending = racers[W].type === 'scooter' ? 'escape' : 'celebrate';

  const elim = racers.slice(2).reverse(); // first eliminated first
  const F = Math.min(3, elim.length);
  const chaos = elim.slice(0, elim.length - F);
  const final5 = elim.slice(elim.length - F);
  final5.forEach((r, k) => (r.role = `E${F - k}`)); // E3 = last before the duel… E1 first
  // relabel so E1 is the first final-five elimination
  final5.forEach((r, k) => (r.role = `E${k + 1}`));

  // grid: runner-up on pole, winner at the very back, the rest shuffled deterministically
  const rr = rng(2026);
  const others = racers.filter((r) => r.i !== W && r.i !== R);
  for (let k = others.length - 1; k > 0; k--) {
    const j = Math.floor(rr() * (k + 1));
    [others[k], others[j]] = [others[j], others[k]];
  }
  const gridOrder = [racers[R], ...others, racers[W]];
  gridOrder.forEach((r, k) => (r.grid = gridSlot(k)));
  plan.gridOrder = gridOrder.map((r) => r.i);

  // ------------------------------------------------------------ elimination schedule (film time)
  let t = 9.45;
  const schedule = [];
  for (let k = 0; k < chaos.length; k++) {
    const r = chaos[k];
    const [pre, hold] = BUDGET[r.type] || BUDGET.kart;
    const onset = t + pre;
    const def = crashFor(r.type);
    r.crash = { type: r.type, def, t: onset };
    let end = onset + hold;
    const nxt = chaos[k + 1];
    const chainOff = nxt && CHAINS[r.type] && CHAINS[r.type][nxt.type];
    if (chainOff !== undefined) {
      const [, h2] = BUDGET[nxt.type];
      nxt.crash = { type: nxt.type, def: crashFor(nxt.type), t: onset + chainOff, chainedTo: r.i };
      r.crash.chainFollower = nxt.i;
      end = Math.max(end, onset + chainOff + h2);
      schedule.push(r, nxt);
      k++;
    } else {
      schedule.push(r);
    }
    t = end;
  }
  const F0 = chaos.length ? t + 0.05 : 12;
  plan.F0 = F0;
  // final five
  let ft = F0 + 2.0;
  final5.forEach((r, k) => {
    const [pre, hold] = BUDGET[r.type] || BUDGET.kart;
    const onset = ft + pre;
    r.crash = { type: r.type, def: crashFor(r.type), t: onset };
    ft = onset + hold + (k < F - 1 ? 0.3 : 0);
  });
  const D = Math.max(ft + 0.95, F0 + 3);
  plan.D = D;

  // ------------------------------------------------------------ slow motion map
  const rate = [[0, 1]];
  const addWindow = (a, b, r0, rampIn = 0.1, rampOut = 0.15) => {
    rate.push([a - rampIn, 1], [a, r0], [b, r0], [b + rampOut, 1]);
  };
  for (const r of [...chaos, ...final5]) {
    const sm = r.crash.def.slowmo;
    if (sm) addWindow(r.crash.t + sm[0], r.crash.t + sm[1], sm[2]);
  }
  const S = plan.special;
  const T = {}; // named finale times
  if (S) {
    Object.assign(T, {
      hack: D + 11.6, launch: D + 17.7, bullet: D + 18.25, push: D + 21.25,
    });
    T.slowEnd = T.push + 5.05;
    T.E0 = T.slowEnd + 2.5;
    rate.push(
      [T.hack - 0.3, 1], [T.hack + 0.1, 0.035], [T.launch - 0.02, 0.035], [T.launch, 1],
      [T.bullet - 0.05, 1], [T.bullet + 0.05, 0.25], [T.push - 0.75, 0.25], [T.push - 0.4, 0.15],
      [T.slowEnd, 0.15], [T.slowEnd + 0.3, 0.32], [T.slowEnd + 1.9, 0.32], [T.slowEnd + 2.2, 1]
    );
  } else {
    Object.assign(T, { pass: D + 17.0, cross: D + 20 });
    rate.push([T.pass - 0.2, 1], [T.pass, 0.4], [T.pass + 1.4, 0.4], [T.pass + 1.6, 1]);
  }
  rate.sort((a, b) => a[0] - b[0]);
  const duration = S ? T.E0 + 14.4 : D + (plan.ending === 'escape' ? 40 : 32);
  const tm = new TimeMap(rate, duration);
  plan.timeMap = tm;
  plan.duration = duration;
  plan.tauGO = tm.tau(GO);
  plan.T = T;
  const tau = (x) => tm.tau(x);
  racers.forEach((r) => {
    if (r.crash) r.crash.tau = tau(r.crash.t);
  });

  // ------------------------------------------------------------ pack speed shape U(τ) (P = V·U)
  const shape = new Curve1D([[0, 0], [GO, 0], [GO + 0.6, 0.25], [GO + 2.6, 1], [F0, 1], [F0 + 1.5, 1.08], [D, 1.08], [D + 1, 1.12]], 'monotone');
  const dTau = 1 / 200;
  const tauEnd = tm.tau(duration) + 2;
  const nU = Math.ceil(tauEnd / dTau) + 2;
  const U = new Float64Array(nU);
  for (let k = 1; k < nU; k++) {
    const tk = tm.tOf(k * dTau);
    U[k] = U[k - 1] + shape.at(tk) * dTau;
  }
  const Utab = new Table(0, dTau, U);

  // ------------------------------------------------------------ pack keyframes (relative offsets d, lanes)
  const keyT = [];
  for (let x = GO + 2.6; x < F0 + 0.5; x += 2.4) keyT.push(x);
  let order = gridOrder.map((r) => r.i).filter((i) => i !== W);
  const crashT = (i) => (racers[i].crash ? racers[i].crash.t : Infinity);
  racers.forEach((r) => {
    r.dKeys.push([0, r.grid.s], [GO, r.grid.s]);
    r.lKeys.push([0, r.grid.lateral], [GO, r.grid.lateral], [GO + 0.9, r.grid.lateral]);
  });
  keyT.forEach((T0, step) => {
    const active = order.filter((i) => crashT(i) > T0 + 0.2);
    // a few deterministic overtakes per step
    const rs = rng(hash(step, 99));
    for (let s = 0; s < 3; s++) {
      const k = Math.floor(rs() * (active.length - 1));
      if (k >= 0 && k + 1 < active.length) [active[k], active[k + 1]] = [active[k + 1], active[k]];
    }
    // the runner-up stays near the front
    const ri = active.indexOf(R);
    if (ri > 1) { active.splice(ri, 1); active.splice(1, 0, R); }
    // the winner climbs slowly from the back as others crash
    const wFrac = clamp((T0 - GO - 6) / (F0 - GO - 6));
    const total = active.length + 1;
    const wRank = Math.round(lerp(total - 1, Math.min(total - 1, 3), wFrac * wFrac));
    const ordered = active.slice();
    ordered.splice(Math.min(wRank, ordered.length), 0, W);
    const gap = lerp(5.6, 7, 1 - ordered.length / Math.max(1, N));
    ordered.forEach((i, rank) => {
      const r = racers[i];
      const jit = (rs() - 0.5) * 2.5;
      r.dKeys.push([T0, 6 - rank * gap + jit]);
      r.lKeys.push([T0, LANES[(rank + step) % LANES.length] * 0.95]);
    });
    order = ordered.filter((i) => i !== W);
  });

  // crash lane / ram constraints
  for (const r of [...chaos, ...final5]) {
    const def = r.crash.def;
    const tc = r.crash.t;
    if (def.side && r.role === 'C') {
      const lane = def.side === 'right' ? 10.5 : -10.5;
      r.lKeys = r.lKeys.filter(([x]) => x < tc - 2.6 || x > tc + 0.1);
      r.lKeys.push([tc - 1.7, lane], [tc, lane]);
    }
  }
  // chained followers sit next to / behind their leader
  for (const r of chaos) {
    if (r.crash.chainedTo === undefined) continue;
    const lead = racers[r.crash.chainedTo];
    const tc = lead.crash.t;
    const dl = new Curve1D(lead.dKeys, 'monotone');
    const ll = new Curve1D(lead.lKeys, 'monotone');
    const behind = r.type === 'stilts' ? -9 : 0;
    const side = r.type === 'robot' ? 6.5 : -7;
    r.dKeys = r.dKeys.filter(([x]) => x < tc - 2.8 || x > tc + 1);
    r.lKeys = r.lKeys.filter(([x]) => x < tc - 2.8 || x > tc + 1);
    for (const off of [-1.9, -0.8, 0, 0.6]) {
      r.dKeys.push([tc + off, dl.at(tc + off) + behind]);
      r.lKeys.push([tc + off, clamp(ll.at(tc + off) + side, -11, 11)]);
    }
  }
  // the 8-bit racer rams whoever stopped just in front of it
  for (let k = 1; k < chaos.length; k++) {
    const r = chaos[k];
    const prev = chaos[k - 1];
    if (!r.crash.def.ram || r.crash.t - prev.crash.t > 0.8) continue;
    r.crash.rams = prev.i;
    prev.crash.rammedBy = r.i;
    // keep both at the back of the pack around the crash, same lane
    const tc = prev.crash.t;
    for (const x of [prev, r]) {
      x.dKeys = x.dKeys.filter(([kx]) => kx < tc - 4.5 || kx > tc + 1.5);
      x.lKeys = x.lKeys.filter(([kx]) => kx < tc - 4.5 || kx > tc + 1.5);
    }
    const back = -6 - (racers.filter((q) => crashT(q.i) > tc).length + 1) * 6;
    prev.dKeys.push([tc - 2.6, back], [tc, back]);
    prev.lKeys.push([tc - 2.6, -3], [tc, -3]);
    r.ramPending = { tc, prevI: prev.i, back };
  }

  // ------------------------------------------------------------ final five choreography
  const F5 = {
    R: [[0, 6, -6], [2, 3, -6], [3.5, 6, -3], [6, 7, -6], [8.5, 8, -4], [9.6, 6, -4], [11.3, 9, -4], [13, 9, -5]],
    W: [[0, -10, 4], [2, -7, 8], [3.5, -4, 6], [5.5, -6, 3], [7, -5, 2], [8.5, -2, 2], [10, 0, 6], [11.3, 1, 5], [13, 4, 5]],
    E3: [[0, 3, 6], [2, 7, 3], [3.5, 2, 7], [6, 3, 7], [8.5, 3, 7]],
    E2: [[0, -3, 0], [2, -1, -1], [3.5, -1, -8], [5.4, -7, -1]],
    E1: [[0, -6, -2], [2, -3, 9], [3.2, 0, 9]],
  };
  const f5Span = D - 0.95 - F0;
  const remap5 = (x) => F0 + (x / 13) * (f5Span + 0.95);
  // Align the authored beats with the actual crash onsets.
  const e = (role) => racers.find((r) => r.role === role);
  const addF5 = (r, keys, cut) => {
    if (!r) return;
    r.dKeys = r.dKeys.filter(([x]) => x < F0 - 2.2);
    r.lKeys = r.lKeys.filter(([x]) => x < F0 - 2.2);
    keys.forEach(([x, d, l]) => {
      const tt = remap5(x);
      if (cut !== undefined && tt > cut + 0.2) return;
      r.dKeys.push([tt, d]);
      r.lKeys.push([tt, l]);
    });
  };
  addF5(racers[R], F5.R);
  addF5(racers[W], F5.W);
  const e1 = e('E1'), e2 = e('E2'), e3 = e('E3');
  if (F === 3) {
    addF5(e3, F5.E3, e3.crash.t);
    addF5(e2, F5.E2, e2.crash.t);
    addF5(e1, F5.E1, e1.crash.t);
  } else {
    final5.forEach((r, k) => addF5(r, [F5.E3, F5.E2, F5.E1][k], r.crash.t));
  }
  // final-five crash staging relative to their targets
  if (e3) {
    const tc = e3.crash.t;
    e3.dKeys = e3.dKeys.filter(([x]) => x < tc - 1.5);
    e3.lKeys = e3.lKeys.filter(([x]) => x < tc - 1.5);
    const dr = new Curve1D(racers[R].dKeys, 'monotone');
    e3.dKeys.push([tc - 1.0, dr.at(tc - 1.0) - 2], [tc, dr.at(tc) + 4]);
    e3.lKeys.push([tc - 1.0, 7], [tc, 2.5]);
  }
  if (e2 && e2.type === 'dungeon') {
    const tc = e2.crash.t;
    const dw = new Curve1D(racers[W].dKeys, 'monotone');
    const lw = new Curve1D(racers[W].lKeys, 'monotone');
    e2.dKeys = e2.dKeys.filter(([x]) => x < tc - 1.8);
    e2.lKeys = e2.lKeys.filter(([x]) => x < tc - 1.8);
    e2.dKeys.push([tc - 1.2, dw.at(tc - 1.2) - 1.5], [tc, dw.at(tc) - 1.0]);
    e2.lKeys.push([tc - 1.2, lw.at(tc - 1.2) - 3.6], [tc, lw.at(tc) - 3.5]);
  }

  // ------------------------------------------------------------ build curves (keys in film time → τ)
  const toTauCurve = (keys) => new Curve1D(keys.map(([x, y]) => [tau(x), y]), 'monotone');
  // winner's slow comedic launch is defined against the pack, so it needs P
  const finishSetup = (V) => {
    const P = (tt) => V * Utab.at(tt);
    const w = racers[W];
    const g0 = w.grid.s;
    const launch = (x) => (x < 2.5 ? 7 * x * x : 43.75 + 35 * (x - 2.5) + 4 * (x - 2.5) ** 2);
    w.dKeysFinal = w.dKeys.filter(([x]) => x <= GO || x > GO + 7.2);
    for (let x = 0.5; x <= 7.0; x += 0.5) w.dKeysFinal.push([GO + x, g0 + launch(x) - P(tau(GO + x))]);
    return P;
  };

  // finale progress tables for W & R
  const vGKeys = S
    ? [[D - 1, 1.12], [D + 1, 1.2], [D + 7, 1.2], [D + 9.5, 1.33], [D + 60, 1.33]]
    : [[D - 1, 1.12], [D + 1, 1.18], [D + 8, 1.2], [D + 20, 1.22], [D + 40, 1.22]];
  const gKeysAuthored = S
    ? [[D + 1.0, -3.5], [D + 4.5, -2.0], [D + 6.0, -5], [D + 8.0, -16], [D + 10.0, -38], [T.hack, -60], [T.launch, -64], [T.launch + 0.6, -46], [T.bullet + 0.9, -24], [T.push - 0.9, -6], [T.push - 0.35, -1.6], [T.push, 1.0]]
    : [[D + 1.0, -4], [D + 5, -3], [D + 8, -10], [D + 12, -14], [D + 15, -16], [T.pass, -9], [T.pass + 1.2, 3], [D + 20, 15], [D + 21.5, 26]];

  const buildFinale = (V, P) => {
    const w = racers[W], r = racers[R];
    const dW = toTauCurve(w.dKeysFinal), dR = toTauCurve(r.dKeys);
    const t0 = D - 1, tau0 = tau(t0);
    const sR0 = P(tau0) + dR.at(tau0), sW0 = P(tau0) + dW.at(tau0);
    const vG = toTauCurve(vGKeys);
    const n = Math.ceil((tauEnd - tau0) / dTau) + 2;
    const sR = new Float64Array(n);
    sR[0] = sR0;
    for (let k = 1; k < n; k++) sR[k] = sR[k - 1] + V * vG.at(tau0 + k * dTau) * dTau;
    const RT = new Table(tau0, dTau, sR);
    const g = toTauCurve([[t0, sW0 - sR0], ...gKeysAuthored]);
    const tauPass = S ? tau(T.push) : tau(gKeysAuthored[gKeysAuthored.length - 1][0]);
    const sW = new Float64Array(n);
    let tauCross = null, v = 0;
    const tauAccel = S ? tau(T.slowEnd + 2.2) : tau(T.pass + 6);
    for (let k = 0; k < n; k++) {
      const tk = tau0 + k * dTau;
      if (tk <= tauPass) {
        sW[k] = RT.at(tk) + g.at(tk);
        if (k > 0) v = (sW[k] - sW[k - 1]) / dTau;
      } else {
        let target;
        if (plan.ending === 'escape') {
          if (S) {
            const c = tauCross ?? Infinity;
            target = tk < c + 0.15 ? 300 : lerp(300, 175, smooth((tk - c - 0.15) / 0.4));
          } else target = Math.max(v, 175);
          if (tk > tauAccel) target = Math.min(900, 175 + 34 * (tk - tauAccel));
          v = S && tk < tauPass + 0.12 ? lerp(v, target, 0.2) : target;
        } else {
          // generic: coast after the line, brake to a stop near the end of the straight
          const c = tauCross ?? Infinity;
          target = tk < c ? Math.max(v, V * 1.3) : Math.max(0, V * 1.3 * (1 - (tk - c) / 3.2));
          v = target;
        }
        sW[k] = sW[k - 1] + v * dTau;
      }
      if (tauCross === null && sW[k] >= L) tauCross = tk;
    }
    const WT = new Table(tau0, dTau, sW);
    // generic: runner-up brakes after the line too
    if (!S) {
      let c2 = null;
      for (let k = 1; k < n; k++) {
        const tk = tau0 + k * dTau;
        if (c2 === null && sR[k - 1] >= L) c2 = tk;
        if (c2 !== null) sR[k] = sR[k - 1] + Math.max(0, V * 1.22 * (1 - (tk - c2) / 3.0)) * dTau;
      }
    }
    return { RT, WT, tau0, tauCross };
  };
  const evalV = (V) => {
    const P = finishSetup(V);
    const f = buildFinale(V, P);
    const probe = S ? f.RT.at(tau(T.push)) - (L - 225) : f.WT.at(tau(T.cross)) - L;
    return { P, f, probe };
  };
  const a = evalV(50), b = evalV(60);
  const V = 50 + (-a.probe * 10) / (b.probe - a.probe);
  const fin = evalV(V);
  plan.V = V;
  const Pfn = fin.P;
  plan.P = (x) => Pfn(x);
  racers[W].dKeys = racers[W].dKeysFinal;

  // runner-up lanes in the finale, winner lanes
  if (S) {
    racers[R].lKeys = racers[R].lKeys.filter(([x]) => x < D - 0.5).concat([[D + 0.5, -5], [T.push - 0.9, -5], [T.push - 0.3, -2.4], [T.push, -2.2]]);
    racers[W].lKeys = racers[W].lKeys.filter(([x]) => x < D - 0.5).concat([[D + 0.5, 5], [T.launch, 5], [T.push - 1.2, 3.4], [T.push - 0.35, 1.4], [T.push, 0.9], [T.push + 0.8, 3]]);
  } else {
    racers[R].lKeys = racers[R].lKeys.filter(([x]) => x < D - 0.5).concat([[D + 0.5, -4], [T.pass, -3], [T.pass + 1.5, -5]]);
    racers[W].lKeys = racers[W].lKeys.filter(([x]) => x < D - 0.5).concat([[D + 0.5, 5], [T.pass - 0.5, 3], [T.pass + 1.5, 3]]);
  }

  racers.forEach((r) => {
    r.dCurve = toTauCurve(r.dKeys);
    r.lCurve = toTauCurve(r.lKeys);
  });
  racers[W].table = fin.f.WT;
  racers[R].table = fin.f.RT;
  racers[W].tableFrom = fin.f.tau0;
  racers[R].tableFrom = fin.f.tau0;
  // the special finale: Goth Mommy gets shoved out at the push
  if (S) racers[R].crash = { type: 'goth', def: crashFor('goth'), t: T.push, tau: tau(T.push), explodeAge: 0.5, finale: true };
  plan.tauCross = fin.f.tauCross ?? tau(duration);
  plan.tCross = tm.tOf(plan.tauCross);
  T.cross = plan.tCross;

  // ram: place the 8-bit right behind the stopped car at impact
  for (const r of racers) {
    if (!r.ramPending) continue;
    const { prevI } = r.ramPending;
    const prev = racers[prevI];
    const tcPrev = prev.crash.t;
    const tauHit = r.crash.tau;
    // stopped position of the leader: s at its onset + braking distance
    const sPrev = plan.P(prev.crash.tau) + prev.dCurve.at(prev.crash.tau);
    const vPrev = (plan.P(prev.crash.tau + 0.01) + prev.dCurve.at(prev.crash.tau + 0.01) - sPrev) / 0.01;
    const age = tauHit - prev.crash.tau;
    const stopDist = age >= 0.38 ? (vPrev * 0.38) / 2 : vPrev * age - (0.5 * vPrev * age * age) / 0.38;
    const sHit = sPrev + stopDist - 4.9;
    const dHit = sHit - plan.P(tauHit);
    r.dKeys = r.dKeys.filter(([x]) => x < tcPrev - 4.5 || x > r.crash.t + 1);
    r.dKeys.push([tcPrev - 2.6, dHit - 8], [r.crash.t - 0.35, dHit - 0.9], [r.crash.t, dHit]);
    r.lKeys = r.lKeys.filter(([x]) => x < tcPrev - 4.5 || x > r.crash.t + 1);
    r.lKeys.push([tcPrev - 2.6, -3], [r.crash.t, -3]);
    r.dCurve = toTauCurve(r.dKeys);
    r.lCurve = toTauCurve(r.lKeys);
  }

  plan.progress = (i, ta) => {
    const r = racers[i];
    if (r.table && ta >= r.tableFrom) return r.table.at(ta);
    return Pfn(ta) + r.dCurve.at(ta);
  };
  plan.lateral = (i, ta) => {
    const r = racers[i];
    let l = r.lCurve.at(ta);
    if (r.wobble && ta > plan.tauGO) l += Math.sin(ta * 2.7 + i) * r.wobble * smooth((ta - plan.tauGO) / 2);
    return l;
  };

  plan.eliminations = racers.filter((r) => r.crash).sort((x, y) => x.crash.t - y.crash.t).map((r) => ({ i: r.i, t: r.crash.t }));
  plan.chaos = chaos.map((r) => r.i);
  plan.final5 = final5.map((r) => r.i);

  buildPresentation(plan);
  return plan;
}

// ============================================================================ presentation
function buildPresentation(plan) {
  const { racers, W, R, D, T, F0 } = plan;
  const S = plan.special;
  const tm = plan.timeMap;
  const shots = [];
  const ev = [];
  const sfx = (t, name, vol = 1) => ev.push({ t, type: 'sfx', name, vol });
  const label = (t, text, o = {}) => ev.push({ t, type: 'label', text, dur: o.dur ?? 1.6, racer: o.racer, style: o.style ?? 'pop', color: o.color, y: o.y });
  const byType = (type) => racers.find((r) => r.type === type && r.i !== W && r.i !== R);

  // ------------------------------------------------------------ opening
  plan.countdown = { lights: [GO - 1.65, GO - 1.1, GO - 0.55], go: GO };
  shots.push({
    t0: 0, t1: 2.9, kind: 'path', fog: 0.0006,
    points: [[760, 320, -720], [430, 190, -300], [140, 70, 70], [25, 24, 64]],
    looks: [[-200, 0, -170], [-80, 0, -60], [-25, 0, 0], [-32, 2, 0]],
  });
  label(0.5, 'FUTURE GAME MAKERS JAM 2026 #2', { style: 'title', dur: 2.4 });
  const glimpse = [];
  glimpse.push({ r: R, off: [[9, -5.5, 0.6], [7.5, -4.6, 0.8]], look: [0, 0, 2.2], dur: 0.9, sfx: 'revBig' });
  for (const [type, off, look, s] of [
    ['monster', [[8, -5, 3], [7, -4, 3.6]], [0, 0, 5.2], 'roarSmall'],
    ['rocket', [[-2.5, -8, 1.8], [-1.2, -7, 1.6]], [-0.8, 0, 1.4], 'rocketIdle'],
    ['dungeon', [[8.5, -3.6, 3.2], [7.2, -3.0, 3.2]], [1.2, 0, 2.4], 'chomp'],
  ]) {
    const r = byType(type);
    if (r) glimpse.push({ r: r.i, off, look, dur: 0.58, sfx: s });
  }
  let gt = 2.9;
  while (glimpse.length < 4) {
    const r = racers.find((x) => x.i !== W && !glimpse.some((g) => g.r === x.i));
    if (!r) break;
    glimpse.push({ r: r.i, off: [[6, -4, 2], [5, -3.5, 2.2]], look: [0, 0, 1.5], dur: 0.6 });
  }
  for (const g of glimpse) {
    shots.push({ t0: gt, t1: gt + g.dur, kind: 'follow', racer: g.r, offset: g.off, look: g.look, fov: 40 });
    label(gt + 0.05, racers[g.r].name.toUpperCase(), { style: 'tag', dur: g.dur - 0.05, color: racers[g.r].color });
    if (g.sfx) sfx(gt + 0.05, g.sfx, 0.9);
    gt += g.dur;
  }
  // the hero: a tiny scooter between giants
  const heroEnd = GO - 1.65;
  shots.push({ t0: gt, t1: heroEnd, kind: 'follow', racer: W, offset: [[7.5, -5.0, 2.4], [5.2, -3.4, 2.5]], look: [0, 0, 1.9], fov: 40 });
  label(gt + 0.05, racers[W].name.toUpperCase(), { style: 'tag', dur: heroEnd - gt - 0.1, color: racers[W].color });
  sfx(gt + 0.35, 'meep', 1.0);
  shots.push({ t0: heroEnd, t1: GO, kind: 'static', pos: [16, 0.9, -7], look: [-30, 6.5, 1], fov: 56 });
  plan.countdown.lights.forEach((x, k) => {
    sfx(x, 'beepLow', 1);
    label(x, String(3 - k), { style: 'count', dur: 0.5 });
  });
  sfx(GO, 'beepHigh', 1);
  sfx(GO + 0.05, 'launch', 0.9);
  label(GO, 'GO!', { style: 'count', dur: 0.8, color: '#3dff7a' });
  shots.push({ t0: GO, t1: 9.45, kind: 'static', pos: [10, 0.6, -13.8], look: { racer: R, offset: [0, 1.8, 0], lag: 0.12 }, fov: 58, blur: 0.2 });

  // ------------------------------------------------------------ crash shots + fillers
  const crashShots = [];
  const crashers = racers.filter((r) => r.crash && !r.crash.finale).sort((a, b) => a.crash.t - b.crash.t);
  plan.crashCtxShots = crashers; // resolved later by the director (needs crash bases)
  const blocks = [];
  for (const r of crashers) {
    if (r.crash.chainedTo !== undefined) continue;
    const [pre, hold] = BUDGET[r.type] || BUDGET.kart;
    let hold2 = hold;
    if (r.crash.chainFollower !== undefined) {
      const f = racers[r.crash.chainFollower];
      hold2 = Math.max(hold, f.crash.t - r.crash.t + (BUDGET[f.type] || BUDGET.kart)[1]);
    }
    blocks.push({ i: r.i, t0: r.crash.t - pre, t1: r.crash.t + hold2, follower: r.crash.chainFollower });
  }
  plan.crashBlocks = blocks;

  // fillers: chaos & final five
  const fillers = [];
  const addFiller = (a, b, idx, target) => {
    if (b - a < 0.3) return;
    const kinds = ['aerial', 'side', 'chase', 'front'];
    const kind = kinds[idx % kinds.length];
    fillers.push({ t0: a, t1: b, kind: 'filler', style: kind, racer: target });
  };
  let cur = 9.45;
  blocks.forEach((bk, k) => {
    if (bk.t0 > cur + 0.05) addFiller(cur, bk.t0, k, bk.i);
    cur = Math.max(cur, bk.t1);
  });
  // final five intro
  plan.f5intro = [F0, F0 + 2.0];

  // ------------------------------------------------------------ finale shots
  if (S) {
    shots.push(
      { t0: D - 0.95, t1: D, kind: 'follow', racer: W, offset: [[-4, 11, 2.2], [-2, 12, 2.4]], look: [7, -8, 1.6], fov: 46 },
      { t0: D, t1: D + 2.2, kind: 'follow', racer: R, offset: [[11, -9, 0.6], [9, -8, 0.8]], look: [0, 0, 2.2], fov: 46, letterbox: 1 },
      { t0: D + 2.2, t1: D + 3.4, kind: 'follow', racer: W, offset: [[0.5, 2.7, 0.35], [0.1, 2.5, 0.35]], look: [0.1, 0, 0.3], fov: 32 },
      { t0: D + 3.4, t1: D + 4.8, kind: 'follow', racer: W, anchor: 'head', offset: [[2.4, 0.9, -0.3], [1.9, 0.6, -0.32]], look: [0, 0, -0.08], fov: 34 },
      { t0: D + 4.8, t1: D + 6.2, kind: 'follow', racer: R, anchor: 'head', offset: [[3.0, -1.4, 0.35], [2.5, -1.1, 0.25]], look: [0, 0, 0], fov: 30 },
      { t0: D + 6.2, t1: D + 9.0, kind: 'follow', racer: W, offset: [[-5, 0.8, 1.6], [-6.5, 0.4, 1.9]], look: [20, -6, 2.0], fov: 52 },
      { t0: D + 8.4, t1: D + 10.1, kind: 'static', pos: [46, 6.5, -9], look: { racer: R, offset: [0, 2, 0], lag: 0.05 }, fov: 11, fov2: 8.5 },
      { t0: D + 10.1, t1: T.hack, kind: 'static', pos: [16, 0.9, -12.5], look: { racer: R, offset: [0, 2.2, 0], lag: 0.05 }, fov: 24, fov2: 18 },
      // the hack
      { t0: T.hack, t1: T.hack + 1.3, kind: 'follow', racer: W, anchor: 'head', offset: [[3.4, 0.5, -0.35], [2.0, 0.3, -0.25]], look: [0, 0, -0.06], fov: 30, fov2: 19 },
      { t0: T.hack + 1.3, t1: T.hack + 1.9, kind: 'follow', racer: W, anchor: 'head', offset: [[1.6, 0.12, -0.2], [1.45, 0.1, -0.18]], look: [0, 0, -0.05], fov: 19, fov2: 17 },
      { t0: T.hack + 1.9, t1: T.hack + 2.6, kind: 'follow', racer: W, offset: [[0.05, -0.75, 3.05], [0.12, -0.7, 2.95]], look: [0.64, 0, 2.08], fov: 32, fov2: 26 },
      { t0: T.hack + 2.6, t1: T.hack + 5.0, kind: 'follow', racer: W, offset: [[3.4, -1.6, 3.1], [3.0, -1.2, 3.05]], look: [0.9, 0.25, 2.85], fov: 42 },
      { t0: T.hack + 5.0, t1: T.launch, kind: 'follow', racer: W, offset: [[4.6, 2.1, 1.2], [3.8, 1.7, 1.3]], look: [0, 0, 2.0], fov: 48, shake: 0.25 },
      // the absurd overtake
      { t0: T.launch, t1: T.launch + 0.55, kind: 'trackcam', racer: W, at: T.launch, place: [5, 7.5, 1.2], fov: 50, blur: 0.8, shake: 0.6 },
      { t0: T.launch + 0.55, t1: T.launch + 1.1, kind: 'follow', racer: W, offset: [[0.55, 2.3, 0.42]], look: [0.2, 0, 0.3], fov: 34, blur: 0.7 },
      { t0: T.launch + 1.1, t1: T.launch + 1.65, kind: 'follow', racer: W, anchor: 'head', offset: [[1.9, 0.4, 0.1]], look: [0, 0, 0], fov: 30, blur: 0.5, shake: 0.35 },
      { t0: T.launch + 1.65, t1: T.launch + 2.65, kind: 'follow', racer: R, anchor: 'head', offset: [[2.6, 1.2, 0.35], [2.4, 1.3, 0.3]], look: [-7, 3.2, -0.5], fov: 46 },
      { t0: T.launch + 2.65, t1: T.push + 0.35, kind: 'follow', racer: W, offset: [[9, 2.6, 1.0], [5.5, 1.4, 1.3]], look: [0, -2.6, 1.6], fov: 48, blur: 0.3 },
      { t0: T.push + 0.35, t1: 0, kind: 'money', fov: 50 },
      { t0: -1, t1: 0, kind: 'static', pos: [4, 1.0, -17.5], look: [-1.5, 1.4, 9], fov: 44, blur: 0.4, name: 'cross' },
    );
  } else {
    shots.push(
      { t0: D - 0.95, t1: D, kind: 'follow', racer: W, offset: [[-4, 11, 2.2], [-2, 12, 2.4]], look: [7, -8, 1.6], fov: 46 },
      { t0: D, t1: D + 3, kind: 'follow', racer: R, offset: [[11, -9, 0.8], [9, -8, 1.0]], look: [0, 0, 1.8], fov: 46, letterbox: 1 },
      { t0: D + 3, t1: D + 5, kind: 'follow', racer: W, offset: [[6, 5, 2.4], [5, 4, 2.4]], look: [0, 0, 1.8], fov: 40 },
      { t0: D + 5, t1: D + 8, kind: 'follow', racer: R, offset: [[-12, 4, 4], [-14, 3, 4.5]], look: [10, 0, 1.5], fov: 50 },
      { t0: D + 8, t1: D + 11, kind: 'aerial', racers: [W, R], height: 22, back: 26, fov: 50 },
      { t0: D + 11, t1: D + 14, kind: 'follow', racer: W, offset: [[-6, 2, 2], [-7, 1.5, 2.3]], look: [20, -5, 2], fov: 50 },
      { t0: D + 14, t1: T.pass - 0.4, kind: 'static', pos: [-3, 10, -11], look: { racer: R, offset: [0, 2, 0] }, fov: 22 },
      { t0: T.pass - 0.4, t1: T.pass + 1.8, kind: 'follow', racer: W, offset: [[11, 7, 2.2], [6, 8, 2.4]], look: [0, -3, 1.5], fov: 50 },
      { t0: T.pass + 1.8, t1: plan.tCross + 0.6, kind: 'static', pos: [16, 0.9, -12.5], look: { racer: W, offset: [0, 1.5, 0], lag: 0.05 }, fov: 34 },
    );
  }

  // ------------------------------------------------------------ ending
  const C = plan.tCross;
  plan.winnerAt = C + 0.15;
  const crossShot = shots.find((x) => x.name === 'cross');
  if (crossShot) {
    crossShot.t0 = C - 0.4;
    crossShot.t1 = C + 0.15;
  }
  if (plan.ending === 'escape') {
    const E0 = S ? T.E0 : C + 2.6;
    shots.push(
      { t0: S ? 0 : C + 0.6, t1: E0, kind: 'static', pos: [30, 3.2, -16], look: [-6, 7.5, 9], fov: 54, winner: true },
      { t0: E0, t1: E0 + 1.2, kind: 'discover', fov: 46 },
      { t0: E0 + 1.2, t1: E0 + 3.5, kind: 'follow', racer: W, offset: [[-9, -4, 3.4], [-10, -5, 3.6]], look: [12, 0, 1.6], fov: 56, blur: 0.25, fog: 0.0007 },
      { t0: E0 + 3.5, t1: E0 + 5.3, kind: 'follow', racer: W, offset: [[-10, -4, 3.6], [-90, -14, 16]], look: [0, 0, 1.5], fov: 50, fog: 0.0005, ease: 'in' },
      { t0: E0 + 5.3, t1: plan.duration + 1, kind: 'zoomout', fov: 50 },
    );
    if (S) shots.find((s) => s.winner).t0 = C + 0.15;
    plan.endText = { t: E0 + 10.2, text: "HE LITERALLY CAN'T STOP MOVING." };
    plan.fade = [plan.duration - 1.6, plan.duration];
    plan.discoverAt = E0;
    sfx(E0 + 0.55, 'meepFar', 0.9);
    sfx(E0 + 0.6, 'recordScratch', 0.8);
    label(E0 + 0.5, '…wait.', { style: 'small', racer: undefined, y: 0.72, dur: 1.4 });
  } else {
    shots.push(
      { t0: C + 0.6, t1: C + 6.0, kind: 'orbit', racer: W, radius: 13, height: 4, speed: 0.35, fov: 46 },
      { t0: C + 6.0, t1: plan.duration + 1, kind: 'crane', racer: W, fov: 50 },
    );
    plan.endText = { t: C + 7.0, text: `THE THEME IS: ${racers[W].name.toUpperCase()}` };
    plan.fade = [plan.duration - 1.6, plan.duration];
  }

  plan.shots = shots;
  plan.fillers = fillers;

  // ------------------------------------------------------------ special scripted acting
  plan.specials = racers.map(() => null);
  if (S) {
    plan.specials[W] = (t) => scooterActing(t, plan);
    plan.specials[R] = (t) => gothActing(t, plan);
  } else if (racers[W].type === 'scooter') {
    plan.specials[W] = (t) => ({ expr: t > C ? { lid: 0, brow: 0.3, open: 0.9, smile: 1, wide: 1.35 } : undefined, pushed: t > C ? 0.4 : 0 });
  }

  // ------------------------------------------------------------ timeline events
  ev.push({ t: D - 0.6, type: 'banner', text: 'FINAL DUEL', dur: 2.2 });
  ev.push({ t: F0 + 0.3, type: 'banner', text: 'FINAL FIVE', dur: 1.8 });
  if (S) {
    sfx(D + 0.1, 'revBig', 1);
    sfx(D + 6.3, 'gmBoost', 1);
    sfx(T.hack, 'heartbeat', 0.9);
    sfx(T.hack + 1.3, 'ding', 0.8);
    sfx(T.hack + 1.95, 'beep', 0.7);
    [0, 0.12, 0.23, 0.36, 0.5, 0.61, 0.75, 0.9, 1.0, 1.15, 1.3, 1.42, 1.6, 1.72, 1.9, 2.05, 2.2].forEach((x) => sfx(T.hack + 2.7 + x, 'keyTap', 0.6));
    [2.75, 3.25, 3.75, 4.25, 4.65].forEach((x, k) => sfx(T.hack + x, k === 4 ? 'success' : 'hackBeep', 0.8));
    sfx(T.hack + 5.0, 'beep', 0.9);
    sfx(T.hack + 5.05, 'electric', 0.9);
    sfx(T.hack + 5.1, 'powerUp', 1);
    sfx(T.launch, 'launch', 1.3);
    sfx(T.launch + 0.02, 'sonicBoom', 1.2);
    ev.push({ t: T.launch, type: 'shake', amp: 1.6, dur: 0.7 });
    ev.push({ t: T.launch, type: 'flash', dur: 0.2, color: '#bff6ff' });
    sfx(T.launch + 1.7, 'gasp', 0.8);
    sfx(T.push - 0.4, 'whoosh', 1);
    label(T.push - 0.9, 'NOT TODAY!', { racer: R, color: '#c04dff', dur: 0.9 });
  }
  sfx(C, 'finishWhoosh', 1);
  sfx(C + 0.05, 'fanfare', 1);
  sfx(C + 0.1, 'cheer', 1.2);
  sfx(C + 0.2, 'confettiPop', 1);
  ev.push({ t: plan.winnerAt, type: 'winner', text: racers[W].name.toUpperCase(), dur: S ? T.E0 - plan.winnerAt + 0.3 : 4.8 });
  ev.push({ t: plan.endText.t, type: 'endtext', text: plan.endText.text });

  // music cues
  plan.music = S
    ? [[0, 'intro'], [GO, 'race'], [F0, 'final5'], [D - 0.95, 'finale'], [T.hack, 'hack'], [T.launch, 'overtake'], [C, 'victory'], [T.E0, 'ending']]
    : [[0, 'intro'], [GO, 'race'], [F0, 'final5'], [D - 0.95, 'finale'], [T.pass, 'overtake'], [C, 'victory'], [C + 4.5, 'ending']];
  plan.musicEnd = plan.duration - 0.3;

  // leaderboard visibility & phases
  plan.lbHidden = S ? [[T.hack - 0.2, T.launch + 0.6], [T.push + 0.35, C - 0.2]] : [];
  plan.lbFinaleFrom = D - 0.95;
  plan.lbFinalFiveFrom = F0;
  plan.lbGoneAfter = S ? T.E0 : C + 6;
  plan.letterbox = S ? [D, T.E0] : [D, C + 1];
  plan.events = ev.sort((a, b) => a.t - b.t);
  plan.T = T;

  // jumbotron + crowd
  plan.jumbo = (t, remaining) => {
    if (t < plan.countdown.lights[0]) return [['THEME GRAND PRIX', 'LIVE'], '#ff3e7f'];
    if (t < GO) return [[String(4 - plan.countdown.lights.filter((x) => t >= x).length)], '#ff3b3b'];
    if (t < GO + 2) return [['GO!'], '#3dff7a'];
    if (t >= C) return [['WINNER', racers[W].name.toUpperCase()], '#ffd23f'];
    if (t >= D - 1) return [['FINAL DUEL'], '#c04dff'];
    return [[`${remaining} / ${plan.N}`, 'RACERS REMAINING'], '#22d3ee'];
  };
  plan.cheer = (t) => {
    let c = 0.25;
    if (t < GO + 2.5) c = 0.35 + 0.5 * smooth((t - GO + 1.5) / 1.5) * (1 - smooth((t - GO - 1.5) / 1));
    if (t > C) c = 1.1;
    return c;
  };
  plan.sceneMarks = [
    ['1 · Start', 0],
    ['2 · Kaos', 9.45],
    ['3 · Sidste fem', F0],
    ['4 · Finale', D - 0.95],
    ...(S ? [['5 · Hacket', T.hack - 0.3], ['6 · Overhaling', T.launch - 0.3], ['7 · Han stopper ikke', C - 0.3]] : [['5 · Målstregen', C - 3], ['6 · Afslutning', C + 1]]),
  ];
}

// ---------------------------------------------------------------- acting: the gamer
function scooterActing(t, plan) {
  const { D, T } = plan;
  const C = plan.tCross;
  const H = T.hack;
  const sp = { screen: 'speed' };
  if (t < GO) {
    sp.expr = { lid: 0, brow: 0.5, smile: 0.35, wide: 1.1, blink: (t % 2.3) < 0.12 ? 1 : 0 };
    return sp;
  }
  if (t < D - 1) return sp;
  if (t < D + 6.2) {
    sp.expr = { lid: 0.2, brow: 0.45, smile: -0.25, open: 0.15 };
    sp.gripHard = 0.6;
    sp.crouch = 0.6;
    return sp;
  }
  if (t < H) {
    sp.expr = { lid: 0.05, brow: 0.7, smile: -0.6, open: 0.2 };
    sp.gripHard = 0.8;
    sp.crouch = 0.7;
    sp.headYaw = Math.sin(t * 1.3) * 0.1;
    return sp;
  }
  if (t < H + 1.3) {
    sp.expr = { lid: 0, brow: 0.85, smile: -0.85, open: 0.35, wide: 1.1, lookY: 0.2 };
    sp.crouch = 0.6;
    return sp;
  }
  if (t < H + 1.9) {
    const k = smooth((t - H - 1.3) / 0.2);
    sp.expr = { lid: 0, brow: lerp(0.85, -0.1, k), browY: 0.7 * k, open: 0.5 * k + 0.2, wide: 1 + 0.45 * k, lookY: 0.4 };
    return sp;
  }
  if (t < H + 2.6) {
    sp.lookDown = smooth((t - H - 1.9) / 0.3);
    sp.expr = { lid: 0.3, brow: -0.3, smile: 0.25, lookY: -1 };
    return sp;
  }
  const holoLines = [];
  const tl = [[2.75, 'SPEED LIMIT: 20 KM/H'], [3.25, '> HACKING...'], [3.75, '> BYPASSING LIMITER...'], [4.25, '> LIMITER REMOVED'], [4.65, 'UNLIMITED SPEED ENABLED']];
  for (const [x, s] of tl) if (t >= H + x) holoLines.push(s);
  if (t < H + 5.0) {
    sp.typing = smooth((t - H - 2.6) / 0.2);
    sp.lookDown = 0.65;
    sp.holo = smooth((t - H - 2.65) / 0.25);
    sp.holoLines = holoLines;
    sp.holoGreen = t >= H + 4.65;
    sp.screen = t >= H + 4.65 ? 'green' : 'hack';
    sp.expr = { lid: 0.35, brow: -0.45, smile: 0.25, lookY: -0.8 };
    return sp;
  }
  if (t < T.launch) {
    const k = smooth((t - H - 5.0) / 1.0);
    sp.holo = 1 - smooth((t - H - 5.0) / 0.4);
    sp.holoLines = holoLines;
    sp.holoGreen = true;
    sp.screen = 'green';
    sp.gripHard = 1;
    sp.crouch = 1;
    sp.shake = k;
    sp.wheelGlow = k * 0.7;
    sp.expr = { lid: 0.2, brow: -0.75, smile: 0.95, smirk: 0.2 };
    return sp;
  }
  if (t < T.push) {
    sp.screen = 'green';
    sp.pushed = t < T.launch + 3 ? 1 : 0.7;
    sp.wheelGlow = 1;
    sp.gripHard = 1;
    sp.shake = 0.4;
    sp.expr = { lid: 0.85, brow: 0.5, open: 0.95, wide: 0.85 };
    return sp;
  }
  sp.screen = 'green';
  sp.wheelGlow = 1;
  sp.pushed = 0.45;
  sp.expr = t < C ? { lid: 0, brow: -0.4, smile: 1, open: 0.5, wide: 1.2 } : { lid: 0, brow: 0.3, open: 0.95, smile: 1, wide: 1.4 };
  return sp;
}

function gothActing(t, plan) {
  const { D, T } = plan;
  const sp = {};
  if (t < D - 1) return null;
  if (t < D + 6.2) { sp.expr = { lid: 0.45, brow: -0.2, smile: 0.75, smirk: 0.25 }; sp.boost = 0.7; return sp; }
  if (t < D + 9) { sp.expr = { lid: 0.5, brow: -0.25, smile: 0.9, smirk: 0.35 }; sp.boost = 1.6; sp.headYaw = -0.25; return sp; }
  if (t < T.launch + 1.65) { sp.expr = { lid: 0.55, brow: -0.15, smile: 0.85, smirk: 0.3 }; sp.boost = 1.0; return sp; }
  if (t < T.push - 0.9) { sp.expr = { lid: 0, brow: 0.6, open: 0.35, wide: 1.35, lookX: 1 }; sp.headYaw = -0.55; sp.boost = 1.4; return sp; }
  sp.expr = { lid: 0.15, brow: -0.75, smile: -0.6 };
  sp.headYaw = -0.3;
  sp.boost = 2;
  return sp;
}

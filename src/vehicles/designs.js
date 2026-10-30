import * as THREE from 'three';
import { mat, umat, glow, G, mk, grp, textCanvas } from '../core/kit.js';
import { wheel, face, driver, steeringWheel, textSprite } from './parts.js';
import { clamp, smooth, lerp } from '../core/math.js';

// All 18 vehicle designs. Each builder returns a model:
// { root, body, wheels, L, W, H, head?, parts, update(st) }
// Local frame: +X forward, +Y up, +Z right, origin = ground under the vehicle centre.

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/** Capsule between two points, re-aimable every frame. */
function limb(parent, material, r) {
  const m = mk(G.capsule(r, 1, 3, 8), material, parent);
  return {
    mesh: m,
    set(a, b) {
      _a.subVectors(b, a);
      const len = _a.length();
      m.position.addVectors(a, b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(_up, _a.normalize());
      m.scale.set(1, Math.max(0.01, len - r * 2 + 0.0001) / 1, 1);
    },
  };
}

function base(color) {
  const root = new THREE.Group();
  const body = grp(root);
  return { root, body, wheels: [], parts: {}, color, update() {} };
}

function stripeTexture(a, b, n = 8, diagonal = true) {
  return textCanvas(128, 128, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = b;
    for (let i = -n; i < n * 2; i++) {
      ctx.beginPath();
      const s = w / n;
      if (diagonal) {
        ctx.moveTo(i * s, 0); ctx.lineTo(i * s + s / 2, 0); ctx.lineTo(i * s + s / 2 - h, h); ctx.lineTo(i * s - h, h);
      } else {
        ctx.rect(i * s, 0, s / 2, h);
      }
      ctx.fill();
    }
  });
}

// ------------------------------------------------------------------ 1. scooter (the hero)
function scooter(color) {
  const v = base(color);
  const S = grp(v.body);
  S.scale.setScalar(1.45);
  const frameM = mat('#2b2f36', { metal: 0.6, rough: 0.35 });
  const acc = mat(color, { rough: 0.45 });
  mk(G.rbox(1.25, 0.09, 0.38, 0.04), frameM, S, [0, 0.25, 0]);
  mk(G.box(1.0, 0.012, 0.32), mat('#111', { rough: 1 }), S, [-0.05, 0.3, 0]);
  mk(G.box(1.1, 0.04, 0.02), acc, S, [0, 0.25, 0.19]);
  mk(G.box(1.1, 0.04, 0.02), acc, S, [0, 0.25, -0.19]);
  mk(G.box(0.34, 0.03, 0.14), frameM, S, [-0.62, 0.36, 0], [0, 0, 0.45]);
  const glowRim = umat('#00e5ff', { emissive: '#00e5ff', ei: 0 });
  v.wheelGlow = glowRim;
  v.wheels.push(wheel(S, 0.58, 0.15, 0, 0.15, 0.08, { rim: '#9aa0a6', glowRim }));
  v.wheels.push(wheel(S, -0.58, 0.15, 0, 0.15, 0.08, { rim: '#9aa0a6', glowRim }));
  mk(G.cyl(0.03, 0.035, 1.16, 8), frameM, S, [0.53, 0.8, 0], [0, 0, 0.07]);
  mk(G.box(0.05, 0.25, 0.14), frameM, S, [0.58, 0.25, 0]);
  mk(G.cyl(0.022, 0.022, 0.8, 8), frameM, S, [0.49, 1.38, 0], [Math.PI / 2, 0, 0]);
  for (const z of [-0.37, 0.37]) mk(G.cyl(0.035, 0.035, 0.14, 8), mat('#111'), S, [0.49, 1.38, z], [Math.PI / 2, 0, 0]);
  mk(G.sphere(0.04, 8, 6), mat('#ffd23f', { metal: 0.8, rough: 0.2 }), S, [0.5, 1.42, -0.22]);
  // tiny screen on the handlebar
  const scrTex = textCanvas(256, 160, () => {});
  const scrMat = new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false });
  const scrG = grp(S, [0.45, 1.44, 0], [0, -Math.PI / 2, 0]);
  mk(G.box(0.24, 0.17, 0.03), frameM, scrG, [0, 0, -0.018], [-0.65, 0, 0]);
  const scr = mk(G.plane(0.21, 0.14), scrMat, scrG, [0, 0.002, 0.002], [-0.65, 0, 0]);
  scr.castShadow = false;
  v.screen = { tex: scrTex, key: '' };
  const drawScreen = (mode) => {
    if (v.screen.key === mode) return;
    v.screen.key = mode;
    const { ctx, canvas } = scrTex.userData;
    const w = canvas.width, h = canvas.height;
    const green = mode === 'green' || mode === 'unlimited';
    ctx.fillStyle = green ? '#032b12' : mode === 'hack' ? '#06140a' : '#0b1220';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (mode === 'speed') {
      ctx.fillStyle = '#7dd3fc';
      ctx.font = 'bold 74px "Segoe UI", Arial';
      ctx.fillText('20', w / 2 - 30, h / 2 - 8);
      ctx.font = 'bold 30px "Segoe UI", Arial';
      ctx.fillText('km/h', w / 2 + 70, h / 2 + 10);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 20px Consolas, monospace';
      ctx.fillText('LIMIT', w / 2, h - 22);
    } else if (mode === 'hack') {
      ctx.fillStyle = '#22ff66';
      ctx.font = 'bold 26px Consolas, monospace';
      ctx.fillText('> sudo rm', w / 2, h / 2 - 22);
      ctx.fillText('  limiter', w / 2, h / 2 + 12);
      ctx.fillRect(30, h - 26, (w - 60) * 0.7, 10);
    } else {
      ctx.fillStyle = '#39ff88';
      ctx.font = 'bold 86px "Segoe UI", Arial';
      ctx.fillText('∞', w / 2, h / 2 - 4);
      ctx.font = 'bold 22px Consolas, monospace';
      ctx.fillText('UNLIMITED', w / 2, h - 22);
    }
    scrTex.needsUpdate = true;
  };
  drawScreen('speed');

  // the gamer
  const hoodie = mat(color, { rough: 0.85 });
  const jeans = mat('#34518a', { rough: 0.9 });
  const skin = mat('#f2c79b', { rough: 0.6 });
  const shoe = mat('#f4f4f4', { rough: 0.6 });
  const P = grp(S, [-0.05, 0.3, 0]); // person root on the deck
  v.person = P;
  mk(G.rbox(0.32, 0.14, 0.15, 0.05), shoe, P, [0.16, 0.07, 0.08]);
  mk(G.rbox(0.32, 0.14, 0.15, 0.05), shoe, P, [-0.22, 0.07, -0.08]);
  mk(G.box(0.33, 0.03, 0.155), mat('#ff3b3b'), P, [0.16, 0.0, 0.08]);
  mk(G.box(0.33, 0.03, 0.155), mat('#ff3b3b'), P, [-0.22, 0.0, -0.08]);
  const upper = grp(P, [0, 0.82, 0]); // hips pivot: lean animations rotate this
  v.upper = upper;
  const legL = limb(P, jeans, 0.085), legR = limb(P, jeans, 0.085);
  legL.set(new THREE.Vector3(0.12, 0.12, 0.08), new THREE.Vector3(0.02, 0.85, 0.09));
  legR.set(new THREE.Vector3(-0.2, 0.12, -0.08), new THREE.Vector3(-0.04, 0.85, -0.09));
  mk(G.capsule(0.25, 0.42, 4, 12), hoodie, upper, [0.02, 0.32, 0]);
  mk(G.box(0.02, 0.22, 0.24), mat('#fff8e7'), upper, [0.27, 0.35, 0]);
  const hood = mk(G.torus(0.17, 0.08, 6, 14), hoodie, upper, [-0.1, 0.72, 0], [0, Math.PI / 2, 0.5]);
  v.hood = hood;
  for (const z of [-0.06, 0.06]) mk(G.cyl(0.012, 0.012, 0.22, 4), mat('#ffffff'), upper, [0.25, 0.52, z]);
  const headG = grp(upper, [0.05, 0.98, 0]);
  v.head = headG;
  const R = 0.27;
  mk(G.sphere(R, 20, 16), skin, headG);
  mk(G.sphere(0.06, 8, 6), skin, headG, [0, 0, R], [0, 0, 0], [1, 1.3, 0.6]);
  mk(G.sphere(0.06, 8, 6), skin, headG, [0, 0, -R], [0, 0, 0], [1, 1.3, 0.6]);
  v.face = face(headG, R, { eyeSize: 0.3, browColor: '#4a2c17' });
  // big glasses
  const gl = mat('#111', { rough: 0.4 });
  for (const z of [-0.1, 0.1]) mk(G.torus(0.075, 0.012, 6, 16), gl, headG, [R * 0.97, R * 0.14, z], [0, Math.PI / 2, 0]);
  mk(G.box(0.01, 0.012, 0.06), gl, headG, [R * 1.0, R * 0.17, 0]);
  // helmet
  const helmetM = mat('#dfe3ea', { rough: 0.5, metal: 0.05 });
  const helmet = grp(headG, [-0.01, 0.06, 0]);
  mk(G.hemi(0.36, 18), helmetM, helmet, [0, 0, 0], [0, 0, 0], [1.05, 0.92, 1]);
  mk(G.box(0.68, 0.06, 0.06), acc, helmet, [0, 0.33, 0]);
  mk(G.box(0.16, 0.03, 0.42), helmetM, helmet, [0.32, 0.02, 0], [0, 0, -0.15]);
  mk(G.box(0.04, 0.03, 0.03), mat('#111'), helmet, [0, -0.18, 0.27]);
  // arms
  const armL = limb(S, hoodie, 0.075), armR = limb(S, hoodie, 0.075);
  const handL = mk(G.sphere(0.07, 8, 6), skin, S), handR = mk(G.sphere(0.07, 8, 6), skin, S);
  v.arms = { armL, armR, handL, handR };

  // hologram (billboard) for the hack
  const holoTex = textCanvas(640, 400, () => {});
  const holoMat = new THREE.MeshBasicMaterial({ map: holoTex, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
  const holo = new THREE.Mesh(G.plane(1.5, 0.94), holoMat);
  holo.renderOrder = 20;
  v.root.add(holo);
  v.holo = { mesh: holo, tex: holoTex, key: '' };
  const drawHolo = (lines, green) => {
    const key = lines.join('|') + green;
    if (key === v.holo.key) return;
    v.holo.key = key;
    const { ctx, canvas } = holoTex.userData;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = green ? 'rgba(2,40,18,0.82)' : 'rgba(2,22,34,0.8)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = green ? '#39ff88' : '#4de1ff';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    for (let y = 0; y < h; y += 6) { ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, y, w, 2); }
    ctx.font = 'bold 44px Consolas, "Courier New", monospace';
    ctx.textBaseline = 'top';
    lines.forEach((ln, i) => {
      const last = i === lines.length - 1;
      ctx.fillStyle = last ? (green ? '#d6ffe4' : '#ffffff') : green ? '#39ff88' : '#7fe9ff';
      ctx.fillText(ln, 24, 28 + i * 70);
    });
    holoTex.needsUpdate = true;
  };

  v.L = 1.9; v.W = 0.8; v.H = 2.7;
  v.headWorldOffset = new THREE.Vector3(0, 2.75, 0);
  const sh = new THREE.Vector3(), hand = new THREE.Vector3();
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    const wob = Math.sin(t * 2.3) * 0.05 + Math.sin(t * 5.1) * 0.02;
    const pushed = sp.pushed ?? 0;
    const shake = sp.shake ?? 0;
    upper.rotation.set(wob + shake * Math.sin(t * 61) * 0.05, 0, -0.12 + pushed * 0.55 - (sp.crouch ?? 0) * 0.25);
    upper.position.set(-pushed * 0.12, 0.82 - (sp.crouch ?? 0) * 0.08, 0);
    P.position.x = -0.05 - pushed * 0.08;
    headG.rotation.set(0, sp.headYaw ?? 0, (sp.lookDown ?? 0) * -0.55 + pushed * 0.35);
    headG.scale.set(1 - pushed * 0.12, 1, 1 + pushed * 0.1);
    hood.rotation.z = 0.5 + pushed * 0.9 + Math.sin(t * 40) * 0.15 * pushed;
    const ex = sp.expr || { lid: 0.1, brow: 0.25, smile: 0.25, blink: (t % 3.7) < 0.12 ? 1 : 0 };
    v.face.set(ex);
    // hands on grips, or typing on the screen
    const typing = sp.typing ?? 0;
    for (const side of [-1, 1]) {
      const arm = side < 0 ? armL : armR;
      const hm = side < 0 ? handL : handR;
      upper.updateMatrix();
      sh.set(0.02, 0.55, side * 0.27).applyMatrix4(upper.matrix).add(P.position);
      hand.set(0.49, 1.38, side * 0.36);
      if (typing > 0 && side > 0) {
        const tap = Math.abs(Math.sin(t * 26)) * 0.05;
        hand.lerp(new THREE.Vector3(0.43, 1.47 + tap, 0.04), typing);
      }
      if (typing > 0 && side < 0) {
        const tap = Math.abs(Math.sin(t * 23 + 1)) * 0.05;
        hand.lerp(new THREE.Vector3(0.43, 1.47 + tap, -0.06), typing * 0.8);
      }
      arm.set(sh, hand);
      hm.position.copy(hand);
      const grip = 1 + (sp.gripHard ?? 0) * 0.35;
      hm.scale.setScalar(grip);
    }
    drawScreen(sp.screen ?? 'speed');
    glowRim.emissiveIntensity = (sp.wheelGlow ?? 0) * 6;
    // hologram
    const ho = sp.holo ?? 0;
    holo.visible = ho > 0.01;
    if (holo.visible && st.camera) {
      drawHolo(sp.holoLines || [], sp.holoGreen);
      holoMat.opacity = ho;
      holo.position.set(1.05, 3.0, 0.55);
      holo.scale.set(ho, ho, ho);
      v.root.updateMatrixWorld();
      const wp = holo.getWorldPosition(new THREE.Vector3());
      const q = new THREE.Quaternion().copy(st.camera.quaternion);
      const pq = v.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      holo.quaternion.copy(pq.multiply(q));
      void wp;
    }
  };
  return v;
}

// ------------------------------------------------------------------ 2. Goth Mommy
function goth(color) {
  const v = base(color);
  const B = v.body;
  const black = mat('#211a2c', { metal: 0.55, rough: 0.28 });
  const purple = mat('#4a1a70', { metal: 0.5, rough: 0.3 });
  const chrome = mat('#d9d6e6', { metal: 1, rough: 0.15 });
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c04dff').multiplyScalar(2.2), toneMapped: false });
  const glass = mat('#2a0f3d', { metal: 0.3, rough: 0.1, emissive: '#5b1a8a', ei: 0.45 });
  mk(G.rbox(8.2, 1.5, 4.1, 0.7), black, B, [0, 1.25, 0]);
  mk(G.rbox(3.2, 0.6, 3.5, 0.3), black, B, [2.4, 2.05, 0]);
  mk(G.rbox(4.3, 1.7, 3.7, 0.55), purple, B, [-1.75, 2.6, 0]);
  mk(G.rbox(4.0, 0.25, 3.3, 0.1), black, B, [-1.75, 3.5, 0]);
  // gothic arched windows on the hearse cabin
  const arch = new THREE.Shape();
  arch.moveTo(-0.45, -0.5); arch.lineTo(0.45, -0.5); arch.lineTo(0.45, 0.2);
  arch.quadraticCurveTo(0.45, 0.6, 0, 0.85); arch.quadraticCurveTo(-0.45, 0.6, -0.45, 0.2); arch.lineTo(-0.45, -0.5);
  const archG = new THREE.ShapeGeometry(arch);
  for (const side of [-1, 1]) for (const x of [-3.1, -1.75, -0.4]) {
    const w = mk(archG, glass, B, [x, 2.55, side * 1.87], [0, side > 0 ? 0 : Math.PI, 0]);
    w.castShadow = false;
  }
  // rose window at the back
  mk(G.circle(0.8, 16), glass, B, [-3.93, 2.65, 0], [0, -Math.PI / 2, 0]);
  mk(G.torus(0.8, 0.08, 6, 18), chrome, B, [-3.93, 2.65, 0], [0, Math.PI / 2, 0]);
  // spires
  for (const x of [-3.6, 0.1]) for (const z of [-1.6, 1.6]) {
    mk(G.cone(0.18, 1.0, 6), black, B, [x, 4.05, z]);
    mk(G.sphere(0.08, 6, 4), neon, B, [x, 4.55, z]);
  }
  // organ-pipe grille
  for (let i = 0; i < 9; i++) {
    const z = (i - 4) * 0.36;
    const h = 0.5 + (1 - Math.abs(i - 4) / 4) * 0.55;
    mk(G.cyl(0.11, 0.11, h, 8), chrome, B, [4.12, 1.15 + h / 2 - 0.3, z]);
  }
  // angry headlights
  for (const side of [-1, 1]) {
    mk(G.sphere(0.36, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9b8ff').multiplyScalar(2), toneMapped: false }), B, [3.95, 1.55, side * 1.45], [0, 0, 0], [0.5, 1, 1]);
    mk(G.box(0.3, 0.12, 0.85), black, B, [4.05, 1.92, side * 1.45], [side * 0.35, 0, 0]);
  }
  // neon strips + underglow
  for (const side of [-1, 1]) mk(G.box(7.6, 0.08, 0.06), neon, B, [0, 0.62, side * 2.06]).castShadow = false;
  const ug = mk(G.plane(9.5, 5.5), new THREE.MeshBasicMaterial({ color: '#b347ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTex() }), v.root, [0, 0.12, 0], [-Math.PI / 2, 0, 0]);
  ug.castShadow = false;
  ug.receiveShadow = false;
  // candelabra hood ornament
  const cand = grp(B, [3.3, 2.38, 0]);
  mk(G.cyl(0.05, 0.12, 0.4, 6), chrome, cand, [0, 0.2, 0]);
  mk(G.box(0.06, 0.06, 0.7), chrome, cand, [0, 0.4, 0]);
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(2), toneMapped: false });
  for (const z of [-0.33, 0, 0.33]) {
    mk(G.cyl(0.05, 0.05, 0.3, 6), mat('#f4f0e6'), cand, [0, 0.58, z]);
    mk(G.cone(0.05, 0.14, 6), flameM, cand, [0, 0.8, z]).castShadow = false;
  }
  // bat wings
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0); wingShape.lineTo(-0.3, 1.6); wingShape.lineTo(-0.9, 1.3); wingShape.quadraticCurveTo(-1.2, 0.8, -1.6, 1.0);
  wingShape.quadraticCurveTo(-1.8, 0.5, -2.2, 0.6); wingShape.quadraticCurveTo(-2.0, 0.2, -2.3, -0.1); wingShape.lineTo(0, 0);
  const wingG = new THREE.ShapeGeometry(wingShape);
  v.wings = [];
  for (const side of [-1, 1]) {
    const wg = grp(B, [-2.2, 3.2, side * 1.7]);
    const w = mk(wingG, mat('#1d0f2a', { double: true, rough: 0.6 }), wg, [0, 0, 0], [side * -0.4 + Math.PI / 2 * 0, 0, 0]);
    w.rotation.set(side > 0 ? -1.1 : 1.1 + Math.PI, 0, 0);
    if (side < 0) w.scale.set(1, -1, 1);
    v.wings.push(wg);
  }
  // exhausts with flames
  v.flames = [];
  for (const side of [-1, 1]) {
    mk(G.cyl(0.26, 0.3, 1.6, 10), chrome, B, [-3.8, 1.6, side * 1.3], [0, 0, Math.PI / 2 - 0.45]);
    const fl = mk(G.cone(0.32, 1.6, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#c86bff').multiplyScalar(2.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), B, [-4.9, 2.1, side * 1.3], [0, 0, Math.PI / 2 - 0.45]);
    fl.castShadow = false;
    v.flames.push(fl);
  }
  // windscreen + driver
  mk(G.box(0.12, 0.9, 3.0), mat('#1a0b26', { opacity: 0.45, rough: 0.05, metal: 0.4 }), B, [1.05, 2.45, 0], [0, 0, -0.45]);
  const seat = grp(B, [0.0, 1.85, 0]);
  const d = driver(seat, { skin: '#f4e3ea', shirt: '#17121c', headR: 0.5, face: { lip: '#3d0a2a', browColor: '#111', lashes: true } });
  // long black hair
  const hair = mat('#0b0a0f', { rough: 0.7 });
  mk(G.hemi(0.54, 18), hair, d.head, [-0.04, 0.03, 0], [0, 0, 0.25]);
  mk(G.rbox(0.25, 1.35, 0.95, 0.12), hair, d.head, [-0.42, -0.5, 0], [0, 0, 0.12]);
  for (const z of [-0.5, 0.5]) mk(G.rbox(0.34, 1.7, 0.2, 0.09), hair, d.head, [0.02, -0.42, z], [z * 0.25, 0, 0]);
  mk(G.box(0.12, 0.2, 0.8), hair, d.head, [0.36, 0.38, 0], [0, 0, -0.5]);
  mk(G.torus(0.3, 0.04, 6, 16), mat('#111'), d.torso, [0.05, 0.5, 0], [Math.PI / 2, 0, 0]);
  mk(G.sphere(0.06, 6, 4), neon, d.torso, [0.33, 0.48, 0]);
  // tiny bat on the cabin, high collar
  mk(G.box(0.1, 0.45, 1.0), mat('#2a0f3d'), d.torso, [-0.25, 0.75, 0], [0, 0, 0.3]);
  const sw = steeringWheel(B, [0.7, 2.6, 0]);
  d.arms.forEach((a) => (a.rotation.z = -0.15));
  v.driver = d;
  v.face = d.face;
  v.head = d.head;
  // side mirror (used for the "sees the scooter in the mirror" shot)
  const mirror = grp(B, [1.1, 2.6, 2.05]);
  mk(G.cyl(0.03, 0.03, 0.5, 6), chrome, mirror, [0, -0.15, -0.1], [0.6, 0, 0]);
  mk(G.rbox(0.12, 0.38, 0.55, 0.06), black, mirror, [0, 0.05, 0.05]);
  mk(G.plane(0.45, 0.3), mat('#c8d4ff', { metal: 1, rough: 0.05 }), mirror, [-0.07, 0.05, 0.05], [0, -Math.PI / 2, 0]);
  v.mirror = mirror;

  const tireOpts = { rim: '#5b1a8a', spoke: '#c04dff', tire: '#0b0b0e' };
  v.wheels.push(wheel(v.root, 2.65, 0.8, -1.95, 0.8, 0.7, tireOpts));
  v.wheels.push(wheel(v.root, 2.65, 0.8, 1.95, 0.8, 0.7, tireOpts));
  v.wheels.push(wheel(v.root, -2.55, 1.18, -2.05, 1.18, 1.0, tireOpts));
  v.wheels.push(wheel(v.root, -2.55, 1.18, 2.05, 1.18, 1.0, tireOpts));
  v.L = 9; v.W = 4.3; v.H = 4.2;
  v.headWorldOffset = new THREE.Vector3(0, 3.4, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    v.wings.forEach((w, i) => (w.rotation.x = Math.sin(t * 5 + i * Math.PI) * 0.25 * (i ? 1 : -1)));
    const boost = sp.boost ?? (st.racing ? 0.5 : 0.2);
    v.flames.forEach((f, i) => f.scale.set(1, 0.6 + boost * 1.2 + Math.sin(t * 37 + i) * 0.25, 1));
    sw.wheel.rotation.x = (sp.steer ?? 0) + Math.sin(t * 1.3) * 0.05;
    d.head.rotation.set(0, sp.headYaw ?? 0, sp.headTilt ?? 0);
    const ex = sp.expr || { lid: 0.42, brow: -0.18, smile: 0.7, smirk: 0.25, blink: (t % 4.3) < 0.1 ? 1 : 0 };
    d.face.set(ex);
  };
  return v;
}

let _glowTex;
function glowTex() {
  if (!_glowTex) {
    _glowTex = textCanvas(128, 128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    });
  }
  return _glowTex;
}

// ------------------------------------------------------------------ 3. Dungeon: living chest
function dungeon(color) {
  const v = base(color);
  const B = v.body;
  const wood = mat('#7a4a22', { rough: 0.9, flat: true });
  const gold = mat('#e0b23a', { metal: 0.85, rough: 0.3 });
  mk(G.box(3.4, 1.7, 2.6), wood, B, [0, 1.45, 0]);
  for (const x of [-1.2, 0, 1.2]) mk(G.box(0.22, 1.74, 2.64), gold, B, [x, 1.45, 0]);
  mk(G.box(3.44, 0.2, 2.64), gold, B, [0, 0.65, 0]);
  mk(G.box(0.1, 0.5, 0.4), mat('#222'), B, [1.72, 1.6, 0]);
  // coins + tongue inside
  for (let i = 0; i < 14; i++) mk(G.cyl(0.18, 0.18, 0.05, 10), gold, B, [-1 + (i % 7) * 0.33, 2.3, -0.6 + Math.floor(i / 7) * 0.9], [0.3 * (i % 3), 0, 0.2]);
  const tongue = mk(G.sphere(0.6, 12, 8), mat('#d43a5a', { rough: 0.4 }), B, [0.3, 2.25, 0], [0, 0, 0], [1.4, 0.35, 0.9]);
  // lower fangs
  const fangM = mat('#fffbea', { rough: 0.3 });
  for (let i = 0; i < 5; i++) mk(G.cone(0.14, 0.45, 6), fangM, B, [1.62, 2.45, -1.0 + i * 0.5]);
  // lid (pivot at the back top edge)
  const lid = grp(B, [-1.7, 2.3, 0]);
  const lidInner = grp(lid, [1.7, 0, 0]);
  mk(G.box(3.4, 0.4, 2.6), wood, lidInner, [0, 0.2, 0]);
  const dome = mk(G.cyl(1.3, 1.3, 3.4, 14, false), wood, lidInner, [0, 0.4, 0], [0, 0, Math.PI / 2], [1, 1, 0.45]);
  dome.scale.set(0.45, 1, 1);
  for (const x of [-1.2, 0, 1.2]) mk(G.torus(1.3, 0.1, 4, 16, Math.PI), gold, lidInner, [x, 0.4, 0], [0, Math.PI / 2, 0], [1, 0.45, 1]);
  for (let i = 0; i < 6; i++) mk(G.cone(0.13, 0.42, 6), fangM, lidInner, [1.62, -0.1, -1.1 + i * 0.44], [Math.PI, 0, 0]);
  const eyeG = grp(lidInner, [1.4, 0.75, 0]);
  const fc = face(eyeG, 0.9, { eyeSize: 0.42, browColor: '#3b1d0a' });
  fc.group.children.forEach((c) => c.isGroup && c.children.length === 0 && (c.visible = false));
  v.face = fc;
  v.lid = lid;
  const rust = { rim: '#a0522d', spoke: '#5c2e12', tire: '#3b2a20' };
  v.wheels.push(wheel(v.root, 1.2, 0.55, -1.35, 0.55, 0.4, rust));
  v.wheels.push(wheel(v.root, 1.2, 0.55, 1.35, 0.55, 0.4, rust));
  v.wheels.push(wheel(v.root, -1.2, 0.55, -1.35, 0.55, 0.4, rust));
  v.wheels.push(wheel(v.root, -1.2, 0.55, 1.35, 0.55, 0.4, rust));
  v.L = 3.6; v.W = 2.9; v.H = 3.6;
  v.headWorldOffset = new THREE.Vector3(1.5, 3.0, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const chomp = Math.pow(Math.abs(Math.sin(st.t * 3.2)), 3) * 0.35;
    lid.rotation.z = sp.lid ?? 0.12 + chomp;
    tongue.scale.set(1.4, 0.35 + (sp.lid ?? 0) * 0.2, 0.9);
    fc.set(sp.expr || { lid: 0.15, brow: -0.35, smile: 0, open: 0, blink: (st.t % 3.1) < 0.12 ? 1 : 0, wide: 1 });
  };
  return v;
}

// ------------------------------------------------------------------ 4. Femboys: pink glitter supercar
function heartShape(s = 1) {
  const h = new THREE.Shape();
  h.moveTo(0, -0.6 * s);
  h.bezierCurveTo(-0.1 * s, -0.4 * s, -0.7 * s, -0.1 * s, -0.6 * s, 0.25 * s);
  h.bezierCurveTo(-0.5 * s, 0.6 * s, -0.05 * s, 0.6 * s, 0, 0.3 * s);
  h.bezierCurveTo(0.05 * s, 0.6 * s, 0.5 * s, 0.6 * s, 0.6 * s, 0.25 * s);
  h.bezierCurveTo(0.7 * s, -0.1 * s, 0.1 * s, -0.4 * s, 0, -0.6 * s);
  return h;
}
let _heartG;
export function heartGeo() {
  if (!_heartG) _heartG = new THREE.ExtrudeGeometry(heartShape(1), { depth: 0.18, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
  return _heartG;
}
function femboy(color) {
  const v = base(color);
  const B = v.body;
  const pink = mat(color, { metal: 0.55, rough: 0.22 });
  const light = mat('#ffd1ec', { metal: 0.3, rough: 0.3 });
  const white = mat('#ffffff', { metal: 0.5, rough: 0.2 });
  mk(G.rbox(5.0, 0.85, 2.5, 0.38), pink, B, [0, 0.85, 0]);
  mk(G.rbox(2.0, 0.4, 2.2, 0.18), pink, B, [1.8, 1.25, 0], [0, 0, -0.12]);
  mk(G.hemi(1.0, 18), mat('#ffb3df', { opacity: 0.55, rough: 0.05, metal: 0.3 }), B, [-0.2, 1.25, 0], [0, 0, 0], [1.25, 0.75, 0.95]);
  // giant spoiler
  for (const z of [-0.8, 0.8]) mk(G.box(0.2, 1.1, 0.12), white, B, [-2.25, 1.75, z]);
  mk(G.rbox(1.1, 0.14, 3.2, 0.06), light, B, [-2.35, 2.35, 0], [0, 0, 0.12]);
  // bows
  const bowM = mat('#ffffff', { rough: 0.4 });
  const bow = (p, s) => {
    const g = grp(B, p);
    g.scale.setScalar(s);
    mk(G.cone(0.35, 0.6, 8), bowM, g, [0, 0, -0.3], [Math.PI / 2, 0, 0]);
    mk(G.cone(0.35, 0.6, 8), bowM, g, [0, 0, 0.3], [-Math.PI / 2, 0, 0]);
    mk(G.sphere(0.16, 8, 6), mat('#ff3d9a'), g);
    return g;
  };
  bow([-2.35, 2.55, 0], 1.2);
  bow([2.6, 1.3, 0], 0.7);
  // hearts on the doors
  const hm = mat('#ff2d7a', { metal: 0.3, rough: 0.3, emissive: '#ff2d7a', ei: 0.4 });
  for (const side of [-1, 1]) {
    const h = mk(heartGeo(), hm, B, [0.2, 0.95, side * 1.27], [0, side > 0 ? 0 : Math.PI, 0], 0.55);
    h.castShadow = false;
  }
  // sparkles
  v.sparkles = [];
  const spM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2fb').multiplyScalar(3), toneMapped: false });
  for (let i = 0; i < 10; i++) {
    const s = mk(new THREE.OctahedronGeometry(0.09), spM, B, [(i / 10) * 5 - 2.5, 0.9 + (i % 3) * 0.3, (i % 2 ? 1 : -1) * 1.3]);
    s.castShadow = false;
    v.sparkles.push(s);
  }
  const seat = grp(B, [-0.2, 0.95, 0]);
  const d = driver(seat, { skin: '#ffe0d2', shirt: '#ffffff', headR: 0.45, face: { lip: '#ff4fa3', lashes: true, browColor: '#ff8fc8' } });
  const hair = mat('#ffa6d9', { rough: 0.7 });
  mk(G.hemi(0.5, 16), hair, d.head, [-0.03, 0.04, 0], [0, 0, 0.3]);
  mk(G.rbox(0.25, 0.7, 0.85, 0.1), hair, d.head, [-0.35, -0.2, 0]);
  for (const z of [-0.3, 0.3]) mk(G.cone(0.13, 0.3, 4), mat('#2b2b2b'), d.head, [-0.05, 0.52, z], [0, 0, 0.1]);
  for (const z of [-0.18, 0.18]) mk(heartGeo(), mat('#ff2d7a', { rough: 0.2, metal: 0.3 }), d.head, [0.47, 0.06, z], [0, Math.PI / 2, 0], 0.17);
  v.face = d.face;
  v.head = d.head;
  const wo = { rim: '#ffffff', spoke: '#ff77c8', tire: '#2a1a24' };
  v.wheels.push(wheel(v.root, 1.6, 0.55, -1.25, 0.55, 0.45, wo));
  v.wheels.push(wheel(v.root, 1.6, 0.55, 1.25, 0.55, 0.45, wo));
  v.wheels.push(wheel(v.root, -1.6, 0.6, -1.25, 0.6, 0.55, wo));
  v.wheels.push(wheel(v.root, -1.6, 0.6, 1.25, 0.6, 0.55, wo));
  v.L = 5.2; v.W = 2.7; v.H = 2.7;
  v.headWorldOffset = new THREE.Vector3(-0.1, 2.6, 0);
  v.update = (st) => {
    const t = st.t;
    v.sparkles.forEach((s, i) => {
      const k = (Math.sin(t * 9 + i * 2.1) + 1) / 2;
      s.scale.setScalar(0.4 + k * 1.4);
      s.rotation.y = t * 4 + i;
    });
    d.face.set((st.special || {}).expr || { lid: 0.35, brow: -0.1, smile: 0.8, smirk: -0.2, blink: (t % 2.9) < 0.12 ? 1 : 0 });
  };
  return v;
}

// ------------------------------------------------------------------ 5. Out of Space: rocket on wheels
function rocket(color) {
  const v = base(color);
  const B = v.body;
  const white = mat('#f2f4f8', { rough: 0.35, metal: 0.2 });
  const red = mat('#e63946', { rough: 0.4 });
  const acc = mat(color, { rough: 0.4 });
  const R = grp(B, [0, 1.35, 0]);
  mk(G.cyl(0.95, 0.95, 3.8, 18), white, R, [0, 0, 0], [0, 0, Math.PI / 2]);
  mk(G.cone(0.95, 1.6, 18), red, R, [2.7, 0, 0], [0, 0, -Math.PI / 2]);
  for (const x of [-1.2, 1.0]) mk(G.cyl(0.97, 0.97, 0.25, 18), acc, R, [x, 0, 0], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = mk(G.box(1.2, 0.08, 0.9), red, R, [-1.6, Math.sin(a) * 1.15, Math.cos(a) * 1.15], [a, 0, 0]);
    fin.rotation.set(-a + Math.PI / 2, 0, 0);
  }
  mk(G.cyl(0.7, 0.5, 0.6, 14), mat('#555b66', { metal: 0.8, rough: 0.3 }), R, [-2.15, 0, 0], [0, 0, Math.PI / 2]);
  const flameM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3fb8ff').multiplyScalar(1.5), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flame = mk(G.cone(0.55, 2.2, 12), flameM, R, [-3.4, 0, 0], [0, 0, Math.PI / 2]);
  flame.castShadow = false;
  const core = mk(G.cone(0.3, 1.4, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color('#cfefff').multiplyScalar(1.6), toneMapped: false }), R, [-3.0, 0, 0], [0, 0, Math.PI / 2]);
  core.castShadow = false;
  // porthole with astronaut
  mk(G.torus(0.45, 0.08, 8, 18), mat('#9aa3b2', { metal: 0.9, rough: 0.2 }), R, [0.7, 0.45, 0.85], [0, 0, 0]);
  mk(G.circle(0.42, 18), mat('#a8e0ff', { opacity: 0.45, rough: 0.05 }), R, [0.7, 0.45, 0.9]);
  const astro = grp(R, [0.6, 0.35, 0.45]);
  mk(G.sphere(0.38, 14, 10), mat('#7ee081', { rough: 0.5 }), astro);
  const fc = face(astro, 0.38, { eyeSize: 0.35 });
  astro.rotation.y = -Math.PI / 2 + 0.35;
  mk(G.sphere(0.42, 14, 10), mat('#ffffff', { opacity: 0.25, rough: 0.05 }), astro);
  v.face = fc;
  v.head = astro;
  // little side boosters
  for (const side of [-1, 1]) mk(G.cyl(0.25, 0.25, 1.5, 10), white, R, [-0.9, -0.5, side * 1.05], [0, 0, Math.PI / 2]);
  const strut = mat('#666b75', { metal: 0.7, rough: 0.3 });
  for (const x of [1.3, -1.3]) for (const side of [-1, 1]) {
    mk(G.box(0.12, 0.9, 0.12), strut, B, [x, 0.75, side * 0.95], [side * 0.35, 0, 0]);
    v.wheels.push(wheel(v.root, x, 0.4, side * 1.25, 0.4, 0.3, { rim: '#e63946' }));
  }
  v.flame = flame;
  v.flameCore = core;
  v.rocketBody = R;
  v.L = 6.5; v.W = 2.6; v.H = 2.4;
  v.headWorldOffset = new THREE.Vector3(0.7, 1.8, 0.9);
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    const thrust = sp.thrust ?? (st.racing ? 0.6 : 0.15);
    const fl = 0.35 + thrust * 1.3 + Math.sin(t * 43) * 0.1;
    flame.scale.set(0.7 + thrust * 0.5, fl, 0.7 + thrust * 0.5);
    flame.position.x = -2.6 - fl * 0.95;
    core.scale.set(1, 0.7 + thrust, 1);
    R.rotation.x = Math.sin(t * 7.3) * 0.04 * (1 + thrust);
    R.position.y = 1.35 + Math.sin(t * 13) * 0.03 * (1 + thrust * 3);
    fc.set(sp.expr || { lid: 0, brow: 0.3, open: 0.15 + 0.1 * Math.sin(t * 3), wide: 1.1, blink: (t % 3.3) < 0.1 ? 1 : 0 });
  };
  return v;
}

// ------------------------------------------------------------------ 6. 8-Bit RPG voxel racer
function voxel(color) {
  const v = base(color);
  const S = 0.5;
  const pal = { B: color, R: '#d82800', W: '#fcfcfc', K: '#101010', G: '#a8a8a8', Y: '#fca044', S: '#f8b878', D: '#787878', P: '#e40058' };
  // layers from bottom (y) ; rows = x (back→front) ; cols = z
  const vox = [];
  const add = (x, y, z, c) => vox.push([x, y, z, c]);
  for (let x = -4; x <= 4; x++) for (let z = -2; z <= 2; z++) {
    add(x, 1, z, Math.abs(z) === 2 && x % 2 === 0 ? 'R' : 'B');
    if (x >= -3 && x <= 3 && Math.abs(z) === 2) add(x, 2, z, 'B');
    if (x === 4 || x === -4) add(x, 2, z, x === 4 ? (Math.abs(z) === 1 ? 'Y' : 'B') : Math.abs(z) === 1 ? 'R' : 'B');
  }
  for (let z = -2; z <= 2; z++) add(-5, 3, z, 'R');
  add(-5, 2, -2, 'D'); add(-5, 2, 2, 'D');
  // knight
  for (const [x, y, z, c] of [
    [-1, 2, 0, 'G'], [-1, 3, 0, 'G'], [-1, 2, -1, 'G'], [-1, 2, 1, 'G'], [-1, 3, -1, 'G'], [-1, 3, 1, 'G'],
    [-1, 4, 0, 'G'], [-1, 4, -1, 'G'], [-1, 4, 1, 'G'], [0, 4, 0, 'K'], [0, 4, -1, 'G'], [0, 4, 1, 'G'],
    [-1, 5, 0, 'G'], [-1, 5, -1, 'G'], [-1, 5, 1, 'G'], [0, 5, 0, 'G'], [-1, 6, 0, 'P'], [-2, 6, 0, 'P'], [-2, 5, 0, 'P'],
    [0, 3, 1, 'G'], [1, 3, 1, 'S'],
    [1, 4, 1, 'W'], [1, 5, 1, 'W'], [1, 6, 1, 'W'], [1, 7, 1, 'W'], [1, 3, 2, 'Y'],
  ]) add(x, y, z, c);
  const geo = G.box(S * 0.98, S * 0.98, S * 0.98);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), vox.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  v.voxHome = [];
  vox.forEach(([x, y, z, col], i) => {
    const p = new THREE.Vector3(x * S, y * S, z * S);
    v.voxHome.push(p);
    m4.makeTranslation(p.x, p.y, p.z);
    im.setMatrixAt(i, m4);
    im.setColorAt(i, c.set(pal[col]));
  });
  im.castShadow = true;
  im.receiveShadow = true;
  v.body.add(im);
  v.vox = im;
  for (const x of [1.6, -1.6]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, 0.5, side * 1.3, 0.5, 0.5, { square: true, rim: '#606060' }));
  v.L = 5; v.W = 2.6; v.H = 3.8;
  v.headWorldOffset = new THREE.Vector3(-0.3, 2.5, 0);
  v.update = (st) => {
    // chunky "frame-skipping" bob like an old game
    v.body.position.y = Math.floor(st.t * 8) % 2 ? 0.06 : 0;
  };
  return v;
}

// ------------------------------------------------------------------ 7. Automation: industrial robot
function robot(color) {
  const v = base(color);
  const B = v.body;
  const yel = mat(color, { rough: 0.5, metal: 0.2 });
  const dark = mat('#2b2e33', { metal: 0.6, rough: 0.4 });
  const hz = stripeTexture('#ffc21a', '#111111', 6);
  const hazard = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.6 });
  mk(G.box(4.6, 1.3, 2.4), yel, B, [0, 1.35, 0]);
  mk(G.box(4.64, 0.35, 2.44), hazard, B, [0, 0.82, 0]);
  mk(G.box(1.6, 1.1, 1.8), dark, B, [-1.2, 2.5, 0]);
  // conveyor treads
  v.treadTex = [];
  for (const side of [-1, 1]) {
    const tt = stripeTexture('#1a1a1a', '#4a4a4a', 8, false);
    tt.wrapS = tt.wrapT = THREE.RepeatWrapping;
    tt.repeat.set(4, 1);
    v.treadTex.push(tt);
    mk(G.rbox(4.8, 1.1, 0.6, 0.45), new THREE.MeshStandardMaterial({ map: tt, roughness: 0.9 }), B, [0, 0.6, side * 1.45]);
  }
  // gears
  v.gears = [];
  for (const side of [-1, 1]) {
    const gg = grp(B, [-0.6, 1.7, side * 1.25]);
    mk(G.cyl(0.55, 0.55, 0.15, 12), dark, gg, [0, 0, 0], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 8; i++) mk(G.box(0.2, 0.25, 0.14), dark, gg, [Math.cos((i / 8) * Math.PI * 2) * 0.6, Math.sin((i / 8) * Math.PI * 2) * 0.6, 0], [0, 0, (i / 8) * Math.PI * 2]);
    v.gears.push(gg);
  }
  // lamps
  v.lamps = [];
  for (let i = 0; i < 4; i++) {
    const lm = umat('#550000', { emissive: '#ff2200', ei: 0 });
    mk(G.sphere(0.15, 8, 6), lm, B, [1.4 + i * 0.3, 2.05, (i % 2 ? 0.6 : -0.6)]);
    v.lamps.push(lm);
  }
  mk(G.cyl(0.04, 0.04, 1.4, 6), dark, B, [-1.6, 3.6, 0.6]);
  const beacon = umat('#ffaa00', { emissive: '#ffaa00', ei: 1 });
  mk(G.sphere(0.16, 8, 6), beacon, B, [-1.6, 4.3, 0.6]);
  v.lamps.push(beacon);
  // two robot arms
  v.robotArms = [];
  for (const side of [-1, 1]) {
    const a0 = grp(B, [0.9, 2.0, side * 0.7]);
    mk(G.cyl(0.35, 0.42, 0.3, 12), dark, a0);
    const a1 = grp(a0, [0, 0.15, 0]);
    mk(G.box(0.3, 1.5, 0.3), yel, a1, [0, 0.75, 0]);
    const a2 = grp(a1, [0, 1.5, 0]);
    mk(G.sphere(0.22, 10, 8), dark, a2);
    mk(G.box(0.25, 1.2, 0.25), yel, a2, [0, 0.6, 0]);
    const a3 = grp(a2, [0, 1.2, 0]);
    mk(G.box(0.15, 0.4, 0.15), dark, a3, [-0.1, 0.2, 0.06]);
    mk(G.box(0.15, 0.4, 0.15), dark, a3, [0.1, 0.2, -0.06]);
    v.robotArms.push({ a0, a1, a2, a3 });
  }
  // face screen
  const scr = textCanvas(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#071a10'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#34ff7a'; ctx.fillRect(28, 20, 18, 18); ctx.fillRect(82, 20, 18, 18); ctx.fillRect(40, 46, 48, 6);
  });
  mk(G.plane(1.0, 0.55), new THREE.MeshBasicMaterial({ map: scr, toneMapped: false }), B, [-0.39, 2.6, 0], [0, Math.PI / 2, 0]).castShadow = false;
  v.panels = B.children.slice(0, 6);
  v.L = 4.9; v.W = 3.1; v.H = 4.4;
  v.headWorldOffset = new THREE.Vector3(-0.4, 2.6, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    const panic = sp.panic ?? 0;
    v.treadTex.forEach((tt) => (tt.offset.x = -st.dist * 0.18));
    v.gears.forEach((g, i) => (g.rotation.z = -st.dist * 0.8 * (i ? 1 : -1)));
    v.lamps.forEach((l, i) => {
      const on = Math.floor(t * (3 + panic * 9) + i) % 2 === 0;
      l.emissiveIntensity = on ? 2.5 : 0.1;
      if (i < 4) l.emissive.set(panic > 0.5 ? '#ff0000' : '#ffaa00');
    });
    if (!sp.armsOverride) {
      v.robotArms.forEach((a, i) => {
        const k = t * (1.4 + panic * 6) + i * 1.7;
        a.a0.rotation.y = Math.sin(k) * 0.6;
        a.a1.rotation.z = -0.4 + Math.sin(k * 1.3) * 0.25 - panic * 0.4;
        a.a2.rotation.z = -0.9 + Math.sin(k * 1.7) * 0.4 - panic * 0.5;
      });
    }
  };
  return v;
}

// ------------------------------------------------------------------ 8. Build to Survive
function survival(color) {
  const v = base(color);
  const B = v.body;
  const metal = mat('#6b7078', { metal: 0.6, rough: 0.5, flat: true });
  const rusty = mat('#8a5a3c', { metal: 0.3, rough: 0.8, flat: true });
  const wood = mat('#a47148', { rough: 0.95, flat: true });
  const dark = mat('#2d3035', { metal: 0.4, rough: 0.6 });
  mk(G.box(4.8, 1.3, 2.5), dark, B, [0, 1.3, 0]);
  mk(G.box(2.4, 1.2, 2.3), metal, B, [-0.7, 2.5, 0]);
  // planks
  const r = [0.2, -0.15, 0.3, -0.25, 0.1, 0.22];
  for (let i = 0; i < 6; i++) mk(G.box(0.22, 1.25, 0.12), wood, B, [-1.8 + i * 0.6, 1.4, 1.3], [r[i], 0, r[i] * 0.5]);
  for (let i = 0; i < 5; i++) mk(G.box(1.4, 0.24, 0.12), wood, B, [-1.2 + i * 0.5, 1.3 + (i % 2) * 0.4, -1.3], [0, 0, r[i]]);
  // plates with rivets
  mk(G.box(1.3, 0.9, 0.1), rusty, B, [1.4, 1.5, 1.32], [0, 0, 0.1]);
  mk(G.box(1.2, 1.0, 0.1), metal, B, [0.2, 2.6, -1.18], [0.06, 0, 0]);
  // fence ram on the front
  const fenceTex = textCanvas(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#c0c4c8';
    ctx.lineWidth = 5;
    for (let i = -w; i < w * 2; i += 22) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke();
    }
  });
  mk(G.plane(2.6, 1.4), new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }), B, [2.55, 1.4, 0], [0, Math.PI / 2, 0]);
  mk(G.box(0.15, 0.15, 2.8), metal, B, [2.55, 2.1, 0]);
  mk(G.box(0.15, 0.15, 2.8), metal, B, [2.55, 0.7, 0]);
  for (let i = 0; i < 5; i++) mk(G.cone(0.12, 0.6, 6), metal, B, [2.75, 0.75, -1.1 + i * 0.55], [0, 0, -Math.PI / 2]);
  // roof junk: barrel, tire, lawn chair-ish
  mk(G.cyl(0.4, 0.4, 0.9, 12), mat('#2f6b3a', { rough: 0.6 }), B, [-1.2, 3.55, 0.4]);
  mk(G.torus(0.4, 0.17, 8, 14), mat('#1a1a1a'), B, [-0.1, 3.25, -0.5], [Math.PI / 2, 0, 0]);
  mk(G.box(0.6, 0.06, 0.6), mat(color), B, [0.3, 3.3, 0.5]);
  // driver with saucepan helmet
  const d = driver(grp(B, [0.65, 2.05, 0]), { skin: '#e0ac69', shirt: '#556b2f', headR: 0.42 });
  mk(G.cyl(0.48, 0.44, 0.35, 12), mat('#c0c0c0', { metal: 0.9, rough: 0.25 }), d.head, [0, 0.35, 0]);
  mk(G.box(0.7, 0.06, 0.08), mat('#c0c0c0', { metal: 0.9, rough: 0.25 }), d.head, [-0.6, 0.35, 0]);
  v.face = d.face;
  v.head = d.head;
  mk(G.box(0.12, 0.9, 1.9), mat('#88aacc', { opacity: 0.35 }), B, [1.55, 2.6, 0], [0, 0, -0.3]);
  // mismatched wheels
  v.wheels.push(wheel(v.root, 1.6, 0.7, -1.4, 0.7, 0.55, { rim: '#b33' }));
  v.wheels.push(wheel(v.root, 1.6, 0.55, 1.4, 0.55, 0.45, { rim: '#ddd' }));
  v.wheels.push(wheel(v.root, -1.6, 0.85, -1.4, 0.85, 0.65, { rim: '#333' }));
  v.wheels.push(wheel(v.root, -1.6, 0.75, 1.4, 0.75, 0.5, { rim: '#da3' }));
  v.L = 5.4; v.W = 3; v.H = 4;
  v.headWorldOffset = new THREE.Vector3(0.7, 3.6, 0);
  v.update = (st) => {
    d.face.set((st.special || {}).expr || { lid: 0.2, brow: -0.3, smile: -0.2, blink: (st.t % 3.4) < 0.12 ? 1 : 0 });
    v.body.rotation.x = Math.sin(st.t * 9) * 0.015;
  };
  return v;
}

// ------------------------------------------------------------------ 9. Everything Comes at a Cost
function gold(color) {
  const v = base(color);
  const B = v.body;
  const au = mat('#d9a520', { metal: 0.9, rough: 0.32 });
  const chrome = mat('#f2f2f2', { metal: 1, rough: 0.1 });
  mk(G.rbox(5.4, 1.0, 2.5, 0.42), au, B, [0, 0.95, 0]);
  mk(G.rbox(2.6, 0.9, 2.2, 0.38), au, B, [-0.5, 1.8, 0]);
  mk(G.box(0.1, 0.75, 1.9), mat('#3a2a00', { opacity: 0.55, rough: 0.05 }), B, [0.82, 1.85, 0], [0, 0, -0.5]);
  mk(G.box(0.2, 0.5, 1.8), chrome, B, [2.72, 0.85, 0]);
  // coin slot + coin counter
  mk(G.box(0.5, 0.06, 0.9), mat('#111'), B, [1.7, 1.47, 0]);
  mk(G.box(0.3, 0.04, 0.6), mat('#000'), B, [1.7, 1.5, 0]);
  const ct = textCanvas(256, 96, () => {});
  v.counterTex = ct;
  v.counterKey = '';
  const scr = mk(G.plane(0.9, 0.34), new THREE.MeshBasicMaterial({ map: ct, toneMapped: false }), B, [0.92, 1.9, 0], [0, Math.PI / 2, 0]);
  scr.castShadow = false;
  // diamond ornament
  mk(new THREE.OctahedronGeometry(0.25), mat('#bff6ff', { metal: 0.2, rough: 0.05, emissive: '#5fd5ff', ei: 0.6 }), B, [2.5, 1.65, 0], [0, 0.5, 0], [0.8, 1.2, 0.8]);
  const d = driver(grp(B, [-0.4, 1.35, 0]), { skin: '#ffdbac', shirt: '#1b1b1b', headR: 0.42 });
  mk(G.cyl(0.32, 0.32, 0.7, 14), mat('#111', { rough: 0.4 }), d.head, [0, 0.62, 0]);
  mk(G.cyl(0.52, 0.52, 0.05, 16), mat('#111', { rough: 0.4 }), d.head, [0, 0.3, 0]);
  mk(G.box(0.05, 0.08, 0.5), mat('#ffcf3a', { metal: 1, rough: 0.2 }), d.head, [0, 0.35, 0]);
  mk(G.torus(0.11, 0.02, 6, 14), mat('#ffcf3a', { metal: 1 }), d.head, [0.42, 0.05, 0.15], [0, Math.PI / 2, 0]);
  mk(G.box(0.08, 0.08, 0.5), mat('#e8e8e8'), d.head, [0.42, -0.14, 0], [0.15, 0, 0]);
  v.face = d.face;
  v.head = d.head;
  // the coin being fed
  const coin = mk(G.cyl(0.2, 0.2, 0.05, 14), au, B, [1.7, 2.3, 0], [Math.PI / 2, 0, 0]);
  v.coin = coin;
  const wo = { rim: '#ffcf3a', spoke: '#b8860b', tire: '#151515' };
  for (const x of [1.7, -1.7]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, 0.55, side * 1.25, 0.55, 0.45, wo));
  v.L = 5.6; v.W = 2.7; v.H = 2.9;
  v.headWorldOffset = new THREE.Vector3(-0.4, 3.0, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const coins = sp.coins ?? 99;
    const key = String(coins);
    if (key !== v.counterKey) {
      v.counterKey = key;
      const { ctx, canvas } = ct.userData;
      ctx.fillStyle = coins <= 0 ? '#3a0000' : '#001a08';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = 'bold 64px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = coins <= 0 ? '#ff3333' : coins < 10 ? '#ffcc00' : '#33ff77';
      ctx.fillText(coins <= 0 ? '¢ 0' : `¢ ${coins}`, canvas.width / 2, canvas.height / 2);
      ct.needsUpdate = true;
    }
    const ph = (st.t * 2.2) % 1;
    coin.visible = coins > 0;
    coin.position.set(1.7, 1.5 + Math.sin(ph * Math.PI) * 1.2, 0);
    coin.rotation.set(Math.PI / 2, ph * 12, 0);
    d.face.set(sp.expr || { lid: 0.45, brow: -0.1, smile: 0.5, smirk: 0.2 });
  };
  return v;
}

// ------------------------------------------------------------------ 10. Find Out the Controls
function buttons(color) {
  const v = base(color);
  const B = v.body;
  const red = mat(color, { rough: 0.35, metal: 0.3 });
  const dark = mat('#22252b', { rough: 0.5 });
  mk(G.rbox(4.6, 0.7, 1.6, 0.3), red, B, [0, 0.75, 0]);
  mk(G.rbox(2.2, 0.4, 1.0, 0.18), red, B, [2.6, 0.62, 0]);
  mk(G.box(0.4, 0.12, 2.8), dark, B, [3.6, 0.45, 0]);
  mk(G.box(0.6, 0.12, 2.6), dark, B, [-2.4, 1.65, 0]);
  for (const z of [-0.8, 0.8]) mk(G.box(0.15, 0.6, 0.12), dark, B, [-2.4, 1.3, z]);
  // giant dashboard of buttons
  const dash = grp(B, [0.95, 1.45, 0], [0, 0, 0.55]);
  mk(G.box(0.15, 1.1, 2.4), dark, dash);
  const cols = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ff9f0a', '#bf5af2', '#ffffff', '#64d2ff'];
  const bg = G.cyl(0.07, 0.07, 0.08, 8);
  const bi = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ roughness: 0.3, emissive: '#222' }), 48);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), c = new THREE.Color();
  for (let i = 0; i < 48; i++) {
    m4.compose(new THREE.Vector3(0.1, -0.42 + Math.floor(i / 12) * 0.27, -1.05 + (i % 12) * 0.19), q, new THREE.Vector3(1, 1, 1));
    bi.setMatrixAt(i, m4);
    bi.setColorAt(i, c.set(cols[(i * 7) % cols.length]));
  }
  dash.add(bi);
  v.bigButton = mk(G.cyl(0.18, 0.2, 0.12, 14), mat('#ff0000', { emissive: '#ff0000', ei: 0.6 }), dash, [0.12, 0.65, 0], [0, 0, Math.PI / 2]);
  // levers
  v.levers = [];
  for (let i = 0; i < 4; i++) {
    const lg = grp(B, [0.3, 1.1, -0.65 + i * 0.43]);
    mk(G.cyl(0.03, 0.03, 0.7, 6), mat('#999', { metal: 0.8 }), lg, [0, 0.35, 0]);
    mk(G.sphere(0.08, 8, 6), mat(cols[i]), lg, [0, 0.72, 0]);
    v.levers.push(lg);
  }
  // warning beacons
  v.beacons = [];
  for (const z of [-0.6, 0.6]) {
    const bm = umat('#ff1a1a', { emissive: '#ff1a1a', ei: 1, opacity: 0.85 });
    mk(G.hemi(0.25, 12), bm, B, [-1.2, 1.12, z]);
    v.beacons.push(bm);
  }
  const seat = grp(B, [-0.5, 1.0, 0]);
  mk(G.box(0.3, 1.0, 0.9), dark, seat, [-0.45, 0.5, 0]);
  const d = driver(seat, { skin: '#c68642', shirt: '#ffffff', headR: 0.42 });
  mk(G.hemi(0.44, 14), mat(color), d.head, [0, 0.05, 0], [0, 0, 0.1]);
  const q2 = textSprite('?', { color: '#ffe14d', size: 110, w: 128, h: 128 });
  q2.scale.set(0.9, 0.9, 1);
  q2.position.set(0, 1.25, 0);
  d.head.add(q2);
  v.question = q2;
  v.seat = seat;
  v.driverObj = d;
  v.face = d.face;
  v.head = d.head;
  for (const x of [2.7, -1.7]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, x > 0 ? 0.5 : 0.6, side * 1.2, x > 0 ? 0.5 : 0.6, 0.55, { rim: '#ffcc00' }));
  v.L = 6.2; v.W = 2.8; v.H = 2.8;
  v.headWorldOffset = new THREE.Vector3(-0.5, 2.6, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    v.beacons.forEach((b, i) => (b.emissiveIntensity = Math.floor(t * 6 + i) % 2 ? 3 : 0.2));
    v.levers.forEach((l, i) => (l.rotation.z = Math.sin(t * (3 + i) + i) * 0.5));
    d.head.rotation.y = Math.sin(t * 2.2) * 0.6;
    q2.position.y = 1.25 + Math.sin(t * 4) * 0.1;
    d.arms[0].rotation.x = Math.sin(t * 7) * 0.4;
    d.arms[1].rotation.x = Math.sin(t * 6 + 1) * 0.4;
    d.face.set(sp.expr || { lid: 0, brow: 0.5, browY: 0.3, open: 0.3, wide: 1.15, lookX: Math.sin(t * 2.2) });
  };
  return v;
}

// ------------------------------------------------------------------ 11. Out of Control buggy
function buggy(color) {
  const v = base(color);
  const B = v.body;
  const tube = mat(color, { metal: 0.4, rough: 0.4 });
  const dark = mat('#26282c', { rough: 0.6 });
  mk(G.box(3.8, 0.25, 1.8), dark, B, [0, 0.9, 0]);
  const bar = (a, b) => limb(B, tube, 0.07).set(new THREE.Vector3(...a), new THREE.Vector3(...b));
  for (const z of [-0.85, 0.85]) {
    bar([-1.6, 0.95, z], [-0.8, 2.6, z * 0.8]);
    bar([1.4, 0.95, z], [0.5, 2.6, z * 0.8]);
    bar([-0.8, 2.6, z * 0.8], [0.5, 2.6, z * 0.8]);
    bar([-1.9, 0.95, z], [1.9, 0.95, z]);
  }
  bar([-0.8, 2.6, -0.68], [-0.8, 2.6, 0.68]);
  bar([0.5, 2.6, -0.68], [0.5, 2.6, 0.68]);
  mk(G.box(0.6, 0.9, 0.9), dark, B, [-0.6, 1.4, 0]);
  const seat = grp(B, [-0.2, 1.05, 0]);
  const d = driver(seat, { skin: '#ffdbac', shirt: '#ff6b35', headR: 0.42 });
  for (let i = 0; i < 7; i++) mk(G.cone(0.1, 0.5, 5), mat('#ffef5c'), d.head, [-0.1, 0.35, 0], [Math.sin(i) * 0.9, 0, -0.4 + Math.cos(i * 1.3) * 0.7]);
  mk(G.torus(0.16, 0.05, 6, 12), mat('#222'), d.head, [0.38, 0.15, -0.16], [0, Math.PI / 2, 0]);
  mk(G.torus(0.16, 0.05, 6, 12), mat('#222'), d.head, [0.38, 0.15, 0.16], [0, Math.PI / 2, 0]);
  const sw = steeringWheel(B, [0.55, 1.9, 0]);
  v.sw = sw;
  // whip flag
  const whip = grp(B, [-1.7, 1.0, 0.7]);
  mk(G.cyl(0.03, 0.03, 3, 5), mat('#ddd'), whip, [0, 1.5, 0]);
  mk(G.cone(0.4, 0.7, 3), mat('#ff6b00', { double: true }), whip, [0.3, 2.8, 0], [0, 0, -Math.PI / 2]);
  v.whip = whip;
  v.face = d.face;
  v.head = d.head;
  const knob = { rim: '#ffd60a', tire: '#1d1d1d', seg: 10 };
  for (const x of [1.5, -1.5]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, 0.75, side * 1.35, 0.75, 0.7, knob));
  v.L = 4.5; v.W = 3.4; v.H = 3.3;
  v.headWorldOffset = new THREE.Vector3(-0.2, 2.6, 0);
  v.update = (st) => {
    const t = st.t;
    sw.wheel.rotation.x = t * 9;
    whip.rotation.x = Math.sin(t * 6) * 0.35;
    d.head.rotation.y = Math.sin(t * 5) * 0.4;
    d.face.set((st.special || {}).expr || { lid: 0, brow: 0.6, open: 0.75, wide: 1.25, lookX: Math.sin(t * 8) });
  };
  return v;
}

// ------------------------------------------------------------------ 12. The Floor Is Lava
function stilts(color) {
  const v = base(color);
  const B = v.body;
  const cab = mat('#3a3f47', { metal: 0.5, rough: 0.4 });
  const acc = mat(color, { rough: 0.4 });
  const lavaM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a00').multiplyScalar(2.2), toneMapped: false });
  const top = grp(B, [0, 4.4, 0]);
  v.top = top;
  mk(G.rbox(2.6, 1.3, 2.0, 0.4), acc, top, [0, 0, 0]);
  mk(G.box(0.1, 0.7, 1.6), mat('#cfe8ff', { opacity: 0.45 }), top, [1.25, 0.35, 0], [0, 0, -0.25]);
  const d = driver(grp(top, [0.1, -0.1, 0]), { skin: '#f1c27d', shirt: '#ffffff', headR: 0.42 });
  mk(G.sphere(0.06, 6, 4), mat('#9be7ff', { opacity: 0.8 }), d.head, [0.25, 0.3, 0.38]);
  v.face = d.face;
  v.head = d.head;
  v.legs = [];
  for (const x of [0.9, -0.9]) for (const side of [-1, 1]) {
    const lg = grp(top, [x, -0.5, side * 0.8]);
    mk(G.cyl(0.11, 0.09, 3.6, 8), cab, lg, [0, -1.8, side * 0.25], [side * 0.14, 0, 0]);
    v.legs.push(lg);
  }
  for (const x of [0.9, -0.9]) for (const side of [-1, 1]) {
    const w = wheel(v.root, x, 0.42, side * 1.35, 0.42, 0.3, { rimMat: lavaM, tire: '#3a0d00' });
    w.spin.children[0].material = lavaM;
    v.wheels.push(w);
  }
  v.L = 3; v.W = 3; v.H = 6;
  v.headWorldOffset = new THREE.Vector3(0.1, 5.8, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const hop = sp.hop ?? Math.abs(Math.sin(st.t * 6.5)) * 0.35;
    top.position.y = 4.4 + hop;
    d.face.set(sp.expr || { lid: 0, brow: 0.55, open: 0.35, wide: 1.2, lookY: -0.6 });
  };
  return v;
}

// ------------------------------------------------------------------ 13. AI
function ai(color) {
  const v = base(color);
  const B = v.body;
  const white = mat('#eef2f7', { metal: 0.4, rough: 0.2 });
  const neonC = new THREE.Color(color).multiplyScalar(2.2);
  const neon = new THREE.MeshBasicMaterial({ color: neonC, toneMapped: false });
  mk(G.rbox(5.0, 0.8, 2.5, 0.38), white, B, [0, 0.85, 0]);
  mk(G.rbox(2.8, 0.75, 2.1, 0.35), mat('#0b1622', { metal: 0.6, rough: 0.05 }), B, [-0.3, 1.5, 0]);
  for (const side of [-1, 1]) mk(G.box(4.8, 0.06, 0.05), neon, B, [0, 0.62, side * 1.26]).castShadow = false;
  mk(G.box(0.05, 0.06, 2.4), neon, B, [2.52, 0.95, 0]).castShadow = false;
  // face screen
  const ft = textCanvas(256, 96, () => {});
  v.faceTex = ft;
  v.faceKey = '';
  mk(G.plane(1.8, 0.62), new THREE.MeshBasicMaterial({ map: ft, toneMapped: false, transparent: true }), B, [2.53, 0.95, 0], [0, Math.PI / 2, 0]).castShadow = false;
  // AI core orb
  v.orb = mk(G.sphere(0.4, 16, 12), new THREE.MeshBasicMaterial({ color: neonC, toneMapped: false }), B, [-0.3, 1.55, 0]);
  // hologram rings
  v.rings = [];
  const ringM = new THREE.MeshBasicMaterial({ color: neonC, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const r = mk(G.torus(0.7 + i * 0.3, 0.025, 4, 32), ringM, B, [-0.3, 2.4 + i * 0.25, 0], [Math.PI / 2, 0, 0]);
    r.castShadow = false;
    v.rings.push(r);
  }
  // hologram text panel
  const ht = textCanvas(768, 192, () => {});
  v.holoTex = ht;
  v.holoKey = '';
  const hp = new THREE.Mesh(G.plane(5.2, 1.3), new THREE.MeshBasicMaterial({ map: ht, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  hp.position.set(-0.3, 3.9, 0);
  hp.rotation.y = -Math.PI / 2;
  B.add(hp);
  v.holoPanel = hp;
  const wo = { rim: '#dfe6ee', spoke: color, tire: '#111' };
  for (const x of [1.6, -1.6]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, 0.55, side * 1.25, 0.55, 0.45, wo));
  v.L = 5.2; v.W = 2.7; v.H = 3;
  v.headWorldOffset = new THREE.Vector3(2.5, 1.1, 0);
  const drawFace = (mode) => {
    if (mode === v.faceKey) return;
    v.faceKey = mode;
    const { ctx, canvas } = ft.userData;
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#02131a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.font = 'bold 64px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mode === 'smug' ? '^‿^' : mode === 'panic' ? 'O_O' : mode === 'calc' ? '◔_◔' : '•‿•', w / 2, h / 2);
    ft.needsUpdate = true;
  };
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    v.rings.forEach((r, i) => { r.rotation.z = t * (1 + i * 0.6); r.rotation.x = Math.PI / 2 + Math.sin(t * 2 + i) * 0.2; });
    v.orb.scale.setScalar(1 + Math.sin(t * 6) * 0.08);
    drawFace(sp.face ?? 'smile');
    const txt = sp.holo ?? '';
    hp.visible = !!txt;
    if (txt && txt !== v.holoKey) {
      v.holoKey = txt;
      const { ctx, canvas } = ht.userData;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0,255,220,0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
      ctx.fillStyle = '#d9fff8';
      ctx.font = 'bold 64px Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, canvas.width / 2, canvas.height / 2);
      ht.needsUpdate = true;
    }
  };
  return v;
}

// ------------------------------------------------------------------ 14. Blind Fighting tank
function tank(color) {
  const v = base(color);
  const B = v.body;
  const olive = mat('#5b6b3a', { rough: 0.7, flat: true });
  const dark = mat('#2a2d24', { rough: 0.8 });
  mk(G.box(4.2, 1.1, 2.4), olive, B, [0, 1.1, 0]);
  mk(G.box(3.8, 0.4, 2.0), olive, B, [0, 1.85, 0]);
  for (const side of [-1, 1]) mk(G.rbox(4.6, 1.0, 0.6, 0.45), dark, B, [0, 0.6, side * 1.4]);
  const turret = grp(B, [-0.3, 2.1, 0]);
  mk(G.hemi(1.1, 14), olive, turret, [0, 0, 0], [0, 0, 0], [1, 0.75, 1]);
  const d = driver(grp(turret, [-0.1, 0.25, 0]), { skin: '#e0ac69', shirt: '#4a5a2a', headR: 0.42 });
  const band = mk(G.cyl(0.445, 0.445, 0.22, 16, true), mat('#111', { double: true }), d.head, [0, 0.12, 0]);
  band.castShadow = false;
  v.bandTails = [];
  for (const k of [-1, 1]) {
    const tail = mk(G.box(0.05, 0.12, 0.5), mat('#111'), d.head, [-0.45, 0.1, k * 0.12], [0, k * 0.3, 0]);
    v.bandTails.push(tail);
  }
  v.face = d.face;
  v.head = d.head;
  // boxing gloves on telescopic arms
  v.gloves = [];
  const gloveM = mat('#d62828', { rough: 0.35, metal: 0.1 });
  for (const side of [-1, 1]) {
    const arm = grp(B, [1.8, 1.6, side * 0.75]);
    const ext = grp(arm);
    mk(G.cyl(0.13, 0.13, 1, 8), mat('#888', { metal: 0.8 }), ext, [0.5, 0, 0], [0, 0, Math.PI / 2]);
    const gl = grp(arm, [1.2, 0, 0]);
    mk(G.sphere(0.65, 14, 12), gloveM, gl, [0.25, 0, 0], [0, 0, 0], [1.05, 0.95, 0.95]);
    mk(G.sphere(0.28, 10, 8), gloveM, gl, [0.15, 0.35, side * -0.45]);
    mk(G.cyl(0.42, 0.45, 0.4, 12), mat('#fff'), gl, [-0.35, 0, 0], [0, 0, Math.PI / 2]);
    v.gloves.push({ arm, ext, gl });
  }
  for (const x of [1.4, 0, -1.4]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, 0.48, side * 1.45, 0.42, 0.55, { rim: '#4a4f3a' }));
  v.L = 5.6; v.W = 3.2; v.H = 3.6;
  v.headWorldOffset = new THREE.Vector3(-0.4, 3.3, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    const punch = sp.punch ?? 0.25;
    v.gloves.forEach((g, i) => {
      const ph = Math.max(0, Math.sin(t * (6 + punch * 10) + i * Math.PI));
      const e = 1 + ph * punch * 2.4;
      g.ext.scale.set(e, 1, 1);
      g.gl.position.x = 0.2 + e;
      g.arm.rotation.y = (sp.aim ?? 0) * (i ? 1 : 1);
    });
    v.bandTails.forEach((b, i) => (b.rotation.y = (i ? 1 : -1) * 0.3 + Math.sin(t * 14 + i) * 0.25));
    d.head.rotation.y = Math.sin(t * 1.7) * 0.5;
    d.face.set(sp.expr || { lid: 0, brow: -0.4, smile: -0.3, open: 0.2 });
  };
  return v;
}

// ------------------------------------------------------------------ 15. You Are the Monster
function monster(color) {
  const v = base(color);
  const B = v.body;
  const fur = mat(color, { rough: 0.95, flat: true });
  const belly = mat('#c9b6ff', { rough: 0.9, flat: true });
  const hips = grp(B, [0, 2.0, 0]);
  v.hips = hips;
  const torso = grp(hips, [0, 0.2, 0]);
  mk(G.ico(1.7, 1), fur, torso, [0, 1.6, 0], [0, 0, 0], [1, 1.15, 1.05]);
  mk(G.ico(1.1, 1), belly, torso, [0.85, 1.3, 0], [0, 0, 0], [0.6, 1.1, 1.1]);
  const head = grp(torso, [0.4, 3.3, 0]);
  mk(G.ico(1.15, 1), fur, head);
  for (const z of [-0.6, 0.6]) mk(G.cone(0.25, 0.9, 6), mat('#fff3d6', { flat: true }), head, [-0.1, 1.05, z], [z * 0.5, 0, -0.3]);
  const fc = face(head, 1.15, { eyeSize: 0.34, browColor: '#2a1050' });
  v.face = fc;
  v.head = head;
  // teeth row
  for (let i = 0; i < 5; i++) mk(G.cone(0.1, 0.28, 5), mat('#ffffff'), head, [1.0, -0.36, -0.35 + i * 0.17], [Math.PI, 0, 0]);
  // arms
  v.mArms = [];
  for (const side of [-1, 1]) {
    const sh = grp(torso, [0.1, 2.5, side * 1.55]);
    mk(G.capsule(0.38, 1.6, 4, 8), fur, sh, [0, -1.0, side * 0.2], [side * 0.25, 0, 0]);
    for (let k = 0; k < 3; k++) mk(G.cone(0.1, 0.3, 4), mat('#fff3d6'), sh, [0.2, -2.05, side * 0.25 + (k - 1) * 0.15], [Math.PI, 0, 0]);
    v.mArms.push(sh);
  }
  // legs with roller skates
  v.mLegs = [];
  const skateM = mat('#ff4fa3', { rough: 0.4 });
  for (const side of [-1, 1]) {
    const lg = grp(hips, [0, 0, side * 0.8]);
    mk(G.capsule(0.42, 1.0, 4, 8), fur, lg, [0, -0.85, 0]);
    const skate = grp(lg, [0.15, -1.75, 0]);
    mk(G.rbox(1.2, 0.5, 0.7, 0.15), skateM, skate, [0, 0.1, 0]);
    mk(G.box(1.1, 0.08, 0.5), mat('#ddd', { metal: 0.6 }), skate, [0, -0.17, 0]);
    for (const x of [-0.4, -0.13, 0.13, 0.4]) mk(G.cyl(0.11, 0.11, 0.18, 10), mat('#ffe14d'), skate, [x, -0.27, 0], [Math.PI / 2, 0, 0]);
    v.mLegs.push(lg);
  }
  v.L = 3.6; v.W = 4; v.H = 7.5;
  v.headWorldOffset = new THREE.Vector3(0.4, 5.6, 0);
  v.update = (st) => {
    const sp = st.special || {};
    const t = st.t;
    const cyc = st.dist * 0.22;
    if (!sp.custom) {
      v.mLegs.forEach((l, i) => {
        const s = Math.sin(cyc + i * Math.PI);
        l.rotation.set(s * 0.35, 0, 0);
        l.position.x = s * 0.25;
      });
      v.mArms.forEach((a, i) => (a.rotation.set(0, 0, Math.sin(cyc + i * Math.PI) * 0.6)));
      hips.rotation.y = Math.sin(cyc) * 0.12;
      hips.position.y = 2.0 + Math.abs(Math.cos(cyc)) * 0.15;
    }
    fc.set(sp.expr || { lid: 0.1, brow: -0.45, open: 0.25 + 0.15 * Math.sin(t * 3), wide: 1, blink: (t % 3.9) < 0.12 ? 1 : 0 });
  };
  return v;
}

// ------------------------------------------------------------------ 16. Everything Is a Weapon: armed shopping cart
function cart(color) {
  const v = base(color);
  const B = v.body;
  const chrome = mat('#cfd6dc', { metal: 0.9, rough: 0.25 });
  const basketG = new THREE.BoxGeometry(3.2, 1.5, 2.0, 8, 4, 5);
  const basket = new THREE.Mesh(basketG, new THREE.MeshBasicMaterial({ color: '#cfd6dc', wireframe: true }));
  basket.position.set(0, 1.75, 0);
  B.add(basket);
  mk(G.box(3.2, 0.06, 2.0), chrome, B, [0, 1.0, 0]);
  mk(G.box(3.0, 0.05, 1.8), chrome, B, [0, 0.45, 0]);
  for (const x of [-1.5, 1.5]) for (const z of [-0.9, 0.9]) mk(G.cyl(0.04, 0.04, 0.9, 6), chrome, B, [x, 0.75, z]);
  mk(G.cyl(0.07, 0.07, 2.2, 8), mat('#e63946'), B, [-1.85, 2.4, 0], [Math.PI / 2, 0, 0]);
  mk(G.box(0.06, 0.8, 0.06), chrome, B, [-1.75, 2.0, -0.95], [0, 0, 0.25]);
  mk(G.box(0.06, 0.8, 0.06), chrome, B, [-1.75, 2.0, 0.95], [0, 0, 0.25]);
  // weapons
  const steel = mat('#e6eaee', { metal: 1, rough: 0.15 });
  const knife = grp(B, [0.3, 2.6, 0.75], [0.2, 0, -0.7]);
  mk(G.box(0.1, 2.4, 0.5), steel, knife, [0, 1.2, 0]);
  mk(G.box(0.16, 0.8, 0.22), mat('#3b2412'), knife, [0, -0.3, 0]);
  const pan = grp(B, [-0.6, 2.6, -0.85], [-0.5, 0, 0.5]);
  mk(G.cyl(0.65, 0.55, 0.15, 16), mat('#202020', { metal: 0.6, rough: 0.4 }), pan, [0, 1.2, 0], [Math.PI / 2, 0, 0]);
  mk(G.box(0.1, 1.0, 0.12), mat('#202020'), pan, [0, 0.3, 0]);
  const fork = grp(B, [1.2, 2.2, -0.6], [0.6, 0, -0.9]);
  mk(G.box(0.08, 1.6, 0.12), steel, fork, [0, 0.8, 0]);
  for (let i = 0; i < 4; i++) mk(G.box(0.06, 0.6, 0.05), steel, fork, [0, 1.8, -0.18 + i * 0.12]);
  // cannon
  const cannon = grp(B, [1.1, 2.15, 0]);
  mk(G.cyl(0.35, 0.45, 2.2, 12), mat('#333', { metal: 0.7, rough: 0.35 }), cannon, [0.7, 0, 0], [0, 0, -Math.PI / 2]);
  mk(G.torus(0.38, 0.08, 6, 14), mat('#d4a017', { metal: 0.9 }), cannon, [1.75, 0, 0], [0, Math.PI / 2, 0]);
  v.cannon = cannon;
  // the shopper: tiny chef with a colander helmet
  const d = driver(grp(B, [-0.6, 1.1, 0]), { skin: '#ffdbac', shirt: '#ffffff', headR: 0.42 });
  mk(G.hemi(0.48, 12), mat('#b8c0c8', { metal: 0.8, rough: 0.3, flat: true }), d.head, [0, 0.08, 0]);
  v.face = d.face;
  v.head = d.head;
  for (const x of [1.4, -1.4]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, 0.28, side * 0.85, 0.28, 0.2, { rim: '#333' }));
  v.L = 4.2; v.W = 2.2; v.H = 4.5;
  v.headWorldOffset = new THREE.Vector3(-0.6, 2.7, 0);
  v.update = (st) => {
    const sp = st.special || {};
    cannon.rotation.z = sp.cannonAim ?? Math.sin(st.t * 1.5) * 0.1;
    v.body.rotation.x = Math.sin(st.t * 23) * 0.02;
    d.face.set(sp.expr || { lid: 0.1, brow: -0.5, smile: 0.6, open: 0.2 });
  };
  return v;
}

// ------------------------------------------------------------------ 17. One Piece at a Time
function junk(color) {
  const v = base(color);
  const B = v.body;
  const pieces = [];
  const part = (geo, m, p, r = [0, 0, 0]) => {
    const o = mk(geo, m, B, p, r);
    o.userData.home = { p: o.position.clone(), q: o.quaternion.clone() };
    pieces.push(o);
    return o;
  };
  mk(G.box(4.4, 0.35, 2.2), mat('#3b3b3b', { rough: 0.8 }), B, [0, 0.75, 0]); // chassis stays
  const seat = grp(B, [-0.3, 0.95, 0]);
  mk(G.box(0.8, 0.3, 0.9), mat('#6b4423'), seat, [0, 0.15, 0]);
  mk(G.box(0.25, 1.0, 0.9), mat('#6b4423'), seat, [-0.4, 0.6, 0]);
  const d = driver(seat, { skin: '#f1c27d', shirt: '#ffbe0b', headR: 0.42, pos: [0, 0.2, 0] });
  mk(G.hemi(0.44, 12), mat('#7c3aed'), d.head, [0, 0.05, 0]);
  v.face = d.face;
  v.head = d.head;
  const sw = steeringWheel(B, [0.55, 1.95, 0]);
  v.steering = sw.group;
  sw.group.userData.home = { p: sw.group.position.clone(), q: sw.group.quaternion.clone() };
  // panels in mismatched colours, listed in the order they fall off
  part(G.box(0.3, 0.4, 2.3), mat('#9e9e9e', { metal: 0.6 }), [-2.3, 0.85, 0]); // rear bumper
  part(G.box(0.8, 0.12, 2.0), mat('#ef476f'), [-2.0, 2.0, 0]); // spoiler
  part(G.box(1.5, 0.9, 0.12), mat('#118ab2'), [-0.2, 1.4, 1.15]); // door R
  part(G.box(1.6, 0.25, 2.1), mat('#06d6a0', { flat: true }), [1.4, 1.2, 0], [0, 0, -0.08]); // hood
  part(G.box(1.5, 0.9, 0.12), mat('#ffd166'), [-0.2, 1.4, -1.15]); // door L
  part(G.box(1.8, 0.12, 2.0), mat('#8d99ae'), [-0.4, 2.55, 0]); // roof
  part(G.box(1.0, 0.7, 2.1), mat(color), [-1.75, 1.3, 0]); // trunk
  part(G.box(0.3, 0.4, 2.3), mat('#9e9e9e', { metal: 0.6 }), [2.25, 0.85, 0]); // front bumper
  for (const [x, z] of [[-1.9, 1.05], [-1.9, -1.05], [1.4, 1.05], [1.4, -1.05]]) part(G.cyl(0.05, 0.05, 1.5, 4), mat('#666'), [x, 1.8, z]); // pillars
  v.pieces = pieces;
  const wcols = ['#e63946', '#ffffff', '#2a9d8f', '#f4a261'];
  [[1.5, -1.25, 0.55], [1.5, 1.25, 0.5], [-1.5, -1.25, 0.6], [-1.5, 1.25, 0.65]].forEach(([x, z, r], i) => {
    const w = wheel(v.root, x, r, z, r, 0.45, { rim: wcols[i] });
    w.obj.userData.home = { p: w.obj.position.clone(), q: w.obj.quaternion.clone() };
    v.wheels.push(w);
  });
  v.L = 4.8; v.W = 2.7; v.H = 2.8;
  v.headWorldOffset = new THREE.Vector3(-0.3, 2.7, 0);
  v.update = (st) => {
    const t = st.t;
    v.pieces.forEach((p, i) => {
      if (p.userData.detached) return;
      p.position.copy(p.userData.home.p);
      p.position.y += Math.sin(t * 31 + i * 2) * 0.03;
      p.quaternion.copy(p.userData.home.q);
      p.rotateX(Math.sin(t * 27 + i) * 0.03);
    });
    d.face.set((st.special || {}).expr || { lid: 0.1, brow: 0.3, smile: 0.5, blink: (t % 3) < 0.1 ? 1 : 0 });
  };
  return v;
}

// ------------------------------------------------------------------ 18. Generic kart
function kart(color) {
  const v = base(color);
  const B = v.body;
  const c = mat(color, { rough: 0.35, metal: 0.3 });
  mk(G.rbox(3.4, 0.35, 1.8, 0.15), c, B, [0, 0.55, 0]);
  mk(G.rbox(1.2, 0.5, 1.4, 0.2), c, B, [1.3, 0.75, 0]);
  mk(G.box(0.6, 0.9, 0.9), mat('#222'), B, [-0.7, 1.1, 0]);
  const d = driver(grp(B, [-0.3, 0.8, 0]), { skin: '#f1c27d', shirt: color, headR: 0.42 });
  mk(G.hemi(0.5, 14), mat('#ffffff', { rough: 0.3 }), d.head, [0, 0.02, 0]);
  mk(G.box(0.4, 0.12, 0.9), c, d.head, [0.1, 0.42, 0]);
  steeringWheel(B, [0.45, 1.6, 0]);
  v.face = d.face;
  v.head = d.head;
  for (const x of [1.25, -1.25]) for (const side of [-1, 1]) v.wheels.push(wheel(v.root, x, 0.42, side * 1.0, 0.42, 0.45, { rim: '#ddd' }));
  v.L = 3.6; v.W = 2.4; v.H = 2.3;
  v.headWorldOffset = new THREE.Vector3(-0.3, 2.4, 0);
  v.update = (st) => d.face.set({ lid: 0.1, brow: -0.2, smile: 0.4, blink: (st.t % 3.2) < 0.1 ? 1 : 0 });
  return v;
}

export const BUILDERS = { scooter, goth, dungeon, femboy, rocket, voxel, robot, survival, gold, buttons, buggy, stilts, ai, tank, monster, cart, junk, kart };

export function buildVehicle(type, color) {
  const fn = BUILDERS[type] || kart;
  const v = fn(color);
  v.type = BUILDERS[type] ? type : 'kart';
  v.root.traverse((o) => {
    if (o.isMesh && o.material && o.material.transparent && o.material.blending === THREE.AdditiveBlending) o.castShadow = false;
  });
  return v;
}

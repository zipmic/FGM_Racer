import * as THREE from 'three';
import { mat, G, mk, grp } from '../core/kit.js';

// Reusable building blocks for the vehicle designs: wheels, cartoon faces, drivers.
// Vehicle local frame: +X forward, +Y up, +Z right.

export function wheel(parent, x, y, z, r, w, opts = {}) {
  const g = grp(parent, [x, y, z]);
  const spin = grp(g);
  const tireM = mat(opts.tire ?? '#1b1b1f', { rough: 0.85 });
  const rimM = opts.rimMat ?? mat(opts.rim ?? '#c9ccd2', { metal: 0.7, rough: 0.3 });
  const tire = mk(opts.square ? G.box(r * 2, r * 2, w) : G.cyl(r, r, w, opts.seg ?? 18), tireM, spin, [0, 0, 0], [opts.square ? 0 : Math.PI / 2, 0, 0]);
  if (!opts.square) {
    mk(G.cyl(r * 0.62, r * 0.62, w * 1.04, 12), rimM, spin, [0, 0, 0], [Math.PI / 2, 0, 0]);
    // spokes make rotation readable
    const spokeM = mat(opts.spoke ?? '#3a3d44', { metal: 0.5, rough: 0.4 });
    mk(G.box(r * 1.15, r * 0.16, w * 1.08), spokeM, spin);
    mk(G.box(r * 0.16, r * 1.15, w * 1.08), spokeM, spin);
    if (opts.glowRim) {
      mk(G.torus(r * 0.75, r * 0.07, 6, 18), opts.glowRim, spin, [0, 0, w * 0.53]);
      mk(G.torus(r * 0.75, r * 0.07, 6, 18), opts.glowRim, spin, [0, 0, -w * 0.53]);
    }
  } else {
    mk(G.box(r * 1.2, r * 1.2, w * 1.06), rimM, spin);
  }
  tire.castShadow = true;
  return { obj: g, spin, r };
}

/**
 * Cartoon face on a head looking along +X.
 * expr: { lid, brow, browY, open, smile, lookX, lookY, wide, blink }
 */
export function face(head, R, opts = {}) {
  const f = grp(head);
  const white = mat('#ffffff', { rough: 0.3 });
  const black = mat('#111111', { rough: 0.3 });
  const browM = mat(opts.browColor ?? '#2b1a0f', { rough: 0.8 });
  const eyes = [], pupils = [], brows = [];
  const eyeR = R * (opts.eyeSize ?? 0.27);
  for (const side of [-1, 1]) {
    const eg = grp(f, [R * 0.84, R * 0.14, side * R * 0.36]);
    const e = mk(G.sphere(eyeR, 14, 10), white, eg, [0, 0, 0], [0, 0, 0], [0.55, 1, 1]);
    e.castShadow = false;
    const p = mk(G.sphere(eyeR * 0.48, 10, 8), black, eg, [eyeR * 0.36, 0, 0]);
    p.castShadow = false;
    if (opts.lashes) {
      for (let i = 0; i < 3; i++) mk(G.box(0.02, eyeR * 0.5, 0.025), black, eg, [eyeR * 0.1, eyeR * 0.95, (i - 1) * eyeR * 0.45 * side], [side * (i - 1) * 0.4, 0, 0]);
    }
    const b = mk(G.box(R * 0.08, R * 0.08, R * 0.38), browM, f, [R * 0.9, R * 0.5, side * R * 0.36]);
    b.castShadow = false;
    eyes.push(eg); pupils.push(p); brows.push(b);
  }
  const mouth = grp(f, [R * 0.9, -R * 0.38, 0]);
  const lipM = mat(opts.lip ?? '#5a1a1a', { rough: 0.5 });
  const smileArc = mk(G.torus(R * 0.24, R * 0.045, 6, 14, Math.PI), lipM, mouth, [0, 0, 0], [0, Math.PI / 2, Math.PI]);
  smileArc.castShadow = false;
  const open = mk(G.sphere(R * 0.22, 12, 8), mat('#3a0b0b'), mouth, [0, 0, 0], [0, 0, 0], [0.4, 0.2, 1]);
  open.castShadow = false;
  const api = {
    group: f,
    set(e = {}) {
      const lid = Math.min(0.92, e.lid ?? 0) + (e.blink ?? 0);
      const wide = e.wide ?? 1;
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1;
        eyes[i].scale.set(wide, Math.max(0.06, (1 - Math.min(1, lid)) * wide), wide);
        pupils[i].position.set(eyeR * 0.36, (e.lookY ?? 0) * eyeR * 0.45, (e.lookX ?? 0) * eyeR * 0.45);
        const ang = (e.brow ?? 0) * side;
        brows[i].rotation.set(ang, 0, 0);
        brows[i].position.y = R * (0.5 + (e.browY ?? 0) * 0.25 + (wide - 1) * 0.2);
      }
      const o = e.open ?? 0;
      open.visible = o > 0.05;
      open.scale.set(0.4, 0.15 + o * 0.85, 0.8 + o * 0.3);
      const sm = e.smile ?? 0.4;
      smileArc.visible = o < 0.5;
      smileArc.scale.set(1, Math.abs(sm) < 0.05 ? 0.1 : Math.sign(sm) * Math.min(1, Math.abs(sm) * 1.6), 1);
      smileArc.rotation.x = e.smirk ?? 0;
    },
  };
  api.set({});
  return api;
}

/**
 * Seated driver bust. Sits at local origin (seat height), faces +X.
 * Returns parts for animation.
 */
export function driver(parent, opts = {}) {
  const g = grp(parent, opts.pos ?? [0, 0, 0]);
  const skin = mat(opts.skin ?? '#f1c27d', { rough: 0.6 });
  const shirt = mat(opts.shirt ?? '#3366ff', { rough: 0.7 });
  const torso = mk(G.capsule(0.42, 0.55, 4, 10), shirt, g, [0, 0.62, 0], [0, 0, -0.1]);
  const headG = grp(g, [0.05, 1.55, 0]);
  const R = opts.headR ?? 0.48;
  mk(G.sphere(R, 18, 14), skin, headG);
  const fc = face(headG, R, opts.face);
  if (opts.hair) mk(G.hemi(R * 1.06, 16), mat(opts.hair, { rough: 0.8 }), headG, [-0.04, 0.04, 0], [0, 0, 0.35]);
  const arms = [];
  for (const side of [-1, 1]) {
    const a = grp(g, [0.05, 1.05, side * 0.42]);
    mk(G.capsule(0.13, 0.55, 3, 8), shirt, a, [0.3, -0.05, 0], [0, 0, -Math.PI / 2 + 0.35]);
    mk(G.sphere(0.15, 8, 6), skin, a, [0.66, -0.2, 0]);
    arms.push(a);
  }
  return { group: g, head: headG, face: fc, torso, arms, R };
}

export function steeringWheel(parent, p, r = 0.38) {
  const g = grp(parent, p, [0, 0, 0]);
  const sw = grp(g, [0, 0, 0], [0, 0, -0.9]);
  mk(G.torus(r, 0.05, 6, 18), mat('#1a1a1a', { rough: 0.6 }), sw, [0, 0, 0], [0, Math.PI / 2, 0]);
  mk(G.box(0.06, r * 1.8, 0.06), mat('#333'), sw, [0, 0, 0]);
  return { group: g, wheel: sw };
}

/** Billboarded text plane (canvas) for holograms / thought bubbles */
export function textSprite(text, { color = '#ffffff', bg = 'rgba(0,0,0,0)', size = 128, font = 'Impact, "Arial Black", sans-serif', w = 512, h = 128 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * 0.12;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(sm);
  return s;
}

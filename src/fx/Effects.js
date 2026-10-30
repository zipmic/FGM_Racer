import * as THREE from 'three';
import { rng, hash, clamp, lerp } from '../core/math.js';
import { radialTexture } from '../core/kit.js';
import { heartGeo } from '../vehicles/designs.js';

/**
 * Effects Manager. Every particle is a pure function of story time τ:
 * emitters spawn on a fixed τ grid with seeded randomness, and each particle's
 * state is computed analytically from its age. Seeking, pausing and replaying
 * therefore always show exactly the same smoke, sparks, confetti and bats.
 */

const KIND = {
  dust: { r: 'soft', g: -1, drag: 1.6, size: [1.6, 5.5], color: ['#c8b89a', '#a89f8e'], alpha: [0.45, 0] },
  smoke: { r: 'soft', g: -3, drag: 1.2, size: [2.5, 12], color: ['#4a4a4f', '#2e2e33'], alpha: [0.75, 0] },
  whiteSmoke: { r: 'soft', g: -2, drag: 1.4, size: [2, 9], color: ['#f2f2f2', '#d8d8d8'], alpha: [0.7, 0] },
  purple: { r: 'soft', g: -2, drag: 1.0, size: [4, 18], color: ['#7b2cbf', '#3c096c', '#9d4edd'], alpha: [0.85, 0] },
  steam: { r: 'soft', g: -6, drag: 1.5, size: [0.8, 4], color: ['#ffffff'], alpha: [0.55, 0] },
  splash: { r: 'soft', g: 30, drag: 0.2, size: [1.2, 3.5], color: ['#e6f6ff', '#9fd8ff'], alpha: [0.9, 0] },
  fire: { r: 'add', g: -4, drag: 1.4, size: [4, 9], color: ['#ffb238', '#ff6a00', '#ff3d00'], alpha: [0.55, 0] },
  fireball: { r: 'soft', g: -5, drag: 1.7, size: [5, 15], color: ['#ff9f1c', '#ff6b00', '#ffd166', '#e85d04', '#d00000'], alpha: [0.95, 0] },
  spark: { r: 'add', g: 22, drag: 0.8, size: [0.35, 0.1], color: ['#fff2a8', '#ffcf40', '#ffffff'], alpha: [1, 0.2] },
  energy: { r: 'add', g: 0, drag: 2.5, size: [1.0, 0.2], color: ['#38e8ff', '#4f7dff', '#bff6ff'], alpha: [1, 0] },
  glitter: { r: 'add', g: 2, drag: 1.2, size: [0.5, 0.1], color: ['#ffffff', '#ffb6e6', '#ff77c8'], alpha: [1, 0] },
  flash: { r: 'add', g: 0, drag: 0, size: [8, 26], color: ['#fff1c2'], alpha: [0.7, 0] },
  chunk: { r: 'chunk', g: 30, drag: 0.3, size: [0.6, 0.6] },
  confetti: { r: 'confetti', g: 4, drag: 1.8, size: [0.35, 0.35], color: ['#ff4d6d', '#ffd23f', '#3a86ff', '#06d6a0', '#ff8c1a', '#bf5af2', '#ffffff'] },
  coin: { r: 'coin', g: 26, drag: 0.4, size: [1, 1] },
  bat: { r: 'bat', g: -1.5, drag: 0.6, size: [1, 1] },
  heart: { r: 'heart', g: -1, drag: 1.2, size: [0.5, 0.8] },
  tire: { r: 'tire', g: 26, drag: 0.25, size: [1, 1], color: ['#141016'] },
};

const pointVS = `
  attribute float psize;
  attribute vec4 pcolor;
  uniform float uScale;
  varying vec4 vColor;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vColor = pcolor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(psize * uScale / max(0.1, -mv.z), 0.0, 900.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const pointFS = `
  uniform sampler2D map;
  varying vec4 vColor;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb * mix(1.0, t.r, 0.0), vColor.a * t.a);
    if (gl_FragColor.a < 0.004) discard;
  }`;

class PointBatch {
  constructor(scene, max, additive, tex) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 }, map: { value: tex } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: pointVS,
      fragmentShader: pointFS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 5;
    scene.add(this.points);
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(p, c, a, s) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.col[i * 4] = c.r; this.col[i * 4 + 1] = c.g; this.col[i * 4 + 2] = c.b; this.col[i * 4 + 3] = a;
    this.size[i] = s;
  }
  end() {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = true;
    g.attributes.pcolor.needsUpdate = true;
    g.attributes.psize.needsUpdate = true;
  }
}

class InstBatch {
  constructor(scene, geo, material, max) {
    this.mesh = new THREE.InstancedMesh(geo, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.max = max;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(m4, c) {
    if (this.n >= this.max) return;
    this.mesh.setMatrixAt(this.n, m4);
    this.mesh.setColorAt(this.n, c);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function batGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.3, 0.25); s.lineTo(0.9, 0.35); s.quadraticCurveTo(1.0, 0.1, 1.2, 0.05);
  s.quadraticCurveTo(1.0, -0.1, 0.9, -0.2); s.quadraticCurveTo(0.6, -0.05, 0.35, -0.25); s.lineTo(0, -0.1);
  s.lineTo(-0.35, -0.25); s.quadraticCurveTo(-0.6, -0.05, -0.9, -0.2); s.quadraticCurveTo(-1.0, -0.1, -1.2, 0.05);
  s.quadraticCurveTo(-1.0, 0.1, -0.9, 0.35); s.lineTo(-0.3, 0.25); s.lineTo(0, 0);
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const soft = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64);
    this.soft = new PointBatch(scene, 9000, false, soft);
    this.add = new PointBatch(scene, 9000, true, soft);
    this.chunk = new InstBatch(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, flatShading: true }), 1500);
    this.confetti = new InstBatch(scene, new THREE.PlaneGeometry(1, 0.6), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, emissive: '#222222' }), 2500);
    this.coin = new InstBatch(scene, new THREE.CylinderGeometry(0.35, 0.35, 0.07, 12), new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.25 }), 400);
    this.bat = new InstBatch(scene, batGeo(), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, color: '#ffffff', roughness: 0.7 }), 400);
    this.heart = new InstBatch(scene, heartGeo(), new THREE.MeshStandardMaterial({ roughness: 0.3, emissive: '#ff2d7a', emissiveIntensity: 0.5 }), 300);
    const tireGeo = new THREE.CylinderGeometry(1.1, 1.1, 0.9, 14);
    tireGeo.rotateX(Math.PI / 2);
    this.tire = new InstBatch(scene, tireGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }), 40);
    this.emitters = [];
    this.originCache = new Map();
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this.colorCache = new Map();

    // ribbon trail (used for the winner's energy trail)
    this.trailMax = 130;
    const tg = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(this.trailMax * 2 * 3);
    this.trailAlpha = new Float32Array(this.trailMax * 2);
    const idx = [];
    for (let i = 0; i < this.trailMax - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    tg.setIndex(idx);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('alpha', new THREE.BufferAttribute(this.trailAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const tm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color('#8ff6ff').multiplyScalar(2.2) } },
      vertexShader: `attribute float alpha; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        void main(){
        #include <logdepthbuf_fragment>
        gl_FragColor = vec4(uColor, vA); }`,
    });
    this.trail = new THREE.Mesh(tg, tm);
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 7;
    this.trail.visible = false;
    scene.add(this.trail);
    // constant-size beacon so the winner stays visible from kilometres away
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: new THREE.Color('#9ff3ff').multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, sizeAttenuation: false, toneMapped: false }));
    this.beacon.renderOrder = 9;
    this.beacon.visible = false;
    scene.add(this.beacon);
  }

  clear() {
    this.emitters = [];
    this.originCache.clear();
  }

  /** Register an emitter. Required: kind, t0. Optional: t1, rate, count, life, origin(ts), vel(r, ts), color ... */
  emit(def) {
    const k = KIND[def.kind];
    const e = {
      id: this.emitters.length + 1,
      t1: def.t0,
      rate: 0,
      count: 1,
      life: 1,
      g: k.g, drag: k.drag, size: k.size, color: k.color, alpha: k.alpha ?? [1, 0],
      ...def,
      r: k.r,
    };
    if (!e.rate) e.t1 = e.t0;
    e.colors = (Array.isArray(e.color) ? e.color : [e.color]).map((c) => this._col(c));
    this.emitters.push(e);
    return e;
  }

  _col(c) {
    let v = this.colorCache.get(c);
    if (!v) this.colorCache.set(c, (v = new THREE.Color(c)));
    return v;
  }

  _origin(e, k, ts) {
    const key = e.id * 1e7 + k;
    let o = this.originCache.get(key);
    if (!o) {
      o = e.origin(ts, k).clone();
      this.originCache.set(key, o);
    }
    return o;
  }

  update(tau, camera, renderer) {
    for (const b of [this.soft, this.add, this.chunk, this.confetti, this.coin, this.bat, this.heart, this.tire]) b.begin();
    const p = this._p, v = this._v;
    for (const e of this.emitters) {
      if (tau < e.t0 || tau > e.t1 + e.life) continue;
      const dt = e.rate ? 1 / e.rate : 1;
      const kFirst = e.rate ? Math.max(0, Math.ceil((tau - e.life - e.t0) / dt)) : 0;
      const kLast = e.rate ? Math.floor((Math.min(tau, e.t1) - e.t0) / dt) : 0;
      for (let k = kFirst; k <= kLast; k++) {
        const ts = e.t0 + k * dt;
        const age = tau - ts;
        if (age < 0 || age > e.life) continue;
        const o = this._origin(e, k, ts);
        const u = age / e.life;
        for (let j = 0; j < e.count; j++) {
          const r = rng(hash(e.id, k, j));
          if (e.vel) e.vel(r, ts, v); else v.set((r() - 0.5) * 4, r() * 4, (r() - 0.5) * 4);
          const d = e.drag;
          const f = d > 0 ? (1 - Math.exp(-d * age)) / d : age;
          p.copy(o).addScaledVector(v, f);
          p.y -= 0.5 * e.g * age * age;
          if (e.floor !== undefined && p.y < e.floor) p.y = e.floor;
          const col = e.colors[Math.floor(r() * e.colors.length)];
          const sz = lerp(e.size[0], e.size[1], u) * (0.7 + r() * 0.6) * (e.scale ?? 1);
          if (e.r === 'soft' || e.r === 'add') {
            const a = lerp(e.alpha[0], e.alpha[1], u) * (e.r === 'soft' ? Math.min(1, age * 8) : 1);
            (e.r === 'soft' ? this.soft : this.add).push(p, col, a, sz);
          } else {
            const spin = (e.spin ?? 8) * (0.5 + r());
            const rx = r() * 6, ry = r() * 6;
            let sx = sz, sy = sz, sz2 = sz;
            const shrink = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
            if (e.r === 'bat') {
              const flap = 0.25 + Math.abs(Math.sin(age * 28 + j)) * 0.9;
              this._e.set(Math.sin(age * 5 + j) * 0.3, Math.atan2(v.x, v.z), 0);
              sx = sz; sy = sz; sz2 = sz * flap;
              this._s.set(sx * flap, sy, sz2 / flap);
            } else if (e.r === 'confetti') {
              this._e.set(rx + age * spin, ry + age * spin * 0.7, age * spin * 0.4);
              this._s.set(sx, sy, sz2);
            } else {
              this._e.set(rx + age * spin * (1 - u * 0.7), ry + age * spin * 0.6 * (1 - u * 0.7), 0);
              this._s.set(sx * (e.stretch ?? 1), sy, sz2);
            }
            this._s.multiplyScalar(shrink);
            this._q.setFromEuler(this._e);
            this._m.compose(p, this._q, this._s);
            const batch = this[e.r];
            batch.push(this._m, col);
          }
        }
      }
    }
    const h = renderer.domElement.height;
    const scale = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.soft.uniforms.uScale.value = scale;
    this.add.uniforms.uScale.value = scale;
    for (const b of [this.soft, this.add, this.chunk, this.confetti, this.coin, this.bat, this.heart, this.tire]) b.end();
  }

  /** points: array of Vector3 newest first. */
  setTrail(points, camera, widthBase = 0.9, alpha = 1) {
    if (!points || points.length < 2 || alpha <= 0) {
      this.trail.visible = false;
      return;
    }
    this.trail.visible = true;
    const n = Math.min(points.length, this.trailMax);
    const side = new THREE.Vector3(), tan = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (let i = 0; i < this.trailMax; i++) {
      const k = Math.min(i, n - 1);
      const pt = points[k];
      const nb = points[Math.min(k + 1, n - 1)], pb = points[Math.max(k - 1, 0)];
      tan.subVectors(pb, nb).normalize();
      toCam.subVectors(camera.position, pt);
      const dist = toCam.length();
      side.crossVectors(tan, toCam.normalize()).normalize();
      const u = k / (n - 1);
      const w = Math.max(widthBase, dist * (dist > 600 ? 0.011 : 0.0045)) * (1 - u * 0.6);
      // lift the ribbon so hills never swallow it when seen from far away
      const lift = w * Math.abs(side.y) + (dist > 600 ? w * 0.4 : 0);
      this.trailPos.set([pt.x + side.x * w, pt.y + side.y * w + lift, pt.z + side.z * w], i * 6);
      this.trailPos.set([pt.x - side.x * w, pt.y - side.y * w + lift, pt.z - side.z * w], i * 6 + 3);
      const a = alpha * Math.pow(1 - u, dist > 600 ? 0.7 : 1.4) * (i < n ? 1 : 0);
      this.trailAlpha[i * 2] = a;
      this.trailAlpha[i * 2 + 1] = a;
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.alpha.needsUpdate = true;
  }

  setBeacon(pos, size) {
    if (!pos || size <= 0) {
      this.beacon.visible = false;
      return;
    }
    this.beacon.visible = true;
    this.beacon.position.copy(pos);
    this.beacon.scale.set(size, size, 1);
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Track, ROAD_HALF, gridSlot, TUNNEL_CENTER } from './Track.js';
import { Terrain, WATER_LEVEL } from './Terrain.js';
import { mat, umat, glow, G, mk, grp, textCanvas, bannerTexture, checkerTexture, radialTexture } from '../core/kit.js';
import { rng, clamp, smooth, lerp } from '../core/math.js';

/**
 * Builds the static race world: terrain, road, stands, crowd, tunnel, bridge,
 * scenery and the far landscape used for the final zoom-out.
 */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.track = new Track();
    this.terrain = new Terrain(this.track);
    this.cheerUniforms = { uTime: { value: 0 }, uCheer: { value: 0.3 } };
    this.flagUniforms = { uTime: { value: 0 } };
    this.propsRoot = new THREE.Group();
    this.propsRoot.name = 'crash-props';
    scene.add(this.propsRoot);

    this.root.add(this.terrain.buildMesh());
    this._water();
    this._road();
    this._kerbsAndBarriers();
    this._startFinish();
    this._grandstands();
    this._pitBuilding();
    this._flags();
    this._jumbotron();
    this._bridge();
    this._tunnel();
    this._parkingLot();
    this._trees();
    this._clouds();
  }

  // ---------------------------------------------------------------- water
  _water() {
    const g = new THREE.PlaneGeometry(90000, 90000, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: '#2f86c8', roughness: 0.15, metalness: 0.2, emissive: '#0b2a48', emissiveIntensity: 0.6 });
    const w = new THREE.Mesh(g, m);
    w.position.y = WATER_LEVEL;
    w.receiveShadow = true;
    this.root.add(w);
  }

  // ---------------------------------------------------------------- road
  _ribbon(s0, s1, latA, latB, yA, yB, step = 2, vScale = 16) {
    const tr = this.track;
    const f = tr.makeFrame();
    const pos = [], uv = [], idx = [];
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      tr.frame(s, f);
      const a = f.pos.clone().addScaledVector(f.right, latA).addScaledVector(f.up, yA);
      const b = f.pos.clone().addScaledVector(f.right, latB).addScaledVector(f.up, yB);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(0, s / vScale, 1, s / vScale);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  _road() {
    const tex = textCanvas(256, 512, (ctx, w, h) => {
      ctx.fillStyle = '#44464c';
      ctx.fillRect(0, 0, w, h);
      const r = rng(4);
      for (let i = 0; i < 5000; i++) {
        const v = 50 + r() * 40;
        ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
        ctx.fillRect(r() * w, r() * h, 2, 2);
      }
      ctx.fillStyle = '#f1f1f1';
      ctx.fillRect(6, 0, 7, h);
      ctx.fillRect(w - 13, 0, 7, h);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(w * 0.3, 0, w * 0.08, h);
      ctx.fillRect(w * 0.62, 0, w * 0.08, h);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 });
    const L = this.track.length;
    const g = this._ribbon(0, L, -ROAD_HALF, ROAD_HALF, 0.05, 0.05, 2, 32);
    const road = new THREE.Mesh(g, m);
    road.receiveShadow = true;
    this.root.add(road);
  }

  _kerbsAndBarriers() {
    const tr = this.track;
    const f = tr.makeFrame();
    const pos = [], col = [];
    const red = new THREE.Color('#e3262b'), white = new THREE.Color('#f4f4f4');
    const push = (p, c) => { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); };
    const step = 4;
    for (let s = 0; s < tr.length; s += step) {
      tr.frame(s, f);
      if (Math.abs(f.curv) < 0.004 || tr.flags[Math.floor(s / tr.step)]) continue;
      const f2 = tr.makeFrame();
      tr.frame(s + step, f2);
      const c = Math.floor(s / step) % 2 ? red : white;
      for (const side of [-1, 1]) {
        const a0 = f.pos.clone().addScaledVector(f.right, side * ROAD_HALF).addScaledVector(f.up, 0.09);
        const a1 = f.pos.clone().addScaledVector(f.right, side * (ROAD_HALF + 2.4)).addScaledVector(f.up, 0.09);
        const b0 = f2.pos.clone().addScaledVector(f2.right, side * ROAD_HALF).addScaledVector(f2.up, 0.09);
        const b1 = f2.pos.clone().addScaledVector(f2.right, side * (ROAD_HALF + 2.4)).addScaledVector(f2.up, 0.09);
        if (side > 0) { push(a0, c); push(a1, c); push(b0, c); push(a1, c); push(b1, c); push(b0, c); }
        else { push(a0, c); push(b0, c); push(a1, c); push(a1, c); push(b0, c); push(b1, c); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const kerb = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    kerb.receiveShadow = true;
    this.root.add(kerb);

    // low barriers (instanced)
    const L = tr.length;
    const spots = [];
    for (let s = 0; s < L; s += 6.5) {
      const fl = tr.flags[Math.floor(s / tr.step)];
      if (fl) continue;
      for (const side of [-1, 1]) {
        if (side > 0 && s > 235 && s < 380) continue; // run-off where the winner leaves the track
        if (side < 0 && s > L - 220 && s < L) continue; // open area where Goth Mommy flies off
        spots.push([s, side]);
      }
    }
    const bg = G.box(6.2, 1.0, 0.7);
    const bm = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    const inst = new THREE.InstancedMesh(bg, bm, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), basis = new THREE.Matrix4();
    const cols = ['#e3262b', '#f4f4f4', '#1f6feb', '#f4f4f4'].map((c) => new THREE.Color(c));
    spots.forEach(([s, side], i) => {
      tr.frame(s, f);
      basis.makeBasis(f.tan, f.up, f.right);
      q.setFromRotationMatrix(basis);
      const p = f.pos.clone().addScaledVector(f.right, side * (ROAD_HALF + 4.2)).addScaledVector(f.up, 0.5);
      m4.compose(p, q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, cols[Math.floor(s / 6.5) % 4]);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.root.add(inst);
  }

  clearProps() {
    for (const c of [...this.propsRoot.children]) this.propsRoot.remove(c);
  }

  placeOnTrack(obj, s, lateral = 0, height = 0, yawOffset = 0) {
    return this._placeOnTrack(obj, s, lateral, height, yawOffset);
  }

  _placeOnTrack(obj, s, lateral = 0, height = 0, yawOffset = 0) {
    const f = this.track.makeFrame();
    this.track.frame(s, f);
    const basis = new THREE.Matrix4().makeBasis(f.tan, f.up, f.right);
    obj.quaternion.setFromRotationMatrix(basis);
    if (yawOffset) obj.rotateY(yawOffset);
    obj.position.copy(f.pos).addScaledVector(f.right, lateral).addScaledVector(f.up, height);
    return obj;
  }

  // ---------------------------------------------------------------- start / finish
  _startFinish() {
    const L = this.track.length;
    const chk = checkerTexture(8);
    chk.wrapS = chk.wrapT = THREE.RepeatWrapping;
    chk.repeat.set(1, 8);
    const line = new THREE.Mesh(G.plane(3.2, ROAD_HALF * 2), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.08, 0);
    line.receiveShadow = true;
    this.root.add(line);

    // grid boxes
    const white = mat('#f4f4f4', { rough: 0.8 });
    for (let k = 0; k < 24; k++) {
      const g = gridSlot(k);
      const box = grp(this.root);
      this._placeOnTrack(box, g.s + L, g.lateral, 0.07);
      mk(G.box(0.4, 0.02, 4.2), white, box, [2.6, 0, 0]);
      mk(G.box(2.8, 0.02, 0.35), white, box, [1.3, 0, -2.0]);
      mk(G.box(2.8, 0.02, 0.35), white, box, [1.3, 0, 2.0]);
    }

    // gantry
    const gantry = grp(this.root, [0, 0, 0]);
    const steel = mat('#2a2d36', { metal: 0.6, rough: 0.35 });
    mk(G.box(1.6, 12, 1.6), steel, gantry, [0, 6, -ROAD_HALF - 3]);
    mk(G.box(1.6, 12, 1.6), steel, gantry, [0, 6, ROAD_HALF + 3]);
    mk(G.box(2.2, 2.4, ROAD_HALF * 2 + 8), steel, gantry, [0, 12.6, 0]);
    const finTex = bannerTexture('FINISH', { stripes: true, fg: '#ffffff', accent: '#ff2d55' });
    const finMat = new THREE.MeshStandardMaterial({ map: finTex, roughness: 0.6, emissive: '#ffffff', emissiveMap: finTex, emissiveIntensity: 0.25 });
    const sign1 = mk(G.plane(ROAD_HALF * 2 + 6, 5.2), finMat, gantry, [-1.15, 16.2, 0], [0, -Math.PI / 2, 0]);
    sign1.castShadow = false;
    const titleTex = bannerTexture('FUTURE GAME MAKERS JAM 2026 #2', { bg: '#120c22', accent: '#a855f7', fg: '#ffe066' });
    const t2 = new THREE.MeshStandardMaterial({ map: titleTex, emissive: '#ffffff', emissiveMap: titleTex, emissiveIntensity: 0.35 });
    mk(G.plane(ROAD_HALF * 2 + 6, 5.2), t2, gantry, [1.15, 16.2, 0], [0, Math.PI / 2, 0]).castShadow = false;
    mk(G.box(0.6, 5.6, ROAD_HALF * 2 + 6.4), steel, gantry, [0, 16.2, 0]);

    // start lights: 3 red + they all go green at GO
    this.startLamps = [];
    const housing = mat('#111', { rough: 0.5 });
    for (let i = 0; i < 3; i++) {
      const z = (i - 1) * 3.2;
      mk(G.box(1.4, 2.6, 2.4), housing, gantry, [-1.3, 9.9, z]);
      const lm = umat('#330000', { emissive: '#000000' });
      for (const x of [-2.0, 2.0]) mk(G.sphere(0.85, 16, 12), lm, gantry, [x, 9.9, z]).castShadow = false;
      mk(G.box(1.4, 2.6, 2.4), housing, gantry, [1.3, 9.9, z]);
      this.startLamps.push(lm);
    }
    this.gantry = gantry;
  }

  // ---------------------------------------------------------------- grandstands + crowd
  _grandstands() {
    const stands = [
      { x0: -340, x1: -40, z: 24 },
      { x0: -20, x1: 205, z: 24 },
    ];
    const concrete = mat('#c9c4bb', { rough: 0.9 });
    const seatCols = ['#2f6fde', '#e8443a', '#ffd23f'];
    const rows = 9;
    const spots = [];
    stands.forEach((st, si) => {
      const len = st.x1 - st.x0;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      for (let r = 0; r < rows; r++) {
        shape.lineTo(r * 3.2, 1 + r * 1.7);
        shape.lineTo((r + 1) * 3.2, 1 + r * 1.7);
      }
      shape.lineTo(rows * 3.2, 0);
      shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
      // shape (u, v) → world: u along +z (away from track), v up, extrude along x
      g.rotateY(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat(seatCols[si % 3], { rough: 0.8 }));
      // after rotateY(-90°): shape x → +z? (x,0,0) → (0,0,x); extrude z → (-z,0,0)
      m.position.set(st.x1, 0, st.z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      // back wall + roof
      mk(G.box(len, 22, 1), concrete, this.root, [(st.x0 + st.x1) / 2, 11, st.z + rows * 3.2 + 0.5]);
      const roofCol = si % 2 ? '#e8443a' : '#7c3aed';
      mk(G.box(len + 4, 0.8, 22), mat(roofCol, { rough: 0.6 }), this.root, [(st.x0 + st.x1) / 2, 23, st.z + rows * 3.2 - 9], [-0.12, 0, 0]);
      for (let x = st.x0 + 6; x < st.x1; x += 30) mk(G.cyl(0.4, 0.4, 22, 8), concrete, this.root, [x, 11, st.z + rows * 3.2 - 1]);
      // front fence banner
      const ban = bannerTexture(si ? 'THEME GRAND PRIX' : 'FUTURE GAME MAKERS JAM', { bg: '#101018', accent: si ? '#22d3ee' : '#f43f5e', fg: '#fff' });
      ban.wrapS = THREE.RepeatWrapping;
      ban.repeat.set(Math.round(len / 40), 1);
      const banM = new THREE.MeshStandardMaterial({ map: ban, emissive: '#ffffff', emissiveMap: ban, emissiveIntensity: 0.2 });
      mk(G.plane(len, 2.2), banM, this.root, [(st.x0 + st.x1) / 2, 1.1, st.z - 0.3], [0, Math.PI, 0]).castShadow = false;
      for (let r = 0; r < rows; r++) {
        for (let x = st.x0 + 1; x < st.x1 - 1; x += 1.45) {
          spots.push([x + (r % 2) * 0.6, 1 + r * 1.7, st.z + r * 3.2 + 1.6]);
        }
      }
    });
    // crowd along the north side / turn 1 hill too
    for (let x = 60; x < 230; x += 1.5) for (let r = 0; r < 3; r++) spots.push([x, 0, -62 - r * 1.6]);

    const r = rng(77);
    const bodyG = G.box(0.9, 1.15, 0.6);
    const headG = G.sphere(0.36, 8, 6);
    const cheerMat = (base) => {
      const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.8 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.cheerUniforms.uTime;
        sh.uniforms.uCheer = this.cheerUniforms.uCheer;
        sh.vertexShader = 'uniform float uTime;\nuniform float uCheer;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 0.731 + instanceMatrix[3].z * 1.913;
            transformed.y += abs(sin(uTime * (5.5 + mod(ph, 3.0)) + ph)) * uCheer;
          #endif`
        );
      };
      return m;
    };
    const bodies = new THREE.InstancedMesh(bodyG, cheerMat('#ffffff'), spots.length);
    const heads = new THREE.InstancedMesh(headG, cheerMat('#ffffff'), spots.length);
    const m4 = new THREE.Matrix4();
    const shirt = new THREE.Color(), skin = new THREE.Color();
    const shirts = ['#ff4d6d', '#ffd23f', '#3a86ff', '#8338ec', '#06d6a0', '#ff8c1a', '#ffffff', '#222222', '#f72585'];
    const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
    spots.forEach((p, i) => {
      m4.makeTranslation(p[0], p[1] + 0.6, p[2]);
      bodies.setMatrixAt(i, m4);
      m4.makeTranslation(p[0], p[1] + 1.55, p[2]);
      heads.setMatrixAt(i, m4);
      shirt.set(shirts[Math.floor(r() * shirts.length)]);
      skin.set(skins[Math.floor(r() * skins.length)]);
      bodies.setColorAt(i, shirt);
      heads.setColorAt(i, skin);
    });
    bodies.castShadow = false;
    heads.castShadow = false;
    bodies.receiveShadow = true;
    this.root.add(bodies, heads);
  }

  _pitBuilding() {
    const g = grp(this.root, [-430, 0, -48]);
    mk(G.box(420, 9, 18), mat('#e9e6df', { rough: 0.85 }), g, [0, 4.5, 0]);
    mk(G.box(424, 1, 22), mat('#1f2937', { rough: 0.5 }), g, [0, 9.4, 0]);
    const doorTex = textCanvas(512, 64, (ctx, w, h) => {
      ctx.fillStyle = '#e9e6df'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = ['#ff8c1a', '#8e3bd6', '#ff77c8', '#5ad1ff', '#ffc21a', '#3f7bff', '#e8443a', '#8ac926'][i];
        ctx.fillRect(i * 64 + 6, 6, 52, 58);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let k = 0; k < 6; k++) ctx.fillRect(i * 64 + 6, 10 + k * 9, 52, 2);
      }
    });
    doorTex.wrapS = THREE.RepeatWrapping;
    doorTex.repeat.set(6, 1);
    mk(G.plane(420, 7), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7 }), g, [0, 3.6, 9.05]).castShadow = false;
    const sign = bannerTexture('PIT LANE  •  FGM JAM 2026 #2  •  PIT LANE', { bg: '#0d1117', accent: '#22d3ee' });
    mk(G.plane(200, 5), new THREE.MeshStandardMaterial({ map: sign, emissive: '#fff', emissiveMap: sign, emissiveIntensity: 0.4 }), g, [0, 12.5, 9.2]).castShadow = false;
    mk(G.box(200, 6, 0.5), mat('#1f2937'), g, [0, 12.5, 8.8]);
    // media tower
    const tw = grp(this.root, [-260, 0, -78]);
    mk(G.box(16, 30, 16), mat('#f2f2f2', { rough: 0.7 }), tw, [0, 15, 0]);
    mk(G.box(20, 6, 20), mat('#22d3ee', { rough: 0.2, metal: 0.3, emissive: '#0e7490', ei: 0.5 }), tw, [0, 33, 0]);
  }

  _flags() {
    const colors = ['#ff8c1a', '#8e3bd6', '#ff77c8', '#c98a2e', '#5ad1ff', '#9c7a52', '#ffc21a', '#e8443a', '#3f7bff', '#ffd84a', '#ff5a1f', '#8ac926', '#7d5bd6', '#2ef2d0', '#d9342b', '#b8c0c8', '#f2a65a'];
    const flagG = new THREE.PlaneGeometry(4.5, 2.8, 12, 2);
    flagG.translate(2.25, 0, 0);
    const pole = mat('#d9d9d9', { metal: 0.6, rough: 0.3 });
    let k = 0;
    const addFlag = (x, z, h) => {
      mk(G.cyl(0.12, 0.12, h, 6), pole, this.root, [x, h / 2, z]);
      const m = new THREE.MeshStandardMaterial({ color: colors[k++ % colors.length], side: THREE.DoubleSide, roughness: 0.7 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.flagUniforms.uTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float w = position.x / 4.5;
           transformed.z += sin(position.x * 1.6 - uTime * 7.0 + ${(k * 1.7).toFixed(2)}) * 0.45 * w;
           transformed.y += sin(position.x * 1.1 - uTime * 5.0) * 0.12 * w;`
        );
      };
      const fl = new THREE.Mesh(flagG, m);
      fl.position.set(x, h - 1.6, z);
      fl.rotation.y = Math.PI * 0.85;
      this.root.add(fl);
    };
    for (let x = -330; x <= 200; x += 22) addFlag(x, 21.5, 9);
    for (let x = -620; x <= -240; x += 26) addFlag(x, -36, 8);
    for (let a = 0; a < 6; a++) addFlag(250 + Math.cos(a * 0.5) * 112, -140 + Math.sin(a * 0.5 - 1.2) * 112, 8);
  }

  _jumbotron() {
    const g = grp(this.root, [110, 0, -98]);
    const steel = mat('#2a2d36', { metal: 0.5, rough: 0.4 });
    mk(G.box(2, 18, 2), steel, g, [-14, 9, 0]);
    mk(G.box(2, 18, 2), steel, g, [14, 9, 0]);
    mk(G.box(38, 20, 2), mat('#0b0b10'), g, [0, 26, 0]);
    this.jumboTex = textCanvas(1024, 512, () => {});
    const sm = new THREE.MeshBasicMaterial({ map: this.jumboTex, toneMapped: false });
    const screen = new THREE.Mesh(G.plane(35, 17), sm);
    screen.position.set(0, 26, 1.05);
    g.add(screen);
    g.rotation.y = -0.18;
    this.jumboKey = '';
  }

  setJumbotron(lines, accent = '#ffcc00') {
    const key = lines.join('|') + accent;
    if (key === this.jumboKey) return;
    this.jumboKey = key;
    const { ctx, canvas } = this.jumboTex.userData;
    const w = canvas.width, h = canvas.height;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1b1036');
    bg.addColorStop(1, '#05030c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, 24);
    ctx.fillRect(0, h - 24, w, 24);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      const big = i === 0;
      ctx.font = `${big ? 150 : 70}px Impact, "Arial Black", sans-serif`;
      ctx.fillStyle = big ? '#ffffff' : accent;
      const y = lines.length === 1 ? h / 2 : big ? h * 0.4 : h * 0.4 + 120 * i;
      ctx.fillText(ln, w / 2, y);
    });
    this.jumboTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- bridge + tunnel
  _bridge() {
    const [s0, s1] = this.track.bridgeRange;
    const a = s0 - 14, b = s1 + 14;
    const concrete = mat('#b9b3a8', { rough: 0.9 });
    const deck = new THREE.Mesh(this._ribbon(a, b, -ROAD_HALF - 1.2, ROAD_HALF + 1.2, -1.8, -1.8), concrete);
    deck.material = mat('#9a948a', { rough: 0.9, double: true });
    this.root.add(deck);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(this._ribbon(a, b, side * (ROAD_HALF + 1.2), side * (ROAD_HALF + 1.2), -1.8, 1.3), mat('#d8d2c6', { rough: 0.8, double: true }));
      wall.castShadow = true;
      this.root.add(wall);
      const rail = new THREE.Mesh(this._ribbon(a, b, side * (ROAD_HALF + 1.2), side * (ROAD_HALF + 1.2), 1.3, 1.6), mat('#e3262b', { double: true }));
      this.root.add(rail);
    }
    const f = this.track.makeFrame();
    for (let s = a + 10; s < b - 5; s += 28) {
      this.track.frame(s, f);
      for (const side of [-1, 1]) {
        const p = f.pos.clone().addScaledVector(f.right, side * 9);
        mk(G.cyl(1.8, 2.2, 34, 10), concrete, this.root, [p.x, p.y - 18.5, p.z]);
      }
    }
    // stone arch under the bridge for a nice silhouette
    this.track.frame((a + b) / 2, f);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(26, 2.4, 8, 24, Math.PI), concrete);
    arch.position.copy(f.pos).add(new THREE.Vector3(0, -27, 0));
    arch.lookAt(arch.position.clone().add(f.right));
    this.root.add(arch);
  }

  _tunnel() {
    const [s0, s1] = this.track.tunnelRange;
    const a = s0 - 6, b = s1 + 6;
    this.tunnelS = [a, b];
    const prof = [];
    const R = ROAD_HALF + 2.5, wallH = 6;
    prof.push([-R, -0.2], [-R, wallH]);
    for (let i = 1; i < 12; i++) {
      const ang = Math.PI - (i / 12) * Math.PI;
      prof.push([Math.cos(ang) * R, wallH + Math.sin(ang) * 8]);
    }
    prof.push([R, wallH], [R, -0.2]);
    const tr = this.track, f = tr.makeFrame();
    const pos = [], idx = [];
    const n = Math.ceil((b - a) / 2);
    for (let i = 0; i <= n; i++) {
      tr.frame(a + ((b - a) * i) / n, f);
      for (const [lx, ly] of prof) {
        const p = f.pos.clone().addScaledVector(f.right, lx).addScaledVector(f.up, ly);
        pos.push(p.x, p.y, p.z);
      }
      if (i < n) {
        const m = prof.length;
        for (let j = 0; j < m - 1; j++) {
          const k = i * m + j;
          idx.push(k, k + m, k + 1, k + 1, k + m, k + m + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tube = new THREE.Mesh(g, mat('#57534e', { rough: 0.9, double: true, flat: true }));
    tube.castShadow = true;
    tube.receiveShadow = true;
    this.root.add(tube);
    // neon strips
    for (const [side, c] of [[-1, '#c026d3'], [1, '#22d3ee']]) {
      const strip = new THREE.Mesh(this._ribbon(a + 2, b - 2, side * (R - 0.15), side * (R - 0.15), 2.6, 3.2), glow(c, 3.5));
      strip.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.5), side: THREE.DoubleSide, toneMapped: false });
      this.root.add(strip);
    }
    const lampG = G.box(3, 0.3, 1.2);
    const lampM = new THREE.MeshBasicMaterial({ color: '#fff3c4', toneMapped: false });
    for (let s = a + 4; s < b - 2; s += 10) {
      tr.frame(s, f);
      const l = new THREE.Mesh(lampG, lampM);
      this._placeOnTrack(l, s, 0, wallH + 7.8);
      this.root.add(l);
    }
    // portals
    const stone = mat('#8b857c', { rough: 1, flat: true });
    const portalShape = new THREE.Shape();
    portalShape.moveTo(-R - 5, -1); portalShape.lineTo(R + 5, -1); portalShape.lineTo(R + 5, wallH + 13); portalShape.lineTo(-R - 5, wallH + 13); portalShape.lineTo(-R - 5, -1);
    const hole = new THREE.Path();
    hole.moveTo(-R + 0.2, -1);
    hole.lineTo(-R + 0.2, wallH);
    hole.absarc(0, wallH, R - 0.2, Math.PI, 0, true);
    hole.lineTo(R - 0.2, -1);
    hole.lineTo(-R + 0.2, -1);
    portalShape.holes.push(hole);
    const pg = new THREE.ExtrudeGeometry(portalShape, { depth: 3, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 1 });
    pg.translate(0, 0, -1.5);
    for (const s of [a + 1, b - 1]) {
      const p = new THREE.Mesh(pg, stone);
      // shape lies in XY, so orient: X = right, Y = up, Z = tangent
      tr.frame(s, f);
      const basis = new THREE.Matrix4().makeBasis(f.right, f.up, f.tan.clone().negate());
      p.quaternion.setFromRotationMatrix(basis);
      p.position.copy(f.pos);
      p.castShadow = true;
      this.root.add(p);
      const lab = bannerTexture('TUNNEL OF DOOM', { bg: '#1a1022', accent: '#c026d3' });
      const sign = new THREE.Mesh(G.plane(22, 3.6), new THREE.MeshStandardMaterial({ map: lab, emissive: '#fff', emissiveMap: lab, emissiveIntensity: 0.5 }));
      sign.quaternion.copy(p.quaternion);
      if (s < (a + b) / 2) sign.rotateY(Math.PI);
      sign.position.copy(f.pos).addScaledVector(f.up, wallH + 10.5).addScaledVector(f.tan, s < (a + b) / 2 ? -2.3 : 2.3);
      this.root.add(sign);
    }
    // rocks covering the tube
    const r = rng(5);
    const rockM = mat('#7d776d', { rough: 1, flat: true });
    const grassRock = mat('#5f8f3a', { rough: 1, flat: true });
    for (let s = a + 6; s < b - 4; s += 9) {
      for (const lat of [-12, 0, 12]) {
        const R2 = 10 + r() * 6;
        const p = this.track.point(s, lat, wallH + 8.6 + R2 + 0.4);
        const m = mk(G.dodeca(R2), r() < 0.6 ? grassRock : rockM, this.root, [p.x, p.y, p.z], [r() * 3, r() * 3, r() * 3], [1, 0.75, 1]);
        m.receiveShadow = true;
      }
      for (const side of [-1, 1]) {
        const R2 = 12 + r() * 8;
        const p = this.track.point(s, side * (R + R2 + 1), R2 * 0.5);
        mk(G.dodeca(R2), rockM, this.root, [p.x, p.y, p.z], [r() * 3, r() * 3, r() * 3]);
      }
    }
  }

  // ---------------------------------------------------------------- parking lot + fences
  _parkingLot() {
    const lot = textCanvas(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#3d3f44';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#e6e6e6';
      ctx.lineWidth = 3;
      for (let x = 0; x < w; x += 14) {
        for (const y0 of [20, 120, 380, 480]) {
          ctx.beginPath(); ctx.moveTo(x, y0 - 20); ctx.lineTo(x, y0 + 20); ctx.stroke();
        }
      }
      ctx.fillStyle = '#ffd23f';
      for (let x = 10; x < w; x += 40) ctx.fillRect(x, h / 2 - 3, 20, 6);
    });
    const plane = new THREE.Mesh(G.plane(230, 160), new THREE.MeshStandardMaterial({ map: lot, roughness: 0.9 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(550, 0.06, 0);
    plane.receiveShadow = true;
    this.root.add(plane);

    // parked cars (instanced)
    const body = new THREE.BoxGeometry(4.2, 1.1, 2.0); body.translate(0, 0.85, 0);
    const cab = new THREE.BoxGeometry(2.3, 0.9, 1.8); cab.translate(-0.2, 1.85, 0);
    const carG = mergeGeometries([body, cab]);
    const spots = [];
    for (const z of [-66, -52, -34, -20, 20, 34, 52, 66]) for (let x = 448; x < 655; x += 5.4) spots.push([x, z]);
    const cars = new THREE.InstancedMesh(carG, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), spots.length);
    const r = rng(9);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const palette = ['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#003049', '#2a9d8f', '#e9c46a', '#264653', '#ffffff', '#222222', '#8d99ae'];
    spots.forEach(([x, z], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 + (r() - 0.5) * 0.12);
      m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, 1, 1));
      cars.setMatrixAt(i, m4);
      cars.setColorAt(i, c.set(palette[Math.floor(r() * palette.length)]));
    });
    cars.castShadow = true;
    cars.receiveShadow = true;
    this.root.add(cars);

    // light poles
    const pole = mat('#9aa0a6', { metal: 0.5, rough: 0.4 });
    for (let x = 460; x < 650; x += 45) for (const z of [-12, 12]) {
      mk(G.cyl(0.25, 0.3, 12, 6), pole, this.root, [x, 6, z]);
      mk(G.box(2.4, 0.4, 0.8), glow('#fff6d5', 1.5), this.root, [x, 12, z]);
    }
    // fence around the lot with a gate on the far side
    const fenceM = mat('#7a5a3a', { rough: 0.9 });
    const posts = [];
    for (let x = 440; x <= 662; x += 6) { posts.push([x, -78]); posts.push([x, 78]); }
    for (let z = -78; z <= 78; z += 6) { if (Math.abs(z) > 15) { posts.push([440, z]); posts.push([662, z]); } }
    const pg = G.box(0.5, 2.4, 0.5);
    const postI = new THREE.InstancedMesh(pg, fenceM, posts.length);
    posts.forEach(([x, z], i) => postI.setMatrixAt(i, m4.makeTranslation(x, 1.2, z)));
    postI.castShadow = true;
    this.root.add(postI);
    for (const z of [-78, 78]) for (const y of [0.8, 1.9]) mk(G.box(222, 0.25, 0.15), fenceM, this.root, [551, y, z]);
    for (const x of [440, 662]) for (const sgn of [-1, 1]) for (const y of [0.8, 1.9]) mk(G.box(0.15, 0.25, 63), fenceM, this.root, [x, y, sgn * 46.5]);
    // exit gate boards (break when the winner passes)
    this.gate = grp(this.root, [662, 0, 0]);
    this.gateBoards = [];
    const boardM = mat('#a0522d', { rough: 0.9 });
    for (let i = 0; i < 10; i++) {
      const z = -13.5 + i * 3;
      const b = mk(G.box(0.4, 3.2, 2.8), boardM, this.gate, [0, 1.6, z]);
      b.userData.home = b.position.clone();
      this.gateBoards.push(b);
    }
    mk(G.box(0.5, 0.5, 30), mat('#d62828'), this.gate, [0, 3.4, 0]).userData.home = new THREE.Vector3(0, 3.4, 0);
    this.gateBoards.push(this.gate.children[this.gate.children.length - 1]);
    const exitTex = bannerTexture('EXIT  →', { bg: '#0b6e4f', accent: '#ffffff' });
    const sign = mk(G.plane(10, 2), new THREE.MeshStandardMaterial({ map: exitTex }), this.root, [662, 6.5, 16], [0, -Math.PI / 2, 0]);
    mk(G.cyl(0.15, 0.15, 6, 6), pole, this.root, [662, 3, 16]);
    sign.castShadow = false;
    this.gateBreakTau = Infinity;
  }

  // ---------------------------------------------------------------- vegetation + sky stuff
  _trees() {
    const r = rng(1234);
    const tr = this.track, te = this.terrain;
    const trunk = new THREE.CylinderGeometry(0.5, 0.7, 3, 6); trunk.translate(0, 1.5, 0);
    const c1 = new THREE.ConeGeometry(3.4, 5.5, 7); c1.translate(0, 5.5, 0);
    const c2 = new THREE.ConeGeometry(2.5, 4.5, 7); c2.translate(0, 8.4, 0);
    const paint = (g, col) => {
      const c = new THREE.Color(col);
      const arr = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    const pine = mergeGeometries([paint(trunk, '#6b4423'), paint(c1, '#2f7d32'), paint(c2, '#3c9a3e')].map((g) => g.toNonIndexed()));
    const t2 = new THREE.CylinderGeometry(0.5, 0.7, 3.5, 6); t2.translate(0, 1.75, 0);
    const blob = new THREE.IcosahedronGeometry(3.6, 0); blob.translate(0, 6, 0);
    const round = mergeGeometries([paint(t2, '#6b4423'), paint(blob, '#5aa02c')].map((g) => g.toNonIndexed()));
    const spotsA = [], spotsB = [];
    const okSpot = (x, z) => {
      const h = te.heightAt(x, z);
      if (h < WATER_LEVEL + 1.5 || h > 300) return null;
      const near = tr.nearest(x, z, 2);
      if (near && near.d2 < 38 * 38) return null;
      if (x > -800 && x < 250 && z > -110 && z < 150) return null; // stands/pit area
      if (x > 200 && x < 720 && z > -95 && z < 95) return null; // parking / run-off
      if (Math.hypot(x - 255, z + 140) < 70) return null; // quarry
      if (Math.hypot(x - TUNNEL_CENTER.x, z - TUNNEL_CENTER.y) < 50) return null;
      if (x > 300) {
        // escape corridor
        const p = te.escapePoly;
        for (let i = 0; i < p.length - 1; i += 1) {
          const [ax, az] = p[i];
          if (Math.abs(ax - x) < 120 && Math.abs(az - z) < 45) return null;
        }
      }
      return h;
    };
    for (let i = 0; i < 9000; i++) {
      const near = i < 5200;
      const ang = r() * Math.PI * 2;
      const rad = near ? 120 + Math.sqrt(r()) * 1300 : 1400 + Math.pow(r(), 0.7) * 9000;
      const x = -250 + Math.cos(ang) * rad, z = -150 + Math.sin(ang) * rad;
      const h = okSpot(x, z);
      if (h === null) continue;
      const s = (near ? 0.8 : 1.6) + r() * (near ? 0.9 : 2.2);
      (r() < 0.6 ? spotsA : spotsB).push([x, h - 0.3, z, s, r() * 6]);
    }
    const mkInst = (geo, spots) => {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
      const inst = new THREE.InstancedMesh(geo, m, spots.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      spots.forEach(([x, y, z, s, rot], i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.9 + (rot % 1) * 0.3), s));
        inst.setMatrixAt(i, m4);
        c.setHSL(0.27 + (rot % 0.6) * 0.08 - 0.02, 0.35, 0.75 + (rot % 0.4) * 0.5);
        inst.setColorAt(i, c);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.root.add(inst);
    };
    mkInst(pine, spotsA);
    mkInst(round, spotsB);

    // rocks
    const rocks = [];
    for (let i = 0; i < 700; i++) {
      const ang = r() * Math.PI * 2, rad = 150 + Math.pow(r(), 0.8) * 6000;
      const x = -250 + Math.cos(ang) * rad, z = -150 + Math.sin(ang) * rad;
      const h = okSpot(x, z);
      if (h === null) continue;
      rocks.push([x, h, z, 1 + r() * (rad > 1500 ? 9 : 3), r() * 6]);
    }
    const rg = new THREE.DodecahedronGeometry(1, 0);
    const ri = new THREE.InstancedMesh(rg, mat('#8f897f', { rough: 1, flat: true }), rocks.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    rocks.forEach(([x, y, z, s, rot], i) => {
      q.setFromEuler(new THREE.Euler(rot, rot * 2, rot * 3));
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * 0.7, s * 1.2));
      ri.setMatrixAt(i, m4);
    });
    ri.castShadow = true;
    ri.frustumCulled = false;
    this.root.add(ri);
  }

  _clouds() {
    const r = rng(42);
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      g.scale(1 + r() * 0.6, 0.6 + r() * 0.3, 1 + r() * 0.5);
      g.translate((i - 2.5) * 0.9, r() * 0.4, (r() - 0.5) * 0.8);
      parts.push(g);
    }
    const cg = mergeGeometries(parts);
    const n = 70;
    const inst = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: '#c9d3df', emissive: '#9fb0c4', emissiveIntensity: 0.12, roughness: 1, flatShading: true }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const x = -250 + (r() - 0.5) * 30000, z = -150 + (r() - 0.5) * 30000;
      const s = 120 + r() * 220;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6);
      m4.compose(new THREE.Vector3(x, 1400 + r() * 1200, z), q, new THREE.Vector3(s, s * 0.6, s * 0.7));
      inst.setMatrixAt(i, m4);
    }
    inst.frustumCulled = false;
    this.root.add(inst);
  }

  // ---------------------------------------------------------------- per-frame (pure in t / τ)
  update(t, tau, info) {
    this.cheerUniforms.uTime.value = t;
    this.cheerUniforms.uCheer.value = info.cheer ?? 0.3;
    this.flagUniforms.uTime.value = t;
    // start lights
    const cd = info.countdown;
    if (cd) {
      this.startLamps.forEach((m, i) => {
        let on = 0, green = false;
        if (t >= cd.go) { on = 1; green = true; }
        else if (t >= cd.lights[i]) on = 1;
        if (t > cd.go + 4) on = 0;
        m.color.set(on ? (green ? '#1aff6a' : '#ff1a1a') : '#2a0505');
        m.emissive.set(on ? (green ? '#1aff6a' : '#ff1a1a') : '#000000');
        m.emissiveIntensity = on ? 3 : 0;
      });
    }
    // exit gate smash
    const age = tau - this.gateBreakTau;
    this.gateBoards.forEach((b, i) => {
      const home = b.userData.home;
      if (!(age > 0)) {
        b.position.copy(home);
        b.rotation.set(0, 0, 0);
        return;
      }
      const a = Math.min(age, 3);
      const side = home.z >= 0 ? 1 : -1;
      const vx = 40 + (i % 3) * 12, vz = side * (8 + (i % 4) * 5), vy = 10 + (i % 5) * 3;
      b.position.set(home.x + vx * a, Math.max(0.3, home.y + vy * a - 15 * a * a), home.z + vz * a);
      b.rotation.set(a * (3 + i), a * 2, a * (4 + i * 0.5));
    });
  }
}

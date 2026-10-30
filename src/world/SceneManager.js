import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const SKY_TOP = new THREE.Color('#3f8fe0');
const SKY_HORIZON = new THREE.Color('#cfe6f7');

/** Speed blur + chromatic aberration + vignette, driven by the camera director. */
const CinemaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlur: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uCA: { value: 0 },
    uVignette: { value: 0.35 },
    uTint: { value: new THREE.Color('#ffffff') },
    uTintAmt: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uBlur; uniform vec2 uCenter; uniform float uCA;
    uniform float uVignette; uniform vec3 uTint; uniform float uTintAmt; uniform float uDesat;
    varying vec2 vUv;
    void main(){
      vec2 dir = vUv - uCenter;
      vec4 col = vec4(0.0);
      float total = 0.0;
      for (int i = 0; i < 12; i++) {
        float k = float(i) / 11.0;
        float w = 1.0 - k * 0.6;
        vec2 uv = uCenter + dir * (1.0 - uBlur * k * 0.16 * smoothstep(0.05, 0.6, length(dir)));
        vec4 c;
        c.r = texture2D(tDiffuse, uv + dir * uCA * 0.012).r;
        c.g = texture2D(tDiffuse, uv).g;
        c.b = texture2D(tDiffuse, uv - dir * uCA * 0.012).b;
        c.a = 1.0;
        col += c * w;
        total += w;
      }
      col /= total;
      float g = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(col.rgb, vec3(g), uDesat);
      col.rgb = mix(col.rgb, col.rgb * uTint, uTintAmt);
      float v = smoothstep(0.85, 0.25, length(dir * vec2(1.0, 0.75)));
      col.rgb *= mix(1.0, v, uVignette);
      gl_FragColor = col;
    }`,
};

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(SKY_HORIZON.clone(), 0.0011);
    this.scene.background = SKY_HORIZON.clone();
    this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 120000);
    this.camera.position.set(0, 50, 100);

    this._sky();
    this._lights();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1920, 1080), 0.5, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.cinema = new ShaderPass(CinemaShader);
    this.composer.addPass(this.cinema);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _sky() {
    const g = new THREE.SphereGeometry(100000, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        top: { value: SKY_TOP },
        horizon: { value: SKY_HORIZON },
        sunDir: { value: new THREE.Vector3(0.62, 0.36, 0.7).normalize() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(horizon, top, pow(smoothstep(-0.02, 0.6, h), 0.7));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(g, m);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight('#cfe8ff', '#5b7f3a', 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d6', 3.0);
    this.sunDir = new THREE.Vector3(0.5, 0.68, 0.54).normalize();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80;
    sc.near = 1; sc.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
    // one reusable flash light for explosions
    this.flash = new THREE.PointLight('#ffb36b', 0, 140, 1.4);
    this.scene.add(this.flash);
  }

  /** Keep the shadow frustum around what the camera is looking at. */
  focusShadows(focus, size = 80) {
    const sc = this.sun.shadow.camera;
    if (sc.right !== size) {
      sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
      sc.updateProjectionMatrix();
    }
    // snap to texel grid to avoid shimmering
    const texel = (size * 2) / 2048;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.sunDir, 400);
    this.sun.target.updateMatrixWorld();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.composer.render();
  }
}

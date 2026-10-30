import * as THREE from 'three';
import './styles.css';
import { SceneManager } from './world/SceneManager.js';
import { World } from './world/World.js';
import { Effects } from './fx/Effects.js';
import { AudioManager } from './audio/AudioManager.js';
import { ConfigManager } from './config.js';
import { buildPlan } from './race/RaceScript.js';
import { RaceDirector } from './race/RaceDirector.js';
import { CameraDirector } from './camera/CameraDirector.js';
import { Leaderboard } from './ui/Leaderboard.js';
import { Overlay } from './ui/Overlay.js';
import { AdminPanel } from './ui/AdminPanel.js';
import { clamp, smooth } from './core/math.js';

/**
 * Timeline Manager / app shell: owns film time, playback state and the
 * render loop, and wires every manager together.
 */
class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.hud = document.getElementById('hud');
    this.loading = document.getElementById('loading');
    this.config = new ConfigManager();
    this.audio = new AudioManager();
    this.mode = 'setup';
    this.t = 0;
    this.playing = false;
    this.last = performance.now();
    this.fpsAcc = [];
    setTimeout(() => this.boot(), 30);
  }

  boot() {
    const t0 = performance.now();
    this.sm = new SceneManager(this.canvas);
    this.world = new World(this.sm.scene);
    this.fx = new Effects(this.sm.scene);
    this.lb = new Leaderboard(this.hud);
    this.ov = new Overlay(this.hud);
    this.admin = new AdminPanel(document.body, this.config, {
      onStart: (t) => this.start(t),
      onFullscreen: () => this.toggleFullscreen(),
      onChange: () => { this.dirty = true; },
    });
    this._controls();
    this.rebuild();
    this.loading.classList.add('done');
    console.info(`[reveal] world built in ${(performance.now() - t0).toFixed(0)} ms`);
    if (location.search.includes('debug')) this._debugHooks();
    requestAnimationFrame((n) => this.loop(n));
  }

  rebuild() {
    if (this.director) this.director.dispose();
    try {
      this.plan = buildPlan(this.config.themes, this.world);
    } catch (e) {
      console.error(e);
      alert(e.message);
      return false;
    }
    this.director = new RaceDirector(this.plan, this.world, this.fx, this.sm.scene);
    this.cam = new CameraDirector(this.plan, this.director, this.world, this.sm);
    this.lb.setPlan(this.plan);
    this.ov.setPlan(this.plan);
    this.admin.setScenes(this.plan.sceneMarks);
    this.dirty = false;
    this._gateTau = undefined;
    // pre-compile every shader now so the first crash of the show never hitches
    try { this.sm.renderer.compile(this.sm.scene, this.sm.camera); } catch (e) { console.warn(e); }
    window.__reveal = this; // handy for debugging in the console
    const p = this.plan;
    console.info('[reveal] plan', {
      duration: p.duration.toFixed(2), V: p.V.toFixed(2), L: p.L.toFixed(0), F0: p.F0.toFixed(2), D: p.D.toFixed(2),
      cross: p.tCross.toFixed(2), special: p.special,
      eliminations: p.eliminations.map((e) => `${p.racers[e.i].name} @ ${e.t.toFixed(2)}`),
    });
    return true;
  }

  start(fromT = 0) {
    if (this.dirty || !this.plan) { if (!this.rebuild()) return; }
    this.audio.init();
    this.audio.resume();
    this.mode = 'play';
    this.admin.hide();
    document.body.classList.add('playing');
    this.seek(fromT);
    this.playing = true;
    this._poke();
  }

  seek(t) {
    this.t = clamp(t, 0, this.plan.duration);
    this.audio.reset(this.t);
    this.lb.snap();
  }

  back() {
    this.mode = 'setup';
    this.playing = false;
    this.audio.pause();
    document.body.classList.remove('playing');
    this.admin.show();
  }

  togglePause() {
    if (this.mode !== 'play') return;
    if (this.t >= this.plan.duration) { this.start(0); return; }
    this.playing = !this.playing;
    if (this.playing) { this.audio.resume(); this.audio.reset(this.t); } else this.audio.pause();
    this._syncButtons();
  }

  sceneStep(dir) {
    const marks = this.plan.sceneMarks.map((m) => m[1]);
    let idx = 0;
    for (let k = 0; k < marks.length; k++) if (this.t >= marks[k] - 0.05) idx = k;
    const next = clamp(idx + dir, 0, marks.length - 1);
    this.seek(dir < 0 && this.t - marks[idx] > 1.5 ? marks[idx] : marks[next]);
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  _controls() {
    const c = document.createElement('div');
    c.className = 'controls';
    c.innerHTML = `
      <button data-c="back" title="Tilbage til opsætning (B)">⚙ Opsætning</button>
      <button data-c="replay" title="Forfra (R)">⏮ Replay</button>
      <button data-c="prev" title="Forrige scene (←)">⏪</button>
      <button data-c="pause" title="Pause / fortsæt (Mellemrum)">⏸ Pause</button>
      <button data-c="next" title="Næste scene (→)">⏩ Skip</button>
      <div class="scrub"><div class="scrub-fill"></div><div class="scrub-marks"></div></div>
      <span class="time">0.0s</span>
      <button data-c="sound" title="Lyd til/fra (M)">🔊 Lyd</button>
      <button data-c="fs" title="Fuld skærm (F)">⛶</button>`;
    document.body.appendChild(c);
    this.ctrl = c;
    this.scrub = c.querySelector('.scrub');
    this.scrubFill = c.querySelector('.scrub-fill');
    this.timeEl = c.querySelector('.time');
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      ({
        back: () => this.back(),
        replay: () => this.start(0),
        prev: () => this.sceneStep(-1),
        next: () => this.sceneStep(1),
        pause: () => this.togglePause(),
        sound: () => { this.audio.setMuted(!this.audio.muted); this._syncButtons(); },
        fs: () => this.toggleFullscreen(),
      })[b.dataset.c]?.();
      this._poke();
    });
    this.scrub.addEventListener('pointerdown', (e) => {
      const r = this.scrub.getBoundingClientRect();
      this.seek(((e.clientX - r.left) / r.width) * this.plan.duration);
    });
    window.addEventListener('keydown', (e) => {
      if (this.mode !== 'play') return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.togglePause(); }
      else if (k === 'arrowright') this.sceneStep(1);
      else if (k === 'arrowleft') this.sceneStep(-1);
      else if (k === 'r') this.start(0);
      else if (k === 'm') { this.audio.setMuted(!this.audio.muted); this._syncButtons(); }
      else if (k === 'f') this.toggleFullscreen();
      else if (k === 'b') this.back();
      else return;
      this._poke();
    });
    window.addEventListener('mousemove', () => this._poke());
  }

  _poke() {
    if (this.mode !== 'play') return;
    document.body.classList.add('show-controls');
    clearTimeout(this._hideT);
    this._hideT = setTimeout(() => document.body.classList.remove('show-controls'), 1800);
    this._syncButtons();
  }

  _syncButtons() {
    if (!this.ctrl) return;
    this.ctrl.querySelector('[data-c="pause"]').textContent = this.playing ? '⏸ Pause' : '▶ Fortsæt';
    this.ctrl.querySelector('[data-c="sound"]').textContent = this.audio.muted ? '🔇 Lyd fra' : '🔊 Lyd';
    const marks = this.ctrl.querySelector('.scrub-marks');
    if (this.plan && marks.dataset.k !== String(this.plan.duration)) {
      marks.dataset.k = String(this.plan.duration);
      marks.innerHTML = this.plan.sceneMarks.map(([n, t]) => `<i style="left:${(t / this.plan.duration) * 100}%" title="${n}"></i>`).join('');
    }
  }

  loop(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.mode === 'play' && this.playing) {
      this.t += dt;
      if (this.t >= this.plan.duration) {
        this.t = this.plan.duration;
        this.playing = false;
        this.audio.pause();
        this._syncButtons();
      }
    }
    requestAnimationFrame((n) => this.loop(n));
    try {
      this.renderFrame(this.mode === 'play' ? this.t : 0, now / 1000);
    } catch (e) {
      // never let one bad frame kill the show; report each distinct error once
      this._errs ??= new Set();
      if (!this._errs.has(e.message)) { this._errs.add(e.message); console.error('[reveal] frame error at t=' + this.t.toFixed(2), e); }
    }
  }

  renderFrame(t, wall) {
    const p = this.plan;
    if (!p) return;
    const tau = p.timeMap.tau(t);
    const cam = this.sm.camera;
    const standings = this.director.evaluate(t, tau, cam);
    let shot = null;
    if (this.mode === 'play') {
      shot = this.cam.update(t, tau);
    } else {
      // attract mode behind the setup panel: slow orbit over the grid
      const a = wall * 0.08;
      cam.position.set(-40 + Math.cos(a) * 70, 22, Math.sin(a) * 70);
      cam.lookAt(-35, 1, 0);
      if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
      this.cam.focus.set(-35, 0, 0);
      this.cam.fog = 0.0011;
      this.cam.blur = 0;
    }
    const remaining = this.lb.update(this.mode === 'play' ? t : -1, standings) ?? p.N;
    const jumbo = p.jumbo(t, remaining);
    this.world.setJumbotron(jumbo[0], jumbo[1]);
    this.world.update(t, tau, { cheer: p.cheer(t), countdown: p.countdown });
    this.world.gateBreakTau = this._gateTau ??= this._findGateTau();
    this.fx.update(tau, cam, this.sm.renderer);
    // winner energy trail + far-away beacon
    const W = p.W;
    const trailFrom = p.special ? p.timeMap.tau(p.T.launch) : p.ending === 'escape' ? p.tauCross : Infinity;
    if (tau > trailFrom) {
      const head = this.director.racingPose(W, tau, {}).pos;
      const far = cam.position.distanceTo(head);
      const span = Math.min(clamp(far / 2200, 1.4, 4.5), tau - trailFrom);
      const pts = this.director.trailPoints(tau, 120, span);
      this.fx.setTrail(pts, cam, 0.5, 1);
      const pulse = 1 + Math.sin(t * 9) * 0.15;
      this.fx.setBeacon(pts[0], far > 150 ? (clamp((far - 150) / 900) * 0.05 + 0.01) * pulse : 0);
    } else {
      this.fx.setTrail(null);
      this.fx.setBeacon(null, 0);
    }
    // scene look
    const fog = this.cam.fog ?? 0.0011;
    this.sm.scene.fog.density = fog;
    this.sm.focusShadows(this.cam.focus, fog < 0.0005 ? 160 : 80);
    const u = this.sm.cinema.uniforms;
    u.uBlur.value = this.cam.blur || 0;
    u.uCA.value = (this.cam.blur || 0) * 0.6;
    const hack = p.special && t > p.T.hack && t < p.T.launch;
    u.uDesat.value = hack ? 0.35 * smooth((t - p.T.hack) / 0.4) : 0;
    u.uTintAmt.value = hack ? 0.25 : 0;
    u.uTint.value.set('#7fd8ff');
    u.uVignette.value = hack ? 0.7 : 0.35;
    this.ov.update(this.mode === 'play' ? t : -10, cam, this.director, (this.cam.blur || 0) > 0.2 ? this.cam.blur : 0, shot);
    // explosion light flash
    const fl = p.allEvents.find((e) => e.type === 'flash' && t >= e.t && t < e.t + 0.6);
    if (fl && p.special && fl.t > p.T.push) {
      this.sm.flash.position.copy(this.director.ctx[p.R]?.boomPos?.() || this.cam.focus);
      this.sm.flash.intensity = 700 * (1 - (t - fl.t) / 0.6);
    } else this.sm.flash.intensity = 0;
    // audio beds
    if (this.mode === 'play') {
      const focusI = shot && shot.racer !== undefined ? shot.racer : W;
      const q = this.director.poseAt(focusI, tau, {});
      const isScooter = p.racers[focusI].type === 'scooter';
      const engOn = t > p.GO - 3 && !(hack) && !(p.ending === 'escape' && t > p.discoverAt + 2);
      const near = shot && (shot.kind === 'follow' || shot.kind === 'baseCam') ? 1 : 0.55;
      this.audio.update(t, p, {
        engineVol: engOn && !isScooter && !q.crashed ? near : engOn ? 0.25 : 0,
        engineSpeed: q.speed || 0,
        whineVol: isScooter && engOn ? 1 : 0,
        whineSpeed: Math.min(400, q.speed || 0),
        crowd: Math.min(1.2, p.cheer(t) + (Math.abs(cam.position.z) < 120 && cam.position.x > -400 && cam.position.x < 260 ? 0.4 : 0)) * (hack ? 0.05 : 1),
        drone: hack ? 1 : 0,
      });
      const f = t / p.duration;
      this.scrubFill.style.width = `${f * 100}%`;
      this.timeEl.textContent = `${t.toFixed(1)}s / ${p.duration.toFixed(0)}s`;
    }
    this.sm.render();
  }

  /** ?debug: window.__shot(t) renders frame t into a still image (works even in a hidden tab). */
  _debugHooks() {
    const still = document.createElement('canvas');
    still.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none';
    this.canvas.after(still);
    const st = document.createElement('style');
    st.textContent = '*{transition:none!important} #loading,.controls{display:none!important}';
    document.head.appendChild(st);
    window.__shot = (t) => {
      if (this.mode !== 'play') { this.audio.setMuted(true); this.start(t); }
      this.seek(t);
      this.playing = false;
      this.renderFrame(t, 0);
      this.renderFrame(t, 0);
      const src = this.sm.renderer.domElement;
      still.width = src.width;
      still.height = src.height;
      still.getContext('2d').drawImage(src, 0, 0);
      const c = this.cam.current;
      return { kind: c?.kind, style: c?.style, racer: c?.racer !== undefined ? this.plan.racers[c.racer].name : null, t0: c?.t0?.toFixed(2), t1: c?.t1?.toFixed(2), errs: [...(this._errs || [])] };
    };
  }

  _findGateTau() {
    // story time when the winner reaches the parking-lot gate (x ≈ 662)
    const p = this.plan;
    if (p.ending !== 'escape') return Infinity;
    const L = p.L;
    let lo = p.tauCross, hi = p.timeMap.tau(p.duration);
    const target = L + 662;
    if (p.progress(p.W, hi) < target) return Infinity;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (p.progress(p.W, mid) < target) lo = mid; else hi = mid;
    }
    return hi;
  }
}

window.addEventListener('DOMContentLoaded', () => new App());

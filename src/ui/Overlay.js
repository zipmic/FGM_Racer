import * as THREE from 'three';
import { clamp, easeOutBack, smooth } from '../core/math.js';

// Overlay: comic labels, name tags, countdown, banners, winner card, end text,
// flashes, letterbox and speed lines. Everything is computed from film time t.

export class Overlay {
  constructor(parent) {
    this.root = document.createElement('div');
    this.root.className = 'ov';
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div class="ov-letter top"></div><div class="ov-letter bottom"></div>
      <canvas class="ov-speed"></canvas>
      <div class="ov-labels"></div>
      <div class="ov-elims"></div>
      <div class="ov-banner"><span></span></div>
      <div class="ov-winner"><div class="w1">WINNER!</div><div class="w2"></div></div>
      <div class="ov-end"></div>
      <div class="ov-flash"></div>
      <div class="ov-fade"></div>`;
    this.labels = this.root.querySelector('.ov-labels');
    this.elimsEl = this.root.querySelector('.ov-elims');
    this.banner = this.root.querySelector('.ov-banner');
    this.bannerText = this.banner.querySelector('span');
    this.winner = this.root.querySelector('.ov-winner');
    this.winnerName = this.winner.querySelector('.w2');
    this.endEl = this.root.querySelector('.ov-end');
    this.flash = this.root.querySelector('.ov-flash');
    this.fade = this.root.querySelector('.ov-fade');
    this.lbTop = this.root.querySelector('.ov-letter.top');
    this.lbBottom = this.root.querySelector('.ov-letter.bottom');
    this.speed = this.root.querySelector('.ov-speed');
    this.sctx = this.speed.getContext('2d');
    this.pool = new Map();
    this._v = new THREE.Vector3();
  }

  setPlan(plan) {
    this.plan = plan;
    this.labels.innerHTML = '';
    this.pool.clear();
    this.labelEvents = plan.allEvents.filter((e) => e.type === 'label');
    this.labelEvents.forEach((e, k) => {
      const d = document.createElement('div');
      d.className = `lbl lbl-${e.style}`;
      d.textContent = e.text;
      if (e.color) d.style.setProperty('--c', e.color);
      d.style.display = 'none';
      this.labels.appendChild(d);
      this.pool.set(k, d);
    });
    // elimination cards: theme name that gets struck out; overlapping ones stack upwards
    this.elimsEl.innerHTML = '';
    this.elims = plan.allEvents.filter((e) => e.type === 'elim').map((e, k, all) => {
      const d = document.createElement('div');
      d.className = 'elim';
      d.style.setProperty('--c', e.color);
      d.innerHTML = '<div class="elim-tag">ELIMINATED</div><div class="elim-name"><span></span><i></i></div>';
      d.querySelector('span').textContent = e.text;
      d.style.display = 'none';
      this.elimsEl.appendChild(d);
      const slot = all.slice(0, k).filter((o) => o.t + o.dur > e.t).length;
      return { e, d, slot, strike: d.querySelector('i'), tag: d.querySelector('.elim-tag') };
    });
    this.banners = plan.allEvents.filter((e) => e.type === 'banner');
    this.flashes = plan.allEvents.filter((e) => e.type === 'flash');
    this.winEv = plan.allEvents.find((e) => e.type === 'winner');
    this.endEv = plan.allEvents.find((e) => e.type === 'endtext');
    this.winnerName.textContent = this.winEv ? this.winEv.text : '';
    this.endEl.textContent = this.endEv ? this.endEv.text : '';
  }

  update(t, camera, director, blur, shot) {
    const p = this.plan;
    if (!p) return;
    const focus = shot ? [shot.racer, shot.racer2, shot.look && shot.look.racer].filter((x) => x !== undefined) : [];
    const W = window.innerWidth, H = window.innerHeight;
    // labels
    this.labelEvents.forEach((e, k) => {
      const d = this.pool.get(k);
      const age = t - e.t;
      if (age < 0 || age > e.dur) { if (d.style.display !== 'none') d.style.display = 'none'; return; }
      let x = 0.5, y = e.y ?? 0.32, ok = true;
      if (e.racer !== undefined && focus.length && !focus.includes(e.racer) && e.style !== 'tag') { d.style.display = 'none'; return; }
      if (e.racer !== undefined && e.style !== 'tag' && e.style !== 'count' && e.style !== 'title') {
        const m = director.models[e.racer];
        const v = this._v;
        if (m.head) m.head.getWorldPosition(v); else m.root.getWorldPosition(v);
        v.y += Math.max(1.6, m.H * 0.35);
        v.project(camera);
        ok = v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15;
        x = clamp(v.x * 0.5 + 0.5, 0.1, 0.9);
        y = clamp(0.5 - v.y * 0.5, 0.1, 0.85);
      }
      if (!ok) { d.style.display = 'none'; return; }
      d.style.display = 'block';
      const pop = easeOutBack(clamp(age / 0.22));
      const out = 1 - smooth((age - (e.dur - 0.25)) / 0.25);
      d.style.opacity = String(out);
      if (e.style === 'tag') {
        d.style.transform = `translateX(${(1 - smooth(age / 0.2)) * -40}px)`;
      } else if (e.style === 'title') {
        d.style.transform = `translate(-50%, 0) scale(${0.9 + 0.1 * pop})`;
      } else {
        d.style.left = `${x * 100}%`;
        d.style.top = `${y * 100}%`;
        d.style.transform = `translate(-50%, -100%) scale(${pop}) rotate(${e.style === 'pop' ? -4 : 0}deg)`;
      }
    });
    // elimination cards
    for (const c of this.elims) {
      const a = t - c.e.t;
      if (a < 0 || a > c.e.dur) { if (c.d.style.display !== 'none') c.d.style.display = 'none'; continue; }
      c.d.style.display = 'block';
      const inK = easeOutBack(clamp(a / 0.3));
      const out = 1 - smooth((a - (c.e.dur - 0.35)) / 0.35);
      c.d.style.opacity = String(Math.min(1, a / 0.12) * out);
      c.d.style.bottom = `${15 + c.slot * 13}vh`;
      c.d.style.transform = `translateX(-50%) scale(${0.6 + 0.4 * inK})`;
      c.strike.style.transform = `scaleX(${smooth((a - 0.45) / 0.4)})`;
      c.tag.style.opacity = String(smooth((a - 0.75) / 0.25));
      c.d.classList.toggle('struck', a > 0.85);
    }
    // banners
    let ban = null;
    for (const b of this.banners) if (t >= b.t && t < b.t + b.dur) ban = b;
    if (ban) {
      const a = t - ban.t;
      this.bannerText.textContent = ban.text;
      this.banner.style.opacity = String(smooth(a / 0.2) * (1 - smooth((a - ban.dur + 0.3) / 0.3)));
      this.banner.style.transform = `translate(-50%, 0) scaleX(${smooth(a / 0.25)})`;
    } else this.banner.style.opacity = '0';
    // winner card
    if (this.winEv && t >= this.winEv.t && t < this.winEv.t + this.winEv.dur) {
      const a = t - this.winEv.t;
      const k = easeOutBack(clamp(a / 0.45));
      const out = 1 - smooth((a - this.winEv.dur + 0.5) / 0.5);
      this.winner.style.opacity = String(Math.min(1, a / 0.15) * out);
      this.winner.style.transform = `translate(-50%, -50%) scale(${0.3 + 0.7 * k + out * 0 - (1 - out) * 0.3})`;
      this.winner.classList.add('on');
    } else {
      this.winner.style.opacity = '0';
      this.winner.classList.remove('on');
    }
    // end text
    if (this.endEv && t >= this.endEv.t) {
      const a = t - this.endEv.t;
      this.endEl.style.opacity = String(smooth(a / 1.4));
      this.endEl.style.letterSpacing = `${0.02 + (1 - smooth(a / 3)) * 0.1}em`;
    } else this.endEl.style.opacity = '0';
    // flash
    let fl = 0;
    for (const f of this.flashes) {
      const a = t - f.t;
      if (a >= 0 && a < f.dur) fl = Math.max(fl, 1 - a / f.dur);
    }
    this.flash.style.opacity = String(fl * 0.6);
    // fade to black (start + end)
    let fade = 1 - smooth(t / 0.6);
    if (p.fade) fade = Math.max(fade, smooth((t - p.fade[0]) / (p.fade[1] - p.fade[0])));
    this.fade.style.opacity = String(fade);
    // letterbox
    const [la, lb2] = p.letterbox;
    const lbk = smooth((t - la) / 0.6) * (1 - smooth((t - lb2) / 0.8));
    this.lbTop.style.transform = `scaleY(${lbk})`;
    this.lbBottom.style.transform = `scaleY(${lbk})`;
    // speed lines
    this._speedLines(t, blur, W, H);
  }

  _speedLines(t, amount, W, H) {
    const c = this.speed;
    if (amount < 0.05) {
      if (this._had) { this.sctx.clearRect(0, 0, c.width, c.height); this._had = false; }
      return;
    }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = this.sctx;
    ctx.clearRect(0, 0, W, H);
    this._had = true;
    const n = Math.floor(30 + amount * 60);
    const frame = Math.floor(t * 30);
    for (let i = 0; i < n; i++) {
      const s = Math.sin((i + 1) * 12.9898 + frame * 78.233) * 43758.5453;
      const r1 = s - Math.floor(s);
      const s2 = Math.sin((i + 7) * 3.1 + frame * 1.7) * 9631.1;
      const r2 = s2 - Math.floor(s2);
      const ang = r1 * Math.PI * 2;
      const rad0 = Math.max(W, H) * (0.32 + r2 * 0.2);
      const rad1 = rad0 + Math.max(W, H) * (0.15 + r2 * 0.35) * amount;
      ctx.strokeStyle = `rgba(255,255,255,${0.08 + amount * 0.22})`;
      ctx.lineWidth = 1 + r2 * 2.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(ang) * rad0, H / 2 + Math.sin(ang) * rad0);
      ctx.lineTo(W / 2 + Math.cos(ang) * rad1, H / 2 + Math.sin(ang) * rad1);
      ctx.stroke();
    }
  }
}

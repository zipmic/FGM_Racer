// Audio Manager: all music and sound effects are synthesised live with the Web Audio API
// (no external files needed). Music is a step sequencer locked to film time.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI → Hz
const CH = {
  Am: [57, 60, 64], F: [53, 57, 60], C: [48, 52, 55], G: [55, 59, 62], Dm: [50, 53, 57], Bb: [46, 50, 53],
  A: [57, 61, 64], Gm: [55, 58, 62], E: [52, 56, 59], Em: [52, 55, 59],
};

const SECTIONS = {
  intro: { bpm: 100, prog: ['Am', 'F', 'Am', 'E'] },
  race: { bpm: 150, prog: ['Am', 'F', 'C', 'G'] },
  final5: { bpm: 156, prog: ['Dm', 'Bb', 'F', 'A'] },
  finale: { bpm: 84, prog: ['Dm', 'Bb', 'Gm', 'A'] },
  hack: { bpm: 60, prog: ['Dm'] },
  overtake: { bpm: 174, prog: ['C', 'G', 'Am', 'F'] },
  victory: { bpm: 112, prog: ['C', 'F', 'G', 'C'] },
  ending: { bpm: 128, prog: ['C', 'Am', 'F', 'G'] },
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.scheduled = new Set();
    this.lastT = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.music = c.createGain();
    this.music.gain.value = 0.42;
    this.music.connect(this.master);
    this.sfx = c.createGain();
    this.sfx.gain.value = 0.8;
    this.sfx.connect(this.master);
    // shared noise
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine bed
    this.eng = c.createGain();
    this.eng.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    this.engLP = lp;
    this.engO1 = c.createOscillator(); this.engO1.type = 'sawtooth';
    this.engO2 = c.createOscillator(); this.engO2.type = 'sawtooth';
    this.engO1.frequency.value = 60; this.engO2.frequency.value = 61.5;
    this.engO1.connect(lp); this.engO2.connect(lp);
    lp.connect(this.eng).connect(this.sfx);
    this.engO1.start(); this.engO2.start();
    // electric whine for the scooter
    this.whine = c.createGain(); this.whine.gain.value = 0;
    this.whineO = c.createOscillator(); this.whineO.type = 'sine'; this.whineO.frequency.value = 500;
    this.whineO.connect(this.whine).connect(this.sfx); this.whineO.start();
    // crowd bed
    this.crowd = c.createGain(); this.crowd.gain.value = 0;
    const cn = c.createBufferSource(); cn.buffer = this.noiseBuf; cn.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.6;
    const lfo = c.createOscillator(); lfo.frequency.value = 3.3;
    const lfoG = c.createGain(); lfoG.gain.value = 0.25;
    const cg = c.createGain(); cg.gain.value = 0.75;
    lfo.connect(lfoG).connect(cg.gain);
    cn.connect(bp).connect(cg).connect(this.crowd).connect(this.sfx);
    cn.start(); lfo.start();
    // low drone for the hack
    this.drone = c.createGain(); this.drone.gain.value = 0;
    const dO = c.createOscillator(); dO.type = 'sine'; dO.frequency.value = 49;
    const dO2 = c.createOscillator(); dO2.type = 'sine'; dO2.frequency.value = 73.5;
    dO.connect(this.drone); dO2.connect(this.drone); this.drone.connect(this.master);
    dO.start(); dO2.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }
  pause() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
  /** call after seeking */
  reset(t) {
    this.scheduled.clear();
    this.lastT = t;
  }

  // ------------------------------------------------------------------ primitives
  _env(g, when, a, peak, dur, rel = 0.05) {
    g.gain.cancelScheduledValues(when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + a);
    g.gain.setValueAtTime(peak, when + Math.max(a, dur - rel));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + rel);
  }
  osc(when, type, f0, f1, dur, vol, bus = this.sfx, opts = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    if (f1 && f1 !== f0) {
      if (opts.linear) o.frequency.linearRampToValueAtTime(f1, when + dur);
      else o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);
    }
    if (opts.detune) o.detune.value = opts.detune;
    const g = c.createGain();
    this._env(g, when, opts.attack ?? 0.005, vol, dur, opts.release ?? 0.06);
    let node = o;
    if (opts.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.lp, when);
      if (opts.lp2) f.frequency.exponentialRampToValueAtTime(opts.lp2, when + dur);
      f.Q.value = opts.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(bus);
    o.start(when);
    o.stop(when + dur + 0.2);
    return o;
  }
  noise(when, dur, vol, type = 'bandpass', f0 = 1000, f1 = null, q = 1, bus = this.sfx, attack = 0.005) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, when);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, when + dur);
    f.Q.value = q;
    const g = c.createGain();
    this._env(g, when, attack, vol, dur, 0.08);
    s.connect(f).connect(g).connect(bus);
    s.start(when, Math.random() * 1.5);
    s.stop(when + dur + 0.2);
  }

  // ------------------------------------------------------------------ sound effects
  play(name, vol = 1, when = null) {
    if (!this.ctx) return;
    const w = when ?? this.ctx.currentTime + 0.01;
    const v = vol;
    const O = (...a) => this.osc(...a);
    const N = (...a) => this.noise(...a);
    switch (name) {
      case 'beepLow': O(w, 'square', 440, 440, 0.32, 0.25 * v, this.sfx, { lp: 3000 }); break;
      case 'beepHigh': O(w, 'square', 880, 880, 0.8, 0.28 * v, this.sfx, { lp: 4000 }); break;
      case 'beep': O(w, 'sine', 1760, 1760, 0.12, 0.3 * v); break;
      case 'hackBeep': O(w, 'square', 1320, 1320, 0.07, 0.12 * v, this.sfx, { lp: 5000 }); O(w + 0.08, 'square', 1760, 1760, 0.07, 0.12 * v, this.sfx, { lp: 5000 }); break;
      case 'keyTap': N(w, 0.025, 0.25 * v, 'highpass', 3500); O(w, 'square', 2200 + Math.random() * 600, null, 0.02, 0.05 * v); break;
      case 'success': [0, 0.08, 0.16].forEach((d, k) => O(w + d, 'square', NOTE(76 + k * 4), null, 0.12, 0.14 * v, this.sfx, { lp: 4000 })); break;
      case 'compute': for (let k = 0; k < 8; k++) O(w + k * 0.06, 'square', 600 + ((k * 337) % 900), null, 0.04, 0.08 * v, this.sfx, { lp: 3000 }); break;
      case 'beepBoop': [0, 0.12, 0.24].forEach((d, k) => O(w + d, 'sine', [700, 400, 900][k], null, 0.1, 0.2 * v)); break;
      case 'robot': for (let k = 0; k < 5; k++) O(w + k * 0.1, 'sawtooth', [220, 330, 180, 440, 260][k], null, 0.08, 0.12 * v, this.sfx, { lp: 1500 }); break;
      case 'meep': O(w, 'square', 1100, 1050, 0.09, 0.18 * v, this.sfx, { lp: 3500 }); O(w + 0.13, 'square', 1100, 1050, 0.09, 0.18 * v, this.sfx, { lp: 3500 }); break;
      case 'meepFar': O(w, 'square', 1100, 1050, 0.07, 0.05 * v, this.sfx, { lp: 2000 }); O(w + 0.11, 'square', 1100, 1050, 0.07, 0.05 * v, this.sfx, { lp: 2000 }); break;
      case 'horn': O(w, 'sawtooth', 392, 392, 0.35, 0.18 * v, this.sfx, { lp: 1600 }); O(w, 'sawtooth', 494, 494, 0.35, 0.14 * v, this.sfx, { lp: 1600 }); break;
      case 'sadHorn': O(w, 'sawtooth', 330, 300, 0.5, 0.15 * v, this.sfx, { lp: 1200 }); break;
      case 'revBig': O(w, 'sawtooth', 55, 140, 0.6, 0.35 * v, this.sfx, { lp: 900, linear: true }); O(w + 0.6, 'sawtooth', 140, 70, 0.6, 0.3 * v, this.sfx, { lp: 700 }); N(w, 1.2, 0.15 * v, 'lowpass', 400); break;
      case 'gmBoost': O(w, 'sawtooth', 70, 190, 1.4, 0.35 * v, this.sfx, { lp: 1200, linear: true }); N(w, 1.4, 0.25 * v, 'bandpass', 300, 900, 0.8); break;
      case 'roarSmall': O(w, 'sawtooth', 120, 70, 0.6, 0.25 * v, this.sfx, { lp: 700 }); N(w, 0.6, 0.15 * v, 'bandpass', 500, 300, 2); break;
      case 'roar': O(w, 'sawtooth', 140, 60, 1.3, 0.4 * v, this.sfx, { lp: 900 }); O(w, 'square', 95, 50, 1.3, 0.2 * v, this.sfx, { lp: 600 }); N(w, 1.3, 0.3 * v, 'bandpass', 700, 250, 1.5); break;
      case 'grumble': O(w, 'sawtooth', 90, 70, 0.6, 0.2 * v, this.sfx, { lp: 500 }); break;
      case 'rocketIdle': N(w, 0.6, 0.25 * v, 'lowpass', 800, 1500); break;
      case 'rocket': N(w, 2.6, 0.6 * v, 'lowpass', 300, 2500, 0.7); O(w, 'sawtooth', 50, 400, 2.5, 0.2 * v, this.sfx, { lp: 900 }); break;
      case 'chomp': O(w, 'square', 180, 80, 0.1, 0.3 * v, this.sfx, { lp: 900 }); N(w, 0.08, 0.3 * v, 'bandpass', 1500); break;
      case 'clank': O(w, 'square', 820, 600, 0.12, 0.18 * v, this.sfx, { lp: 5000 }); O(w, 'triangle', 1640, 1200, 0.25, 0.12 * v); break;
      case 'clank2': O(w, 'square', 520, 400, 0.12, 0.18 * v, this.sfx, { lp: 4000 }); N(w, 0.08, 0.2 * v, 'highpass', 2000); break;
      case 'clang': O(w, 'triangle', 900, 880, 0.5, 0.3 * v); O(w, 'triangle', 1350, 1300, 0.4, 0.15 * v); break;
      case 'boing': O(w, 'sine', 220, 520, 0.18, 0.35 * v, this.sfx, { linear: true }); O(w + 0.18, 'sine', 520, 180, 0.25, 0.25 * v); break;
      case 'boingBig': O(w, 'sine', 120, 600, 0.3, 0.45 * v); O(w + 0.3, 'sine', 600, 150, 0.3, 0.3 * v); break;
      case 'hop': O(w, 'sine', 300, 700, 0.08, 0.2 * v); break;
      case 'scrape': N(w, 1.2, 0.3 * v, 'bandpass', 2500, 1500, 3); break;
      case 'skid': N(w, 0.9, 0.35 * v, 'bandpass', 2200, 1600, 6); O(w, 'sawtooth', 900, 700, 0.9, 0.06 * v, this.sfx, { lp: 2000 }); break;
      case 'brake': N(w, 0.5, 0.4 * v, 'bandpass', 3000, 2000, 8); break;
      case 'crash': N(w, 0.7, 0.7 * v, 'lowpass', 3000, 300); O(w, 'sine', 120, 40, 0.4, 0.6 * v); N(w + 0.05, 0.4, 0.25 * v, 'highpass', 5000); break;
      case 'impact': N(w, 0.5, 0.8 * v, 'lowpass', 2500, 200); O(w, 'sine', 90, 35, 0.5, 0.7 * v); break;
      case 'smack': O(w, 'sine', 160, 50, 0.25, 0.7 * v); N(w, 0.2, 0.6 * v, 'lowpass', 2000); break;
      case 'punch': O(w, 'sine', 140, 60, 0.12, 0.6 * v); N(w, 0.08, 0.4 * v, 'lowpass', 1800); break;
      case 'stomp': O(w, 'sine', 80, 30, 0.35, 0.8 * v); N(w, 0.2, 0.3 * v, 'lowpass', 600); break;
      case 'thud': O(w, 'sine', 100, 40, 0.3, 0.6 * v); break;
      case 'cannon': O(w, 'sine', 90, 25, 0.8, 0.9 * v); N(w, 1.0, 0.8 * v, 'lowpass', 4000, 200); break;
      case 'explosion':
        O(w, 'sine', 70, 18, 2.2, 1.0 * v);
        N(w, 2.6, 0.9 * v, 'lowpass', 5000, 120, 0.7);
        N(w + 0.05, 1.2, 0.35 * v, 'highpass', 3000);
        O(w + 0.02, 'sawtooth', 120, 30, 1.5, 0.25 * v, this.sfx, { lp: 400 });
        break;
      case 'bats': for (let k = 0; k < 14; k++) O(w + k * 0.05, 'sine', 3000 + Math.random() * 2000, 2500, 0.04, 0.05 * v); break;
      case 'whistleDown': O(w, 'sine', 1800, 300, 1.0, 0.18 * v); break;
      case 'whoosh': N(w, 0.6, 0.45 * v, 'bandpass', 400, 3000, 1.5, this.sfx, 0.2); break;
      case 'finishWhoosh': N(w, 0.8, 0.6 * v, 'bandpass', 3000, 300, 1.5, this.sfx, 0.05); break;
      case 'tweet': for (let k = 0; k < 6; k++) O(w + k * 0.15, 'sine', 2600, 3400, 0.08, 0.1 * v); break;
      case 'uhoh': O(w, 'triangle', 520, 520, 0.18, 0.25 * v); O(w + 0.24, 'triangle', 390, 390, 0.3, 0.25 * v); break;
      case 'splash': N(w, 1.1, 0.6 * v, 'lowpass', 3000, 400, 0.8); O(w, 'sine', 300, 80, 0.3, 0.3 * v); break;
      case 'coin': O(w, 'square', 988, null, 0.07, 0.1 * v, this.sfx, { lp: 6000 }); O(w + 0.07, 'square', 1319, null, 0.2, 0.1 * v, this.sfx, { lp: 6000 }); break;
      case 'coins': for (let k = 0; k < 10; k++) O(w + k * 0.06, 'triangle', 1800 + ((k * 431) % 1200), null, 0.08, 0.1 * v); break;
      case 'sadTrombone': [0, 0.35, 0.7].forEach((d, k) => O(w + d, 'sawtooth', NOTE(58 - k), null, 0.32, 0.18 * v, this.sfx, { lp: 1200 })); O(w + 1.05, 'sawtooth', NOTE(55), NOTE(53), 0.9, 0.18 * v, this.sfx, { lp: 1200 }); break;
      case 'gameOver': [76, 72, 67, 64, 60, 55].forEach((n, k) => O(w + k * 0.13, 'square', NOTE(n), null, 0.12, 0.13 * v, this.sfx, { lp: 5000 })); break;
      case 'wiper': O(w, 'sawtooth', 200, 260, 0.2, 0.08 * v, this.sfx, { lp: 900 }); O(w + 0.25, 'sawtooth', 260, 200, 0.2, 0.08 * v, this.sfx, { lp: 900 }); break;
      case 'click': O(w, 'square', 2000, null, 0.02, 0.2 * v); break;
      case 'eject': N(w, 0.4, 0.6 * v, 'lowpass', 2000, 300); O(w, 'sine', 200, 900, 0.4, 0.3 * v); break;
      case 'wee': O(w, 'sine', 500, 1400, 0.9, 0.18 * v, this.sfx, { attack: 0.05 }); break;
      case 'pop': O(w, 'sine', 600, 200, 0.06, 0.4 * v); break;
      case 'confettiPop': for (let k = 0; k < 2; k++) { O(w + k * 0.08, 'sine', 500, 120, 0.1, 0.5 * v); N(w + k * 0.08, 0.3, 0.3 * v, 'highpass', 3000); } break;
      case 'drill': O(w, 'sawtooth', 900, 1100, 0.5, 0.08 * v, this.sfx, { lp: 3000 }); break;
      case 'knock': O(w, 'sine', 300, 150, 0.08, 0.35 * v); N(w, 0.05, 0.2 * v, 'bandpass', 900); break;
      case 'woodSmash': N(w, 0.6, 0.7 * v, 'bandpass', 900, 300, 1); for (let k = 0; k < 5; k++) O(w + k * 0.04, 'triangle', 300 + k * 90, 150, 0.08, 0.15 * v); break;
      case 'ding': O(w, 'sine', 2093, null, 1.0, 0.25 * v); O(w, 'sine', 4186, null, 0.6, 0.08 * v); break;
      case 'creak': O(w, 'sawtooth', 160, 120, 0.6, 0.1 * v, this.sfx, { lp: 900, q: 8 }); break;
      case 'whoa': O(w, 'triangle', 400, 250, 0.5, 0.2 * v, this.sfx, { lp: 2000 }); break;
      case 'sparkle': for (let k = 0; k < 8; k++) O(w + k * 0.04, 'sine', NOTE(84 + ((k * 5) % 12)), null, 0.12, 0.08 * v); break;
      case 'poof': N(w, 0.5, 0.5 * v, 'lowpass', 1500, 200); O(w, 'sine', 400, 100, 0.2, 0.2 * v); break;
      case 'charge': O(w, 'sawtooth', 100, 800, 0.9, 0.15 * v, this.sfx, { lp: 2000 }); break;
      case 'heartbeat': for (let k = 0; k < 5; k++) { O(w + k * 1.2, 'sine', 60, 40, 0.15, 0.6 * v); O(w + k * 1.2 + 0.22, 'sine', 55, 38, 0.15, 0.45 * v); } break;
      case 'electric': for (let k = 0; k < 14; k++) N(w + k * 0.07, 0.04, 0.25 * v, 'highpass', 4000 + Math.random() * 3000); O(w, 'sawtooth', 60, 60, 1.1, 0.1 * v, this.sfx, { lp: 3000 }); break;
      case 'powerUp': O(w, 'sawtooth', 80, 2400, 1.15, 0.22 * v, this.sfx, { lp: 4000 }); O(w, 'sine', 160, 3200, 1.15, 0.15 * v); break;
      case 'launch': O(w, 'sawtooth', 60, 600, 0.6, 0.5 * v, this.sfx, { lp: 2500 }); N(w, 1.0, 0.7 * v, 'bandpass', 300, 4000, 1.2); break;
      case 'sonicBoom': O(w, 'sine', 60, 20, 1.2, 1.0 * v); N(w, 0.8, 0.8 * v, 'lowpass', 6000, 150); break;
      case 'gasp': N(w, 0.35, 0.3 * v, 'bandpass', 1400, 2200, 4, this.sfx, 0.08); break;
      case 'slide': O(w, 'sine', 900, 300, 0.6, 0.15 * v); break;
      case 'recordScratch': N(w, 0.25, 0.5 * v, 'bandpass', 1200, 4000, 3); N(w + 0.25, 0.2, 0.4 * v, 'bandpass', 3500, 900, 3); break;
      case 'fanfare': {
        const seq = [[60, 0, 0.18], [64, 0.18, 0.18], [67, 0.36, 0.18], [72, 0.54, 0.7], [67, 1.3, 0.2], [72, 1.5, 1.0]];
        for (const [n, d, l] of seq) {
          O(w + d, 'sawtooth', NOTE(n), null, l, 0.16 * v, this.sfx, { lp: 2600, attack: 0.02 });
          O(w + d, 'sawtooth', NOTE(n - 12), null, l, 0.1 * v, this.sfx, { lp: 1600, attack: 0.02 });
        }
        break;
      }
      case 'cheer': N(w, 3.5, 0.35 * v, 'bandpass', 900, 1300, 0.5, this.sfx, 0.3); N(w, 3.0, 0.2 * v, 'bandpass', 2400, 2000, 0.8, this.sfx, 0.2); break;
      default: O(w, 'sine', 600, 300, 0.1, 0.2 * v);
    }
  }

  // ------------------------------------------------------------------ music
  _section(plan, t) {
    let cur = null;
    for (const [st, name] of plan.music) if (t >= st) cur = [st, name];
    return cur;
  }

  _step(name, k, when, vol) {
    const sec = SECTIONS[name];
    const stepDur = 60 / sec.bpm / 4;
    const bar = Math.floor(k / 16);
    const s = k % 16;
    const chord = CH[sec.prog[bar % sec.prog.length]];
    const M = this.music;
    const O = (type, f, dur, v, opts) => this.osc(when, type, f, null, dur, v * vol, M, opts);
    const kick = (v = 0.8) => { this.osc(when, 'sine', 150, 42, 0.16, v * vol, M); };
    const snare = (v = 0.4) => { this.noise(when, 0.14, v * vol, 'bandpass', 1900, null, 0.7, M); this.osc(when, 'triangle', 190, 150, 0.08, v * 0.4 * vol, M); };
    const hat = (v = 0.12) => this.noise(when, 0.03, v * vol, 'highpass', 7500, null, 1, M);
    switch (name) {
      case 'intro': {
        if (s % 4 === 0) this.osc(when, 'sine', 110, 55, 0.3, (0.25 + bar * 0.08) * vol, M);
        if (s === 0) for (const n of chord) O('sawtooth', NOTE(n - 12), stepDur * 16, 0.05, { lp: 900, attack: 0.4, release: 0.3 });
        if (bar >= 2 && s % 2 === 1) this.noise(when, 0.05, 0.08 * vol * (s / 16), 'bandpass', 300, null, 1, M);
        break;
      }
      case 'race':
      case 'final5': {
        const hard = name === 'final5';
        if (s % 4 === 0) kick(0.85);
        if (s === 4 || s === 12) snare(0.38);
        if (s % 2 === 0) hat(hard ? 0.14 : 0.1);
        if (hard && s % 2 === 1) hat(0.05);
        const bassN = chord[0] - 24 + (s % 4 === 2 ? 12 : 0);
        if (s % 2 === 0) O('sawtooth', NOTE(bassN), stepDur * 1.8, 0.2, { lp: 650, lp2: 260 });
        const arp = chord[(s + Math.floor(s / 4)) % 3] + (s >= 8 ? 12 : 0);
        O('square', NOTE(arp), stepDur * 0.8, hard ? 0.06 : 0.045, { lp: 2600 });
        if (hard && s === 0) for (const n of chord) O('sawtooth', NOTE(n), stepDur * 7, 0.035, { lp: 1800, attack: 0.05 });
        break;
      }
      case 'finale': {
        if (s === 0 || s === 10) kick(1.0);
        if (s === 8) { snare(0.55); this.noise(when, 0.6, 0.12 * vol, 'lowpass', 3000, 400, 0.5, M); }
        if (s === 0) {
          for (const n of chord) {
            O('sawtooth', NOTE(n - 12), stepDur * 15, 0.06, { lp: 700, attack: 0.25, release: 0.4 });
            O('sawtooth', NOTE(n), stepDur * 15, 0.03, { lp: 1200, attack: 0.5, release: 0.4, detune: 8 });
          }
          O('sawtooth', NOTE(chord[0] - 24), stepDur * 15, 0.22, { lp: 300, attack: 0.05 });
        }
        if (s % 4 === 2) O('square', NOTE(chord[2] + 12), stepDur * 1.5, 0.03, { lp: 1800 });
        if (s === 14) this.osc(when, 'sine', 95, 50, 0.4, 0.4 * vol, M);
        break;
      }
      case 'hack':
        break;
      case 'overtake': {
        if (k === 0) { this.noise(when, 2.2, 0.35 * vol, 'highpass', 4000, null, 0.5, M); this.osc(when, 'sine', 80, 30, 1.2, 0.9 * vol, M); }
        if (s % 4 === 0) kick(1.0);
        if (s === 4 || s === 12) snare(0.45);
        hat(0.12);
        O('sawtooth', NOTE(chord[0] - 24 + (s % 2 ? 12 : 0)), stepDur * 0.9, 0.22, { lp: 900 });
        O('square', NOTE(chord[s % 3] + 12 + (s % 8 >= 4 ? 12 : 0)), stepDur * 0.7, 0.06, { lp: 3500 });
        if (s === 0) for (const n of chord) O('sawtooth', NOTE(n), stepDur * 14, 0.05, { lp: 2400, attack: 0.02 });
        break;
      }
      case 'victory': {
        if (s === 0) {
          for (const n of chord) {
            O('sawtooth', NOTE(n), stepDur * 15, 0.08, { lp: 2400, attack: 0.03 });
            O('sawtooth', NOTE(n - 12), stepDur * 15, 0.06, { lp: 1400, attack: 0.03 });
          }
          this.osc(when, 'sine', 98, 49, 0.5, 0.7 * vol, M);
        }
        if (s % 4 === 0) this.osc(when, 'sine', 140, 60, 0.2, 0.35 * vol, M);
        if (s % 2 === 0) hat(0.1);
        break;
      }
      case 'ending': {
        const mel = [72, 76, 79, 76, 74, 72, 74, 76, 72, 69, 72, 76, 77, 76, 74, 71];
        if (s % 2 === 0) O('triangle', NOTE(mel[(s / 2 + bar * 8) % mel.length]), stepDur * 1.2, 0.16, { release: 0.05 });
        if (s % 4 === 0) O('triangle', NOTE(chord[0] - 12), stepDur * 1.5, 0.2, { release: 0.05 });
        if (s % 4 === 2) O('triangle', NOTE(chord[2] - 12), stepDur * 1.2, 0.12, { release: 0.05 });
        if (s % 2 === 1) hat(0.06);
        if (s === 4 || s === 12) this.noise(when, 0.05, 0.12 * vol, 'bandpass', 2500, null, 2, M);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ per frame
  update(t, plan, info) {
    if (!this.ctx || this.ctx.state !== 'running') { this.lastT = t; return; }
    const now = this.ctx.currentTime;
    // sound effects crossing (lastT, t]
    if (t > this.lastT && t - this.lastT < 0.5) {
      for (const e of plan.allEvents) {
        if (e.type !== 'sfx') continue;
        if (e.t > this.lastT && e.t <= t) this.play(e.name, e.vol);
        if (e.t > t) break;
      }
    }
    this.lastT = t;
    // music: schedule steps inside the lookahead window
    const look = 0.25;
    const fade = t > plan.musicEnd - 3 ? Math.max(0, (plan.musicEnd - t) / 3) : 1;
    for (let k = 0; k < plan.music.length; k++) {
      const [st, name] = plan.music[k];
      const next = plan.music[k + 1] ? plan.music[k + 1][0] : plan.duration;
      if (next <= t || st > t + look) continue;
      const stepDur = 60 / SECTIONS[name].bpm / 4;
      const k0 = Math.max(0, Math.ceil((t - st) / stepDur - 1e-6));
      const k1 = Math.floor((Math.min(next, t + look) - st) / stepDur - 1e-6);
      for (let j = k0; j <= k1; j++) {
        const key = `${k}:${j}`;
        if (this.scheduled.has(key)) continue;
        this.scheduled.add(key);
        const when = now + (st + j * stepDur - t);
        if (when < now - 0.01) continue;
        this._step(name, j, Math.max(now, when), fade);
      }
    }
    if (this.scheduled.size > 4000) this.scheduled.clear();
    // continuous beds
    const tc = 0.08;
    this.eng.gain.setTargetAtTime(info.engineVol * 0.12, now, tc);
    const f = 40 + info.engineSpeed * 0.9;
    this.engO1.frequency.setTargetAtTime(f, now, tc);
    this.engO2.frequency.setTargetAtTime(f * 1.012 + 1.5, now, tc);
    this.engLP.frequency.setTargetAtTime(400 + info.engineSpeed * 8, now, tc);
    this.whine.gain.setTargetAtTime(info.whineVol * 0.05, now, tc);
    this.whineO.frequency.setTargetAtTime(300 + info.whineSpeed * 4, now, tc);
    this.crowd.gain.setTargetAtTime(info.crowd * 0.22, now, 0.2);
    this.drone.gain.setTargetAtTime(info.drone * 0.12, now, 0.3);
  }
}

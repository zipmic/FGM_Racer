// Leaderboard Manager: motorsport-style standings that follow the race positions.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Leaderboard {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'lb';
    this.el.innerHTML = `
      <div class="lb-head"><span class="lb-flag"></span><span class="lb-title">THEME GRAND PRIX</span><span class="lb-lap">LIVE</span></div>
      <div class="lb-list"></div>
      <div class="lb-foot">RACERS REMAINING: <b class="lb-count">17/17</b></div>`;
    parent.appendChild(this.el);
    this.list = this.el.querySelector('.lb-list');
    this.count = this.el.querySelector('.lb-count');
    this.lap = this.el.querySelector('.lb-lap');
    this.rows = [];
    this.key = '';
  }

  setPlan(plan) {
    this.plan = plan;
    this.list.innerHTML = '';
    this.rows = plan.racers.map((r) => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.innerHTML = `<span class="lb-pos"></span><span class="lb-chip" style="background:${r.color}"></span><span class="lb-name">${esc(r.name)}</span><span class="lb-tag"></span>`;
      this.list.appendChild(row);
      return { el: row, pos: row.querySelector('.lb-pos'), tag: row.querySelector('.lb-tag'), shown: false, y: -1 };
    });
    this.key = '';
    this.instant = true;
  }

  /** Seek / replay: snap without transitions on the next update. */
  snap() { this.instant = true; }

  update(t, standings) {
    const p = this.plan;
    if (!p) return;
    const hidden = t < p.GO - 0.2 || p.lbHidden.some(([a, b]) => t >= a && t < b) || t > p.lbGoneAfter;
    const duel = t >= p.lbFinaleFrom;
    const winner = t >= p.winnerAt;
    const entries = [];
    let remaining = 0;
    for (const st of standings) {
      const r = p.racers[st.i];
      const finaleCrash = r.crash && r.crash.finale;
      if (!st.out || finaleCrash) { remaining++; entries.push({ i: st.i, out: false }); continue; }
      if (st.outAge < 1.35) entries.push({ i: st.i, out: true, age: st.outAge });
    }
    if (winner) {
      // final result order: winner first, runner-up second
      entries.sort((a, b) => (a.i === p.W ? -1 : b.i === p.W ? 1 : a.i === p.R ? -1 : b.i === p.R ? 1 : 0));
    }
    const mode = duel ? 'duel' : remaining <= 5 && t >= p.lbFinalFiveFrom - 0.5 ? 'five' : 'full';
    const key = `${hidden}|${mode}|${winner}|${entries.map((e) => `${e.i}${e.out ? 'o' + (e.age > 0.9 ? 'x' : '') : ''}`).join(',')}`;
    if (key === this.key) return remaining;
    this.key = key;
    this.el.classList.toggle('hidden', hidden);
    this.el.classList.toggle('mode-five', mode === 'five');
    this.el.classList.toggle('mode-duel', mode === 'duel');
    this.el.classList.toggle('instant', this.instant);
    this.count.textContent = `${remaining}/${p.N}`;
    this.list.style.setProperty('--n', Math.max(1, entries.length));
    this.lap.textContent = winner ? 'FINISH' : duel ? 'FINAL DUEL' : mode === 'five' ? 'FINAL FIVE' : 'LIVE';
    const shownIdx = new Set();
    let pos = 0;
    entries.forEach((e) => {
      const row = this.rows[e.i];
      shownIdx.add(e.i);
      if (!e.out) pos++;
      row.el.style.setProperty('--y', pos - 1 + (e.out ? 0 : 0));
      row.el.style.setProperty('--idx', entries.indexOf(e));
      row.pos.textContent = e.out ? '' : String(pos);
      row.el.classList.add('shown');
      row.el.classList.toggle('out', e.out);
      row.el.classList.toggle('leaving', e.out && e.age > 0.9);
      const isW = winner && e.i === p.W;
      row.el.classList.toggle('winner', isW);
      row.tag.textContent = e.out ? 'OUT' : isW ? 'WINNER' : winner && e.i === p.R ? '2ND' : '';
    });
    this.rows.forEach((row, i) => {
      if (!shownIdx.has(i)) {
        row.el.classList.remove('shown', 'out', 'leaving', 'winner');
      }
    });
    if (this.instant) {
      requestAnimationFrame(() => this.el.classList.remove('instant'));
      this.instant = false;
    }
    return remaining;
  }
}

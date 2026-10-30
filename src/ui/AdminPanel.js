import { VEHICLE_TYPES } from '../config.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Setup screen: edit themes/votes/colors/vehicles, see the final order, start or jump to a scene. */
export class AdminPanel {
  constructor(parent, config, handlers) {
    this.config = config;
    this.h = handlers;
    this.el = document.createElement('div');
    this.el.className = 'admin';
    parent.appendChild(this.el);
    this.el.addEventListener('input', (e) => this._onInput(e));
    this.el.addEventListener('change', (e) => this._onInput(e));
    this.el.addEventListener('click', (e) => this._onClick(e));
    this.scenes = [];
    this.render();
  }

  show() { this.el.classList.remove('hidden'); this.render(); }
  hide() { this.el.classList.add('hidden'); }
  setScenes(marks) { this.scenes = marks; this.renderScenes(); }

  render() {
    const th = this.config.themes;
    const standings = this.config.standings();
    const winner = standings[0], runner = standings[1];
    const special = winner && runner && winner.vehicle === 'scooter' && runner.vehicle === 'goth';
    const opts = (sel) => VEHICLE_TYPES.map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
    this.el.innerHTML = `
      <div class="admin-card">
        <header>
          <div>
            <h1>Future Game Makers Jam 2026 #2</h1>
            <p class="sub">Theme Grand Prix · afstemningsresultater og afspilning</p>
          </div>
          <div class="admin-actions">
            <button class="btn ghost" data-act="fullscreen">⛶ Fuld skærm</button>
            <button class="btn primary big" data-act="start">▶ Start animation</button>
          </div>
        </header>
        <div class="admin-grid">
          <section class="themes">
            <div class="sec-head"><h2>Temaer (${th.filter((t) => t.enabled).length} deltager)</h2>
              <div><button class="btn small" data-act="add">+ Tilføj tema</button></div></div>
            <div class="theme-table">
              <div class="tr th"><span></span><span>Med</span><span>Tema</span><span>Stemmer</span><span>Farve</span><span>Køretøj</span><span></span></div>
              ${th.map((t, i) => `
                <div class="tr ${t.enabled ? '' : 'off'}" data-id="${t.id}">
                  <span class="mv"><button class="icon" data-act="up" title="Op (vinder uafgjort)">▲</button><button class="icon" data-act="down" title="Ned">▼</button></span>
                  <span><input type="checkbox" data-f="enabled" ${t.enabled ? 'checked' : ''}></span>
                  <span><input type="text" data-f="name" value="${esc(t.name)}"></span>
                  <span><input type="number" min="0" max="999" data-f="votes" value="${t.votes}"></span>
                  <span><input type="color" data-f="color" value="${t.color}"></span>
                  <span><select data-f="vehicle">${opts(t.vehicle)}</select></span>
                  <span><button class="icon del" data-act="del" title="Fjern">✕</button></span>
                </div>`).join('')}
            </div>
            <div class="row-actions">
              <button class="btn small" data-act="export">⬇ Eksportér JSON</button>
              <label class="btn small">⬆ Importér JSON<input type="file" accept="application/json,.json" data-act="import" hidden></label>
              <button class="btn small ghost" data-act="reset">↺ Standarddata</button>
            </div>
            <p class="hint">Ved lige mange stemmer deler temaerne placering. Rækkefølgen i listen bestemmer, hvem der udgår først i løbet (lavest først).</p>
          </section>
          <section class="results">
            <h2>Beregnet slutresultat</h2>
            <ol class="final">
              ${standings.map((t) => `<li><b>${t.place}.</b><span class="chip" style="background:${t.color}"></span>${esc(t.name)}<em>${t.votes}</em></li>`).join('')}
            </ol>
            <div class="finale-info ${special ? 'ok' : 'warn'}">
              ${special
                ? '✔ Specialfinale aktiv: løbehjulet hacker sig forbi Goth Mommy, og løbehjulet stopper aldrig.'
                : `Generisk finale: ${esc(winner ? winner.name : '–')} vinder over ${esc(runner ? runner.name : '–')}.${winner && winner.vehicle === 'scooter' ? ' Løbehjulet stopper stadig ikke.' : ''}`}
            </div>
            <h2>Spring til scene (test)</h2>
            <div class="scenes"></div>
            <p class="hint">Tastatur under afspilning: <kbd>Mellemrum</kbd> pause · <kbd>←</kbd>/<kbd>→</kbd> scene · <kbd>R</kbd> forfra · <kbd>M</kbd> lyd · <kbd>F</kbd> fuld skærm · <kbd>B</kbd> tilbage. Kontrolpanelet vises kun, når musen bevæges.</p>
          </section>
        </div>
      </div>`;
    this.renderScenes();
  }

  renderScenes() {
    const box = this.el.querySelector('.scenes');
    if (!box) return;
    box.innerHTML = this.scenes.map(([name, t], k) => `<button class="btn small scene" data-act="scene" data-k="${k}">${name}<i>${t.toFixed(1)}s</i></button>`).join('');
  }

  _row(e) {
    const tr = e.target.closest('.tr');
    return tr ? tr.dataset.id : null;
  }

  _onInput(e) {
    const f = e.target.dataset.f;
    if (!f) {
      if (e.type === 'change' && e.target.dataset.act === 'import') this._import(e.target);
      return;
    }
    const id = this._row(e);
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (f === 'votes') v = Number(v);
    this.config.update(id, { [f]: v });
    if (e.type === 'change') {
      const keep = this.el.scrollTop;
      this.render();
      this.el.scrollTop = keep;
      this.h.onChange?.();
    }
  }

  _onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const id = this._row(e);
    switch (act) {
      case 'start': this.h.onStart(0); break;
      case 'fullscreen': this.h.onFullscreen(); break;
      case 'add': this.config.addTheme(); this.render(); this.h.onChange?.(); break;
      case 'del': this.config.removeTheme(id); this.render(); this.h.onChange?.(); break;
      case 'up': this.config.move(id, -1); this.render(); this.h.onChange?.(); break;
      case 'down': this.config.move(id, 1); this.render(); this.h.onChange?.(); break;
      case 'reset':
        if (confirm('Gendan de 17 temaer og stemmetal fra afstemningen?')) { this.config.reset(); this.render(); this.h.onChange?.(); }
        break;
      case 'export': {
        const blob = new Blob([this.config.exportJSON()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fgm-jam-2026-2-themes.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      case 'scene': this.h.onStart(this.scenes[Number(b.dataset.k)][1]); break;
    }
  }

  _import(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        this.config.importJSON(txt);
        this.render();
        this.h.onChange?.();
      } catch (err) {
        alert('Kunne ikke importere: ' + err.message);
      }
    });
  }
}

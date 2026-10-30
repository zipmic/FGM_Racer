// Configuration Manager: themes, votes, colors and vehicle types.
// Persists in localStorage and can be exported / imported as JSON.

const STORAGE_KEY = 'fgm-jam-2026-2-theme-reveal-v1';

export const VEHICLE_TYPES = [
  ['scooter', 'Gamer på elektrisk løbehjul'],
  ['goth', 'Gotisk luksuslimousine'],
  ['dungeon', 'Levende skattekiste'],
  ['femboy', 'Pink glitter-sportsvogn'],
  ['rocket', 'Rumraket på hjul'],
  ['voxel', 'Voxelridder i pixelbil'],
  ['robot', 'Industrirobot med arme'],
  ['survival', 'Pansret overlevelsesbil'],
  ['gold', 'Guldbil der spiser mønter'],
  ['buttons', 'Racer med 1000 knapper'],
  ['buggy', 'Buggy med ødelagt styring'],
  ['stilts', 'Højbenet lavabil'],
  ['ai', 'Autonom AI-robotbil'],
  ['tank', 'Kampvogn med boksehandsker'],
  ['monster', 'Monster på rulleskøjter'],
  ['cart', 'Bevæbnet indkøbsvogn'],
  ['junk', 'Bil der falder fra hinanden'],
  ['kart', 'Generisk gokart'],
];

// Order inside a vote tie = tie-break order (higher in the list = better placement).
// The default order is chosen so the elimination sequence matches the storyboard.
export const DEFAULT_THEMES = [
  { name: "Can't Stop Moving", votes: 10, color: '#ff8c1a', vehicle: 'scooter' },
  { name: 'Goth Mommy', votes: 6, color: '#8e3bd6', vehicle: 'goth' },
  { name: 'Femboys', votes: 5, color: '#ff77c8', vehicle: 'femboy' },
  { name: 'Dungeon', votes: 5, color: '#c98a2e', vehicle: 'dungeon' },
  { name: 'Out of Space', votes: 5, color: '#5ad1ff', vehicle: 'rocket' },
  { name: 'Build to Survive', votes: 4, color: '#9c7a52', vehicle: 'survival' },
  { name: 'Automation', votes: 4, color: '#ffc21a', vehicle: 'robot' },
  { name: 'Find Out the Controls as You Play', votes: 4, color: '#e8443a', vehicle: 'buttons' },
  { name: '8-Bit RPG', votes: 4, color: '#3f7bff', vehicle: 'voxel' },
  { name: 'Everything Comes at a Cost', votes: 4, color: '#ffd84a', vehicle: 'gold' },
  { name: 'The Floor Is Lava', votes: 4, color: '#ff5a1f', vehicle: 'stilts' },
  { name: 'Out of Control', votes: 4, color: '#8ac926', vehicle: 'buggy' },
  { name: 'You Are the Monster', votes: 3, color: '#7d5bd6', vehicle: 'monster' },
  { name: 'AI', votes: 3, color: '#2ef2d0', vehicle: 'ai' },
  { name: 'Blind Fighting', votes: 3, color: '#d9342b', vehicle: 'tank' },
  { name: 'Everything Is a Weapon', votes: 2, color: '#b8c0c8', vehicle: 'cart' },
  { name: 'One Piece at a Time', votes: 2, color: '#f2a65a', vehicle: 'junk' },
];

let idCounter = 1;
const newId = () => `t${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function normalizeTheme(t) {
  return {
    id: t.id || newId(),
    name: String(t.name ?? 'Nyt tema').slice(0, 60),
    votes: Math.max(0, Math.round(Number(t.votes) || 0)),
    color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#cccccc',
    vehicle: VEHICLE_TYPES.some(([k]) => k === t.vehicle) ? t.vehicle : 'kart',
    enabled: t.enabled !== false,
  };
}

export class ConfigManager {
  constructor() {
    this.themes = [];
    this.load();
  }
  defaults() {
    return DEFAULT_THEMES.map((t) => normalizeTheme({ ...t }));
  }
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.themes) && data.themes.length) {
          this.themes = data.themes.map(normalizeTheme);
          return;
        }
      }
    } catch (e) {
      console.warn('Could not read saved config', e);
    }
    this.themes = this.defaults();
  }
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, themes: this.themes }));
    } catch (e) {
      console.warn('Could not save config', e);
    }
  }
  reset() {
    this.themes = this.defaults();
    this.save();
  }
  addTheme() {
    this.themes.push(normalizeTheme({ name: 'Nyt tema', votes: 1, color: '#66ccff', vehicle: 'kart' }));
    this.save();
  }
  removeTheme(id) {
    this.themes = this.themes.filter((t) => t.id !== id);
    this.save();
  }
  move(id, dir) {
    const i = this.themes.findIndex((t) => t.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.themes.length) return;
    [this.themes[i], this.themes[j]] = [this.themes[j], this.themes[i]];
    this.save();
  }
  update(id, patch) {
    const t = this.themes.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, normalizeTheme({ ...t, ...patch, id }));
    this.save();
  }
  exportJSON() {
    return JSON.stringify(
      { version: 1, event: 'Future Game Makers Jam 2026 #2', themes: this.themes.map(({ id, ...rest }) => rest) },
      null,
      2
    );
  }
  importJSON(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data.themes;
    if (!Array.isArray(list) || !list.length) throw new Error('JSON indeholder ingen temaer');
    this.themes = list.map((t) => normalizeTheme({ ...t, id: undefined }));
    this.save();
  }
  /** Final placement by votes. Ties share a placement; tie-break order = list order. */
  standings() {
    return computeStandings(this.themes);
  }
}

export function computeStandings(themes) {
  const list = themes
    .map((t, index) => ({ ...t, index }))
    .filter((t) => t.enabled);
  list.sort((a, b) => b.votes - a.votes || a.index - b.index);
  for (const t of list) t.place = 1 + list.filter((o) => o.votes > t.votes).length;
  return list;
}

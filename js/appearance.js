// The page's look: the color theme chosen in the Theme panel, and the gentle
// background animation behind the page.
import { logoSvg } from './logos.js';
import { DEFAULT_THEME_ID, THEMES, findTheme, themeVariables } from './themes.js';

const THEME_STORAGE_KEY = 'lectureLedger.theme';
// The chosen theme's colors, which a script in index.html applies before the
// page first appears, so it never flashes the default colors.
const THEME_COLORS_STORAGE_KEY = 'lectureLedger.themeColors';

// How each kind of background animation looks and moves. motion: rise, fall,
// drift (left to right), twinkle (in place), or wander (small loops).
// size in px and duration in seconds are [smallest, largest].
const AMBIENCE_KINDS = {
  motes: { count: 18, motion: 'rise', shape: 'dot', size: [2, 5], duration: [22, 40], opacity: 0.5 },
  notes: { count: 12, motion: 'rise', glyphs: ['♪', '♫'], size: [14, 22], duration: [18, 30], opacity: 0.4 },
  stars: { count: 30, motion: 'twinkle', glyphs: ['✦', '·'], size: [7, 15], duration: [3, 7], opacity: 0.85 },
  hearts: { count: 12, motion: 'rise', glyphs: ['♥'], size: [10, 18], duration: [18, 32], opacity: 0.35 },
  clouds: { count: 7, motion: 'drift', shape: 'cloud', size: [80, 160], duration: [70, 120], opacity: 0.1 },
  petals: { count: 16, motion: 'fall', shape: 'petal', size: [8, 13], duration: [14, 24], opacity: 0.7 },
  sparkles: { count: 22, motion: 'twinkle', glyphs: ['✦', '✧'], size: [8, 16], duration: [3, 6], opacity: 0.7 },
  steam: { count: 10, motion: 'rise', shape: 'wisp', size: [40, 80], duration: [16, 26], opacity: 0.1 },
  letters: { count: 16, motion: 'fall', glyphs: [...'abcdefghijklmnopqrstuvwxyz'], size: [13, 19], duration: [20, 34], opacity: 0.3 },
  snow: { count: 28, motion: 'fall', shape: 'dot', size: [3, 7], duration: [16, 28], opacity: 0.7 },
  fireflies: { count: 16, motion: 'wander', shape: 'glow', size: [3, 5], duration: [8, 16], opacity: 0.9 },
  sand: { count: 24, motion: 'drift', shape: 'dot', size: [2, 3], duration: [26, 46], opacity: 0.4 },
  bubbles: { count: 16, motion: 'rise', shape: 'bubble', size: [6, 16], duration: [16, 28], opacity: 0.5 },
  blobs: { count: 6, motion: 'drift', shape: 'blob', size: [140, 240], duration: [60, 100], opacity: 0.09 },
};

export const AMBIENCE_KIND_NAMES = Object.keys(AMBIENCE_KINDS);

// Random numbers that are the same every time for the same theme, so the
// background doesn't rearrange itself on every visit.
function seededRandom(seedText) {
  let seed = [...seedText].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderAmbience(container, theme) {
  const kind = AMBIENCE_KINDS[theme.ambience.kind];
  container.replaceChildren();
  if (!kind) return;
  const random = seededRandom(theme.id);
  const between = ([low, high]) => low + random() * (high - low);
  for (let index = 0; index < kind.count; index++) {
    const particle = document.createElement('span');
    particle.className = `particle motion-${kind.motion} shape-${kind.shape ?? 'glyph'}`;
    if (kind.glyphs) particle.textContent = kind.glyphs[Math.floor(random() * kind.glyphs.length)];
    const duration = between(kind.duration);
    // Rising and falling particles enter at the bottom or top edge, drifting ones at the left (see styles.css).
    const left = `${(random() * 100).toFixed(1)}%`;
    const top = `${(random() * 100).toFixed(1)}%`;
    if (kind.motion !== 'drift') particle.style.left = left;
    if (kind.motion !== 'rise' && kind.motion !== 'fall') particle.style.top = top;
    Object.assign(particle.style, {
      color: theme.ambience.color,
      opacity: String(kind.opacity),
      animationDuration: `${duration.toFixed(1)}s`,
      // A negative delay starts each particle partway through, so they're spread out from the start.
      animationDelay: `${(-random() * duration).toFixed(1)}s`,
    });
    particle.style.setProperty('--size', `${between(kind.size).toFixed(1)}px`);
    particle.style.setProperty('--sway', `${(random() * 80 - 40).toFixed(0)}px`);
    particle.style.setProperty('--spin', `${(random() * 720 - 360).toFixed(0)}deg`);
    container.appendChild(particle);
  }
}

function loadSavedThemeId() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (findTheme(saved)) return saved;
  } catch {
    // Storage can be blocked (e.g. private windows); the default is fine then.
  }
  return DEFAULT_THEME_ID;
}

function saveTheme(theme, variables) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
    localStorage.setItem(THEME_COLORS_STORAGE_KEY, JSON.stringify(variables));
  } catch {
    // Not remembering the choice is harmless.
  }
}

// A logo in its small round badge. Our own drawings, never user text, so
// setting them as markup is safe.
function showLogo(element, theme) {
  element.innerHTML = logoSvg(theme);
  element.style.setProperty('--logo-bg', theme.colors.bg);
}

// The colors a theme card's little picture of the page uses.
const DEMO_COLORS = {
  '--demo-bg': 'bg',
  '--demo-panel-top': 'panelTop',
  '--demo-panel-bottom': 'panelBottom',
  '--demo-key-cap': 'keyCap',
  '--demo-paper': 'paper',
  '--demo-ink': 'ink',
  '--demo-ink-soft': 'inkSoft',
  '--demo-machine': 'machine',
};

function themeCard(theme) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'theme-card';
  card.dataset.themeId = theme.id;
  for (const [variable, color] of Object.entries(DEMO_COLORS)) card.style.setProperty(variable, theme.colors[color]);
  card.style.setProperty('--demo-backdrop', theme.backdrop);
  const keys = [theme.colors.accent, theme.colors.brass]
    .map((color) => `<span class="demo-key" style="background: ${color}"></span>`)
    .join('');
  card.innerHTML = `
    <span class="theme-demo" aria-hidden="true">
      <span class="demo-panel">${keys}<span class="demo-counter"></span></span>
      <span class="demo-paper">
        <span class="demo-line" style="width: 82%"></span>
        <span class="demo-line" style="width: 64%"></span>
        <span class="demo-line soft" style="width: 74%"></span>
      </span>
      <span class="demo-machine"></span>
    </span>
    <span class="theme-card-footer">
      <span class="theme-logo" aria-hidden="true"></span>
      <span class="theme-card-name"></span>
      <span class="theme-card-check" aria-hidden="true">✓</span>
    </span>`;
  card.querySelector('.theme-card-name').textContent = theme.name;
  showLogo(card.querySelector('.theme-logo'), theme);
  return card;
}

function applyTheme(theme, { ambienceEl, themeButtonLogo, themeButtonName, themeGrid }) {
  // The typewriter's lamp shines in the color of the theme's background animation.
  const variables = { ...themeVariables(theme), '--backdrop': theme.backdrop, '--lamp': theme.ambience.color };
  for (const [variable, value] of Object.entries(variables)) {
    document.documentElement.style.setProperty(variable, value);
  }
  document.documentElement.dataset.theme = theme.id;
  showLogo(themeButtonLogo, theme);
  themeButtonName.textContent = theme.name;
  for (const card of themeGrid.children) card.setAttribute('aria-pressed', String(card.dataset.themeId === theme.id));
  renderAmbience(ambienceEl, theme);
  return variables;
}

// Fills the Theme panel with a card per theme and applies the saved theme.
// Choosing a card applies and remembers that theme right away; the panel stays
// open to compare others until it is closed (Esc, a click outside, or the button).
export function setUpAppearance(elements) {
  const { themeButton, themePanel, themeGrid } = elements;
  themeGrid.append(...THEMES.map(themeCard));
  const savedTheme = findTheme(loadSavedThemeId());
  // Saved again so the colors applied early stay in step with js/themes.js.
  saveTheme(savedTheme, applyTheme(savedTheme, elements));

  const setPanelOpen = (open) => {
    themePanel.hidden = !open;
    themeButton.setAttribute('aria-expanded', String(open));
    if (open) themeGrid.querySelector('[aria-pressed="true"]')?.focus();
  };
  themeButton.addEventListener('click', () => setPanelOpen(themePanel.hidden));
  themeGrid.addEventListener('click', (event) => {
    const card = event.target.closest('.theme-card');
    if (!card) return;
    const theme = findTheme(card.dataset.themeId) ?? findTheme(DEFAULT_THEME_ID);
    saveTheme(theme, applyTheme(theme, elements));
  });
  document.addEventListener('click', (event) => {
    if (!themePanel.hidden && !themePanel.contains(event.target) && !themeButton.contains(event.target)) {
      setPanelOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !themePanel.hidden) {
      setPanelOpen(false);
      themeButton.focus();
    }
  });
}

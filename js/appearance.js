// The page's look: the color theme chosen in the Theme panel, and the gentle
// background animation behind the page, or, in a window-view theme, the view
// out of the window with the weather chosen by its buttons.
import { logoSvg } from './logos.js';
import { seededRandom } from './seeded-random.js';
import { WEATHERS, WEATHER_NAMES, estimatedSunTimes, minutesAfterMidnight, skyColors, sunPosition } from './sky.js';
import { DEFAULT_THEME_ID, THEMES, WINDOW_THEMES, findTheme, themeVariables } from './themes.js';
import { weatherIconSvg } from './weather-icons.js';
import { createWindowView } from './window-view.js';

const THEME_STORAGE_KEY = 'lectureLedger.theme';
// The chosen theme's colors, which a script in index.html applies before the
// page first appears, so it never flashes the default colors.
const THEME_COLORS_STORAGE_KEY = 'lectureLedger.themeColors';
const WEATHER_STORAGE_KEY = 'lectureLedger.windowWeather';
// How often the window view catches up with the time of day.
const SKY_UPDATE_MS = 60_000;

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

function loadSavedWeather() {
  try {
    const saved = localStorage.getItem(WEATHER_STORAGE_KEY);
    if (WEATHERS.includes(saved)) return saved;
  } catch {
    // Without storage the sky starts clear.
  }
  return 'clear';
}

function saveWeather(weather) {
  try {
    localStorage.setItem(WEATHER_STORAGE_KEY, weather);
  } catch {
    // Not remembering the weather is harmless.
  }
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

// ?time=14:30 in the address shows the window at that time of day, to preview
// day or night whatever the clock says.
const previewTime = new URLSearchParams(window.location.search).get('time')?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

// The time of day and weather outside the window right now. Without a
// location, sunrise and sunset are estimated from the date.
function currentScene(weather) {
  const date = new Date();
  if (previewTime) date.setHours(Number(previewTime[1]), Number(previewTime[2]), 0, 0);
  return { date, weather, sun: sunPosition(minutesAfterMidnight(date), estimatedSunTimes(date)) };
}

// A theme as it looks right now. A window theme takes its day or night colors
// and a picture of the sky, which shows on its card and, until the scripts
// run, behind the page; the typewriter lamp shines in its lamp color. Other
// themes are unchanged.
function themeAsShown(theme, { sun, weather }) {
  if (!theme.dayColors) return theme;
  const sky = skyColors(sun.height, weather);
  return {
    ...theme,
    colors: sun.isDay ? theme.dayColors : theme.nightColors,
    backdrop: `linear-gradient(180deg, ${sky.top}, ${sky.middle} 58%, ${sky.horizon} 86%)`,
    ambience: { kind: 'none', color: theme.lamp },
  };
}

function weatherButton(weather) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'weather-button';
  button.dataset.weather = weather;
  button.title = WEATHER_NAMES[weather];
  button.setAttribute('aria-label', WEATHER_NAMES[weather]);
  return button;
}

// Marks the chosen weather; clear weather shows a sun by day and a moon at night.
function showWeatherButtons(weatherPicker, { weather, sun }) {
  for (const button of weatherPicker.querySelectorAll('.weather-button')) {
    button.innerHTML = weatherIconSvg(button.dataset.weather, !sun.isDay);
    button.setAttribute('aria-pressed', String(button.dataset.weather === weather));
  }
}

function applyTheme(theme, scene, elements) {
  const { ambienceEl, themeButtonLogo, themeButtonName, themeGrid, windowThemeGrid, weatherPicker } = elements;
  const shown = themeAsShown(theme, scene);
  // The typewriter's lamp shines in the color of the theme's background animation.
  const variables = { ...themeVariables(shown), '--backdrop': shown.backdrop, '--lamp': shown.ambience.color };
  for (const [variable, value] of Object.entries(variables)) {
    document.documentElement.style.setProperty(variable, value);
  }
  document.documentElement.dataset.theme = theme.id;
  const isWindow = Boolean(theme.dayColors);
  if (isWindow) document.documentElement.dataset.scene = 'window';
  else delete document.documentElement.dataset.scene;
  showLogo(themeButtonLogo, shown);
  themeButtonName.textContent = theme.name;
  for (const card of [...themeGrid.children, ...windowThemeGrid.children]) {
    card.setAttribute('aria-pressed', String(card.dataset.themeId === theme.id));
  }
  renderAmbience(ambienceEl, shown);
  weatherPicker.hidden = !isWindow;
  if (isWindow) showWeatherButtons(weatherPicker, scene);
  return variables;
}

// Fills the Theme panel with a card per theme and applies the saved theme.
// Choosing a card applies and remembers that theme right away; the panel stays
// open to compare others until it is closed (Esc, a click outside, or the button).
export function setUpAppearance(elements) {
  const { themeButton, themePanel, themeGrid, windowThemeGrid, weatherPicker, windowViewEl } = elements;
  const windowView = createWindowView(windowViewEl);
  let theme = findTheme(loadSavedThemeId());
  let weather = loadSavedWeather();

  themeGrid.append(...THEMES.map(themeCard));
  const scene = currentScene(weather);
  windowThemeGrid.append(...WINDOW_THEMES.map((windowTheme) => themeCard(themeAsShown(windowTheme, scene))));
  weatherPicker.append(...WEATHERS.map(weatherButton));

  // Saved each time so the colors applied early stay in step with js/themes.js
  // and, in a window theme, with the time of day.
  const show = () => {
    const now = currentScene(weather);
    saveTheme(theme, applyTheme(theme, now, elements));
    if (theme.dayColors) windowView.show(now);
    else windowView.hide();
  };
  show();
  setInterval(() => {
    if (theme.dayColors) show();
  }, SKY_UPDATE_MS);

  const setPanelOpen = (open) => {
    themePanel.hidden = !open;
    themeButton.setAttribute('aria-expanded', String(open));
    if (open) themePanel.querySelector('[aria-pressed="true"]')?.focus();
  };
  themeButton.addEventListener('click', () => setPanelOpen(themePanel.hidden));
  themePanel.addEventListener('click', (event) => {
    const card = event.target.closest('.theme-card');
    if (!card) return;
    theme = findTheme(card.dataset.themeId) ?? findTheme(DEFAULT_THEME_ID);
    show();
  });
  weatherPicker.addEventListener('click', (event) => {
    const button = event.target.closest('.weather-button');
    if (!button) return;
    weather = button.dataset.weather;
    saveWeather(weather);
    show();
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

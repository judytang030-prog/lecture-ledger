// The page's look: the color theme chosen in the Theme panel, and the gentle
// background animation behind the page, or, in a window-view theme, the view
// out of the window, with the real weather where the student is or the
// weather chosen by its buttons.
import { fetchPlaceName, fetchWeather, findLocation } from './live-weather.js';
import { cornerCompanion, logoSvg } from './logos.js';
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
// How often the window view catches up with the time of day, and with the
// real weather.
const SKY_UPDATE_MS = 60_000;
const LIVE_WEATHER_UPDATE_MS = 15 * 60_000;

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
  // Unchanged since last time: the particles carry on where they are.
  const key = `${theme.id} ${theme.ambience.kind} ${theme.ambience.color}`;
  if (container.dataset.ambience === key) return;
  container.dataset.ambience = key;
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

// The theme's small moving companion in the panel's bottom-right corner (our
// own drawings, so setting them as markup is safe). Left alone while the
// theme stays the same, so it doesn't restart every minute.
function showPanelCorner(element, theme) {
  if (element.dataset.themeId === theme.id) return;
  element.dataset.themeId = theme.id;
  const { motion, markup } = cornerCompanion(theme);
  element.className = `theme-panel-corner corner-${motion}`;
  element.innerHTML = markup;
}

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

// The time of day and weather outside the window right now. Without the real
// sunrise and sunset, they are estimated from the date.
function currentScene(weather, sunTimes) {
  const date = new Date();
  if (previewTime) date.setHours(Number(previewTime[1]), Number(previewTime[2]), 0, 0);
  return { date, weather, sun: sunPosition(minutesAfterMidnight(date), sunTimes ?? estimatedSunTimes(date)) };
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

// The background animation inside the Theme panel: the theme's own, or in a
// window view what the sky has: snow, stars at night, or dust in the sunlight.
function panelAmbience(shown, { sun, weather }) {
  if (!shown.dayColors) return shown;
  if (weather === 'snow') return { ...shown, ambience: { kind: 'snow', color: sun.isDay ? '#8fa6bb' : '#e6ecff' } };
  return { ...shown, ambience: sun.isDay ? { kind: 'motes', color: '#b89a5e' } : { kind: 'stars', color: '#e6ecff' } };
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
  const { ambienceEl, panelAmbienceEl, panelCornerEl, themeButtonLogo, themeButtonName, themeGrid, windowThemeGrid } =
    elements;
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
  renderAmbience(panelAmbienceEl, panelAmbience(shown, scene));
  showPanelCorner(panelCornerEl, shown);
  return variables;
}

// What the "my weather" readout says while the real weather is being found.
const LIVE_STATUS_TEXT = {
  locating: 'Finding your location…',
  loading: 'Getting the weather…',
};

// Why the real weather can't be shown, for the notice under the title.
const LIVE_PROBLEM_TEXT = {
  denied:
    'The window can’t show the weather where you are, because this site isn’t allowed to see your location. ' +
    'To allow it, click the icon at the left of the address bar, turn on Location, and reload the page. ' +
    'Until then, pick the weather with the buttons.',
  unlocated:
    'Couldn’t find where you are. On a Mac, check that Chrome may use Location Services ' +
    '(System Settings → Privacy & Security → Location Services). ' +
    'It will try again in 15 minutes; until then, pick the weather with the buttons.',
  failed:
    'Couldn’t get the weather where you are (no internet, or the weather service didn’t answer). ' +
    'It will try again in 15 minutes; until then, pick the weather with the buttons.',
};

// Fills the Theme panel with a card per theme and applies the saved theme.
// Choosing a card applies and remembers that theme right away; the panel stays
// open to compare others until it is closed (Esc, a click outside, or the button).
export function setUpAppearance(elements) {
  const { themeButton, themePanel, themeGrid, windowThemeGrid, weatherPicker, weatherReadout, windowViewEl, noticesEl } =
    elements;
  const windowView = createWindowView(windowViewEl);
  let theme = findTheme(loadSavedThemeId());
  let weather = loadSavedWeather();
  // The real weather where the student is, for the "my weather" window view.
  // status: 'idle', 'locating', 'loading', 'ready', or a problem: 'denied',
  // 'unlocated' (no location found) or 'failed' (no weather).
  const live = { status: 'idle', location: null, report: null, place: '', checkedAt: 0, busy: false };
  const locationNotice = document.createElement('p');
  locationNotice.className = 'notice';

  themeGrid.append(...THEMES.map(themeCard));
  const scene = currentScene(weather);
  windowThemeGrid.append(...WINDOW_THEMES.map((windowTheme) => themeCard(themeAsShown(windowTheme, scene))));
  weatherPicker.append(...WEATHERS.map(weatherButton));

  const usesLiveWeather = () => theme.weather === 'here';

  // The weather buttons show in a window view unless it is showing the real
  // weather; the readout says what the real weather is, or that it's coming.
  const showWeatherControls = (now) => {
    const liveProblem = usesLiveWeather() ? LIVE_PROBLEM_TEXT[live.status] : null;
    weatherPicker.hidden = !theme.dayColors || (usesLiveWeather() && !liveProblem);
    if (!weatherPicker.hidden) showWeatherButtons(weatherPicker, now);
    weatherReadout.hidden = !usesLiveWeather() || Boolean(liveProblem);
    if (!weatherReadout.hidden) {
      const { report, place } = live;
      weatherReadout.querySelector('.weather-readout-icon').innerHTML = report
        ? weatherIconSvg(report.weather, !now.sun.isDay)
        : '';
      weatherReadout.querySelector('.weather-readout-text').textContent = report
        ? [place, report.temperature, report.description].filter(Boolean).join(' · ')
        : LIVE_STATUS_TEXT[live.status] ?? '';
    }
    if (liveProblem) {
      locationNotice.textContent = liveProblem;
      noticesEl.prepend(locationNotice);
    } else {
      locationNotice.remove();
    }
  };

  // Saved each time so the colors applied early stay in step with js/themes.js
  // and, in a window theme, with the time of day.
  const show = () => {
    const report = usesLiveWeather() ? live.report : null;
    const now = currentScene(report ? report.weather : weather, report?.sunTimes);
    saveTheme(theme, applyTheme(theme, now, elements));
    showWeatherControls(now);
    if (theme.dayColors) windowView.show(now);
    else windowView.hide();
  };

  // Finds the student's location (once; the browser asks them first) and the
  // weather there, then shows it.
  const refreshLiveWeather = async () => {
    if (!usesLiveWeather() || live.busy) return;
    live.busy = true;
    live.checkedAt = Date.now();
    try {
      if (!live.location) {
        live.status = 'locating';
        show();
        live.location = await findLocation();
      }
      if (!live.report) {
        live.status = 'loading';
        show();
      }
      const [report, place] = await Promise.all([
        fetchWeather(live.location),
        live.place || fetchPlaceName(live.location),
      ]);
      Object.assign(live, { report, place, status: 'ready' });
    } catch (error) {
      const problems = { denied: 'denied', unsupported: 'denied', unavailable: 'unlocated' };
      live.status = problems[error.code] ?? 'failed';
    } finally {
      live.busy = false;
    }
    show();
  };
  const refreshIfDue = () => {
    if (usesLiveWeather() && Date.now() - live.checkedAt >= LIVE_WEATHER_UPDATE_MS) refreshLiveWeather();
  };

  show();
  refreshIfDue();
  setInterval(() => {
    if (theme.dayColors) show();
    refreshIfDue();
  }, SKY_UPDATE_MS);

  // The Theme button opens and closes the panel (a popover, which the browser
  // also closes on Esc or a click outside); it hangs under the button.
  const placePanel = () => {
    const button = themeButton.getBoundingClientRect();
    themePanel.style.setProperty('--theme-panel-top', `${Math.round(button.bottom + 10)}px`);
    themePanel.style.setProperty('--theme-panel-right', `${Math.round(Math.max(16, window.innerWidth - button.right))}px`);
  };
  themePanel.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'open') placePanel();
  });
  themePanel.addEventListener('toggle', (event) => {
    const open = event.newState === 'open';
    themeButton.setAttribute('aria-expanded', String(open));
    if (open) themePanel.querySelector('[aria-pressed="true"]')?.focus();
  });
  const keepPanelPlaced = () => {
    if (themePanel.matches(':popover-open')) placePanel();
  };
  window.addEventListener('scroll', keepPanelPlaced, { passive: true });
  window.addEventListener('resize', keepPanelPlaced);
  themePanel.addEventListener('click', (event) => {
    const card = event.target.closest('.theme-card');
    if (!card) return;
    theme = findTheme(card.dataset.themeId) ?? findTheme(DEFAULT_THEME_ID);
    show();
    if (usesLiveWeather() && live.status !== 'ready') refreshLiveWeather();
  });
  weatherPicker.addEventListener('click', (event) => {
    const button = event.target.closest('.weather-button');
    if (!button) return;
    weather = button.dataset.weather;
    saveWeather(weather);
    show();
  });
}

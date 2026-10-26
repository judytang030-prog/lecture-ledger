// The view out of a floor-to-ceiling window behind the page, for the
// window-view themes, as a camera focused on the glass would see it: the sky
// at this time of day, the sun as a soft glare, or the moon in its real phase
// among faint stars, and the town outside blurred into soft shapes, its lights
// glowing discs at night. The weather is drifting cloud, blowing leaves, rain
// running down the glass, lightning, snow, or fog. The page covers the middle
// of the window, so the sun and moon sit in the strips beside it.
import { seededRandom } from './seeded-random.js';
import { darkness, mixColors, moonLitPath, moonPhase, skyColors } from './sky.js';

// How each weather looks: how many banks of cloud and how many seconds they
// take to cross, how much of the sun, moon and stars shows through (sky), how
// thick the haze is, how far the town's lights spread (bokeh) and how bright
// they stay (lights), and what falls outside or runs down the glass.
const WEATHER_LOOKS = {
  clear: { clouds: 2, cloudSeconds: [220, 320], sky: 1, haze: 0, bokeh: 1, lights: 1 },
  cloudy: { clouds: 7, cloudSeconds: [140, 220], sky: 0.35, haze: 0.08, bokeh: 1, lights: 1 },
  windy: { clouds: 5, cloudSeconds: [30, 50], sky: 1, haze: 0, bokeh: 1, lights: 1, leaves: 26 },
  rain: { clouds: 8, cloudSeconds: [110, 170], sky: 0, haze: 0.16, bokeh: 1.4, lights: 1, rain: 260, glassDrops: 1 },
  thunder: {
    clouds: 9,
    cloudSeconds: [70, 110],
    sky: 0,
    haze: 0.2,
    bokeh: 1.4,
    lights: 0.9,
    rain: 380,
    glassDrops: 1.7,
    lightning: true,
  },
  snow: { clouds: 7, cloudSeconds: [160, 230], sky: 0.1, haze: 0.22, bokeh: 1.2, lights: 0.85, snow: 340 },
  fog: { clouds: 3, cloudSeconds: [240, 340], sky: 0.3, haze: 0.72, bokeh: 1.7, lights: 0.5 },
};

// Tree colors through the year: blossom in spring, green in summer, orange
// and gold in autumn, dark evergreens in winter.
const SEASON_CROWNS = [
  { months: [2, 3, 4], colors: ['#6f9a4f', '#8fb565', '#e7b9c8'] },
  { months: [5, 6, 7], colors: ['#3d6a39', '#4f7f44', '#33583a'] },
  { months: [8, 9, 10], colors: ['#b8662c', '#cf9a38', '#7d7a35'] },
  { months: [11, 0, 1], colors: ['#2f4a3c', '#3b5646', '#283f34'] },
];

const LEAF_COLORS = ['#c8792f', '#a3502a', '#d9a441', '#7b8a3a'];
// Out-of-focus lights: warm windows and street lamps, a few cooler ones, and
// headlights and tail lights for the cars.
const BOKEH_COLORS = ['#ffc46b', '#ffad4d', '#ffd99a', '#fff0cf', '#ff8f5e', '#ffe0a8', '#ffc46b', '#ffd99a'];
// Now and then a traffic light or a cool white lamp.
const RARE_BOKEH_COLORS = ['#ff5f4f', '#7fe3a0', '#a9d4ff'];
const TRAFFIC_COLORS = ['#fff3dc', '#ff5a4a'];
// The canvas animations run at about 30 frames a second, which is smooth for
// rain and snow and leaves time for transcription.
const FRAME_MS = 30;
const SKYLINE_WIDTH = 1600;
const SKYLINE_GROUND = 300;

function windowRects(x, top, width, height, size, gap, litShare, random) {
  let rects = '';
  for (let row = top + gap; row + size[1] < top + height - 4; row += size[1] + gap) {
    for (let column = x + gap; column + size[0] < x + width - 2; column += size[0] + gap) {
      // Some windows are left out, as in a real building.
      if (random() < 0.35) continue;
      const kind = random() < litShare ? 'wv-lit' : 'wv-pane';
      rects += `<rect class="${kind}" x="${column.toFixed(1)}" y="${row.toFixed(1)}" width="${size[0]}" height="${size[1]}"/>`;
    }
  }
  return rects;
}

function buildingRow({ className, widths, heights, windowSize, windowGap, litShare }, random) {
  let markup = '';
  for (let x = -10; x < SKYLINE_WIDTH + 10; ) {
    const width = widths[0] + random() * (widths[1] - widths[0]);
    let height = heights[0] + random() * (heights[1] - heights[0]);
    if (random() < 0.07) height += 70;
    const top = SKYLINE_GROUND - height;
    markup += `<rect class="${className}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}"/>`;
    markup += windowRects(x, top, width, height, windowSize, windowGap, litShare, random);
    x += width + random() * 10;
  }
  return markup;
}

function trees(random) {
  let markup = '';
  // Close together, so out of focus they merge into one canopy.
  for (let x = 6; x < SKYLINE_WIDTH; x += 16 + random() * 22) {
    const size = 16 + random() * 16;
    const crown = () => `wv-crown-${1 + Math.floor(random() * 3)}`;
    markup += `
      <rect class="wv-trunk" x="${(x - 2).toFixed(1)}" y="${(300 - size).toFixed(1)}" width="4" height="${(size + 20).toFixed(1)}"/>
      <circle class="${crown()}" cx="${(x - size * 0.6).toFixed(1)}" cy="${(300 - size * 0.55).toFixed(1)}" r="${(size * 0.72).toFixed(1)}"/>
      <circle class="${crown()}" cx="${(x + size * 0.6).toFixed(1)}" cy="${(300 - size * 0.5).toFixed(1)}" r="${(size * 0.68).toFixed(1)}"/>
      <circle class="${crown()}" cx="${x.toFixed(1)}" cy="${(300 - size * 1.05).toFixed(1)}" r="${size.toFixed(1)}"/>`;
  }
  return markup;
}

// The town outside: hills, a row of far buildings, nearer buildings, and
// trees. The stylesheet blurs it heavily, as it would be out of focus.
function skylineMarkup() {
  const random = seededRandom('window-view');
  const far = buildingRow(
    { className: 'wv-far', widths: [26, 70], heights: [60, 165], windowSize: [4, 6], windowGap: 6, litShare: 0.32 },
    random,
  );
  const near = buildingRow(
    { className: 'wv-near', widths: [50, 110], heights: [30, 95], windowSize: [6, 8], windowGap: 7, litShare: 0.26 },
    random,
  );
  return `
    <svg class="wv-skyline" viewBox="0 0 ${SKYLINE_WIDTH} 320" preserveAspectRatio="xMidYMax slice">
      <path class="wv-hills" d="M0 215 C180 170 380 200 600 178 S1000 160 1220 192 S1480 172 1600 196 V320 H0 Z"/>
      ${far}
      ${near}
      ${trees(random)}
      <rect class="wv-ground" x="0" y="306" width="${SKYLINE_WIDTH}" height="14"/>
    </svg>`;
}

// The town's lights at night as out-of-focus discs, mostly in the strips
// beside the page where they show, and car lights passing along the bottom.
function bokehMarkup() {
  const random = seededRandom('window-bokeh');
  const pick = (colors) => colors[Math.floor(random() * colors.length)];
  const besidePage = () => (random() < 0.5 ? random() * 15 : 85 + random() * 15);
  const light = ({ className, left, top, size, color, strength, seconds, delay = 0 }) =>
    `<span class="${className}" style="left: ${left.toFixed(1)}%; top: ${top.toFixed(1)}%; --size: ${size.toFixed(0)}px; ` +
    `--color: ${color}; --strength: ${strength.toFixed(2)}; animation-duration: ${seconds.toFixed(1)}s; ` +
    `animation-delay: ${(-delay).toFixed(1)}s"></span>`;
  let markup = '';
  for (let index = 0; index < 96; index++) {
    const seconds = 5 + random() * 10;
    markup += light({
      // One light in four brightens and dims; animating them all is costly.
      className: random() < 0.25 ? 'wv-bokeh-light wv-breathing' : 'wv-bokeh-light',
      left: random() < 0.75 ? besidePage() : random() * 100,
      // Lights sit in the town, more of them lower down.
      top: 66 + random() ** 0.6 * 34,
      size: 18 + random() ** 1.6 * 92,
      color: pick(random() < 0.08 ? RARE_BOKEH_COLORS : BOKEH_COLORS),
      strength: 0.25 + random() * 0.5,
      seconds,
      delay: random() * seconds,
    });
  }
  for (let index = 0; index < 8; index++) {
    const seconds = 16 + random() * 18;
    const headlights = index % 2 === 0;
    markup += light({
      className: `wv-bokeh-light wv-traffic${headlights ? '' : ' wv-traffic-back'}`,
      left: 0,
      top: 91 + random() * 6,
      size: 16 + random() * 22,
      color: TRAFFIC_COLORS[headlights ? 0 : 1],
      strength: 0.6 + random() * 0.3,
      seconds,
      delay: random() * seconds,
    });
  }
  return markup;
}

function starsMarkup() {
  const random = seededRandom('window-stars');
  let markup = '';
  for (let index = 0; index < 110; index++) {
    const size = (0.6 + random() ** 2 * 1.3).toFixed(1);
    let style = `left: ${(random() * 100).toFixed(2)}%; top: ${(random() * 62).toFixed(2)}%; --size: ${size}px`;
    const twinkles = random() < 0.25;
    if (twinkles) style += `; --twinkle: ${(3 + random() * 5).toFixed(1)}s`;
    markup += `<span class="wv-star${twinkles ? ' twinkle' : ''}" style="${style}"></span>`;
  }
  return markup;
}

// The moon's dark seas as they look from the northern hemisphere, as
// [x, y, half-width, half-height] on a moon 92 across: Imbrium, Serenitatis,
// Tranquillitatis, Crisium, Fecunditatis, Nubium, Procellarum and Frigoris.
const MOON_SEAS = [
  [-12, -18, 15, 12],
  [8, -16, 9, 8],
  [16, -2, 11, 10],
  [30, -10, 6, 7],
  [26, 10, 7, 9],
  [-6, 16, 9, 7],
  [-26, 0, 12, 24],
  [-2, -32, 20, 4],
];

function moonMarkup() {
  const seas = MOON_SEAS.map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`).join('');
  return `
    <svg viewBox="-50 -50 100 100">
      <defs>
        <radialGradient id="windowMoonSurface" cx="0.42" cy="0.42" r="0.62">
          <stop offset="0" stop-color="#f8f4e8"/>
          <stop offset="0.7" stop-color="#e9e3d2"/>
          <stop offset="1" stop-color="#b3ab97"/>
        </radialGradient>
        <filter id="windowMoonMottle" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="4" seed="7"/>
          <feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.43  0 0 0 0 0.39  1.8 0 0 0 -0.75"/>
        </filter>
        <filter id="windowMoonSoft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4"/>
        </filter>
        <clipPath id="windowMoonLit"><path class="wv-moon-lit-shape"/></clipPath>
      </defs>
      <circle class="wv-moon-dark" r="46"/>
      <g clip-path="url(#windowMoonLit)">
        <circle r="46" fill="url(#windowMoonSurface)"/>
        <g class="wv-moon-seas" filter="url(#windowMoonSoft)">${seas}</g>
        <rect x="-46" y="-46" width="92" height="92" filter="url(#windowMoonMottle)" opacity="0.5"/>
        <circle class="wv-moon-bright" cx="-6" cy="31" r="2.6" filter="url(#windowMoonSoft)"/>
      </g>
    </svg>`;
}

function sceneMarkup() {
  return `
    <div class="wv-outside">
      <div class="wv-sky"></div>
      <div class="wv-stars">${starsMarkup()}</div>
      <div class="wv-sun"><span class="wv-sun-glow"></span><span class="wv-sun-core"></span></div>
      <div class="wv-moon"><span class="wv-moon-glow"></span>${moonMarkup()}</div>
      <div class="wv-clouds"></div>
      ${skylineMarkup()}
      <div class="wv-bokeh">${bokehMarkup()}</div>
      <div class="wv-fog"></div>
      <canvas class="wv-falling"></canvas>
      <div class="wv-lightning"></div>
    </div>
    <canvas class="wv-glass"></canvas>
    <div class="wv-glare"></div>
    <div class="wv-frame">
      <span class="wv-frame-top"></span>
      <span class="wv-transom"></span>
      <span class="wv-frame-left"></span>
      <span class="wv-frame-right"></span>
      <span class="wv-sill"></span>
    </div>
    <div class="wv-lens"></div>`;
}

// One raindrop on the glass, drawn once and then stamped at every drop's size.
// A drop bends light from below, so it is brightest at the bottom, with a dark
// upper rim and a glint on top.
function dropletSprite() {
  const size = 64;
  const center = size / 2;
  const radius = 30;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const circle = (r, y = center) => {
    context.beginPath();
    context.arc(center, y, r, 0, Math.PI * 2);
  };
  context.fillStyle = 'rgba(0, 0, 0, 0.22)';
  circle(radius - 1, center + 3);
  context.fill();
  const body = context.createRadialGradient(center, center + radius * 0.4, radius * 0.1, center, center, radius);
  body.addColorStop(0, 'rgba(255, 255, 255, 0.62)');
  body.addColorStop(0.55, 'rgba(255, 255, 255, 0.2)');
  body.addColorStop(1, 'rgba(40, 50, 60, 0.18)');
  context.fillStyle = body;
  circle(radius);
  context.fill();
  const rim = context.createLinearGradient(0, center - radius, 0, center + radius);
  rim.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
  rim.addColorStop(0.5, 'rgba(0, 0, 0, 0.12)');
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
  context.strokeStyle = rim;
  context.lineWidth = 4;
  circle(radius - 2);
  context.stroke();
  context.fillStyle = 'rgba(255, 255, 255, 0.85)';
  context.beginPath();
  context.ellipse(center - radius * 0.32, center - radius * 0.42, radius * 0.2, radius * 0.12, -0.5, 0, Math.PI * 2);
  context.fill();
  return canvas;
}

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

// Builds the scene in container and returns show(state) and hide().
// state: { date, sun (from sunPosition in js/sky.js), weather }.
export function createWindowView(container) {
  container.innerHTML = sceneMarkup();
  const find = (selector) => container.querySelector(selector);
  const clouds = find('.wv-clouds');
  const lightning = find('.wv-lightning');
  const falling = find('.wv-falling');
  const glass = find('.wv-glass');
  const fallingContext = falling.getContext('2d');
  const glassContext = glass.getContext('2d');
  const sprite = dropletSprite();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const random = Math.random;

  let shownWeather = null;
  let look = WEATHER_LOOKS.clear;
  let isNight = false;
  let width = 0;
  let height = 0;
  let frameRequest = 0;
  let lastFrame = 0;
  let spawnCredit = { drop: 0, run: 0 };
  let nextLightning = 0;
  let bolt = null;
  let rainStreaks = [];
  let snowflakes = [];
  let leaves = [];
  let drops = [];
  let runs = [];

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    for (const canvas of [falling, glass]) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d').setTransform(scale, 0, 0, scale, 0, 0);
    }
  }

  // Clouds out of focus are broad, soft patches of light and shade.
  function makeClouds() {
    const cloudRandom = seededRandom(`clouds-${shownWeather}`);
    const [fastest, slowest] = look.cloudSeconds;
    clouds.replaceChildren(
      ...Array.from({ length: look.clouds }, (_, index) => {
        const cloud = document.createElement('span');
        cloud.className = index % 2 ? 'wv-cloud wv-cloud-shade' : 'wv-cloud';
        const seconds = fastest + cloudRandom() * (slowest - fastest);
        cloud.style.top = `${(-10 + cloudRandom() * 55).toFixed(1)}%`;
        cloud.style.width = `${(45 + cloudRandom() * 55).toFixed(0)}vw`;
        cloud.style.opacity = (0.35 + cloudRandom() * 0.45).toFixed(2);
        cloud.style.animationDuration = `${seconds.toFixed(0)}s`;
        cloud.style.animationDelay = `${(-cloudRandom() * seconds).toFixed(0)}s`;
        return cloud;
      }),
    );
  }

  function makeFalling() {
    rainStreaks = Array.from({ length: look.rain ?? 0 }, () => ({
      x: random() * (width + 200) - 100,
      y: random() * height,
      length: 12 + random() * 16,
      speed: 900 + random() * 500,
    }));
    snowflakes = Array.from({ length: look.snow ?? 0 }, () => ({
      x: random() * width,
      y: random() * height,
      radius: 1 + random() ** 2 * 3,
      phase: random() * Math.PI * 2,
    }));
    leaves = Array.from({ length: look.leaves ?? 0 }, () => ({
      x: random() * width,
      y: random() * height * 0.9,
      size: 4 + random() * 4,
      speed: 260 + random() * 260,
      angle: random() * Math.PI * 2,
      spin: (random() - 0.5) * 10,
      phase: random() * Math.PI * 2,
      color: LEAF_COLORS[Math.floor(random() * LEAF_COLORS.length)],
    }));
    drops = [];
    runs = [];
    spawnCredit = { drop: 0, run: 0 };
    // The glass starts out already wet, rather than drying out on every change.
    if (look.glassDrops) for (let index = 0; index < maxDrops() * 0.8; index++) spawnDrop();
  }

  // Drops gather only in the strips of glass beside the page, where they show.
  const stripWidth = () => Math.max(70, (width - 1072) / 2 + 30);
  const xInStrips = () => (random() < 0.5 ? random() * stripWidth() : width - random() * stripWidth());
  const maxDrops = () => Math.min(1400, (2 * stripWidth() * height) / 380);

  function spawnDrop() {
    const drop = { x: xInStrips(), y: random() * height, r: 0.8 + random() ** 2.5 * 3.4 };
    const touching = drops.find((other) => Math.hypot(other.x - drop.x, other.y - drop.y) < (other.r + drop.r) * 0.9);
    if (touching) {
      // Two drops that touch run together into one bigger drop, which slides
      // down once it is heavy enough.
      touching.r = Math.hypot(touching.r, drop.r);
      if (touching.r > 4.2) {
        drops.splice(drops.indexOf(touching), 1);
        runs.push(startRun(touching));
      }
      return;
    }
    drops.push(drop);
    if (drops.length > maxDrops()) drops.shift();
  }

  function startRun({ x, y, r }) {
    return { x, y, r: Math.max(r, 3.4), speed: 0, pause: 0, nextTrail: 6 + random() * 10, wiggle: random() * 10 };
  }

  function updateGlass(seconds) {
    spawnCredit.drop += seconds * 90 * look.glassDrops;
    for (; spawnCredit.drop >= 1; spawnCredit.drop--) spawnDrop();
    spawnCredit.run += seconds * 1.2 * look.glassDrops;
    for (; spawnCredit.run >= 1; spawnCredit.run--) {
      runs.push(startRun({ x: xInStrips(), y: random() * height * 0.6, r: 3.4 + random() * 2.6 }));
    }
    for (const run of runs) {
      // Running drops stop and start, as if catching on the glass.
      if (run.pause > 0) run.pause -= seconds;
      else if (random() < seconds * 0.6) run.pause = 0.15 + random() * 0.5;
      const targetSpeed = run.pause > 0 ? 4 : 50 + run.r * 28;
      run.speed += (targetSpeed - run.speed) * Math.min(1, seconds * 6);
      const moved = run.speed * seconds;
      run.y += moved;
      run.x += Math.sin(run.y * 0.045 + run.wiggle) * 0.25;
      // A running drop gathers up the drops in its path…
      for (let index = drops.length - 1; index >= 0; index--) {
        const drop = drops[index];
        if (Math.abs(drop.x - run.x) < run.r + drop.r && Math.abs(drop.y - run.y) < run.r + drop.r) {
          run.r = Math.min(8, Math.hypot(run.r, drop.r * 0.7));
          drops.splice(index, 1);
        }
      }
      // …and leaves a trail of small ones behind it.
      run.nextTrail -= moved;
      if (run.nextTrail <= 0) {
        run.nextTrail = 7 + random() * 12;
        drops.push({ x: run.x + (random() - 0.5) * 2, y: run.y - run.r * 1.2, r: 0.6 + random() * run.r * 0.22 });
        run.r = Math.max(3, run.r * 0.99);
      }
    }
    runs = runs.filter((run) => run.y - run.r * 2 < height);
  }

  function drawGlass() {
    glassContext.clearRect(0, 0, width, height);
    glassContext.globalAlpha = isNight ? 0.7 : 0.95;
    for (const drop of drops) {
      const size = drop.r * 2.15;
      glassContext.drawImage(sprite, drop.x - size / 2, drop.y - size / 2, size, size);
    }
    // A running drop is stretched a little by its own speed.
    for (const run of runs) {
      const size = run.r * 2.15;
      glassContext.drawImage(sprite, run.x - size / 2, run.y - size * 0.75, size, size * 1.3);
    }
    glassContext.globalAlpha = 1;
  }

  function updateFalling(seconds, now) {
    const drift = shownWeather === 'thunder' ? 0.2 : 0.1;
    for (const streak of rainStreaks) {
      streak.y += streak.speed * seconds;
      streak.x -= streak.speed * drift * seconds;
      if (streak.y > height) {
        streak.y = -streak.length - random() * 60;
        streak.x = random() * (width + 200) - 100;
      }
    }
    for (const flake of snowflakes) {
      flake.y += (22 + flake.radius * 18) * seconds;
      flake.phase += seconds * 0.8;
      flake.x += Math.sin(flake.phase) * 12 * seconds;
      if (flake.y > height + 4) {
        flake.y = -4;
        flake.x = random() * width;
      }
    }
    for (const leaf of leaves) {
      leaf.x += leaf.speed * seconds;
      leaf.phase += seconds * 2.4;
      leaf.y += Math.sin(leaf.phase) * 50 * seconds + 14 * seconds;
      leaf.angle += leaf.spin * seconds;
      if (leaf.x > width + 20 || leaf.y > height) {
        leaf.x = -20 - random() * 200;
        leaf.y = random() * height * 0.85;
      }
    }
    if (look.lightning && !reducedMotion.matches) {
      if (!nextLightning) nextLightning = now + 3000 + random() * 5000;
      if (now >= nextLightning) {
        strikeLightning(now);
        nextLightning = now + 5000 + random() * 8000;
      }
    }
  }

  function strikeLightning(now) {
    // The bolt comes down in one of the strips beside the page, where it shows.
    const onLeft = random() < 0.5;
    let x = onLeft ? width * (0.03 + random() * 0.06) : width * (0.91 + random() * 0.06);
    const points = [[x, 0]];
    for (let y = 0; y < height * 0.78; ) {
      y += 16 + random() * 30;
      x += (random() - 0.5) * 30;
      points.push([x, y]);
    }
    bolt = { points, until: now + 220 };
    const strength = isNight ? 0.8 : 0.45;
    lightning.animate(
      [
        { opacity: 0 },
        { opacity: strength, offset: 0.08 },
        { opacity: strength * 0.15, offset: 0.25 },
        { opacity: strength * 0.65, offset: 0.35 },
        { opacity: 0 },
      ],
      { duration: 900, easing: 'ease-out' },
    );
  }

  function drawFalling(now) {
    fallingContext.clearRect(0, 0, width, height);
    if (rainStreaks.length) {
      const drift = shownWeather === 'thunder' ? 0.2 : 0.1;
      fallingContext.strokeStyle = isNight ? 'rgba(150, 168, 196, 0.32)' : 'rgba(225, 233, 242, 0.42)';
      fallingContext.lineWidth = 1;
      fallingContext.beginPath();
      for (const streak of rainStreaks) {
        fallingContext.moveTo(streak.x, streak.y);
        fallingContext.lineTo(streak.x + streak.length * drift, streak.y - streak.length);
      }
      fallingContext.stroke();
    }
    if (snowflakes.length) {
      fallingContext.fillStyle = isNight ? 'rgba(220, 228, 240, 0.75)' : 'rgba(255, 255, 255, 0.9)';
      fallingContext.beginPath();
      for (const flake of snowflakes) {
        fallingContext.moveTo(flake.x + flake.radius, flake.y);
        fallingContext.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
      }
      fallingContext.fill();
    }
    for (const leaf of leaves) {
      fallingContext.save();
      fallingContext.translate(leaf.x, leaf.y);
      fallingContext.rotate(leaf.angle);
      fallingContext.fillStyle = leaf.color;
      fallingContext.globalAlpha = isNight ? 0.45 : 0.85;
      fallingContext.beginPath();
      fallingContext.ellipse(0, 0, leaf.size, leaf.size * 0.45, 0, 0, Math.PI * 2);
      fallingContext.fill();
      fallingContext.restore();
    }
    if (bolt && now < bolt.until) {
      fallingContext.save();
      fallingContext.strokeStyle = '#f4f7ff';
      fallingContext.shadowColor = '#bcd2ff';
      fallingContext.shadowBlur = 14;
      fallingContext.lineWidth = 2.2;
      fallingContext.beginPath();
      bolt.points.forEach(([x, y], index) => (index ? fallingContext.lineTo(x, y) : fallingContext.moveTo(x, y)));
      fallingContext.stroke();
      fallingContext.restore();
    }
  }

  const hasMotion = () => Boolean(look.rain || look.snow || look.leaves || look.glassDrops);

  function frame(now) {
    frameRequest = requestAnimationFrame(frame);
    if (now - lastFrame < FRAME_MS) return;
    // After a pause (a hidden tab), carry on from where things were.
    const seconds = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    updateFalling(seconds, now);
    if (look.glassDrops) updateGlass(seconds);
    drawFalling(now);
    if (look.glassDrops) drawGlass();
  }

  function startMotion() {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    fallingContext.clearRect(0, 0, width, height);
    glassContext.clearRect(0, 0, width, height);
    if (!hasMotion()) return;
    if (reducedMotion.matches) {
      // A still picture: the rain, snow and drops where they are, not moving.
      drawFalling(0);
      if (look.glassDrops) drawGlass();
      return;
    }
    lastFrame = performance.now();
    frameRequest = requestAnimationFrame(frame);
  }

  function setColors({ date, sun, weather }) {
    const sky = skyColors(sun.height, weather);
    const dark = darkness(sun.height);
    isNight = dark > 0.5;
    const set = (name, value) => container.style.setProperty(name, value);
    set('--sky-top', sky.top);
    set('--sky-middle', sky.middle);
    set('--sky-horizon', sky.horizon);
    set('--star-opacity', (dark * look.sky).toFixed(2));

    // The sun climbs from behind the town to high in the sky at midday; it is
    // orange near the horizon and white-gold when high.
    const sunHeight = sun.isDay ? sun.height : -0.2;
    set('--sun-y', `${(84 - sunHeight * 70).toFixed(1)}%`);
    set('--sun-color', mixColors('#ff8a3d', '#fff1c4', clamp(sunHeight / 0.3)));
    set('--sun-opacity', (sun.isDay ? look.sky * clamp((sunHeight + 0.04) / 0.12) : 0).toFixed(2));

    // At night the moon rises and sets in the strip on the other side.
    const moonHeight = sun.isDay ? 0 : Math.sin(Math.PI * sun.progress);
    set('--moon-y', `${(84 - moonHeight * 62).toFixed(1)}%`);
    set('--moon-opacity', (sun.isDay ? 0 : clamp(dark * 1.4 - 0.25) * look.sky).toFixed(2));
    const litPath = moonLitPath(moonPhase(date), 0, 0, 46);
    for (const shape of container.querySelectorAll('.wv-moon-lit-shape')) shape.setAttribute('d', litPath);

    const heavy = weather === 'rain' || weather === 'thunder';
    const dayCloud = mixColors('#ffffff', sky.horizon, 0.3);
    const nightCloud = mixColors(sky.middle, '#ffffff', 0.1);
    let cloudLight = mixColors(dayCloud, nightCloud, dark);
    if (heavy) cloudLight = mixColors(cloudLight, sky.top, 0.4);
    set('--cloud-light', cloudLight);
    set('--cloud-shade', mixColors(mixColors(cloudLight, sky.top, 0.45), '#000000', 0.15));

    const night = (color, amount = 0.9) => mixColors(color, '#04060b', dark * amount);
    set('--hills', night(mixColors(sky.horizon, '#46525e', 0.5)));
    set('--building-far', night(mixColors('#8796a6', sky.horizon, 0.35)));
    set('--building-near', night(mixColors('#5d6a78', sky.horizon, 0.15), 0.95));
    set('--pane', mixColors(sky.middle, '#ffffff', 0.35));
    set('--pane-opacity', ((1 - dark) * 0.55).toFixed(2));
    set('--lights', (dark * look.lights).toFixed(2));
    set('--bokeh-scale', String(look.bokeh));
    const crowns = SEASON_CROWNS.find((season) => season.months.includes(date.getMonth())).colors;
    crowns.forEach((color, index) => set(`--crown-${index + 1}`, night(color, 0.88)));
    set('--trunk', night('#4a3a2c', 0.88));
    const ground = night('#3d473c');
    set('--ground', weather === 'snow' ? mixColors(ground, night('#e6ecf2', 0.75), 0.75) : ground);
    set('--haze', mixColors(sky.horizon, sky.middle, 0.4));
    set('--haze-opacity', look.haze.toFixed(2));
    set('--frame', mixColors('#2f3338', '#0b0d11', dark));
    set('--room-glow', (dark * 0.16).toFixed(3));
  }

  window.addEventListener('resize', () => {
    if (container.hidden) return;
    resize();
    makeFalling();
    startMotion();
  });
  reducedMotion.addEventListener('change', () => {
    if (!container.hidden) startMotion();
  });

  return {
    show(state) {
      const wasHidden = container.hidden;
      container.hidden = false;
      if (wasHidden) resize();
      if (state.weather !== shownWeather) {
        shownWeather = state.weather;
        look = WEATHER_LOOKS[shownWeather] ?? WEATHER_LOOKS.clear;
        container.dataset.weather = shownWeather;
        nextLightning = 0;
        makeClouds();
        makeFalling();
        setColors(state);
        startMotion();
      } else {
        setColors(state);
        if (wasHidden) startMotion();
      }
    },
    hide() {
      container.hidden = true;
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    },
  };
}

// Each theme's logo, shown on its card in the Theme panel so the themes are
// easy to tell apart: a lamp, a coffee cup, a plant… Each is a little SVG
// drawing, 100 wide and 120 tall, standing on its bottom edge.

function flower(x, y, radius, petal, center) {
  const petals = [0, 72, 144, 216, 288]
    .map((angle) => {
      const radians = (angle * Math.PI) / 180;
      const petalX = x + Math.sin(radians) * radius;
      const petalY = y - Math.cos(radians) * radius;
      return `<circle cx="${petalX.toFixed(1)}" cy="${petalY.toFixed(1)}" r="${radius}" fill="${petal}"/>`;
    })
    .join('');
  return `${petals}<circle cx="${x}" cy="${y}" r="${radius * 0.6}" fill="${center}"/>`;
}

function sunflowerHead(petal, center) {
  const petals = Array.from(
    { length: 12 },
    (_, index) => `<ellipse cx="0" cy="-14" rx="4.5" ry="10" fill="${petal}" transform="rotate(${index * 30})"/>`,
  ).join('');
  return `<g transform="translate(50 36)">${petals}<circle r="9" fill="${center}"/></g>`;
}

const DRAWINGS = {
  // A green banker's lamp.
  lamp: (c) => `
    <ellipse cx="50" cy="74" rx="42" ry="16" fill="#ffe6a6" opacity="0.3"/>
    <rect x="22" y="104" width="56" height="12" rx="5" fill="${c.brass}"/>
    <rect x="47" y="62" width="6" height="44" fill="${c.brassDeep}"/>
    <line x1="72" y1="67" x2="72" y2="84" stroke="${c.brassDeep}" stroke-width="1.5"/>
    <circle cx="72" cy="86" r="2.5" fill="${c.brass}"/>
    <path d="M10 66 Q12 36 50 34 Q88 36 90 66 Z" fill="#1f6b44"/>
    <path d="M20 58 Q24 42 50 40" stroke="#6fbf8e" stroke-width="3" fill="none" opacity="0.5"/>
    <rect x="8" y="63" width="84" height="5" rx="2.5" fill="${c.brass}"/>`,

  // A succulent in a white pot.
  plant: () => `
    <g>
      <ellipse cx="50" cy="56" rx="9" ry="24" fill="#4b8e78"/>
      <ellipse cx="36" cy="64" rx="8" ry="20" fill="#5fa98f" transform="rotate(-35 36 64)"/>
      <ellipse cx="64" cy="64" rx="8" ry="20" fill="#5fa98f" transform="rotate(35 64 64)"/>
      <ellipse cx="27" cy="76" rx="7" ry="15" fill="#7cc2a7" transform="rotate(-65 27 76)"/>
      <ellipse cx="73" cy="76" rx="7" ry="15" fill="#7cc2a7" transform="rotate(65 73 76)"/>
    </g>
    <path d="M26 84 H74 L68 116 H32 Z" fill="#f3efe4"/>
    <rect x="24" y="82" width="52" height="8" rx="2" fill="#dcd5c3"/>`,

  // A crescent-moon night light and a star.
  moon: (c, uid) => `
    <defs><mask id="logoMoonCut${uid}"><rect width="100" height="120" fill="white"/><circle cx="64" cy="38" r="25" fill="black"/></mask></defs>
    <circle cx="50" cy="48" r="38" fill="#f3e7b8" opacity="0.12"/>
    <circle cx="50" cy="48" r="30" fill="#f3e7b8" mask="url(#logoMoonCut${uid})"/>
    <g><path d="M80 18 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" fill="#f3e7b8"/></g>
    <rect x="47" y="78" width="6" height="30" fill="${c.brassDeep}"/>
    <ellipse cx="50" cy="111" rx="22" ry="5" fill="${c.brass}"/>`,

  // A red rose in a glass bud vase.
  rose: () => `
    <g>
      <path d="M50 96 C50 74 50 54 50 38" stroke="#3f7a3a" stroke-width="3" fill="none"/>
      <path d="M50 70 C40 62 33 64 28 69 C37 74 44 74 50 70 Z" fill="#4f8f45"/>
      <path d="M50 60 C60 52 67 54 72 59 C63 64 56 64 50 60 Z" fill="#4f8f45"/>
      <circle cx="50" cy="30" r="13" fill="#b3261e"/>
      <path d="M41 29 Q50 17 59 29 Q50 36 41 29 Z" fill="#d8554a"/>
      <circle cx="50" cy="28" r="4" fill="#8f1d16"/>
    </g>
    <path d="M42 90 Q36 104 43 116 H57 Q64 104 58 90 Z" fill="#d6e8ee" opacity="0.75"/>`,

  // A sunflower in a clay pot.
  sunflower: () => `
    <g>
      <path d="M50 100 V46" stroke="#4f7d2f" stroke-width="4"/>
      <path d="M50 82 C40 74 32 76 27 81 C36 87 44 87 50 82 Z" fill="#5f9236"/>
      ${sunflowerHead('#f2c230', '#6b4220')}
    </g>
    <path d="M32 96 H68 L64 116 H36 Z" fill="#b5643c"/>
    <rect x="30" y="93" width="40" height="7" rx="2" fill="#9c5332"/>`,

  // A paper plane.
  plane: () => `
    <path d="M6 104 q14 -10 28 0 t28 0 t28 0" stroke="#dbe9f5" stroke-width="2" stroke-dasharray="3 6" fill="none" opacity="0.7"/>
    <g>
      <path d="M8 66 L94 36 L58 84 Z" fill="#ffffff"/>
      <path d="M94 36 L46 68 L58 84 Z" fill="#dbe7f2"/>
      <path d="M46 68 L50 88 L58 84 Z" fill="#b9cde0"/>
    </g>`,

  // A cherry-blossom branch in a small vase.
  blossom: () => `
    <g>
      <path d="M50 92 C48 72 40 58 26 42 M47 72 C56 62 66 54 80 48 M44 62 C40 50 42 36 48 20"
        stroke="#6b4a3a" stroke-width="3" fill="none" stroke-linecap="round"/>
      ${flower(26, 40, 5, '#f6b7c8', '#e0708c')}
      ${flower(48, 20, 5, '#f9cbd7', '#e0708c')}
      ${flower(80, 47, 4.5, '#f6b7c8', '#e0708c')}
      ${flower(62, 56, 4, '#f9cbd7', '#e0708c')}
      ${flower(38, 52, 3.5, '#f9cbd7', '#e0708c')}
    </g>
    <path d="M40 116 Q35 100 42 90 H58 Q65 100 60 116 Z" fill="#f5f0ea"/>`,

  // Lavender sprigs in a jar.
  lavender: (c) => {
    const sprig = (x, y, angle) => `
      <g transform="rotate(${angle} 50 82)">
        <line x1="50" y1="82" x2="${x}" y2="${y}" stroke="#6b8f5a" stroke-width="2"/>
        ${[0, 6, 12, 18]
          .map(
            (offset) =>
              `<ellipse cx="${x}" cy="${y + offset}" rx="3.2" ry="4.2" fill="${offset % 12 === 0 ? '#8e7cc3' : '#a796d8'}"/>`,
          )
          .join('')}
      </g>`;
    return `
      <g>
        ${sprig(50, 14, 0)}${sprig(50, 20, -16)}${sprig(50, 22, 15)}${sprig(50, 30, -30)}${sprig(50, 30, 28)}
      </g>
      <path d="M34 80 H66 V110 Q66 116 60 116 H40 Q34 116 34 110 Z" fill="#dfe8ef" opacity="0.8"/>
      <rect x="32" y="76" width="36" height="6" rx="2" fill="${c.brass}"/>`;
  },

  // A steaming cup of coffee.
  coffee: () => `
    <g><path d="M40 56 q-7 -10 0 -20 t0 -20" stroke="#efe3d3" stroke-width="3" fill="none" stroke-linecap="round"/></g>
    <g><path d="M52 56 q-7 -10 0 -20 t0 -20" stroke="#efe3d3" stroke-width="3" fill="none" stroke-linecap="round"/></g>
    <g><path d="M64 56 q-7 -10 0 -20 t0 -20" stroke="#efe3d3" stroke-width="3" fill="none" stroke-linecap="round"/></g>
    <ellipse cx="50" cy="112" rx="42" ry="6" fill="#e8dccb"/>
    <path d="M78 74 q16 0 14 12 q-2 10 -16 10" stroke="#f6efe3" stroke-width="6" fill="none"/>
    <path d="M20 64 H80 Q78 102 61 108 H39 Q22 102 20 64 Z" fill="#f6efe3"/>
    <ellipse cx="50" cy="64" rx="30" ry="5" fill="#5a3b28"/>`,

  // A stack of old books with a ribbon bookmark.
  books: (c) => `
    <rect x="12" y="98" width="76" height="18" rx="2" fill="#7a3b2a"/>
    <rect x="80" y="100" width="6" height="14" fill="#f2e6c9"/>
    <rect x="22" y="105" width="40" height="2" fill="${c.brass}"/>
    <rect x="20" y="80" width="64" height="18" rx="2" fill="#2f4a5a"/>
    <rect x="76" y="82" width="6" height="14" fill="#f2e6c9"/>
    <rect x="28" y="87" width="34" height="2" fill="${c.brass}"/>
    <rect x="16" y="62" width="68" height="18" rx="2" fill="#8a6e4b"/>
    <rect x="76" y="64" width="6" height="14" fill="#f2e6c9"/>
    <rect x="24" y="69" width="38" height="2" fill="${c.brass}"/>
    <g>
      <path d="M58 62 V48 L62 52 L66 48 V62 Z" fill="#9a2f25"/>
    </g>`,

  // A metronome.
  metronome: (c) => `
    <path d="M32 114 L42 20 H58 L68 114 Z" fill="#2b2b2b"/>
    <path d="M38 112 L45 38 H55 L62 112 Z" fill="#3c3c3c"/>
    <g>
      <line x1="50" y1="100" x2="50" y2="26" stroke="#d9d9d4" stroke-width="2"/>
      <rect x="45" y="44" width="10" height="8" rx="1" fill="${c.brass}"/>
    </g>
    <circle cx="50" cy="100" r="3" fill="#d9d9d4"/>
    <rect x="28" y="110" width="44" height="6" rx="1" fill="#1a1a1a"/>`,

  // An ink bottle with a quill.
  inkwell: (c) => `
    <g>
      <path d="M52 72 L76 8" stroke="${c.onBgAccent}" stroke-width="1.5"/>
      <path d="M76 8 C60 16 55 40 54 62 C63 44 71 30 76 8 Z" fill="#fbfaf7" stroke="#bdbab3"/>
    </g>
    <rect x="40" y="70" width="20" height="12" rx="2" fill="#2e2e2e"/>
    <path d="M30 80 H70 V108 Q70 116 62 116 H38 Q30 116 30 108 Z" fill="#1d1d1d"/>
    <rect x="37" y="90" width="26" height="12" fill="#f4f2ed"/>
    <rect x="41" y="95" width="18" height="2" fill="#1d1d1d"/>`,

  // A camping lantern.
  lantern: () => `
    <circle cx="50" cy="68" r="38" fill="#e6f59a" opacity="0.16"/>
    <path d="M38 30 Q50 10 62 30" stroke="#2f2f2f" stroke-width="3" fill="none"/>
    <rect x="32" y="30" width="36" height="9" rx="2" fill="#33503b"/>
    <rect x="35" y="39" width="30" height="54" rx="3" fill="#f6e7a8" opacity="0.85"/>
    <g>
      <path d="M50 54 C57 65 57 76 50 82 C43 76 43 65 50 54 Z" fill="#f7b733"/>
      <path d="M50 64 C53 70 53 76 50 80 C47 76 47 70 50 64 Z" fill="#fff3b0"/>
    </g>
    <path d="M35 39 V93 M65 39 V93" stroke="#33503b" stroke-width="2.5"/>
    <rect x="30" y="93" width="40" height="12" rx="2" fill="#33503b"/>
    <rect x="34" y="105" width="32" height="11" rx="2" fill="#22382a"/>`,

  // A potted cactus with a little flower.
  cactus: () => `
    <rect x="40" y="30" width="20" height="68" rx="10" fill="#5f8f4e"/>
    <path d="M40 66 H31 Q24 66 24 59 V46 Q24 41 28 41 Q32 41 32 46 V58 H40 Z" fill="#5f8f4e"/>
    <path d="M60 58 H69 V40 Q69 35 73 35 Q77 35 77 40 V59 Q77 66 70 66 H60 Z" fill="#6f9f5c"/>
    <path d="M47 36 V94 M53 36 V94" stroke="#7fae6a" stroke-width="1.5" opacity="0.6"/>
    <g class="logo-flower">${flower(50, 28, 3.5, '#f28fa0', '#f7d36b')}</g>
    <path d="M30 98 H70 L66 116 H34 Z" fill="#c06b4a"/>
    <rect x="28" y="94" width="44" height="8" rx="2" fill="#a85a3c"/>`,

  // A scallop shell and a pearl.
  shell: () => `
    <path d="M50 108 L16 56 Q50 16 84 56 Z" fill="#f4e1d2"/>
    <path d="M50 108 L22 54 M50 108 L31 42 M50 108 L41 34 M50 108 L50 32 M50 108 L59 34 M50 108 L69 42 M50 108 L78 54"
      stroke="#e2c3ad" stroke-width="2"/>
    <path d="M40 106 H60 L56 116 H44 Z" fill="#e8cbb5"/>
    <g>
      <circle cx="80" cy="106" r="7" fill="#f7f5ee"/>
      <circle cx="77.5" cy="103.5" r="2.2" fill="#ffffff"/>
    </g>`,

  // A tall window at dusk, with the moon over the town.
  window: (c, uid) => `
    <defs>
      <linearGradient id="logoWindowSky${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1b2850"/>
        <stop offset="0.65" stop-color="#5b4f86"/>
        <stop offset="1" stop-color="#ee9462"/>
      </linearGradient>
    </defs>
    <rect x="18" y="8" width="64" height="104" rx="3" fill="url(#logoWindowSky${uid})"/>
    <path d="M64 19 A11 11 0 1 0 75 36 A9 9 0 1 1 64 19 Z" fill="#f6efd6"/>
    <path d="M18 112 V92 H27 V84 H35 V96 H44 V78 H53 V98 H62 V88 H70 V100 H82 V112 Z" fill="#161b2c"/>
    <rect x="18" y="8" width="64" height="104" rx="3" fill="none" stroke="#d3d7de" stroke-width="5"/>
    <path d="M50 8 V112 M18 50 H82" stroke="#d3d7de" stroke-width="4"/>`,

  // A tall window by day, with a map pin: the weather where you are.
  'window-here': (c, uid) => `
    <defs>
      <linearGradient id="logoWindowDay${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3a7cc4"/>
        <stop offset="1" stop-color="#bfdcf2"/>
      </linearGradient>
    </defs>
    <rect x="18" y="8" width="64" height="104" rx="3" fill="url(#logoWindowDay${uid})"/>
    <circle cx="66" cy="27" r="8" fill="#fff4cf"/>
    <path d="M18 112 V96 H30 V88 H40 V100 H52 V84 H62 V98 H72 V92 H82 V112 Z" fill="#6f7f8f"/>
    <rect x="18" y="8" width="64" height="104" rx="3" fill="none" stroke="#d3d7de" stroke-width="5"/>
    <path d="M50 8 V112 M18 50 H82" stroke="#d3d7de" stroke-width="4"/>
    <path d="M34 92 C22 76 20 70 20 64 A14 14 0 0 1 48 64 C48 70 46 76 34 92 Z" fill="#c8402f" stroke="#fff" stroke-width="2.5"/>
    <circle cx="34" cy="64" r="5" fill="#fff"/>`,

  // A lava lamp.
  'lava-lamp': (c, uid) => `
    <defs><clipPath id="logoLavaGlass${uid}"><path d="M40 22 H60 L72 92 H28 Z"/></clipPath></defs>
    <path d="M40 22 H60 L72 92 H28 Z" fill="#f6c27a" opacity="0.45"/>
    <g clip-path="url(#logoLavaGlass${uid})">
      <g><ellipse cx="46" cy="72" rx="9" ry="11" fill="#e8572a"/></g>
      <g><ellipse cx="56" cy="52" rx="7" ry="9" fill="#d9772b"/></g>
      <g><ellipse cx="50" cy="88" rx="13" ry="6" fill="#e8572a"/></g>
    </g>
    <path d="M37 10 H63 L60 22 H40 Z" fill="#3a2a1c"/>
    <path d="M28 92 H72 L80 116 H20 Z" fill="#3a2a1c"/>`,
};

export const LOGO_NAMES = Object.keys(DRAWINGS);

// Masks and clip paths need ids unique on the page, and a logo can appear
// more than once (on the Theme button and on its card).
let drawnCount = 0;

// The SVG for a theme's logo, in the theme's colors.
export function logoSvg(theme) {
  const draw = DRAWINGS[theme.logo];
  drawnCount++;
  return draw
    ? `<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg" focusable="false">${draw(theme.colors, drawnCount)}</svg>`
    : '';
}

// A small fish, for the Ocean teal theme's corner of the Theme panel. It faces
// left; its tail wags on its own.
const FISH = `
  <svg viewBox="0 0 80 40" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <defs>
      <linearGradient id="cornerFishBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffb46b"/>
        <stop offset="1" stop-color="#e2683a"/>
      </linearGradient>
    </defs>
    <path class="fish-tail" d="M58 20 L76 9 Q71 20 76 31 Z" fill="#d45a32"/>
    <path d="M27 11 Q35 2 46 9 L42 13 Z" fill="#d45a32"/>
    <path d="M8 20 C16 7 40 5 54 13 Q60 16 62 20 Q60 24 54 27 C40 35 16 33 8 20 Z" fill="url(#cornerFishBody)"/>
    <path d="M24 12 Q20 20 24 28" stroke="#f7ede2" stroke-width="2.4" fill="none" opacity="0.85"/>
    <path d="M38 10 Q34 20 38 30" stroke="#f7ede2" stroke-width="2.4" fill="none" opacity="0.6"/>
    <path d="M30 26 Q36 32 40 27" fill="#d45a32"/>
    <circle cx="15" cy="18" r="2.4" fill="#1d2b33"/>
    <circle cx="14.3" cy="17.3" r="0.8" fill="#ffffff"/>
  </svg>
  <span class="fish-bubble"></span>
  <span class="fish-bubble fish-bubble-late"></span>`;

// Logos that bob gently rather than rock from their base.
const FLOATING_LOGOS = ['lamp', 'moon', 'plane', 'coffee', 'books', 'inkwell', 'lantern', 'shell', 'lava-lamp', 'window', 'window-here'];

// The small moving thing in the Theme panel's bottom-right corner: a fish
// swimming for Ocean teal, the cactus's flower swaying for Terracotta, and
// otherwise the theme's own logo, rocking or bobbing. motion names the CSS
// animation in styles.css.
export function cornerCompanion(theme) {
  if (theme.id === 'ocean') return { motion: 'swim', markup: FISH };
  if (theme.logo === 'cactus') return { motion: 'flower', markup: logoSvg(theme) };
  return { motion: FLOATING_LOGOS.includes(theme.logo) ? 'float' : 'sway', markup: logoSvg(theme) };
}

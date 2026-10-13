// The typewriter: live text that appears one character at a time, and the
// machine drawn below the paper, whose typebars and keys move as characters
// are typed. Animation only; it makes no sound, since it runs in lectures.

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ---------- Typed text ----------

// A normal typing pace; when far behind the speech, typing speeds up to catch up.
const BASE_CHARACTERS_PER_SECOND = 40;
const CATCH_UP_PER_WAITING_CHARACTER = 1.2;

function commonPrefixLength(a, b) {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length++;
  return length;
}

// Shows text in element as if typed. set() changes the text to type toward;
// when the recognizer rewrites earlier words, typing restarts from where the
// old and new text differ. onCharacterTyped(character) runs for each character.
export function createTypedText(element, { onCharacterTyped = () => {} } = {}) {
  let shown = '';
  let target = '';
  let frameId = null;
  let lastFrameTime = 0;
  let characterBudget = 0;

  function render() {
    element.textContent = shown;
  }

  function typeNextCharacters(now) {
    const elapsedSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
    lastFrameTime = now;
    const waiting = target.length - shown.length;
    characterBudget += elapsedSeconds * (BASE_CHARACTERS_PER_SECOND + waiting * CATCH_UP_PER_WAITING_CHARACTER);
    const typed = [];
    while (characterBudget >= 1 && shown.length < target.length) {
      const character = target[shown.length];
      shown += character;
      typed.push(character);
      characterBudget -= 1;
    }
    // Render first, so a typebar striking this character aims at where it now is.
    render();
    for (const character of typed) onCharacterTyped(character);
    frameId = shown.length < target.length ? requestAnimationFrame(typeNextCharacters) : null;
  }

  return {
    get text() {
      return target;
    },
    set(text) {
      target = text;
      if (prefersReducedMotion.matches) {
        shown = text;
        render();
        return;
      }
      if (!target.startsWith(shown)) {
        shown = shown.slice(0, commonPrefixLength(shown, target));
        render();
      }
      if (frameId === null && shown.length < target.length) {
        lastFrameTime = performance.now();
        characterBudget = 0;
        frameId = requestAnimationFrame(typeNextCharacters);
      }
    },
    clear() {
      cancelAnimationFrame(frameId);
      frameId = null;
      shown = '';
      target = '';
      render();
    },
  };
}

// ---------- The machine ----------

// Each typebar carries one character, in keyboard order, like a real basket.
const TYPEBAR_CHARACTERS = "qwertyuiopasdfghjklzxcvbnm.,'-";
const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
// Where all typebars strike: just under the platen, in the middle (SVG units).
const STRIKE_POINT = { x: 500, y: 52 };
const BASKET_RADIUS = 175;
const TYPEBAR_REST_LENGTH = 105;
// Never start more than one strike in this time, so fast catch-up typing stays calm.
const MIN_MS_BETWEEN_STRIKES = 55;
// A strike: the typebar flies out to the paper, hits at IMPACT_AT of the way through, and falls back.
const STRIKE_MS = 200;
const IMPACT_AT = 0.42;
// Easing is set per keyframe, so the hit happens exactly at IMPACT_AT: the bar
// speeds up into the paper and slows down on its way back.
const FLY_OUT = 'cubic-bezier(0.55, 0, 1, 0.6)';
const FALL_BACK = 'cubic-bezier(0, 0.4, 0.4, 1)';

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function buildTypebars(container) {
  const typebars = [];
  const count = TYPEBAR_CHARACTERS.length;
  for (let i = 0; i < count; i++) {
    // A fan below the strike point, from lower left to lower right.
    const angle = ((20 + (140 * i) / (count - 1)) * Math.PI) / 180;
    const pivot = { x: STRIKE_POINT.x - BASKET_RADIUS * Math.cos(angle), y: STRIKE_POINT.y + BASKET_RADIUS * Math.sin(angle) };
    const toStrike = { x: STRIKE_POINT.x - pivot.x, y: STRIKE_POINT.y - pivot.y };
    const distance = Math.hypot(toStrike.x, toStrike.y);
    const tip = {
      x: pivot.x + (toStrike.x / distance) * TYPEBAR_REST_LENGTH,
      y: pivot.y + (toStrike.y / distance) * TYPEBAR_REST_LENGTH,
    };
    const typebar = svgElement('g', { class: 'typebar' });
    typebar.append(
      svgElement('line', { x1: pivot.x, y1: pivot.y, x2: tip.x, y2: tip.y, class: 'typebar-arm' }),
      svgElement('circle', { cx: tip.x, cy: tip.y, r: 4.5, class: 'typebar-slug' }),
    );
    typebar.style.transformOrigin = `${pivot.x}px ${pivot.y}px`;
    container.appendChild(typebar);
    // Striking stretches the bar from its pivot until its slug reaches the strike point.
    typebars.push({ element: typebar, pivot, reach: distance / TYPEBAR_REST_LENGTH });
  }
  return typebars;
}

function buildKeys(container) {
  const keys = new Map();
  KEY_ROWS.forEach((letters, rowIndex) => {
    const y = 270 + rowIndex * 25;
    const startX = 500 - ((letters.length - 1) * 36) / 2 + rowIndex * 9;
    [...letters].forEach((letter, index) => {
      const key = svgElement('g', { class: 'key' });
      const x = startX + index * 36;
      key.append(
        svgElement('circle', { cx: x, cy: y, r: 12, class: 'key-cap' }),
        Object.assign(svgElement('text', { x, y: y + 4, class: 'key-letter' }), { textContent: letter }),
      );
      container.appendChild(key);
      keys.set(letter.toLowerCase(), key);
    });
  });
  const spaceBar = svgElement('rect', { x: 380, y: 337, width: 240, height: 8, rx: 4, class: 'key-cap space-bar' });
  container.appendChild(spaceBar);
  keys.set(' ', spaceBar);
  return keys;
}

// A transparent layer over the whole window, where a striking typebar is drawn
// all the way from the machine to the paper.
function createStrikeLayer() {
  const layer = svgElement('svg', { class: 'strike-layer', 'aria-hidden': 'true' });
  document.body.appendChild(layer);
  return layer;
}

// svg is the machine's <svg>, which contains #typebars, #keys, #platenRidges and #bell groups.
// getStrikePoint() returns where the next character lands on the paper, in window
// coordinates ({ x, y }), or null; onImpact() runs when a typebar hits the paper.
export function createTypewriterMachine(svg, { getStrikePoint = () => null, onImpact = () => {} } = {}) {
  const typebars = buildTypebars(svg.querySelector('#typebars'));
  const strikeLayer = createStrikeLayer();
  const keys = buildKeys(svg.querySelector('#keys'));
  const platenRidges = svg.querySelector('#platenRidges');
  const bell = svg.querySelector('#bell');
  let lastStrikeTime = 0;

  function pressKey(character) {
    const key = keys.get(character.toLowerCase());
    if (!key) return;
    key.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(2.5px)', offset: 0.3 }, { transform: 'translateY(0)' }], {
      duration: 140,
      easing: 'ease-out',
    });
    key.classList.add('pressed');
    setTimeout(() => key.classList.remove('pressed'), 140);
  }

  function typebarFor(character) {
    const lower = character.toLowerCase();
    const index = TYPEBAR_CHARACTERS.indexOf(lower);
    // Other characters (digits, accents, …) borrow a typebar.
    return typebars[index === -1 ? lower.codePointAt(0) % typebars.length : index];
  }

  // The machine's coordinates, converted to window coordinates.
  function toWindow(point) {
    const matrix = svg.getScreenCTM();
    return {
      x: matrix.a * point.x + matrix.c * point.y + matrix.e,
      y: matrix.b * point.x + matrix.d * point.y + matrix.f,
      scale: matrix.a,
    };
  }

  // The typebar leaves the basket, flies to the paper, hits, and falls back.
  function strikePaper(typebar, target) {
    const pivot = toWindow(typebar.pivot);
    const length = Math.hypot(target.x - pivot.x, target.y - pivot.y);
    const arm = svgElement('line', { x1: pivot.x, y1: pivot.y, x2: target.x, y2: target.y, class: 'strike-arm' });
    arm.style.strokeWidth = `${3.5 * pivot.scale}px`;
    arm.style.strokeDasharray = `${length}`;
    const slug = svgElement('rect', {
      x: target.x - 5 * pivot.scale,
      y: target.y - 3.5 * pivot.scale,
      width: 10 * pivot.scale,
      height: 7 * pivot.scale,
      rx: 1.5 * pivot.scale,
      class: 'strike-slug',
    });
    strikeLayer.append(arm, slug);

    const timing = { duration: STRIKE_MS };
    const atRest = `translate(${pivot.x - target.x}px, ${pivot.y - target.y}px)`;
    arm.animate(
      [
        { strokeDashoffset: length, easing: FLY_OUT },
        { strokeDashoffset: 0, offset: IMPACT_AT, easing: FALL_BACK },
        { strokeDashoffset: length },
      ],
      timing,
    );
    slug
      .animate(
        [
          { transform: atRest, easing: FLY_OUT },
          { transform: 'translate(0, 0)', offset: IMPACT_AT, easing: FALL_BACK },
          { transform: atRest },
        ],
        timing,
      )
      .finished.finally(() => {
        arm.remove();
        slug.remove();
      });
    typebar.element.animate([{ opacity: 1 }, { opacity: 0, offset: 0.08 }, { opacity: 0, offset: 0.92 }, { opacity: 1 }], timing);
    setTimeout(() => {
      showInkMark(target, pivot.scale);
      onImpact();
    }, STRIKE_MS * IMPACT_AT);
  }

  // A small mark where the type hits the paper, fading out.
  function showInkMark(target, scale) {
    const mark = svgElement('circle', { cx: target.x, cy: target.y, r: 4 * scale, class: 'ink-mark' });
    strikeLayer.appendChild(mark);
    mark
      .animate([{ opacity: 0.55, transform: 'scale(0.6)' }, { opacity: 0, transform: 'scale(1.6)' }], { duration: 260, easing: 'ease-out' })
      .finished.finally(() => mark.remove());
  }

  // When the paper is out of view, the typebar only swings inside the machine.
  function swingInBasket(typebar) {
    typebar.element.animate(
      [
        { transform: 'scale(1)', easing: FLY_OUT },
        { transform: `scale(${typebar.reach})`, offset: IMPACT_AT, easing: FALL_BACK },
        { transform: 'scale(1)' },
      ],
      { duration: 170 },
    );
  }

  function isOnScreen(point) {
    return point && point.y >= 0 && point.y <= window.innerHeight && point.x >= 0 && point.x <= window.innerWidth;
  }

  function swingTypebar(character) {
    const typebar = typebarFor(character);
    const target = getStrikePoint();
    if (isOnScreen(target)) {
      strikePaper(typebar, target);
    } else {
      swingInBasket(typebar);
    }
  }

  return {
    strike(character) {
      if (prefersReducedMotion.matches) return;
      const now = performance.now();
      if (now - lastStrikeTime < MIN_MS_BETWEEN_STRIKES) return;
      lastStrikeTime = now;
      pressKey(character);
      if (character.trim()) swingTypebar(character);
    },
    // A finished sentence: the platen turns to feed the paper up, and the bell rings.
    lineFeed() {
      if (prefersReducedMotion.matches) return;
      platenRidges.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }], {
        duration: 450,
        easing: 'cubic-bezier(0.25, 0.8, 0.35, 1)',
      });
      bell.animate([{ opacity: 0.25 }, { opacity: 1, offset: 0.15 }, { opacity: 0.25 }], { duration: 600 });
    },
  };
}

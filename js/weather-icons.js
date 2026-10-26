// Small line icons for the weather buttons (24 × 24, drawn in the text color).

const CLOUD = 'M7.5 18.5h9.25a3.75 3.75 0 0 0 .4-7.48A5.5 5.5 0 0 0 6.6 10.2a4.15 4.15 0 0 0 .9 8.3z';
const SMALL_CLOUD = 'M7.5 14.5h9.25a3.25 3.25 0 0 0 .35-6.48A5 5 0 0 0 7.1 7.4a3.6 3.6 0 0 0 .4 7.1z';

const ICONS = {
  sun: `<circle cx="12" cy="12" r="4.2"/>
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.55 1.55M17.15 17.15l1.55 1.55M5.3 18.7l1.55-1.55M17.15 6.85l1.55-1.55"/>`,
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>',
  cloudy: `<path d="${CLOUD}"/>`,
  windy: '<path d="M3 9h11.5a2.75 2.75 0 1 0-2.75-2.75M3 13h15.5a2.75 2.75 0 1 1-2.75 2.75M3 17h7"/>',
  rain: `<path d="${SMALL_CLOUD}"/><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>`,
  thunder: `<path d="${SMALL_CLOUD}"/><path d="M12.8 15.5l-2.3 3.5h3l-2.3 3.5"/>`,
  snow: `<path d="${SMALL_CLOUD}"/><path d="M8.5 18.2v3M7 19.7h3M15.5 18.2v3M14 19.7h3M12 19v3M10.5 20.5h3"/>`,
  fog: `<path d="${SMALL_CLOUD}"/><path d="M4 17.5h16M6 21h12"/>`,
};

// The icon for a weather; clear weather shows the moon at night.
export function weatherIconSvg(weather, isNight) {
  const name = weather === 'clear' ? (isNight ? 'moon' : 'sun') : weather;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

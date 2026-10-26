// The sky outside the window in the window-view themes (drawn by
// js/window-view.js): how high the sun is, the sky's colors, and the moon's
// phase at a given time. Pure functions, so tests/sky.test.js can check them.

// The weather that can be chosen, in the order of the weather buttons.
export const WEATHERS = ['clear', 'cloudy', 'windy', 'rain', 'thunder', 'snow', 'fog'];

export const WEATHER_NAMES = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  windy: 'Windy',
  rain: 'Rain',
  thunder: 'Thunderstorm',
  snow: 'Snow',
  fog: 'Fog',
};

const MINUTES_PER_DAY = 24 * 60;

export function minutesAfterMidnight(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function dayOfYear(date) {
  return Math.floor((date - new Date(date.getFullYear(), 0, 1)) / 86_400_000) + 1;
}

// Rough sunrise and sunset, in minutes after local midnight, for when only the
// date is known: daylight as at about 40° north (like Champaign), about 15
// hours in late June and 9 in late December, centered on 12:30.
export function estimatedSunTimes(date) {
  const daylightHours = 12 + 3 * Math.cos((2 * Math.PI * (dayOfYear(date) - 172)) / 365);
  const solarNoon = 12.5 * 60;
  return { sunrise: solarNoon - daylightHours * 30, sunset: solarNoon + daylightHours * 30 };
}

// How far through the day (sunrise 0 → sunset 1) or the night (sunset 0 →
// sunrise 1) it is, and how high the sun is: 1 at midday, 0 at sunrise and
// sunset, and -1 in the middle of the night.
export function sunPosition(minutes, { sunrise, sunset }) {
  if (minutes >= sunrise && minutes <= sunset) {
    const progress = (minutes - sunrise) / (sunset - sunrise);
    return { isDay: true, progress, height: Math.sin(Math.PI * progress) };
  }
  const nightLength = MINUTES_PER_DAY - (sunset - sunrise);
  const progress = ((minutes - sunset + MINUTES_PER_DAY) % MINUTES_PER_DAY) / nightLength;
  return { isDay: false, progress, height: -Math.sin(Math.PI * progress) };
}

function hexToRgb(hex) {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
}

export function mixColors(from, to, amount) {
  const [a, b] = [hexToRgb(from), hexToRgb(to)];
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

// The clear sky's colors (top, middle, near the horizon) as the sun rises,
// from deep night to midday. Colors between two of these are blended.
const CLEAR_SKY = [
  { height: -0.35, top: '#050918', middle: '#0b1330', horizon: '#18223f' },
  { height: -0.12, top: '#0f1638', middle: '#272a5c', horizon: '#5a4272' },
  { height: -0.02, top: '#243068', middle: '#6a5488', horizon: '#ea8459' },
  { height: 0.06, top: '#45649f', middle: '#c9928c', horizon: '#ffbb78' },
  { height: 0.25, top: '#3c7cc2', middle: '#8bbbe2', horizon: '#e4edf0' },
  { height: 0.6, top: '#2c74c6', middle: '#7cb3e4', horizon: '#cde4f2' },
];

// Clouds, rain, snow and fog grey the sky: how much, toward which grey by day
// and by night.
const WEATHER_GREY = {
  clear: { amount: 0, day: '#9aa3ad', night: '#141820' },
  windy: { amount: 0.12, day: '#9aa3ad', night: '#141820' },
  cloudy: { amount: 0.6, day: '#9aa3ad', night: '#161a22' },
  rain: { amount: 0.66, day: '#7c858f', night: '#11141b' },
  thunder: { amount: 0.78, day: '#4d545e', night: '#0b0d12' },
  snow: { amount: 0.8, day: '#cdd2d8', night: '#1d222b' },
  fog: { amount: 0.75, day: '#c0c5ca', night: '#252a31' },
};

// The sky's top, middle and horizon colors for a sun height and weather.
export function skyColors(height, weather) {
  const after = CLEAR_SKY.findIndex((stop) => stop.height >= height);
  let clear;
  if (after === 0) clear = CLEAR_SKY[0];
  else if (after === -1) clear = CLEAR_SKY[CLEAR_SKY.length - 1];
  else {
    const [low, high] = [CLEAR_SKY[after - 1], CLEAR_SKY[after]];
    const amount = (height - low.height) / (high.height - low.height);
    clear = Object.fromEntries(['top', 'middle', 'horizon'].map((part) => [part, mixColors(low[part], high[part], amount)]));
  }
  const grey = WEATHER_GREY[weather] ?? WEATHER_GREY.clear;
  const daylight = Math.min(1, Math.max(0, (height + 0.15) / 0.4));
  const greyColor = mixColors(grey.night, grey.day, daylight);
  return {
    top: mixColors(clear.top, greyColor, grey.amount),
    middle: mixColors(clear.middle, greyColor, grey.amount),
    horizon: mixColors(clear.horizon, greyColor, grey.amount),
  };
}

// How dark it is outside, from 0 (sun well up) to 1 (deep night): stars and
// lit windows fade in as it gets darker.
export function darkness(height) {
  return Math.min(1, Math.max(0, (0.05 - height) / 0.3));
}

const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

// The moon's phase: fraction 0 is a new moon, 0.5 full; illumination is the
// share of its face that is lit; waxing means it is growing toward full.
export function moonPhase(date) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86_400_000;
  const age = ((days % SYNODIC_MONTH_DAYS) + SYNODIC_MONTH_DAYS) % SYNODIC_MONTH_DAYS;
  const fraction = age / SYNODIC_MONTH_DAYS;
  return { fraction, illumination: (1 - Math.cos(2 * Math.PI * fraction)) / 2, waxing: fraction < 0.5 };
}

// The SVG path of the moon's lit part, as seen from the northern hemisphere
// (lit on the right while waxing): the edge of the disc on the lit side, then
// back along the half-ellipse where light meets shadow.
export function moonLitPath({ fraction, illumination, waxing }, centerX, centerY, radius) {
  const terminatorWidth = Math.abs(Math.cos(2 * Math.PI * fraction)) * radius;
  const outerSweep = waxing ? 1 : 0;
  const isCrescent = illumination < 0.5;
  const innerSweep = isCrescent === waxing ? 0 : 1;
  const top = `${centerX} ${centerY - radius}`;
  const bottom = `${centerX} ${centerY + radius}`;
  return (
    `M${top} A${radius} ${radius} 0 0 ${outerSweep} ${bottom} ` +
    `A${terminatorWidth.toFixed(2)} ${radius} 0 0 ${innerSweep} ${top} Z`
  );
}

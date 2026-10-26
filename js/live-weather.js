// The real weather where the student is, for the "my weather" window view:
// the browser's location (rounded to about 1 km), the current weather and
// today's sunrise and sunset from Open-Meteo, and the place's name from
// BigDataCloud. Both are free and need no account or key.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const PLACE_NAME_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
// Wind at least this strong (km/h) makes a clear or cloudy sky windy.
const WINDY_KMH = 30;
const LOCATION_TIMEOUT_MS = 15_000;

// What the window shows for each WMO weather code Open-Meteo reports, and how
// the code is described. Codes not listed fall back to cloudy.
const WEATHER_CODES = {
  0: ['clear', 'Clear'],
  1: ['clear', 'Mainly clear'],
  2: ['cloudy', 'Partly cloudy'],
  3: ['cloudy', 'Overcast'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Freezing fog'],
  51: ['rain', 'Light drizzle'],
  53: ['rain', 'Drizzle'],
  55: ['rain', 'Heavy drizzle'],
  56: ['rain', 'Freezing drizzle'],
  57: ['rain', 'Freezing drizzle'],
  61: ['rain', 'Light rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy rain'],
  66: ['rain', 'Freezing rain'],
  67: ['rain', 'Freezing rain'],
  71: ['snow', 'Light snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy snow'],
  77: ['snow', 'Snow grains'],
  80: ['rain', 'Rain showers'],
  81: ['rain', 'Rain showers'],
  82: ['rain', 'Heavy showers'],
  85: ['snow', 'Snow showers'],
  86: ['snow', 'Heavy snow showers'],
  95: ['thunder', 'Thunderstorm'],
  96: ['thunder', 'Thunderstorm with hail'],
  99: ['thunder', 'Thunderstorm with hail'],
};

// The window's weather and its description for a weather code and wind speed.
export function describeWeather(code, windKmh) {
  const [weather, description] = WEATHER_CODES[code] ?? ['cloudy', 'Cloudy'];
  if (windKmh >= WINDY_KMH && (weather === 'clear' || weather === 'cloudy')) {
    return { weather: 'windy', description: `${description}, windy` };
  }
  return { weather, description };
}

// "2026-10-26T07:15" (the place's local time) → minutes after midnight.
export function minutesFromLocalTime(isoTime) {
  const [, hours, minutes] = isoTime.match(/T(\d{2}):(\d{2})/);
  return Number(hours) * 60 + Number(minutes);
}

// "12°C / 54°F" for a temperature in Celsius.
export function formatTemperature(celsius) {
  return `${Math.round(celsius)}°C / ${Math.round((celsius * 9) / 5 + 32)}°F`;
}

// Open-Meteo's answer → what the window needs.
export function readForecast({ current, daily }) {
  return {
    ...describeWeather(current.weather_code, current.wind_speed_10m),
    temperature: formatTemperature(current.temperature_2m),
    sunTimes: { sunrise: minutesFromLocalTime(daily.sunrise[0]), sunset: minutesFromLocalTime(daily.sunset[0]) },
  };
}

const roundToKilometer = (degrees) => Math.round(degrees * 100) / 100;

// The browser's location, rounded to about 1 km. Rejects with an error whose
// code is 'denied', 'unavailable', or 'unsupported'.
export function findLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(Object.assign(new Error('This browser cannot share its location.'), { code: 'unsupported' }));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: roundToKilometer(coords.latitude), longitude: roundToKilometer(coords.longitude) }),
      (error) => {
        const code = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable';
        reject(Object.assign(new Error(error.message), { code }));
      },
      { maximumAge: 30 * 60_000, timeout: LOCATION_TIMEOUT_MS },
    );
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.origin} answered ${response.status}`);
  return response.json();
}

export async function fetchWeather({ latitude, longitude }) {
  const url = new URL(FORECAST_URL);
  url.search = new URLSearchParams({
    latitude,
    longitude,
    current: 'temperature_2m,weather_code,wind_speed_10m',
    daily: 'sunrise,sunset',
    timezone: 'auto',
    forecast_days: '1',
  });
  return readForecast(await fetchJson(url));
}

// The town or city at a location, or '' if it can't be found.
export async function fetchPlaceName({ latitude, longitude }) {
  const url = new URL(PLACE_NAME_URL);
  url.search = new URLSearchParams({ latitude, longitude, localityLanguage: 'en' });
  try {
    const place = await fetchJson(url);
    return place.city || place.locality || place.principalSubdivision || '';
  } catch {
    return '';
  }
}

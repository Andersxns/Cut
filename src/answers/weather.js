import { fetchUpstream } from '../http.js';
import { TTLCache, cacheKey } from '../util/cache.js';

// Weather from Open-Meteo. Cut never guesses your location from your IP:
// you name the place, we look up that place.

const geoCache = new TTLCache({ max: 500, ttl: 24 * 3600_000 });
const forecastCache = new TTLCache({ max: 500, ttl: 15 * 60_000 });

export const WMO = {
  0: ['Clear sky', 'sun'], 1: ['Mainly clear', 'sun'], 2: ['Partly cloudy', 'cloudSun'], 3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'], 48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'drizzle'], 53: ['Drizzle', 'drizzle'], 55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'drizzle'], 57: ['Freezing drizzle', 'drizzle'],
  61: ['Light rain', 'rain'], 63: ['Rain', 'rain'], 65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'], 67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'], 73: ['Snow', 'snow'], 75: ['Heavy snow', 'snow'], 77: ['Snow grains', 'snow'],
  80: ['Rain showers', 'rain'], 81: ['Rain showers', 'rain'], 82: ['Violent rain showers', 'rain'],
  85: ['Snow showers', 'snow'], 86: ['Heavy snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'], 96: ['Thunderstorm with hail', 'storm'], 99: ['Thunderstorm with hail', 'storm'],
};

export async function geocode(place) {
  return geoCache.wrap(cacheKey('geo', place.toLowerCase()), async () => {
    const data = await fetchUpstream(
      'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: place, count: '1', language: 'en', format: 'json' }),
      { timeout: 2500, as: 'json', headers: { Accept: 'application/json' } },
    );
    return data?.results?.[0] || null;
  });
}

const PATTERNS = [
  /^(?:weather|forecast|temperature)(?:\s+(?:forecast|today|now|tomorrow))?\s+(?:in|for|at|of)\s+(.+?)\??$/i,
  /^(?:weather|forecast)(?:\s+(?:forecast|today|now|tomorrow))?\s+(.+?)\??$/i,
  /^(?:what(?:'s| is) the )?(?:weather|forecast|temperature)\s+(?:like\s+)?(?:in|for|at)\s+(.+?)\??$/i,
  /^(.+?)\s+(?:weather|forecast)(?:\s+(?:today|now|tomorrow|this week|forecast))?\??$/i,
];

export function matchWeather(query, ctx) {
  const q = query.trim();
  const askForPlace = async () => ({ type: 'weather', needsPlace: true });
  if (/^(weather|forecast|weather forecast)$/i.test(q)) return askForPlace;
  let place = null;
  for (const re of PATTERNS) {
    const m = q.match(re);
    if (m) {
      place = m[1].trim();
      break;
    }
  }
  if (!place || place.length > 60) return null;
  if (/^(local|current|my|here|near me|today|now|tomorrow)$/i.test(place)) return askForPlace;
  if (/^(the|app|api|apps|channel|radar|map|maps|forecast|widget|station|underground|network|report)$|^(what|how|why|is|best|free|live)\b/i.test(place)) return null;
  const imperial = ctx.region.code === 'us-en';
  return async () => {
    const loc = await geocode(place);
    if (!loc) return null;
    const data = await forecastCache.wrap(cacheKey('wx', loc.latitude, loc.longitude), () =>
      fetchUpstream(
        'https://api.open-meteo.com/v1/forecast?' +
          new URLSearchParams({
            latitude: String(loc.latitude),
            longitude: String(loc.longitude),
            current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
            daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
            timezone: 'auto',
            forecast_days: '7',
          }),
        { timeout: 3000, as: 'json', headers: { Accept: 'application/json' } },
      ),
    );
    const cur = data?.current;
    if (!cur) return null;
    const [condition, icon] = WMO[cur.weather_code] || ['Unknown', 'cloud'];
    return {
      type: 'weather',
      imperial,
      place: [loc.name, loc.admin1 && loc.admin1 !== loc.name ? loc.admin1 : '', loc.country].filter(Boolean).join(', '),
      current: {
        temp: cur.temperature_2m,
        feels: cur.apparent_temperature,
        humidity: cur.relative_humidity_2m,
        wind: cur.wind_speed_10m,
        condition,
        icon: cur.is_day === 0 && icon === 'sun' ? 'moon' : icon,
      },
      days: (data.daily?.time || []).map((date, i) => ({
        date,
        max: data.daily.temperature_2m_max[i],
        min: data.daily.temperature_2m_min[i],
        rain: data.daily.precipitation_probability_max?.[i] ?? null,
        condition: (WMO[data.daily.weather_code[i]] || ['Unknown'])[0],
        icon: (WMO[data.daily.weather_code[i]] || [null, 'cloud'])[1],
      })),
      timezone: data.timezone,
    };
  };
}

// "time in tokyo" → local time there, via the same geocoder.
export function matchWorldClock(query) {
  const m = query.trim().match(/^(?:what(?:'s| is) the )?(?:current |local )?time\s+(?:is it\s+)?(?:in|at)\s+(.+?)\??$/i);
  if (!m) return null;
  const place = m[1].trim();
  return async () => {
    const loc = await geocode(place);
    if (!loc?.timezone) return null;
    const now = new Date();
    const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: loc.timezone, ...opts }).format(now);
    return {
      type: 'clock',
      place: [loc.name, loc.country].filter(Boolean).join(', '),
      timezone: loc.timezone,
      time: fmt({ hour: 'numeric', minute: '2-digit' }),
      date: fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      offset: fmt({ timeZoneName: 'shortOffset' }).split(' ').pop(),
    };
  };
}

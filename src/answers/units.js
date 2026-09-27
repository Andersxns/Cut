// Unit conversion: "10 km to miles", "72 f in c", "how many feet in a mile".

// [key, factor to base unit, singular, plural, ...aliases]
const TABLE = {
  length: [
    ['nm', 1e-9, 'nanometer', 'nanometers', 'nanometre', 'nanometres'],
    ['um', 1e-6, 'micrometer', 'micrometers', 'µm', 'μm', 'micron', 'microns', 'micrometre', 'micrometres'],
    ['mm', 1e-3, 'millimeter', 'millimeters', 'millimetre', 'millimetres'],
    ['cm', 1e-2, 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
    ['m', 1, 'meter', 'meters', 'metre', 'metres'],
    ['km', 1e3, 'kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms'],
    ['in', 0.0254, 'inch', 'inches', '"', 'ins'],
    ['ft', 0.3048, 'foot', 'feet', "'"],
    ['yd', 0.9144, 'yard', 'yards', 'yds'],
    ['mi', 1609.344, 'mile', 'miles'],
    ['nmi', 1852, 'nautical mile', 'nautical miles'],
    ['au', 1.495978707e11, 'astronomical unit', 'astronomical units'],
    ['ly', 9.4607304725808e15, 'light-year', 'light-years', 'light year', 'light years', 'lightyear', 'lightyears'],
  ],
  mass: [
    ['ug', 1e-9, 'microgram', 'micrograms', 'µg', 'μg', 'mcg'],
    ['mg', 1e-6, 'milligram', 'milligrams'],
    ['g', 1e-3, 'gram', 'grams', 'gramme', 'grammes', 'gr'],
    ['kg', 1, 'kilogram', 'kilograms', 'kilo', 'kilos', 'kgs'],
    ['t', 1000, 'tonne', 'tonnes', 'metric ton', 'metric tons'],
    ['ct', 2e-4, 'carat', 'carats'],
    ['oz', 0.028349523125, 'ounce', 'ounces'],
    ['lb', 0.45359237, 'pound', 'pounds', 'lbs'],
    ['st', 6.35029318, 'stone', 'stones'],
    ['ton', 907.18474, 'short ton', 'short tons', 'ton', 'tons', 'us ton', 'us tons'],
    ['lt', 1016.0469088, 'long ton', 'long tons', 'imperial ton', 'imperial tons'],
  ],
  volume: [
    ['ml', 1e-3, 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
    ['cl', 1e-2, 'centiliter', 'centiliters', 'centilitre', 'centilitres'],
    ['dl', 1e-1, 'deciliter', 'deciliters', 'decilitre', 'decilitres'],
    ['l', 1, 'liter', 'liters', 'litre', 'litres', 'ltr'],
    ['m3', 1000, 'cubic meter', 'cubic meters', 'm³', 'cubic metre', 'cubic metres'],
    ['cm3', 1e-3, 'cubic centimeter', 'cubic centimeters', 'cm³', 'cc'],
    ['tsp', 0.00492892159375, 'teaspoon', 'teaspoons'],
    ['tbsp', 0.01478676478125, 'tablespoon', 'tablespoons', 'tbs'],
    ['floz', 0.0295735295625, 'fluid ounce', 'fluid ounces', 'fl oz', 'fl. oz'],
    ['cup', 0.2365882365, 'cup', 'cups'],
    ['pt', 0.473176473, 'pint', 'pints', 'us pint', 'us pints'],
    ['qt', 0.946352946, 'quart', 'quarts'],
    ['gal', 3.785411784, 'gallon', 'gallons', 'us gallon', 'us gallons'],
    ['impgal', 4.54609, 'imperial gallon', 'imperial gallons', 'uk gallon', 'uk gallons'],
    ['imppt', 0.56826125, 'imperial pint', 'imperial pints', 'uk pint', 'uk pints'],
    ['ft3', 28.316846592, 'cubic foot', 'cubic feet', 'ft³', 'cu ft'],
    ['in3', 0.016387064, 'cubic inch', 'cubic inches', 'in³', 'cu in'],
  ],
  area: [
    ['mm2', 1e-6, 'square millimeter', 'square millimeters', 'mm²', 'sq mm'],
    ['cm2', 1e-4, 'square centimeter', 'square centimeters', 'cm²', 'sq cm'],
    ['m2', 1, 'square meter', 'square meters', 'm²', 'sq m', 'sqm', 'square metre', 'square metres'],
    ['km2', 1e6, 'square kilometer', 'square kilometers', 'km²', 'sq km', 'square kilometre', 'square kilometres'],
    ['ha', 1e4, 'hectare', 'hectares'],
    ['acre', 4046.8564224, 'acre', 'acres', 'ac'],
    ['in2', 6.4516e-4, 'square inch', 'square inches', 'in²', 'sq in'],
    ['ft2', 0.09290304, 'square foot', 'square feet', 'ft²', 'sq ft', 'sqft'],
    ['yd2', 0.83612736, 'square yard', 'square yards', 'yd²', 'sq yd'],
    ['mi2', 2589988.110336, 'square mile', 'square miles', 'mi²', 'sq mi'],
  ],
  speed: [
    ['m/s', 1, 'meter per second', 'meters per second', 'mps', 'metre per second', 'metres per second'],
    ['km/h', 1 / 3.6, 'kilometer per hour', 'kilometers per hour', 'kph', 'kmh', 'kmph', 'km per hour', 'kilometres per hour'],
    ['mph', 0.44704, 'mile per hour', 'miles per hour', 'mi/h'],
    ['kn', 0.514444, 'knot', 'knots', 'kt', 'kts'],
    ['ft/s', 0.3048, 'foot per second', 'feet per second', 'fps'],
    ['mach', 343, 'mach', 'mach'],
  ],
  time: [
    ['ns', 1e-9, 'nanosecond', 'nanoseconds'],
    ['us', 1e-6, 'microsecond', 'microseconds', 'µs', 'μs'],
    ['ms', 1e-3, 'millisecond', 'milliseconds', 'msec'],
    ['s', 1, 'second', 'seconds', 'sec', 'secs'],
    ['min', 60, 'minute', 'minutes', 'mins'],
    ['h', 3600, 'hour', 'hours', 'hr', 'hrs'],
    ['d', 86400, 'day', 'days'],
    ['wk', 604800, 'week', 'weeks', 'wks'],
    ['mo', 2629746, 'month', 'months'],
    ['yr', 31556952, 'year', 'years', 'yrs'],
    ['decade', 315569520, 'decade', 'decades'],
    ['century', 3155695200, 'century', 'centuries'],
  ],
  data: [
    ['bit', 0.125, 'bit', 'bits'],
    ['B', 1, 'byte', 'bytes'],
    ['kB', 1e3, 'kilobyte', 'kilobytes', 'KB', 'kb'],
    ['MB', 1e6, 'megabyte', 'megabytes', 'mb'],
    ['GB', 1e9, 'gigabyte', 'gigabytes', 'gb'],
    ['TB', 1e12, 'terabyte', 'terabytes', 'tb'],
    ['PB', 1e15, 'petabyte', 'petabytes', 'pb'],
    ['KiB', 1024, 'kibibyte', 'kibibytes', 'kib'],
    ['MiB', 1024 ** 2, 'mebibyte', 'mebibytes', 'mib'],
    ['GiB', 1024 ** 3, 'gibibyte', 'gibibytes', 'gib'],
    ['TiB', 1024 ** 4, 'tebibyte', 'tebibytes', 'tib'],
    ['Kb', 125, 'kilobit', 'kilobits', 'kbit'],
    ['Mb', 125e3, 'megabit', 'megabits', 'mbit'],
    ['Gb', 125e6, 'gigabit', 'gigabits', 'gbit'],
  ],
  energy: [
    ['J', 1, 'joule', 'joules'],
    ['kJ', 1e3, 'kilojoule', 'kilojoules', 'kj'],
    ['cal', 4.184, 'calorie', 'calories'],
    ['kcal', 4184, 'kilocalorie', 'kilocalories', 'kcals'],
    ['Wh', 3600, 'watt-hour', 'watt-hours', 'wh', 'watt hour', 'watt hours'],
    ['kWh', 3.6e6, 'kilowatt-hour', 'kilowatt-hours', 'kwh', 'kilowatt hour', 'kilowatt hours'],
    ['eV', 1.602176634e-19, 'electronvolt', 'electronvolts', 'ev'],
    ['BTU', 1055.05585, 'BTU', 'BTUs', 'btu', 'btus'],
  ],
  pressure: [
    ['Pa', 1, 'pascal', 'pascals', 'pa'],
    ['kPa', 1e3, 'kilopascal', 'kilopascals', 'kpa'],
    ['MPa', 1e6, 'megapascal', 'megapascals', 'mpa'],
    ['bar', 1e5, 'bar', 'bar', 'bars'],
    ['mbar', 100, 'millibar', 'millibars', 'hpa', 'hPa'],
    ['atm', 101325, 'atmosphere', 'atmospheres'],
    ['psi', 6894.757293, 'psi', 'psi'],
    ['mmHg', 133.322387, 'millimeter of mercury', 'millimeters of mercury', 'mmhg', 'torr'],
    ['inHg', 3386.389, 'inch of mercury', 'inches of mercury', 'inhg'],
  ],
  angle: [
    ['deg', Math.PI / 180, 'degree', 'degrees', '°'],
    ['rad', 1, 'radian', 'radians'],
    ['grad', Math.PI / 200, 'gradian', 'gradians', 'gon'],
    ['turn', 2 * Math.PI, 'turn', 'turns', 'revolution', 'revolutions', 'rev'],
  ],
};

const TEMPERATURE = {
  C: { singular: 'degree Celsius', plural: 'degrees Celsius', symbol: '°C', toK: (v) => v + 273.15, fromK: (k) => k - 273.15, aliases: ['c', '°c', 'celsius', 'centigrade', 'degc', 'degrees c', 'degree c', 'degrees celsius', 'degree celsius'] },
  F: { singular: 'degree Fahrenheit', plural: 'degrees Fahrenheit', symbol: '°F', toK: (v) => ((v - 32) * 5) / 9 + 273.15, fromK: (k) => ((k - 273.15) * 9) / 5 + 32, aliases: ['f', '°f', 'fahrenheit', 'degf', 'degrees f', 'degree f', 'degrees fahrenheit', 'degree fahrenheit'] },
  K: { singular: 'kelvin', plural: 'kelvins', symbol: 'K', toK: (v) => v, fromK: (k) => k, aliases: ['k', 'kelvin', 'kelvins', 'degrees k'] },
};

// Case-sensitive keys first (so "Mb" ≠ "MB"), then a case-insensitive fallback.
const EXACT = new Map();
const LOOSE = new Map();
for (const [category, units] of Object.entries(TABLE)) {
  for (const [key, factor, singular, plural, ...aliases] of units) {
    const unit = { category, key, factor, singular, plural };
    EXACT.set(key, unit);
    for (const alias of [singular, plural, ...aliases]) {
      if (!LOOSE.has(alias.toLowerCase())) LOOSE.set(alias.toLowerCase(), unit);
      if (alias !== alias.toLowerCase()) EXACT.set(alias, unit);
    }
    if (!LOOSE.has(key.toLowerCase())) LOOSE.set(key.toLowerCase(), unit);
  }
}
for (const [key, t] of Object.entries(TEMPERATURE)) {
  const unit = { category: 'temperature', key, ...t };
  for (const alias of t.aliases) LOOSE.set(alias, unit);
}

function findUnit(text) {
  const cleaned = text.trim().replace(/\.$/, '').replace(/\s+/g, ' ');
  return EXACT.get(cleaned) || LOOSE.get(cleaned.toLowerCase()) || LOOSE.get(cleaned.toLowerCase().replace(/^(an? |one )/, '')) || null;
}

export function formatQuantity(x) {
  if (!Number.isFinite(x)) return '';
  const abs = Math.abs(x);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return x.toExponential(4).replace(/\.?0+e/, 'e').replace('e+', ' × 10^').replace('e-', ' × 10^-');
  return Number(x.toPrecision(7)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

const unitLabel = (unit, value) => (Math.abs(value) === 1 ? unit.singular : unit.plural);

function convertValue(value, from, to) {
  if (from.category === 'temperature') return to.fromK(from.toK(value));
  return (value * from.factor) / to.factor;
}

export function convertUnits(query) {
  const q = query.trim().replace(/\?$/, '').replace(/^convert\s+/i, '');
  let amount;
  let fromText;
  let toText;
  const direct = q.match(/^(?:(-?(?:\d[\d,]*\.?\d*|\.\d+))\s*)?(.+?)\s+(?:to|in|into|as|=|->|→)\s+(.+)$/i);
  const howMany = q.match(/^how many\s+(.+?)\s+(?:are\s+)?(?:in|per)\s+(?:(an?|one|\d[\d,]*\.?\d*)\s+)?(.+)$/i);
  if (howMany) {
    toText = howMany[1];
    amount = /^\d/.test(howMany[2] || '') ? howMany[2] : '1';
    fromText = howMany[3];
  } else if (direct) {
    [, amount = '1', fromText, toText] = direct;
  } else return null;

  const value = parseFloat(String(amount).replace(/,/g, ''));
  const from = findUnit(fromText);
  const to = findUnit(toText);
  if (!Number.isFinite(value) || !from || !to || from.category !== to.category || from === to) return null;
  const result = convertValue(value, from, to);
  if (!Number.isFinite(result)) return null;
  const unitRate = convertValue(1, from, to);
  return {
    type: 'units',
    category: from.category,
    from: { value: formatQuantity(value), unit: unitLabel(from, value) },
    to: { value: formatQuantity(result), unit: unitLabel(to, result) },
    rate: from.category === 'temperature' || value === 1 ? '' : `1 ${from.singular} = ${formatQuantity(unitRate)} ${unitLabel(to, unitRate)}`,
  };
}

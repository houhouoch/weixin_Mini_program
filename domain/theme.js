const THEME_SCHEMA_VERSION = 2;
const DEFAULT_THEME_SETTINGS = Object.freeze({
  presetId: 'graphite',
  hueShift: 0,
  warmth: 0,
  brightness: 0
});

const THEME_PRESETS = Object.freeze([
  Object.freeze({ id: 'graphite', name: '石墨', page: '#F5F5F7', surface: '#FFFFFF', primary: '#1D1D1F', accent: '#E8E8ED', text: '#1D1D1F' }),
  Object.freeze({ id: 'ocean', name: '海蓝', page: '#F3F7FA', surface: '#FFFFFF', primary: '#245B78', accent: '#DCEAF3', text: '#1D252A' }),
  Object.freeze({ id: 'sage', name: '鼠尾草', page: '#F3F6F2', surface: '#FFFFFF', primary: '#486456', accent: '#DDE8DF', text: '#202622' }),
  Object.freeze({ id: 'sand', name: '暖砂', page: '#F7F4EE', surface: '#FFFEFC', primary: '#6B5946', accent: '#E8DED0', text: '#29231E' })
]);

const LEGACY_THEME_PRESET_MAP = Object.freeze({
  forest: 'sage',
  coast: 'ocean',
  coral: 'sand',
  midnight: 'graphite',
  lime: 'sage',
  mono: 'graphite'
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function rgbToHsl(rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };
  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);
  let hue;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { h: hue * 60, s: saturation, l: lightness };
}

function hslToRgb(hsl) {
  const hue = ((hsl.h % 360) + 360) % 360 / 360;
  if (hsl.s === 0) {
    const gray = hsl.l * 255;
    return { r: gray, g: gray, b: gray };
  }
  const q = hsl.l < 0.5
    ? hsl.l * (1 + hsl.s)
    : hsl.l + hsl.s - hsl.l * hsl.s;
  const p = 2 * hsl.l - q;
  const channel = (offset) => {
    let value = hue + offset;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return { r: channel(1 / 3) * 255, g: channel(0) * 255, b: channel(-1 / 3) * 255 };
}

function adjustColor(hex, hueShift, warmth, brightness) {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.h += hueShift;
  hsl.l = clamp(hsl.l + brightness / 100, 0.05, 0.96);
  const rgb = hslToRgb(hsl);
  rgb.r += warmth * 1.8;
  rgb.b -= warmth * 1.8;
  return rgbToHex(rgb);
}

function mix(hexA, hexB, amount) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount
  });
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(hexA, hexB) {
  const first = luminance(hexA);
  const second = luminance(hexB);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function minimumContrast(foreground, backgrounds) {
  return Math.min(...backgrounds.map((background) => contrastRatio(background, foreground)));
}

function readableText(backgrounds) {
  const list = Array.isArray(backgrounds) ? backgrounds : [backgrounds];
  const candidates = ['#FFF9EC', '#151A17', '#FFFFFF', '#000000'];
  return candidates.sort(
    (a, b) => minimumContrast(b, list) - minimumContrast(a, list)
  )[0];
}

function presetById(id) {
  return THEME_PRESETS.find((item) => item.id === id) || THEME_PRESETS[0];
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isSupportedThemeSettings(settings) {
  if (!settings || typeof settings.presetId !== 'string') return false;
  const presetId = LEGACY_THEME_PRESET_MAP[settings.presetId] || settings.presetId;
  return THEME_PRESETS.some((item) => item.id === presetId)
    && isIntegerInRange(settings.hueShift, -30, 30)
    && isIntegerInRange(settings.warmth, -10, 10)
    && isIntegerInRange(settings.brightness, -10, 10);
}

function normalizeThemeSettings(settings) {
  const source = settings || {};
  const presetId = LEGACY_THEME_PRESET_MAP[source.presetId] || source.presetId;
  return {
    presetId: presetById(presetId).id,
    hueShift: isIntegerInRange(source.hueShift, -30, 30) ? source.hueShift : 0,
    warmth: isIntegerInRange(source.warmth, -10, 10) ? source.warmth : 0,
    brightness: isIntegerInRange(source.brightness, -10, 10) ? source.brightness : 0
  };
}

function resolveTheme(settings) {
  const normalized = normalizeThemeSettings(settings);
  const preset = presetById(normalized.presetId);
  const primary = adjustColor(
    preset.primary,
    normalized.hueShift,
    Math.round(normalized.warmth / 3),
    normalized.brightness
  );
  const page = adjustColor(
    preset.page,
    Math.round(normalized.hueShift / 4),
    normalized.warmth,
    normalized.brightness
  );
  const surface = adjustColor(
    preset.surface,
    Math.round(normalized.hueShift / 5),
    normalized.warmth,
    normalized.brightness
  );
  const accent = adjustColor(
    preset.accent,
    Math.round(normalized.hueShift / 4),
    Math.round(normalized.warmth / 2),
    Math.round(normalized.brightness / 2)
  );
  const preferredText = adjustColor(preset.text, Math.round(normalized.hueShift / 4), 0, 0);
  const readingSurfaces = [page, surface];
  const text = minimumContrast(preferredText, readingSurfaces) >= 4.5
    ? preferredText
    : readableText(readingSurfaces);
  let muted = mix(text, page, 0.35);
  if (minimumContrast(muted, readingSurfaces) < 3) muted = mix(text, page, 0.2);
  if (minimumContrast(muted, readingSurfaces) < 3) muted = text;
  const border = mix(text, page, 0.78);
  const resolved = {
    id: preset.id,
    name: preset.name,
    page,
    surface,
    primary,
    onPrimary: readableText(primary),
    accent,
    onAccent: readableText(accent),
    text,
    muted,
    border
  };
  resolved.styleText = [
    `--theme-page:${resolved.page}`,
    `--theme-surface:${resolved.surface}`,
    `--theme-primary:${resolved.primary}`,
    `--theme-on-primary:${resolved.onPrimary}`,
    `--theme-accent:${resolved.accent}`,
    `--theme-on-accent:${resolved.onAccent}`,
    `--theme-text:${resolved.text}`,
    `--theme-muted:${resolved.muted}`,
    `--theme-border:${resolved.border}`
  ].join(';');
  return resolved;
}

function getThemePresets(selectedId) {
  return THEME_PRESETS.map((item) => ({
    id: item.id,
    name: item.name,
    selected: item.id === selectedId,
    colors: [item.primary, item.accent, item.page]
  }));
}

module.exports = {
  DEFAULT_THEME_SETTINGS,
  THEME_SCHEMA_VERSION,
  contrastRatio,
  getThemePresets,
  isSupportedThemeSettings,
  normalizeThemeSettings,
  resolveTheme
};

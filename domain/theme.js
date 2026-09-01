const THEME_SCHEMA_VERSION = 3;
const DEFAULT_THEME_SETTINGS = Object.freeze({ presetId: 'light' });

const THEME_PRESETS = Object.freeze([
  Object.freeze({
    id: 'light',
    name: '浅色',
    description: '柔和米白，适合日间',
    scheme: 'light',
    page: '#F5F5F7',
    surface: '#FFFFFF',
    control: '#E8E8ED',
    primary: '#0066CC',
    accent: '#E8E8ED',
    text: '#1D1D1F',
    muted: '#6E6E73',
    border: '#D2D2D7',
    hairline: 'rgba(60,60,67,0.12)'
  }),
  Object.freeze({
    id: 'graphite',
    name: '深色',
    description: '石墨层次，适合夜间',
    scheme: 'dark',
    page: '#1C1C1E',
    surface: '#2C2C2E',
    control: '#3A3A3C',
    primary: '#2997FF',
    accent: '#3A3A3C',
    text: '#F5F5F7',
    muted: '#AEAEB2',
    border: '#48484A',
    hairline: 'rgba(255,255,255,0.10)'
  })
]);

const LEGACY_THEME_PRESET_MAP = Object.freeze({
  ocean: 'light',
  sage: 'light',
  sand: 'light',
  forest: 'light',
  coast: 'light',
  coral: 'light',
  lime: 'light',
  mono: 'light',
  systemBlue: 'light',
  slate: 'light',
  clay: 'light',
  midnight: 'graphite'
});

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
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

function readableText(background) {
  return contrastRatio(background, '#FFFFFF') >= contrastRatio(background, '#000000')
    ? '#FFFFFF'
    : '#000000';
}

function presetById(id) {
  return THEME_PRESETS.find((item) => item.id === id) || THEME_PRESETS[0];
}

function normalizedPresetId(id) {
  return LEGACY_THEME_PRESET_MAP[id] || id;
}

function isLegacyAdjustmentValid(settings, field, min, max) {
  return settings[field] === undefined
    || (Number.isInteger(settings[field]) && settings[field] >= min && settings[field] <= max);
}

function isSupportedThemeSettings(settings) {
  if (!settings || typeof settings.presetId !== 'string') return false;
  const presetId = normalizedPresetId(settings.presetId);
  return THEME_PRESETS.some((item) => item.id === presetId)
    && isLegacyAdjustmentValid(settings, 'hueShift', -30, 30)
    && isLegacyAdjustmentValid(settings, 'warmth', -10, 10)
    && isLegacyAdjustmentValid(settings, 'brightness', -10, 10);
}

function normalizeThemeSettings(settings, sourceSchemaVersion) {
  const source = settings || {};
  if (sourceSchemaVersion && sourceSchemaVersion < THEME_SCHEMA_VERSION && source.presetId === 'graphite') {
    return { presetId: 'light' };
  }
  return { presetId: presetById(normalizedPresetId(source.presetId)).id };
}

function resolveTheme(settings) {
  const normalized = normalizeThemeSettings(settings);
  const preset = presetById(normalized.presetId);
  const resolved = {
    id: preset.id,
    name: preset.name,
    scheme: preset.scheme,
    page: preset.page,
    surface: preset.surface,
    control: preset.control,
    primary: preset.primary,
    onPrimary: readableText(preset.primary),
    accent: preset.accent,
    onAccent: readableText(preset.accent),
    text: preset.text,
    muted: preset.muted,
    border: preset.border,
    hairline: preset.hairline
  };
  resolved.styleText = [
    `--theme-page:${resolved.page}`,
    `--theme-surface:${resolved.surface}`,
    `--theme-control:${resolved.control}`,
    `--theme-primary:${resolved.primary}`,
    `--theme-on-primary:${resolved.onPrimary}`,
    `--theme-accent:${resolved.accent}`,
    `--theme-on-accent:${resolved.onAccent}`,
    `--theme-text:${resolved.text}`,
    `--theme-muted:${resolved.muted}`,
    `--theme-border:${resolved.border}`,
    `--theme-hairline:${resolved.hairline}`
  ].join(';');
  return resolved;
}

function getThemePresets(selectedId) {
  return THEME_PRESETS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    selected: item.id === selectedId,
    preview: {
      page: item.page,
      surface: item.surface,
      text: item.text,
      primary: item.primary
    }
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

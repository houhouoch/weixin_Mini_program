const {
  DEFAULT_THEME_SETTINGS,
  THEME_SCHEMA_VERSION,
  getThemePresets,
  normalizeThemeSettings,
  resolveTheme
} = require('../domain/theme');
const { readThemeRaw, writeThemeRaw } = require('../infrastructure/storage');

function isValidStoredTheme(raw) {
  return Boolean(
    raw
    && raw.schemaVersion === THEME_SCHEMA_VERSION
    && raw.settings
    && JSON.stringify(normalizeThemeSettings(raw.settings)) === JSON.stringify(raw.settings)
  );
}

function toViewModel(settings) {
  const normalized = normalizeThemeSettings(settings);
  return {
    settings: normalized,
    resolved: resolveTheme(normalized),
    presets: getThemePresets(normalized.presetId)
  };
}

async function loadTheme() {
  const raw = await readThemeRaw();
  return toViewModel(isValidStoredTheme(raw) ? raw.settings : DEFAULT_THEME_SETTINGS);
}

async function saveTheme(settings) {
  const normalized = normalizeThemeSettings(settings);
  await writeThemeRaw({ schemaVersion: THEME_SCHEMA_VERSION, settings: normalized });
  return toViewModel(normalized);
}

async function resetTheme() {
  return saveTheme(DEFAULT_THEME_SETTINGS);
}

module.exports = { loadTheme, resetTheme, saveTheme };

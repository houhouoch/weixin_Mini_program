const {
  DEFAULT_THEME_SETTINGS,
  THEME_SCHEMA_VERSION,
  getThemePresets,
  isSupportedThemeSettings,
  normalizeThemeSettings,
  resolveTheme
} = require('../domain/theme');
const { readThemeRaw, writeThemeRaw } = require('../infrastructure/storage');

function isValidStoredTheme(raw) {
  return Boolean(
    raw
    && [1, 2, THEME_SCHEMA_VERSION].includes(raw.schemaVersion)
    && raw.settings
    && isSupportedThemeSettings(raw.settings)
  );
}

function toViewModel(settings, sourceSchemaVersion) {
  const normalized = normalizeThemeSettings(settings, sourceSchemaVersion);
  return {
    settings: normalized,
    resolved: resolveTheme(normalized),
    presets: getThemePresets(normalized.presetId)
  };
}

async function loadTheme() {
  const raw = await readThemeRaw();
  return isValidStoredTheme(raw)
    ? toViewModel(raw.settings, raw.schemaVersion)
    : toViewModel(DEFAULT_THEME_SETTINGS, THEME_SCHEMA_VERSION);
}

async function saveTheme(settings) {
  const normalized = normalizeThemeSettings(settings);
  await writeThemeRaw({ schemaVersion: THEME_SCHEMA_VERSION, settings: normalized });
  return toViewModel(normalized, THEME_SCHEMA_VERSION);
}

async function resetTheme() {
  return saveTheme(DEFAULT_THEME_SETTINGS);
}

module.exports = { loadTheme, resetTheme, saveTheme };

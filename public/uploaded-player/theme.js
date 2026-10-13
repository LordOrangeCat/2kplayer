export const THEME_KEYS = Object.freeze([
  'background', 'surface', 'surfaceRaised', 'surfaceInset', 'text', 'muted',
  'accent', 'accentText', 'border', 'visualizer', 'displayFont', 'bodyFont'
]);

export const DEFAULT_THEME = Object.freeze({
  name: 'Saffron CRT',
  version: 1,
  colors: {
    background: '#090a0b',
    surface: '#111315',
    surfaceRaised: '#191b1d',
    surfaceInset: '#08090a',
    text: '#f1f0eb',
    muted: '#96999c',
    accent: '#f3a712',
    accentText: '#17130a',
    border: '#303336',
    visualizer: '#f3a712'
  },
  fonts: {
    display: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    body: 'Inter, ui-sans-serif, system-ui, sans-serif'
  },
  layout: {
    radius: 8,
    compact: true,
    visualizerHeight: 62
  }
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_KEYS = new Set(['name', 'version', 'colors', 'fonts', 'layout']);
const COLOR_KEYS = new Set(Object.keys(DEFAULT_THEME.colors));
const FONT_KEYS = new Set(['display', 'body']);
const LAYOUT_KEYS = new Set(['radius', 'compact', 'visualizerHeight']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unsupported ${label} property: ${key}`);
  }
}

export function validateTheme(input) {
  if (!isPlainObject(input)) throw new Error('Theme must be a JSON object.');
  assertExactKeys(input, ALLOWED_KEYS, 'theme');
  if (input.version !== 1) throw new Error('Unsupported theme version. Expected version 1.');
  if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 48) {
    throw new Error('Theme name must be 1–48 characters.');
  }
  if (!isPlainObject(input.colors) || !isPlainObject(input.fonts) || !isPlainObject(input.layout)) {
    throw new Error('Theme must define colors, fonts, and layout objects.');
  }
  assertExactKeys(input.colors, COLOR_KEYS, 'color');
  assertExactKeys(input.fonts, FONT_KEYS, 'font');
  assertExactKeys(input.layout, LAYOUT_KEYS, 'layout');

  for (const key of COLOR_KEYS) {
    if (typeof input.colors[key] !== 'string' || !HEX_COLOR.test(input.colors[key])) {
      throw new Error(`Invalid color for ${key}; use a six-digit hex color.`);
    }
  }
  for (const key of FONT_KEYS) {
    const value = input.fonts[key];
    if (typeof value !== 'string' || value.length < 1 || value.length > 120 || /[{};<>]|url\s*\(|expression\s*\(/i.test(value)) {
      throw new Error(`Invalid font definition for ${key}.`);
    }
  }
  if (!Number.isFinite(input.layout.radius) || input.layout.radius < 0 || input.layout.radius > 24) {
    throw new Error('Layout radius must be between 0 and 24.');
  }
  if (typeof input.layout.compact !== 'boolean') throw new Error('Layout compact must be true or false.');
  if (!Number.isFinite(input.layout.visualizerHeight) || input.layout.visualizerHeight < 24 || input.layout.visualizerHeight > 160) {
    throw new Error('Visualizer height must be between 24 and 160 pixels.');
  }
  return structuredClone(input);
}

export function applyTheme(theme, root = document.documentElement) {
  const safe = validateTheme(theme);
  const map = {
    background: '--bg', surface: '--surface', surfaceRaised: '--surface-raised',
    surfaceInset: '--surface-inset', text: '--text', muted: '--muted',
    accent: '--accent', accentText: '--accent-text', border: '--border',
    visualizer: '--visualizer'
  };
  for (const [key, variable] of Object.entries(map)) root.style.setProperty(variable, safe.colors[key]);
  root.style.setProperty('--font-display', safe.fonts.display);
  root.style.setProperty('--font-body', safe.fonts.body);
  root.style.setProperty('--radius', `${safe.layout.radius}px`);
  root.style.setProperty('--visualizer-height', `${safe.layout.visualizerHeight}px`);
  root.dataset.compact = String(safe.layout.compact);
  return safe;
}

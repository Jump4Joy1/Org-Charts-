/**
 * Design tokens: the single source of truth for colour, spacing, radius,
 * shadow, motion and type.
 *
 * The app has three consumers that must agree: the CSS in index.html, the
 * canvas rendering in app.js, and the SVG the exporter writes. Anything
 * hardcoded in one of those can drift from the other two, which is how a
 * PDF ends up not matching the screen. Tokens are published as CSS custom
 * properties for the stylesheet and read back through `token()` by the two
 * JS renderers, so all three read the same numbers.
 *
 * Loaded as a plain script; no build step, no modules.
 */
(function (global) {
  'use strict';

  /** Palette per appearance. Keys are semantic, not literal colour names. */
  var COLOR = {
    light: {
      bg: '#f4f6f8', panel: '#ffffff', panel2: '#eef1f4',
      text: '#1c2530', muted: '#6b7684', line: '#dbe0e6',
      accent: '#3568d4', accent2: '#274a99',
      danger: '#d64545', warn: '#c2762a', good: '#2f9e6e',
      shadow: '0 2px 10px rgba(20,26,34,.08)'
    },
    dim: {
      bg: '#2f353c', panel: '#383e46', panel2: '#414850',
      text: '#eef1f4', muted: '#a8b0b9', line: '#4c545e',
      accent: '#5b8fe6', accent2: '#3568d4',
      danger: '#f0665f', warn: '#e0a13a', good: '#4cbf8b',
      shadow: '0 2px 14px rgba(0,0,0,.3)'
    },
    dark: {
      bg: '#12161c', panel: '#1b2129', panel2: '#232a33',
      text: '#eef1f5', muted: '#93a0b0', line: '#2c3541',
      accent: '#5b8fe6', accent2: '#3568d4',
      danger: '#f0665f', warn: '#e0a13a', good: '#4cbf8b',
      shadow: '0 2px 14px rgba(0,0,0,.4)'
    }
  };

  /** High contrast overrides, layered on top of the chosen appearance. */
  var CONTRAST = {
    light: { text: '#000000', muted: '#3a4350', line: '#6b7684', accent: '#12459c' },
    dim:   { text: '#ffffff', muted: '#dfe4ea', line: '#9aa4b0', accent: '#9ec2ff' },
    dark:  { text: '#ffffff', muted: '#dfe4ea', line: '#8b96a5', accent: '#9ec2ff' }
  };

  /** Base scale in px. Density multiplies the spacing and node metrics. */
  var BASE = {
    space: { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, xxl: 28 },
    radius: { sm: 4, md: 9, lg: 12, xl: 14, pill: 999 },
    type: {
      nodeName: 14.5, nodeTitle: 12, nodeDetail: 11, badge: 15,
      sheetTitle: 19, label: 12.5, small: 11.5
    },
    node: { width: 168, height: 96, padX: 12, padY: 10, avatar: 44, gapSib: 30, gapLevel: 100 }
  };

  /**
   * Density presets. `ui` scales sheet padding and control sizing, `chart`
   * scales the boxes and the gaps between them. They move together but not
   * at the same rate: a compact canvas should still have tappable controls.
   */
  var DENSITY = {
    compact:  { label: 'Compact',  ui: 0.88, chart: 0.86 },
    standard: { label: 'Standard', ui: 1,    chart: 1 },
    spacious: { label: 'Spacious', ui: 1.14, chart: 1.2 }
  };
  var DENSITY_ORDER = ['compact', 'standard', 'spacious'];

  var MOTION = {
    fast: '.12s', base: '.18s', slow: '.28s',
    ease: 'cubic-bezier(.4,0,.2,1)'
  };

  /** Resolved values for the currently applied appearance and density. */
  var current = { appearance: 'light', density: 'standard', contrast: false, values: {} };

  function round(n) { return Math.round(n * 100) / 100; }

  /** Builds the flat token map that gets written to :root. */
  function resolve(appearance, density, highContrast) {
    var pal = COLOR[appearance] || COLOR.light;
    if (highContrast) {
      var over = CONTRAST[appearance] || CONTRAST.light;
      pal = Object.keys(pal).reduce(function (acc, k) { acc[k] = pal[k]; return acc; }, {});
      Object.keys(over).forEach(function (k) { pal[k] = over[k]; });
    }
    var d = DENSITY[density] || DENSITY.standard;
    var out = {};

    Object.keys(pal).forEach(function (k) { out['--' + k] = pal[k]; });

    Object.keys(BASE.space).forEach(function (k) {
      out['--space-' + k] = round(BASE.space[k] * d.ui) + 'px';
    });
    Object.keys(BASE.radius).forEach(function (k) {
      out['--radius-' + k] = (k === 'pill' ? BASE.radius[k] : round(BASE.radius[k] * d.ui)) + 'px';
    });
    Object.keys(BASE.type).forEach(function (k) {
      out['--type-' + k] = round(BASE.type[k] * (k.indexOf('node') === 0 || k === 'badge' ? d.chart : d.ui)) + 'px';
    });
    Object.keys(BASE.node).forEach(function (k) {
      out['--node-' + k] = round(BASE.node[k] * d.chart) + 'px';
    });
    Object.keys(MOTION).forEach(function (k) { out['--motion-' + k] = MOTION[k]; });
    out['--density'] = density;
    return out;
  }

  /**
   * Writes the tokens onto the document root. Returns the resolved map so
   * callers can read numbers without re-parsing CSS.
   */
  function apply(opts) {
    opts = opts || {};
    current.appearance = opts.appearance || current.appearance;
    current.density = opts.density || current.density;
    if (typeof opts.contrast === 'boolean') current.contrast = opts.contrast;
    current.values = resolve(current.appearance, current.density, current.contrast);
    var root = document.documentElement;
    Object.keys(current.values).forEach(function (k) {
      root.style.setProperty(k, current.values[k]);
    });
    root.dataset.density = current.density;
    root.dataset.contrast = current.contrast ? 'high' : 'normal';
    return current.values;
  }

  /** Reads a token. Numeric tokens come back as numbers, minus the unit. */
  function token(name, asNumber) {
    var v = current.values['--' + name];
    if (v === undefined) {
      v = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
    }
    if (asNumber) return parseFloat(v) || 0;
    return v;
  }

  /** Multiplier applied to chart geometry at the current density. */
  function chartScale() { return (DENSITY[current.density] || DENSITY.standard).chart; }

  global.OrgChartTokens = {
    COLOR: COLOR, BASE: BASE, DENSITY: DENSITY, DENSITY_ORDER: DENSITY_ORDER, MOTION: MOTION,
    apply: apply, token: token, resolve: resolve, chartScale: chartScale,
    get current() { return current; }
  };
})(window);

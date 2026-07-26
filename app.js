(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  // Reassigned by applyTokens() when density changes.
  var NODE_W = 168;            // default box width; each box may override it
  var NODE_H_APPROX = 96;
  var BOX_WIDTHS = [140, 168, 210, 260];
  var MIN_W = 110, MAX_W = 460, MIN_H = 56, MAX_H = 420;
  var MIN_FS = 0.6, MAX_FS = 2.6;
  var FONT_SCALES = [0.85, 1, 1.2, 1.45];
  var AVATAR_SIZES = { 0.85: 38, 1: 44, 1.2: 52, 1.45: 62 };
  var SIB_GAP = 30;
  var LEVEL_GAP = 100;
  var DRAG_THRESHOLD = 8; // px of finger movement before a touch counts as a drag
  var STORE_KEY = 'orgchart.v2';
  var OLD_STORE_KEY = 'orgchart.v1';

  var FONT_STACKS = {
    system: "-apple-system,BlinkMacSystemFont,'SF Pro Text',Segoe UI,Roboto,Arial,sans-serif",
    serif: "Georgia,'Times New Roman',Times,serif",
    rounded: "ui-rounded,-apple-system,'SF Pro Rounded',Verdana,sans-serif",
    mono: "'SF Mono',ui-monospace,Menlo,Consolas,monospace",
    classic: "'Times New Roman',Times,serif",
    elegant: "Palatino,'Palatino Linotype','Book Antiqua',serif",
    condensed: "'Arial Narrow','Helvetica Neue',Arial,sans-serif",
    display: "Impact,'Arial Black',sans-serif"
  };
  var FONT_LABELS = {
    system: 'System (default)', serif: 'Serif (Georgia)', rounded: 'Rounded', mono: 'Mono',
    classic: 'Classic (Times)', elegant: 'Elegant (Palatino)', condensed: 'Condensed', display: 'Display (Bold)'
  };
  var FONT_ORDER = ['system', 'serif', 'rounded', 'mono', 'classic', 'elegant', 'condensed', 'display'];

  var BUILTIN_SWATCHES = ['#3568d4', '#2f9e6e', '#c2762a', '#a24fd6', '#d6486b', '#2aa1a1', '#6b6f76', '#b5322f', '#e0a13a', '#4f6bd6', '#1a1d21', '#8a6a3a'];
  // The live palette every colour picker draws from. Swapped by the colour-set
  // manager; kept as one array so pickers need no knowledge of where it came
  // from. Palettes are an app-level preference, not part of a chart, so they
  // live under their own storage key and never travel in an export.
  var COLOR_SWATCHES = BUILTIN_SWATCHES.slice();
  var PALETTE_KEY = 'orgchart.palettes';

  function defaultPalettes() { return { activeId: 'builtin', sets: {} }; }
  function loadPalettes() {
    try {
      var raw = localStorage.getItem(PALETTE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (!p.sets) p.sets = {};
        return p;
      }
    } catch (e) {}
    return defaultPalettes();
  }
  var palettes = loadPalettes();

  // App-level preferences, kept out of chart data so they follow the device
  // rather than travelling inside an exported or synced chart.
  var PREF_KEY = 'orgchart.prefs';
  var prefs = (function () {
    try {
      var raw = localStorage.getItem(PREF_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {};
  })();
  // Tapping empty canvas used to create a box instantly, which fires on any
  // stray touch while panning. Ask by default.
  if (!prefs.tapAdd) prefs.tapAdd = 'ask';
  if (!prefs.contrast) prefs.contrast = 'normal';
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function savePalettes() {
    try { localStorage.setItem(PALETTE_KEY, JSON.stringify(palettes)); } catch (e) {}
  }
  function activePalette() {
    var set = palettes.sets[palettes.activeId];
    return (set && set.colors && set.colors.length) ? set : null;
  }
  function applyActivePalette() {
    var set = activePalette();
    // User colours lead, with the built-ins kept on the end so nothing a chart
    // already uses becomes unreachable after switching sets.
    COLOR_SWATCHES = set ? set.colors.concat(BUILTIN_SWATCHES).slice(0, 24) : BUILTIN_SWATCHES.slice();
  }
  applyActivePalette();

  // ---------------------------------------------------------------------
  // Pull a palette out of a picture
  //
  // Buckets pixels into a coarse RGB grid, ranks the buckets by how much of
  // the image they cover, then drops entries that are nearly grey, nearly
  // white/black, or too close to one already chosen. That keeps a logo's
  // actual brand colours and throws away paper and shadow.
  // ---------------------------------------------------------------------
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      var h = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return h.length === 1 ? '0' + h : h;
    }).join('');
  }
  function colorDistance(a, b) {
    var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }
  function saturationOf(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  }
  function extractPalette(img, count) {
    count = count || 6;
    var SIDE = 96;
    var cv = document.createElement('canvas');
    cv.width = SIDE; cv.height = SIDE;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, SIDE, SIDE);
    var data;
    try { data = cx.getImageData(0, 0, SIDE, SIDE).data; } catch (e) { return []; }

    var STEP = 32; // 8 levels per channel
    var buckets = {};
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // ignore transparent pixels
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var key = Math.floor(r / STEP) + ',' + Math.floor(g / STEP) + ',' + Math.floor(b / STEP);
      var e = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      e.n++; e.r += r; e.g += g; e.b += b;
    }
    var list = Object.keys(buckets).map(function (k) {
      var e = buckets[k];
      return { n: e.n, rgb: [e.r / e.n, e.g / e.n, e.b / e.n] };
    });
    // Prefer colourful buckets, but weight by how much of the image they are.
    list.forEach(function (e) {
      var sat = saturationOf(e.rgb[0], e.rgb[1], e.rgb[2]);
      var lum = (e.rgb[0] * 0.299 + e.rgb[1] * 0.587 + e.rgb[2] * 0.114) / 255;
      var edge = (lum < 0.06 || lum > 0.96) ? 0.15 : 1;   // near-black / near-white
      e.score = e.n * (0.25 + sat * 1.75) * edge;
    });
    list.sort(function (a, b) { return b.score - a.score; });

    var out = [];
    for (var j = 0; j < list.length && out.length < count; j++) {
      var c = list[j].rgb;
      var tooClose = out.some(function (o) { return colorDistance(o, c) < 48; });
      if (!tooClose) out.push(c);
    }
    // If the picture really is near-monochrome, fall back to the most common
    // buckets rather than handing back one lonely swatch.
    if (out.length < 3) {
      list.sort(function (a, b) { return b.n - a.n; });
      for (var k = 0; k < list.length && out.length < count; k++) {
        var c2 = list[k].rgb;
        if (!out.some(function (o) { return colorDistance(o, c2) < 30; })) out.push(c2);
      }
    }
    return out.map(function (c) { return rgbToHex(c[0], c[1], c[2]); });
  }

  var TEXTURES = ['none', 'dots', 'bigdots', 'lines', 'vlines', 'hlines', 'grid', 'graph', 'cross', 'checks', 'zigzag', 'weave'];
  var TEXTURE_LABELS = {
    none: 'Flat', dots: 'Dots', bigdots: 'Big dots', lines: 'Diagonal', vlines: 'Vertical',
    hlines: 'Horizontal', grid: 'Grid', graph: 'Graph paper', cross: 'Crosshatch',
    checks: 'Checks', zigzag: 'Zigzag', weave: 'Weave'
  };

  var PRESETS = {
    ocean: { label: 'Ocean Blue', font: 'system', bg: { type: 'solid', color: '' } },
    slate: { label: 'Slate Pro', font: 'serif', bg: { type: 'solid', color: '' } },
    forest: { label: 'Forest', font: 'system', bg: { type: 'solid', color: '' } },
    sunset: { label: 'Sunset', font: 'rounded', bg: { type: 'gradient', color: '#fff3ea', color2: '#ffe1d0' } },
    grape: { label: 'Grape', font: 'system', bg: { type: 'gradient', color: '#f6effc', color2: '#ece0fa' } },
    ink: { label: 'Monochrome', font: 'serif', bg: { type: 'texture', color: '#20242a', texture: 'grid' } }
  };
  var PRESET_ORDER = ['ocean', 'slate', 'forest', 'sunset', 'grape', 'ink'];

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), canvas = $('canvas'), edgesSvg = $('edges'), emptyEl = $('empty'), hintEl = $('hint');
  var chartNameInput = $('chartName');
  var editBackdrop = $('editBackdrop'), editSheet = $('editSheet');
  var edgeBackdrop = $('edgeBackdrop'), edgeSheet = $('edgeSheet');
  var noteBackdrop = $('noteBackdrop'), noteSheet = $('noteSheet');
  var menuBackdrop = $('menuBackdrop'), menuSheet = $('menuSheet');
  var designBackdrop = $('designBackdrop'), designSheet = $('designSheet');
  var exportBackdrop = $('exportBackdrop'), exportSheet = $('exportSheet');
  var fName = $('fName'), fTitle = $('fTitle');
  var chartListEl = $('chartList'), themeGrid = $('themeGrid');
  var toastEl = $('toast');
  var importFile = $('importFile'), photoFile = $('photoFile');
  var photoPreview = $('photoPreview');
  var printArea = $('printArea');

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  // =====================================================================
  // Shape geometry
  //
  // Every shape is described once, as a normalised outline, and turned into
  // an SVG path by shapePath(). The card on screen and the exported drawing
  // both render that same path, so they cannot drift apart — and corner
  // rounding works on a hexagon exactly as it does on a rectangle.
  //
  //  kind 'rect'     — axis-aligned box, radius rounds the four corners
  //  kind 'poly'     — polygon, radius rounds every vertex
  //  kind 'ellipse'  — radius is ignored
  //  kind 'cylinder' — drawn specially: a tube with elliptical ends
  //
  // `inset` is the fraction of width/height that the text has to give up so
  // it stays inside a shape that narrows towards its edges.
  // =====================================================================
  var SHAPES = {
    rounded:       { label: 'Rounded',  kind: 'rect', defRadius: 14 },
    rect:          { label: 'Square edge', kind: 'rect', defRadius: 0 },
    pill:          { label: 'Pill',     kind: 'rect', defRadius: 999 },
    square:        { label: 'Square',   kind: 'rect', defRadius: 6, fixedAspect: true },
    circle:        { label: 'Circle',   kind: 'ellipse', fixedAspect: true, insetX: 0.16, insetY: 0.16 },
    diamond:       { label: 'Diamond',  kind: 'poly', defRadius: 6, insetX: 0.22, insetY: 0.22,
                     pts: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
    hexagon:       { label: 'Hexagon',  kind: 'poly', defRadius: 8, insetX: 0.14,
                     pts: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]] },
    octagon:       { label: 'Octagon',  kind: 'poly', defRadius: 8, insetX: 0.08, insetY: 0.08,
                     pts: [[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]] },
    parallelogram: { label: 'Slant',    kind: 'poly', defRadius: 4, insetX: 0.14,
                     pts: [[0.18, 0], [1, 0], [0.82, 1], [0, 1]] },
    trapezoid:     { label: 'Trapezoid', kind: 'poly', defRadius: 6, insetX: 0.14,
                     pts: [[0.18, 0], [0.82, 0], [1, 1], [0, 1]] },
    chevron:       { label: 'Chevron',  kind: 'poly', defRadius: 4, insetX: 0.16,
                     pts: [[0, 0], [0.82, 0], [1, 0.5], [0.82, 1], [0, 1], [0.18, 0.5]] },
    cylinder:      { label: 'Cylinder', kind: 'cylinder', insetY: 0.12 }
  };
  var SHAPE_ORDER = ['rounded', 'rect', 'pill', 'square', 'circle', 'diamond', 'hexagon', 'octagon', 'parallelogram', 'trapezoid', 'chevron', 'cylinder'];
  function shapeDef(key) { return SHAPES[key] || SHAPES.rounded; }
  function isFixedAspectShape(key) { return !!shapeDef(key).fixedAspect; }
  // The radius a box actually draws with: its own override, or the shape's
  // natural default when it has never been set.
  function cornerRadius(n) {
    var d = shapeDef(n && n.shape);
    if (d.kind === 'ellipse' || d.kind === 'cylinder') return 0;
    var r = (n && typeof n.corner === 'number') ? n.corner : d.defRadius;
    return Math.max(0, r || 0);
  }

  function fmt(v) { return Math.round(v * 100) / 100; }

  // Rounds every vertex of a closed polygon. Each corner is trimmed back
  // along both of its edges and bridged with a quadratic curve through the
  // original point; the trim is capped at half the shorter edge so adjacent
  // corners can never eat into each other.
  function roundedPolyPath(pts, r) {
    var n = pts.length;
    if (!r || r < 0.5) {
      return 'M ' + pts.map(function (p) { return fmt(p[0]) + ' ' + fmt(p[1]); }).join(' L ') + ' Z';
    }
    var d = '';
    for (var i = 0; i < n; i++) {
      var prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
      var v1x = prev[0] - cur[0], v1y = prev[1] - cur[1];
      var v2x = next[0] - cur[0], v2y = next[1] - cur[1];
      var l1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      var l2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      var t = Math.min(r, l1 / 2, l2 / 2);
      var ax = cur[0] + (v1x / l1) * t, ay = cur[1] + (v1y / l1) * t;
      var bx = cur[0] + (v2x / l2) * t, by = cur[1] + (v2y / l2) * t;
      d += (i === 0 ? 'M ' + fmt(ax) + ' ' + fmt(ay) : ' L ' + fmt(ax) + ' ' + fmt(ay));
      d += ' Q ' + fmt(cur[0]) + ' ' + fmt(cur[1]) + ' ' + fmt(bx) + ' ' + fmt(by);
    }
    return d + ' Z';
  }

  function roundedRectPath(w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    if (r < 0.5) return 'M 0 0 L ' + fmt(w) + ' 0 L ' + fmt(w) + ' ' + fmt(h) + ' L 0 ' + fmt(h) + ' Z';
    return 'M ' + fmt(r) + ' 0'
      + ' H ' + fmt(w - r) + ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 ' + fmt(w) + ' ' + fmt(r)
      + ' V ' + fmt(h - r) + ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 ' + fmt(w - r) + ' ' + fmt(h)
      + ' H ' + fmt(r) + ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 0 ' + fmt(h - r)
      + ' V ' + fmt(r) + ' A ' + fmt(r) + ' ' + fmt(r) + ' 0 0 1 ' + fmt(r) + ' 0 Z';
  }

  function ellipsePath(w, h) {
    var rx = w / 2, ry = h / 2;
    return 'M 0 ' + fmt(ry)
      + ' A ' + fmt(rx) + ' ' + fmt(ry) + ' 0 0 1 ' + fmt(w) + ' ' + fmt(ry)
      + ' A ' + fmt(rx) + ' ' + fmt(ry) + ' 0 0 1 0 ' + fmt(ry) + ' Z';
  }

  // A cylinder is the tube outline; the lip across the top is drawn as a
  // separate stroked arc by the caller.
  function cylinderLip(w, h) {
    var ry = Math.min(h * 0.16, w * 0.22);
    return { ry: ry, lip: 'M 0 ' + fmt(ry) + ' A ' + fmt(w / 2) + ' ' + fmt(ry) + ' 0 0 0 ' + fmt(w) + ' ' + fmt(ry) };
  }
  function cylinderPath(w, h) {
    var ry = cylinderLip(w, h).ry;
    return 'M 0 ' + fmt(ry)
      + ' A ' + fmt(w / 2) + ' ' + fmt(ry) + ' 0 0 1 ' + fmt(w) + ' ' + fmt(ry)
      + ' V ' + fmt(h - ry)
      + ' A ' + fmt(w / 2) + ' ' + fmt(ry) + ' 0 0 1 0 ' + fmt(h - ry)
      + ' Z';
  }

  function shapePath(key, w, h, radius) {
    var d = shapeDef(key);
    if (d.kind === 'ellipse') return ellipsePath(w, h);
    if (d.kind === 'cylinder') return cylinderPath(w, h);
    if (d.kind === 'rect') return roundedRectPath(w, h, radius);
    var pts = d.pts.map(function (p) { return [p[0] * w, p[1] * h]; });
    return roundedPolyPath(pts, radius);
  }

  var state = loadState();
  var undoStack = [];
  var panX = 0, panY = 0, scale = 1;
  var editingId = null, editingEdgeId = null, editingNoteId = null;
  var pendingPhoto = null;

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    try {
      var oldRaw = localStorage.getItem(OLD_STORE_KEY);
      if (oldRaw) {
        var old = JSON.parse(oldRaw);
        var migrated = { activeId: old.activeId, charts: {} };
        Object.keys(old.charts || {}).forEach(function (cid) { migrated.charts[cid] = migrateChart(old.charts[cid]); });
        return migrated;
      }
    } catch (e2) {}
    var id = uid();
    return { activeId: id, charts: {}, deleted: {} };
  }

  function defaultFill() { return { type: 'solid', color: '', color2: '', texture: 'dots', angle: 135 }; }
  function fillAngle(f) { return (f && typeof f.angle === 'number') ? f.angle : 135; }
  // CSS angles run clockwise from 'up'; SVG needs a plain unit vector, so
  // convert once and let both renderers share it.
  function angleVector(deg) {
    var r = (deg - 90) * Math.PI / 180;
    var dx = Math.cos(r), dy = Math.sin(r);
    return { x1: (0.5 - dx / 2), y1: (0.5 - dy / 2), x2: (0.5 + dx / 2), y2: (0.5 + dy / 2) };
  }
  var GRADIENT_PRESETS = [
    { name: 'Slate', a: '#4b5b70', b: '#7d8ea6', angle: 135 },
    { name: 'Ocean', a: '#1f6feb', b: '#4fc3f7', angle: 135 },
    { name: 'Forest', a: '#1f7a4d', b: '#7bc47f', angle: 135 },
    { name: 'Sunset', a: '#c2410c', b: '#f5b451', angle: 120 },
    { name: 'Berry', a: '#7b2d8b', b: '#d46fb0', angle: 135 },
    { name: 'Clay', a: '#8a5a3b', b: '#d9b08c', angle: 150 },
    { name: 'Steel', a: '#334155', b: '#94a3b8', angle: 180 },
    { name: 'Mist', a: '#dfe6f2', b: '#f7fafc', angle: 160 }
  ];
  function defaultBorder() { return { color: '', width: 1, dash: 'solid' }; }
  function defaultBackground() { return { type: 'solid', color: '', color2: '', texture: 'dots', angle: 135, scale: 1 }; }
  function bgBase(bg) { return bg.color2 || 'var(--bg)'; }

  function migrateChart(c) {
    // schema.js owns the version ladder; the per-field defaults below stay
    // here because they reference app constants.
    if (window.OrgChartSchema) window.OrgChartSchema.migrate(c, { uid: uid });
    c.nodes = c.nodes || {};
    c.edges = c.edges || {};
    c.notes = c.notes || {};
    if (!c.background) c.background = defaultBackground();
    if (!c.font) c.font = (c.settings && c.settings.font) || 'system';
    if (!c.badges) c.badges = 'show';
    if (c.trunk === undefined) c.trunk = true;
    if (c.snap === undefined) c.snap = true;
    if (!c.titleBlock) c.titleBlock = { show: false, title: '', subtitle: '', date: '', x: null, y: null };
    if (!c.legend) c.legend = { show: false, title: 'Key', items: [], x: null, y: null };
    if (!c.groups) c.groups = {};
    Object.keys(c.nodes).forEach(function (id) {
      var n = c.nodes[id];
      if (n.parentId) {
        var eid = uid();
        c.edges[eid] = { id: eid, from: n.parentId, to: id, color: '', width: 2, dash: 'solid', arrowStart: false, arrowEnd: true, style: 'elbow', label: '', order: Date.now() };
      }
      if ('parentId' in n) delete n.parentId;
      if (!n.shape) n.shape = 'rounded';
      if (!n.fill) n.fill = defaultFill();
      if (!n.border) n.border = defaultBorder();
      if (n.font === undefined) n.font = '';
      if (n.textColor === undefined) n.textColor = '';
      if (n.nickname === undefined) n.nickname = '';
      if (n.detail === undefined) n.detail = '';
      if (!n.avatarMode) n.avatarMode = 'auto';
      if (!n.layout) n.layout = 'stack';
      if (!n.align) n.align = (n.layout === 'row') ? 'left' : 'center';
      if (!n.fontScale) n.fontScale = 1;
      if (!n.width) n.width = NODE_W;
      // 0 / absent means "let the content decide"; a number is an explicit height.
      if (!n.height) n.height = 0;
      // Older charts stored the look purely in the shape name; give each
      // one the radius that shape used to imply so nothing shifts.
      if (typeof n.corner !== 'number') n.corner = shapeDef(n.shape).defRadius || 0;
      if (!SHAPES[n.shape]) n.shape = 'rounded';
    });
    delete c.settings;
    delete c.autoLayout;
    return c;
  }

  function ensureBootstrapChart() {
    // Tombstones, so a delete on one device propagates instead of the chart
    // being resurrected by the next pull from another device.
    if (!state.deleted) state.deleted = {};
    if (Object.keys(state.charts).length === 0) {
      var id = state.activeId || uid();
      state.charts[id] = newChartObj(id, 'My Org Chart');
      state.activeId = id;
    }
    if (!state.charts[state.activeId]) state.activeId = Object.keys(state.charts)[0];
    Object.values(state.charts).forEach(function (c) { migrateChart(c); });
  }

  function newChartObj(id, name) {
    return { id: id, name: name || 'Untitled chart', nodes: {}, edges: {}, notes: {}, background: defaultBackground(), font: 'system', badges: 'show', trunk: true, snap: true,
      titleBlock: { show: false, title: '', subtitle: '', date: '', x: null, y: null },
      legend: { show: false, title: 'Key', items: [], x: null, y: null },
      groups: {}, density: 'standard',
      version: (window.OrgChartSchema ? window.OrgChartSchema.CURRENT_SCHEMA_VERSION : 3),
      updatedAt: Date.now() };
  }

  var redoStack = [];
  var storageWarned = false;
  // `quiet` writes to disk without restamping the active chart. Sync merges by
  // updatedAt, so merely opening a chart must not make this device's copy look
  // newer than a real edit made on another device.
  function saveState(quiet) {
    if (!quiet) getActiveChart().updatedAt = Date.now();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageWarned = false;
      scheduleSyncPush();
      return true;
    } catch (e) {
      // Storage is full (photos are the usual culprit). Keep the in-memory
      // chart working rather than letting the exception kill the interaction.
      if (!storageWarned) {
        storageWarned = true;
        setTimeout(function () {
          alert('This device is out of storage space for OrgChart, so your latest changes could NOT be saved.\n\nYour chart still works right now, but changes will be lost if you close the app.\n\nTo free space: export this chart as JSON to back it up, then delete charts you no longer need, or remove some box photos (photos take the most space).');
        }, 30);
      }
      toast('⚠️ Not saved — storage full');
      return false;
    }
  }

  function getActiveChart() { return state.charts[state.activeId]; }

  // =====================================================================
  // Cloud sync (optional)
  //
  // The app stays offline-first: localStorage is always the truth for this
  // device, and every feature works with sync switched off. Sync mirrors
  // whole charts through a Supabase project the user owns, merging by
  // last-write-wins on each chart's updatedAt stamp.
  //
  // Only two security-definer functions are exposed to the anon key, and
  // both require the sync code, so the key on its own cannot read or write
  // anybody's charts. The sync code is the actual secret.
  // =====================================================================
  var SYNC_KEY = 'orgchart.sync';
  var SYNC_POLL_MS = 20000;      // background pull cadence while the app is open
  var SYNC_DEBOUNCE_MS = 1200;   // settle time after an edit before pushing

  function defaultSyncCfg() {
    return { url: '', key: '', email: '', token: '', refresh: '', expires: 0, pushed: {} };
  }
  function loadSyncCfg() {
    try {
      var raw = localStorage.getItem(SYNC_KEY);
      if (raw) {
        var c = JSON.parse(raw);
        if (!c.pushed) c.pushed = {};
        // Charts used to be grouped by a shared code. That identity is gone;
        // signing in re-uploads from whichever device you sign in on.
        if (c.space) { delete c.space; c.pushed = {}; }
        return c;
      }
    } catch (e) {}
    return defaultSyncCfg();
  }
  // Kept out of the chart store on purpose: exporting a chart must never
  // hand somebody your session.
  function saveSyncCfg() {
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncCfg)); } catch (e) {}
  }
  var syncCfg = loadSyncCfg();
  var syncState = { status: 'off', detail: '', lastOk: 0, busy: false, pending: false };
  var syncListeners = [];
  function onSyncChange(fn) { syncListeners.push(fn); }
  function setSyncStatus(status, detail) {
    syncState.status = status;
    syncState.detail = detail || '';
    syncListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
  }
  function hasProject() { return !!(syncCfg.url && syncCfg.key); }
  function signedIn() { return hasProject() && !!syncCfg.token; }
  function syncEnabled() { return signedIn(); }
  function normalizeUrl(u) { return (u || '').trim().replace(/\/+$/, ''); }

  function httpJson(path, opts) {
    opts = opts || {};
    var headers = { 'apikey': syncCfg.key, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    headers['Authorization'] = 'Bearer ' + (opts.bearer || syncCfg.token || syncCfg.key);
    if (opts.headers) Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
    return fetch(normalizeUrl(syncCfg.url) + path, {
      method: opts.method || 'POST',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var msg = (data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + res.status);
          if (res.status === 404) msg = 'Setup step missing — run the SQL in your Supabase project';
          if (res.status === 401 && /JWT|token/i.test(msg)) msg = 'Session expired';
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // ---- email sign-in --------------------------------------------------
  // Supabase's OTP endpoints, called directly so the app needs no SDK. The
  // emailed code is typed into the app rather than followed as a link: on
  // iOS a magic link opens Safari, which has separate storage from the
  // home-screen app, so the link would sign in the wrong place.
  function authRequestCode(email) {
    return httpJson('/auth/v1/otp', { bearer: syncCfg.key, body: { email: email, create_user: true } });
  }
  function authVerifyCode(email, code) {
    return httpJson('/auth/v1/verify', { bearer: syncCfg.key, body: { email: email, token: code, type: 'email' } })
      .then(function (data) {
        if (!data || !data.access_token) throw new Error('That code was not accepted');
        syncCfg.email = email;
        syncCfg.token = data.access_token;
        syncCfg.refresh = data.refresh_token || '';
        syncCfg.expires = Date.now() + ((data.expires_in || 3600) * 1000);
        syncCfg.pushed = {};
        saveSyncCfg();
        return data;
      });
  }
  function authRefresh() {
    if (!syncCfg.refresh) return Promise.reject(new Error('Signed out — sign in again'));
    return httpJson('/auth/v1/token?grant_type=refresh_token', {
      bearer: syncCfg.key,
      body: { refresh_token: syncCfg.refresh }
    }).then(function (data) {
      if (!data || !data.access_token) throw new Error('Signed out — sign in again');
      syncCfg.token = data.access_token;
      syncCfg.refresh = data.refresh_token || syncCfg.refresh;
      syncCfg.expires = Date.now() + ((data.expires_in || 3600) * 1000);
      saveSyncCfg();
      return data;
    });
  }
  function authSignOut() {
    syncCfg.email = ''; syncCfg.token = ''; syncCfg.refresh = ''; syncCfg.expires = 0; syncCfg.pushed = {};
    saveSyncCfg();
    clearInterval(syncPollTimer);
    setSyncStatus('off');
  }
  // Renew a minute before expiry rather than discovering it mid-sync.
  function withSession(fn) {
    if (!signedIn()) return Promise.reject(new Error('Not signed in'));
    var soon = Date.now() > (syncCfg.expires - 60000);
    var ready = soon ? authRefresh() : Promise.resolve();
    return ready.then(fn).catch(function (err) {
      if (err && err.status === 401 && syncCfg.refresh) return authRefresh().then(fn);
      throw err;
    });
  }

  // ---- chart transport -------------------------------------------------
  function remotePull() {
    return withSession(function () {
      return httpJson('/rest/v1/oc_charts_v2?select=chart_id,payload,deleted,updated_at', { method: 'GET' });
    });
  }
  function remoteSave(chartId, payload, deleted, stamp) {
    return withSession(function () {
      return httpJson('/rest/v1/rpc/oc_save', {
        body: { p_chart_id: chartId, p_payload: payload, p_deleted: !!deleted, p_updated_at: stamp }
      });
    });
  }

  // Charts this device has changed since the last successful push.
  function dirtyChartIds() {
    var out = [];
    Object.keys(state.charts).forEach(function (id) {
      var c = state.charts[id];
      if (syncCfg.pushed[id] !== c.updatedAt) out.push(id);
    });
    Object.keys(state.deleted || {}).forEach(function (id) {
      if (syncCfg.pushed[id] !== state.deleted[id]) out.push(id);
    });
    return out;
  }

  function syncPushOnce() {
    var ids = dirtyChartIds();
    if (!ids.length) return Promise.resolve(0);
    var chain = Promise.resolve();
    var done = 0;
    ids.forEach(function (id) {
      chain = chain.then(function () {
        var chart = state.charts[id];
        var isDel = !chart;
        var stamp = isDel ? state.deleted[id] : chart.updatedAt;
        return remoteSave(id, isDel ? null : chart, isDel, stamp).then(function () {
          syncCfg.pushed[id] = stamp;
          done++;
        });
      });
    });
    return chain.then(function () { saveSyncCfg(); return done; });
  }

  // Fold the server's rows into local state. Returns whether anything here
  // actually changed, so the caller knows whether to re-render.
  function mergeRemote(rows) {
    var changed = false;
    var activeTouched = false;
    (rows || []).forEach(function (row) {
      var id = row.chart_id;
      var stamp = Number(row.updated_at) || 0;
      var local = state.charts[id];
      var localStamp = local ? local.updatedAt : (state.deleted[id] || 0);
      // Ties go to the local copy: re-applying an identical remote row would
      // just churn the render for nothing.
      if (stamp <= localStamp) return;
      if (row.deleted) {
        if (local) {
          delete state.charts[id];
          state.deleted[id] = stamp;
          changed = true;
          if (state.activeId === id) activeTouched = true;
        }
      } else if (row.payload) {
        var incoming = row.payload;
        incoming.id = id;
        incoming.updatedAt = stamp;
        migrateChart(incoming);
        state.charts[id] = incoming;
        delete state.deleted[id];
        changed = true;
        if (state.activeId === id) activeTouched = true;
      }
      // Remote is now the newest thing we know about, so nothing to push back.
      syncCfg.pushed[id] = stamp;
    });
    if (changed) {
      if (!Object.keys(state.charts).length) ensureBootstrapChart();
      if (!state.charts[state.activeId]) {
        state.activeId = Object.keys(state.charts)[0];
        activeTouched = true;
      }
      saveState(true);
      saveSyncCfg();
    }
    return { changed: changed, activeTouched: activeTouched };
  }

  function syncNow(opts) {
    opts = opts || {};
    if (!syncEnabled()) return Promise.resolve(false);
    if (syncState.busy) { syncState.pending = true; return Promise.resolve(false); }
    syncState.busy = true;
    setSyncStatus('syncing');
    // Push first so this device's edits are on the server before the pull
    // decides who wins.
    return syncPushOnce()
      .then(remotePull)
      .then(function (rows) {
        var res = mergeRemote(rows);
        saveSyncCfg();
        syncState.lastOk = Date.now();
        setSyncStatus('ok');
        if (res.changed) {
          render();
          renderChartList();
          if (res.activeTouched) fitToScreen();
          if (!opts.silentToast) toast('Synced — chart updated from your other device');
        } else if (opts.announce) {
          toast('Synced');
        }
        return res.changed;
      })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : 'Sync failed';
        setSyncStatus('error', msg);
        if (opts.announce) toast('Sync failed — ' + msg);
        return false;
      })
      .then(function (r) {
        syncState.busy = false;
        if (syncState.pending) { syncState.pending = false; setTimeout(function () { syncNow({ silentToast: true }); }, 200); }
        return r;
      });
  }

  var syncPushTimer = null;
  function scheduleSyncPush() {
    if (!syncEnabled()) return;
    // Nothing local has changed — a merge that just wrote to disk shouldn't
    // bounce straight back into another round trip.
    if (!dirtyChartIds().length) return;
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(function () { syncNow({ silentToast: true }); }, SYNC_DEBOUNCE_MS);
  }

  var syncPollTimer = null;
  function startSyncLoop() {
    clearInterval(syncPollTimer);
    if (!syncEnabled()) { setSyncStatus('off'); return; }
    syncPollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') syncNow({ silentToast: false });
    }, SYNC_POLL_MS);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') syncNow({ silentToast: false });
  });
  window.addEventListener('online', function () { syncNow({ silentToast: true }); });

  // ---------------------------------------------------------------------
  // Colour sets sheet
  // ---------------------------------------------------------------------
  var paletteBackdrop = $('paletteBackdrop'), paletteSheet = $('paletteSheet');
  var palDraft = [];

  function openPaletteSheet() {
    renderPaletteList();
    renderPalDraft();
    paletteBackdrop.classList.add('show');
    paletteSheet.classList.add('show');
  }
  function closePaletteSheet() { paletteBackdrop.classList.remove('show'); paletteSheet.classList.remove('show'); }

  function renderPaletteList() {
    var box = $('paletteList');
    box.innerHTML = '';
    var rows = [{ id: 'builtin', name: 'Built-in', colors: BUILTIN_SWATCHES }];
    Object.keys(palettes.sets).forEach(function (id) {
      rows.push({ id: id, name: palettes.sets[id].name, colors: palettes.sets[id].colors, custom: true });
    });
    rows.forEach(function (set) {
      var row = document.createElement('div');
      row.className = 'palrow' + (palettes.activeId === set.id ? ' active' : '');
      row.innerHTML =
        '<div class="pname">' + (palettes.activeId === set.id ? '\u25cf ' : '') + escapeHtml(set.name) + '</div>' +
        '<div class="pdots">' + set.colors.slice(0, 6).map(function (c) {
          return '<i style="background:' + c + '"></i>';
        }).join('') + '</div>' +
        '<button class="rowbtn" data-act="use">Use</button>' +
        (set.custom ? '<button class="rowbtn danger" data-act="del">Delete</button>' : '');
      row.querySelector('[data-act="use"]').addEventListener('click', function () {
        palettes.activeId = set.id;
        savePalettes();
        applyActivePalette();
        renderPaletteList();
        toast('Using “' + set.name + '”');
      });
      var del = row.querySelector('[data-act="del"]');
      if (del) del.addEventListener('click', function () {
        if (!window.confirm('Delete the colour set “' + set.name + '”?\n\nCharts keep the colours they already use.')) return;
        delete palettes.sets[set.id];
        if (palettes.activeId === set.id) palettes.activeId = 'builtin';
        savePalettes();
        applyActivePalette();
        renderPaletteList();
      });
      box.appendChild(row);
    });
  }

  function renderPalDraft() {
    var box = $('palSwatches');
    box.innerHTML = '';
    if (!palDraft.length) {
      box.innerHTML = '<span class="smallmuted">No colours yet — add some, or pull them out of a picture.</span>';
      return;
    }
    palDraft.forEach(function (c, i) {
      var wrap = document.createElement('div');
      wrap.className = 'palwrap';
      wrap.innerHTML = '<button class="swatch" style="background:' + c + '"></button>'
        + '<button class="del" aria-label="Remove">\u00d7</button>';
      wrap.querySelector('.del').addEventListener('click', function () {
        palDraft.splice(i, 1);
        renderPalDraft();
      });
      box.appendChild(wrap);
    });
  }

  $('paletteOpenBtn').addEventListener('click', function () { closeMenu(); setTimeout(openPaletteSheet, 120); });
  $('paletteCloseBtn').addEventListener('click', closePaletteSheet);
  paletteBackdrop.addEventListener('click', function (e) { if (e.target === paletteBackdrop) closePaletteSheet(); });

  $('palAddColor').addEventListener('click', function () {
    // The OS colour picker is the only sane way to choose a colour on a phone.
    var inp = document.createElement('input');
    inp.type = 'color';
    inp.value = palDraft[palDraft.length - 1] || '#3568d4';
    inp.style.cssText = 'position:fixed;left:-100px;top:0;opacity:0;';
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      palDraft.push(inp.value);
      renderPalDraft();
      inp.remove();
    });
    inp.click();
  });

  var paletteFile = $('paletteFile');
  $('palFromImage').addEventListener('click', function () { paletteFile.value = ''; paletteFile.click(); });
  paletteFile.addEventListener('change', function () {
    var file = paletteFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var found = extractPalette(img, 6);
        if (!found.length) { toast('Could not read colours from that picture'); return; }
        // Add to whatever is already in the draft rather than replacing it.
        found.forEach(function (c) { if (palDraft.indexOf(c) === -1) palDraft.push(c); });
        renderPalDraft();
        if (!$('palName').value.trim()) $('palName').value = 'From picture';
        toast('Pulled ' + found.length + ' colours out of that picture');
      };
      img.onerror = function () { toast('That file could not be opened as an image'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  $('palClear').addEventListener('click', function () { palDraft = []; $('palName').value = ''; renderPalDraft(); });
  $('palSave').addEventListener('click', function () {
    if (!palDraft.length) { toast('Add at least one colour first'); return; }
    var name = $('palName').value.trim() || 'My colours';
    var id = uid();
    palettes.sets[id] = { name: name, colors: palDraft.slice() };
    palettes.activeId = id;
    savePalettes();
    applyActivePalette();
    palDraft = [];
    $('palName').value = '';
    renderPalDraft();
    renderPaletteList();
    toast('Saved “' + name + '” and switched to it');
  });

  // ---------------------------------------------------------------------
  // Sync sheet
  // ---------------------------------------------------------------------
  var SYNC_SQL = [
    'create table if not exists public.oc_charts_v2 (',
    '  user_id    uuid    not null references auth.users(id) on delete cascade,',
    '  chart_id   text    not null,',
    '  payload    jsonb,',
    '  deleted    boolean not null default false,',
    '  updated_at bigint  not null,',
    '  primary key (user_id, chart_id)',
    ');',
    '',
    'alter table public.oc_charts_v2 enable row level security;',
    '',
    'drop policy if exists "read own charts"   on public.oc_charts_v2;',
    'drop policy if exists "insert own charts" on public.oc_charts_v2;',
    'drop policy if exists "update own charts" on public.oc_charts_v2;',
    '',
    'create policy "read own charts" on public.oc_charts_v2',
    '  for select to authenticated using (user_id = auth.uid());',
    'create policy "insert own charts" on public.oc_charts_v2',
    '  for insert to authenticated with check (user_id = auth.uid());',
    'create policy "update own charts" on public.oc_charts_v2',
    '  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());',
    '',
    'grant select, insert, update on public.oc_charts_v2 to authenticated;',
    '',
    '-- Saving goes through this so an older write can never clobber a newer one:',
    '-- a device that was offline for a while comes back and loses politely.',
    '-- security invoker, so RLS still applies and auth.uid() is the caller.',
    'create or replace function public.oc_save(',
    '  p_chart_id text,',
    '  p_payload jsonb,',
    '  p_deleted boolean,',
    '  p_updated_at bigint',
    ') returns bigint',
    'language plpgsql',
    'security invoker',
    'set search_path = public',
    'as $$',
    'declare',
    '  v_existing bigint;',
    '  v_uid uuid := auth.uid();',
    'begin',
    '  if v_uid is null then',
    '    raise exception \'not signed in\';',
    '  end if;',
    '',
    '  select c.updated_at into v_existing',
    '  from public.oc_charts_v2 c',
    '  where c.user_id = v_uid and c.chart_id = p_chart_id;',
    '',
    '  if v_existing is not null and v_existing >= p_updated_at then',
    '    return v_existing;',
    '  end if;',
    '',
    '  insert into public.oc_charts_v2 (user_id, chart_id, payload, deleted, updated_at)',
    '  values (v_uid, p_chart_id, p_payload, coalesce(p_deleted, false), p_updated_at)',
    '  on conflict (user_id, chart_id) do update',
    '    set payload = excluded.payload,',
    '        deleted = excluded.deleted,',
    '        updated_at = excluded.updated_at;',
    '',
    '  return p_updated_at;',
    'end;',
    '$$;',
    '',
    'grant execute on function public.oc_save(text, jsonb, boolean, bigint) to authenticated;'
  ].join('\n');

  var syncBackdrop = $('syncBackdrop'), syncSheet = $('syncSheet');
  function openSyncSheet() {
    $('syncUrl').value = syncCfg.url || '';
    $('syncKey').value = syncCfg.key || '';
    $('authEmail').value = syncCfg.email || '';
    $('syncSqlBox').textContent = SYNC_SQL;
    refreshSyncUi();
    syncBackdrop.classList.add('show');
    syncSheet.classList.add('show');
  }
  function closeSyncSheet() { syncBackdrop.classList.remove('show'); syncSheet.classList.remove('show'); }

  function agoText(ts) {
    if (!ts) return '';
    var secs = Math.round((Date.now() - ts) / 1000);
    if (secs < 10) return 'just now';
    if (secs < 60) return secs + 's ago';
    if (secs < 3600) return Math.round(secs / 60) + ' min ago';
    return Math.round(secs / 3600) + ' h ago';
  }
  function refreshSyncUi() {
    var dot = $('syncDot'), text = $('syncStatusText'), detail = $('syncStatusDetail');
    var menuDot = $('menuSyncDot'), menuLabel = $('menuSyncLabel');
    var cls = 'syncdot', label = 'Off', sub = 'Charts stay on this device only.';
    if (!signedIn()) {
      label = hasProject() ? 'Not signed in' : 'Off';
      sub = hasProject() ? 'Enter your email below to start syncing.' : 'Charts stay on this device only.';
    } else if (syncState.status === 'error') {
      cls += ' error'; label = 'Problem syncing'; sub = syncState.detail || 'Could not reach your project.';
    } else if (syncState.status === 'syncing') {
      cls += ' syncing'; label = 'Syncing…'; sub = '';
    } else {
      cls += ' ok'; label = 'On'; sub = syncState.lastOk ? 'Last synced ' + agoText(syncState.lastOk) : 'Waiting for first sync…';
    }
    if (dot) dot.className = cls;
    if (text) text.textContent = label;
    if (detail) detail.textContent = sub;
    if (menuDot) menuDot.className = cls;
    if (menuLabel) menuLabel.textContent = signedIn() ? ('Sync — ' + label.toLowerCase()) : 'Sync across devices';
    var chip = $('syncChip');
    if (chip) {
      chip.className = signedIn() ? (syncState.status === 'error' ? 'error' : (syncState.status === 'ok' ? 'ok' : '')) : '';
      chip.querySelector('.syncdot').className = cls;
      var chipLabel = !signedIn() ? 'Sync off'
        : (syncState.status === 'error' ? 'Sync problem' : (syncState.status === 'syncing' ? 'Syncing' : 'Synced'));
      $('syncChipText').textContent = chipLabel;
      // The visible text is CSS-gated to the error state; screen readers and
      // the tests still get the full status here.
      chip.setAttribute('aria-label', chipLabel);
      chip.title = chipLabel;
    }
    var inEl = $('signedInBlock'), outEl = $('signedOutBlock');
    if (inEl && outEl) {
      inEl.style.display = signedIn() ? 'block' : 'none';
      outEl.style.display = signedIn() ? 'none' : 'block';
      if (signedIn()) $('authWho').textContent = syncCfg.email;
    }
  }
  onSyncChange(refreshSyncUi);
  setInterval(function () { if (signedIn()) refreshSyncUi(); }, 15000);

  $('syncOpenBtn').addEventListener('click', function () { closeMenu(); setTimeout(openSyncSheet, 120); });
  $('syncChip').addEventListener('click', openSyncSheet);
  $('syncCloseBtn').addEventListener('click', closeSyncSheet);
  syncBackdrop.addEventListener('click', function (e) { if (e.target === syncBackdrop) closeSyncSheet(); });
  $('syncSqlCopyBtn').addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(SYNC_SQL).then(function () { toast('SQL copied — paste it into Supabase'); })
        .catch(function () { toast('Could not copy — select it by hand'); });
    } else toast('Could not copy — select it by hand');
  });

  function saveProjectFields() {
    var url = normalizeUrl($('syncUrl').value);
    var key = $('syncKey').value.trim();
    if (!/^https?:\/\//.test(url)) { alert('The Project URL should start with https:// — copy it from Supabase → Project Settings → API.'); return false; }
    if (!key) { alert('Paste the anon public key from Supabase → Project Settings → API.'); return false; }
    // Pointing at a different project invalidates any session held for the old one.
    if (syncCfg.url !== url || syncCfg.key !== key) {
      syncCfg.url = url; syncCfg.key = key;
      syncCfg.token = ''; syncCfg.refresh = ''; syncCfg.expires = 0; syncCfg.pushed = {};
    }
    saveSyncCfg();
    refreshSyncUi();
    return true;
  }
  $('syncSaveProjectBtn').addEventListener('click', function () {
    if (saveProjectFields()) toast('Project saved — now sign in');
  });

  function emailValue() { return ($('authEmail').value || '').trim().toLowerCase(); }
  function sendCode() {
    if (!saveProjectFields()) return;
    var email = emailValue();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('Enter a valid email address.'); return; }
    $('authSendBtn').disabled = true;
    authRequestCode(email)
      .then(function () {
        $('authCodeBlock').style.display = 'block';
        $('authCode').focus();
        toast('Code sent to ' + email);
      })
      .catch(function (err) {
        alert('Could not send the code:\n\n' + (err.message || err) + '\n\nTap "Test connection" for a step-by-step check.');
      })
      .then(function () { $('authSendBtn').disabled = false; });
  }
  $('authSendBtn').addEventListener('click', sendCode);
  $('authResendBtn').addEventListener('click', sendCode);

  $('authVerifyBtn').addEventListener('click', function () {
    var email = emailValue();
    var code = ($('authCode').value || '').replace(/\D/g, '');
    if (code.length < 6) { alert('Enter the 6-digit code from the email.'); return; }
    $('authVerifyBtn').disabled = true;
    authVerifyCode(email, code)
      .then(function () {
        $('authCodeBlock').style.display = 'none';
        $('authCode').value = '';
        refreshSyncUi();
        startSyncLoop();
        return syncNow({ silentToast: true });
      })
      .then(function () {
        refreshSyncUi();
        var n = Object.keys(state.charts).length;
        alert('Signed in as ' + syncCfg.email + '.\n\nYou have ' + n + ' chart' + (n === 1 ? '' : 's') + ' here, kept in step automatically.\n\nSign in with the same email on your other device and they will meet.');
      })
      .catch(function (err) {
        alert('Sign-in failed:\n\n' + (err.message || err));
      })
      .then(function () { $('authVerifyBtn').disabled = false; });
  });

  $('authSignOutBtn').addEventListener('click', function () {
    if (!window.confirm('Sign out on this device?\n\nYour charts stay here, and the copies in your account stay where they are.')) return;
    authSignOut();
    refreshSyncUi();
    toast('Signed out');
  });
  $('syncNowBtn2').addEventListener('click', function () {
    if (!signedIn()) { toast('Sign in first'); return; }
    syncNow({ announce: true });
  });

  // A real round trip that names the failing step. "It isn't syncing" is
  // almost always one of: project details missing, not signed in on this
  // device, or the SQL never run — and those look identical without this.
  $('syncTestBtn').addEventListener('click', function () {
    var out = $('syncReport');
    var url = normalizeUrl($('syncUrl').value);
    var key = $('syncKey').value.trim();
    var lines = [];
    function show() { out.style.display = 'block'; out.textContent = lines.join('\n'); }

    if (!/^https?:\/\//.test(url) || !key) {
      lines = [
        (/^https?:\/\//.test(url) ? 'OK  ' : 'X   ') + 'Project URL',
        (key ? 'OK  ' : 'X   ') + 'Anon key',
        '',
        'Fill in whatever is marked X, then Save project details.'
      ];
      show();
      return;
    }
    lines = ['OK  Project URL', 'OK  Anon key'];
    if (!signedIn()) {
      lines.push('X   Not signed in on this device');
      lines.push('');
      lines.push('Enter your email above and tap "Email me a');
      lines.push('sign-in code". Use the SAME email as your other');
      lines.push('device — that is what pairs them.');
      show();
      return;
    }
    lines.push('OK  Signed in as ' + syncCfg.email);
    lines.push('Reading your charts…');
    show();

    remotePull()
      .then(function (rows) {
        var live = (rows || []).filter(function (r) { return !r.deleted; });
        lines[lines.length - 1] = 'OK  Read your account';
        lines.push('');
        lines.push('Your account holds ' + live.length + ' chart' + (live.length === 1 ? '' : 's') + '.');
        if (!live.length) {
          lines.push('');
          lines.push('Nothing uploaded yet. Make an edit and it should');
          lines.push('appear within a few seconds.');
        } else {
          lines.push('');
          live.slice(0, 8).forEach(function (r) {
            lines.push('  • ' + ((r.payload && r.payload.name) || '(unnamed)'));
          });
          lines.push('');
          lines.push('If any are missing here, tap Sync now.');
        }
        show();
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'unknown error';
        lines[lines.length - 1] = 'X   ' + msg;
        lines.push('');
        if (/Setup step missing|Could not find|relation/i.test(msg)) {
          lines.push('The table is not there. Copy the SQL below into');
          lines.push('your Supabase SQL Editor and press Run.');
        } else if (/Signed out|expired|JWT/i.test(msg)) {
          lines.push('Your session ended. Sign in again above.');
        } else {
          lines.push('Could not reach the project. Check the URL and');
          lines.push('that this device is online.');
        }
        show();
      });
  });
  function snapshot() { return JSON.stringify(state.charts[state.activeId]); }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0; // a fresh edit invalidates the redo trail
  }
  // Commit an undo entry captured before an interactive drag began.
  function commitUndo(snap) {
    if (!snap) return;
    undoStack.push(snap);
    if (undoStack.length > 40) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    if (!undoStack.length) { toast('Nothing to undo'); return; }
    redoStack.push(snapshot());
    state.charts[state.activeId] = JSON.parse(undoStack.pop());
    saveState(); render(); applyChartVars(); toast('Undone');
  }
  function redo() {
    if (!redoStack.length) { toast('Nothing to redo'); return; }
    undoStack.push(snapshot());
    state.charts[state.activeId] = JSON.parse(redoStack.pop());
    saveState(); render(); applyChartVars(); toast('Redone');
  }

  // ---------------------------------------------------------------------
  // Texture helpers (shared by live CSS render and SVG export)
  // ---------------------------------------------------------------------
  // Texture scale multiplies every tile size, so the same pattern can read as
  // fine paper or bold graphics. Kept in step with svgPatternDef, which draws
  // the export copy — the two must agree or a PDF stops matching the screen.
  function texScale(sc) { return Math.max(0.5, Math.min(3, sc || 1)); }
  function textureCss(pattern, ink, base, sc) {
    ink = ink || '#3568d4';
    base = base || 'var(--panel)';
    var k = texScale(sc);
    var u = function (n) { return (n * k).toFixed(2) + 'px'; };
    switch (pattern) {
      case 'dots': return 'radial-gradient(' + ink + '55 ' + u(1.3) + ', transparent ' + u(1.3) + ') 0 0/' + u(11) + ' ' + u(11) + ', ' + base;
      case 'bigdots': return 'radial-gradient(' + ink + '45 ' + u(3) + ', transparent ' + u(3) + ') 0 0/' + u(20) + ' ' + u(20) + ', ' + base;
      case 'lines': return 'repeating-linear-gradient(45deg, ' + ink + '40 0 ' + u(2) + ', transparent ' + u(2) + ' ' + u(9) + '), ' + base;
      case 'vlines': return 'repeating-linear-gradient(90deg, ' + ink + '35 0 ' + u(1.5) + ', transparent ' + u(1.5) + ' ' + u(10) + '), ' + base;
      case 'hlines': return 'repeating-linear-gradient(0deg, ' + ink + '35 0 ' + u(1.5) + ', transparent ' + u(1.5) + ' ' + u(10) + '), ' + base;
      case 'grid': return 'linear-gradient(' + ink + '30 ' + u(1) + ', transparent ' + u(1) + ') 0 0/' + u(14) + ' ' + u(14) + ', linear-gradient(90deg, ' + ink + '30 ' + u(1) + ', transparent ' + u(1) + ') 0 0/' + u(14) + ' ' + u(14) + ', ' + base;
      case 'graph': return 'linear-gradient(' + ink + '22 ' + u(1) + ', transparent ' + u(1) + ') 0 0/' + u(8) + ' ' + u(8) + ', linear-gradient(90deg, ' + ink + '22 ' + u(1) + ', transparent ' + u(1) + ') 0 0/' + u(8) + ' ' + u(8) + ', linear-gradient(' + ink + '44 ' + u(1.4) + ', transparent ' + u(1.4) + ') 0 0/' + u(40) + ' ' + u(40) + ', linear-gradient(90deg, ' + ink + '44 ' + u(1.4) + ', transparent ' + u(1.4) + ') 0 0/' + u(40) + ' ' + u(40) + ', ' + base;
      case 'cross': return 'repeating-linear-gradient(45deg, ' + ink + '30 0 ' + u(2) + ', transparent ' + u(2) + ' ' + u(10) + '), repeating-linear-gradient(-45deg, ' + ink + '30 0 ' + u(2) + ', transparent ' + u(2) + ' ' + u(10) + '), ' + base;
      case 'checks': return 'conic-gradient(' + ink + '22 0 25%, transparent 0 50%, ' + ink + '22 0 75%, transparent 0) 0 0/' + u(18) + ' ' + u(18) + ', ' + base;
      case 'zigzag': return 'repeating-linear-gradient(135deg, ' + ink + '2e 0 ' + u(2) + ', transparent ' + u(2) + ' ' + u(8) + '), repeating-linear-gradient(45deg, ' + ink + '2e 0 ' + u(2) + ', transparent ' + u(2) + ' ' + u(8) + '), ' + base;
      case 'weave': return 'repeating-linear-gradient(0deg, ' + ink + '22 0 ' + u(3) + ', transparent ' + u(3) + ' ' + u(6) + '), repeating-linear-gradient(90deg, ' + ink + '22 0 ' + u(3) + ', transparent ' + u(3) + ' ' + u(6) + '), ' + base;
      default: return base;
    }
  }
  var TEXTURE_KEYS = ['none', 'dots', 'bigdots', 'lines', 'vlines', 'hlines', 'grid', 'graph', 'cross', 'checks', 'zigzag', 'weave'];

  // ---------------------------------------------------------------------
  // Contrast helpers — keep box text legible on any fill the user picks
  // ---------------------------------------------------------------------
  function hexToRgb(hex) {
    if (!hex || hex.charAt(0) !== '#') return null;
    var h = hex.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    var v = parseInt(h, 16);
    if (isNaN(v)) return null;
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  function luminance(hex) {
    var c = hexToRgb(hex);
    if (!c) return null;
    var f = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  // The colour actually sitting behind a box's text, or null when the box
  // just uses the theme's card colour.
  function effectiveFillColor(n) {
    var fill = n.fill || defaultFill();
    if (fill.type === 'gradient') return fill.color || fill.color2 || null;
    if (fill.type === 'texture') return null; // texture keeps the panel base behind it
    return fill.color || null;
  }
  function textColorsFor(n) {
    if (n.textColor) return { name: n.textColor, title: n.textColor, titleOpacity: 0.75 };
    var bg = effectiveFillColor(n);
    var lum = bg === null ? null : luminance(bg);
    if (lum === null) return { name: '', title: '', titleOpacity: 1 }; // inherit theme colours
    var light = lum < 0.5;
    return light
      ? { name: '#ffffff', title: 'rgba(255,255,255,.82)', titleOpacity: 1 }
      : { name: '#16202b', title: 'rgba(22,32,43,.72)', titleOpacity: 1 };
  }

  // ---------------------------------------------------------------------
  // Geometry: rect + anchor points for arbitrary (non-tree) connections
  // ---------------------------------------------------------------------
  function nodeRect(n, h) {
    var w = nodeW(n);
    return { left: n.x, top: n.y, right: n.x + w, bottom: n.y + h, cx: n.x + w / 2, cy: n.y + h / 2, w: w, h: h };
  }
  function anchorOnNode(n, h, towardX, towardY) {
    var rect = nodeRect(n, h);
    var dx = towardX - rect.cx, dy = towardY - rect.cy;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dx = 1;
    if (n.shape === 'circle') {
      var r = rect.w / 2;
      var len = Math.hypot(dx, dy) || 1;
      return { x: rect.cx + (dx / len) * r, y: rect.cy + (dy / len) * r };
    }
    var halfW = rect.w / 2, halfH = rect.h / 2;
    var scaleX = halfW / (Math.abs(dx) || 1e-6), scaleY = halfH / (Math.abs(dy) || 1e-6);
    var s = Math.min(scaleX, scaleY);
    return { x: rect.cx + dx * s, y: rect.cy + dy * s };
  }

  function edgePathBetween(pA, pB, style) {
    var x1 = pA.x, y1 = pA.y, x2 = pB.x, y2 = pB.y;
    if (style === 'straight') return 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2;
    if (style === 'elbow') {
      if (Math.abs(x2 - x1) > Math.abs(y2 - y1)) {
        var midX = (x1 + x2) / 2;
        return 'M ' + x1 + ' ' + y1 + ' L ' + midX + ' ' + y1 + ' L ' + midX + ' ' + y2 + ' L ' + x2 + ' ' + y2;
      }
      var midY = (y1 + y2) / 2;
      return 'M ' + x1 + ' ' + y1 + ' L ' + x1 + ' ' + midY + ' L ' + x2 + ' ' + midY + ' L ' + x2 + ' ' + y2;
    }
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.hypot(dx, dy) || 1;
    var px = -dy / len, py = dx / len;
    var bow = Math.min(len * 0.18, 60);
    var c1x = x1 + dx * 0.33 + px * bow, c1y = y1 + dy * 0.33 + py * bow;
    var c2x = x1 + dx * 0.67 + px * bow, c2y = y1 + dy * 0.67 + py * bow;
    return 'M ' + x1 + ' ' + y1 + ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + x2 + ' ' + y2;
  }

  // -------------------------------------------------------------------
  // Sibling trunk routing
  // -------------------------------------------------------------------
  // Classic org-chart connectors: one line drops from the parent to a
  // shared horizontal bus, then one short drop per child — instead of a
  // separate elbow fanning out to each child. Returns a map of
  // edgeId -> path string for every edge that qualifies.
  function computeTrunkPaths(chart, heightOf) {
    var out = {};
    if (chart.trunk === false) return out;
    var byParent = {};
    Object.keys(chart.edges).forEach(function (id) {
      var e = chart.edges[id];
      if ((e.style || 'elbow') !== 'elbow') return;
      var a = chart.nodes[e.from], b = chart.nodes[e.to];
      if (!a || !b) return;
      // Only when the child genuinely hangs below the parent.
      if (b.y <= a.y + heightOf(e.from) - 1) return;
      // Group by parent *and* stroke look, so differently styled lines
      // (e.g. a dotted-line report) keep their own trunk.
      var key = e.from + '|' + (e.color || '') + '|' + (e.width || 2) + '|' + (e.dash || 'solid');
      (byParent[key] = byParent[key] || []).push(id);
    });
    Object.keys(byParent).forEach(function (key) {
      var ids = byParent[key];
      if (ids.length < 2) return;           // a lone child needs no trunk
      var parentId = chart.edges[ids[0]].from;
      var p = chart.nodes[parentId];
      var pH = heightOf(parentId);
      var pBottom = p.y + pH;
      var childTop = Infinity;
      ids.forEach(function (id) { childTop = Math.min(childTop, chart.nodes[chart.edges[id].to].y); });
      if (childTop <= pBottom) return;      // overlapping — fall back to normal elbows
      var busY = (pBottom + childTop) / 2;
      var px = p.x + nodeW(p) / 2;
      ids.forEach(function (id) {
        var c = chart.nodes[chart.edges[id].to];
        var cxx = c.x + nodeW(c) / 2;
        out[id] = 'M ' + px + ' ' + pBottom + ' L ' + px + ' ' + busY +
                  ' L ' + cxx + ' ' + busY + ' L ' + cxx + ' ' + c.y;
      });
    });
    return out;
  }

  function midOfPath(pA, pB, style) {
    if (style === 'elbow') {
      if (Math.abs(pB.x - pA.x) > Math.abs(pA.y - pB.y)) return { x: (pA.x + pB.x) / 2, y: pA.y };
      return { x: pA.x, y: (pA.y + pB.y) / 2 };
    }
    return { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  var nodeEls = {}, noteEls = {};

  function applyTransform() { canvas.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')'; }

  // Per-box overrides, with back-compatible defaults for older saved charts.
  function nodeW(n) { return (n && n.width) || NODE_W; }
  function nodeScale(n) { return (n && n.fontScale) || 1; }
  function isFixedAspect(n) { return isFixedAspectShape(n && n.shape); }
  // The height a box is *forced* to, or 0 when it should size to its content.
  // Circles and squares always mirror their width.
  function forcedH(n) { return isFixedAspect(n) ? nodeW(n) : ((n && n.height) || 0); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    // One word: show up to two characters ("JW" -> "JW", "Jesse" -> "JE"),
    // rather than a lone letter.
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // What the avatar circle shows when there's no photo: an explicit badge/
  // nickname if the user gave one, otherwise derived initials.
  function badgeText(n) {
    var nick = (n.nickname || '').trim();
    return nick || initials(n.name);
  }
  function showsAvatar(n) {
    var mode = n.avatarMode || 'auto';
    if (mode === 'none') return false;
    return true;
  }
  function showsPhoto(n) {
    return !!n.photo && (n.avatarMode || 'auto') === 'auto';
  }
  // Anything longer than plain initials gets a pill-shaped badge, so a
  // nickname stays legible instead of shrinking to fit a small circle.
  // "Photo only" needs an actual photo; without one it would render an empty
  // box, so it quietly falls back to the normal card until a picture exists.
  function isPhotoOnly(n) { return (n.layout === 'photo') && !!n.photo; }

  function badgeIsPill(n) {
    return !showsPhoto(n) && badgeText(n).length > 3;
  }

  function applyChartVars() {
    var chart = getActiveChart();
    document.documentElement.style.setProperty('--chart-font', FONT_STACKS[chart.font] || FONT_STACKS.system);
    var bg = chart.background || defaultBackground();
    var css;
    if (bg.type === 'gradient') css = 'linear-gradient(' + fillAngle(bg) + 'deg, ' + (bg.color || 'var(--panel2)') + ', ' + (bg.color2 || 'var(--bg)') + ')';
    else if (bg.type === 'texture') css = textureCss(bg.texture, bg.color || '#6b7684', bgBase(bg), bg.scale);
    else css = bg.color || 'var(--bg)';
    stage.style.background = css;
  }

  function applyNodeStyle(el, n) {
    el.dataset.shape = n.shape || 'rounded';
    el.dataset.layout = n.layout || 'stack';
    el.dataset.align = n.align || 'center';
    var w = nodeW(n);
    var fs = nodeScale(n);
    var fh = forcedH(n);
    el.style.width = w + 'px';
    el.style.height = fh ? fh + 'px' : '';
    el.dataset.fixedh = (fh && !isFixedAspect(n)) ? '1' : '0';
    // Shapes that taper have to give the text some room, or a hexagon's
    // wording runs straight out through its slanted sides.
    var sdef = shapeDef(n.shape);
    var padX = Math.round(12 * fs + w * (sdef.insetX || 0));
    var padY = Math.round(10 * fs + (fh || NODE_H_APPROX) * (sdef.insetY || 0));
    el.style.padding = padY + 'px ' + padX + 'px';
    var av = el.querySelector('.avatar');
    var avSize = AVATAR_SIZES[fs] || Math.round(44 * fs);
    av.style.width = avSize + 'px';
    av.style.height = avSize + 'px';
    var pill = badgeIsPill(n);
    av.classList.toggle('pill', pill);
    // A short badge shrinks to fit its circle; a pill grows sideways instead,
    // so the text keeps a readable size either way.
    var chars = showsPhoto(n) ? 2 : Math.max(1, badgeText(n).length);
    var badgeFs = pill ? Math.min(14 * fs, avSize * 0.42)
      : Math.min(15 * fs, (avSize * 0.86) / chars * 1.55);
    av.style.fontSize = badgeFs.toFixed(1) + 'px';
    av.style.padding = pill ? '0 ' + Math.round(avSize * 0.28) + 'px' : '0 2px';
    av.style.minWidth = pill ? avSize + 'px' : '';
    var photoOnly = isPhotoOnly(n);
    av.style.display = (showsAvatar(n) && !photoOnly) ? 'flex' : 'none';
    el.querySelector('.ntext').style.display = photoOnly ? 'none' : 'flex';
    if (photoOnly) el.style.padding = '0';
    el.querySelector('.nname').style.fontSize = (14.5 * fs).toFixed(1) + 'px';
    el.querySelector('.ntitle').style.fontSize = (12 * fs).toFixed(1) + 'px';
    el.querySelector('.ndetail').style.fontSize = (11 * fs).toFixed(1) + 'px';
    el.style.fontFamily = n.font ? FONT_STACKS[n.font] : '';
    var tc = textColorsFor(n);
    el.querySelector('.nname').style.color = tc.name;
    el.querySelector('.ntitle').style.color = tc.title;
    el.querySelector('.ndetail').style.color = tc.title;
    drawNodeShape(el, n);
  }

  // Paints the card's outline into its own SVG layer. The card itself is a
  // transparent box; everything visible — fill, gradient, texture, border —
  // lives on this path, which is the same path the exporter draws.
  var shapeSeq = 0;
  function drawNodeShape(el, n) {
    var svg = el.querySelector('.shapelayer');
    if (!svg) return;
    var w = el.offsetWidth || nodeW(n);
    var h = el.offsetHeight || NODE_H_APPROX;
    if (!w || !h) return;
    var def = shapeDef(n.shape);
    var border = n.border || defaultBorder();
    var sw = border.width || 1;
    // Stroke straddles the path, so inset by half of it to keep the outline
    // inside the card's own box rather than bleeding over its neighbours.
    var iw = Math.max(1, w - sw), ih = Math.max(1, h - sw);
    var fill = n.fill || defaultFill();
    var uid2 = 's' + (++shapeSeq);
    var defs = '';
    var fillAttr;
    if (fill.type === 'gradient') {
      var gv = angleVector(fillAngle(fill));
      defs += '<linearGradient id="' + uid2 + 'g" x1="' + gv.x1 + '" y1="' + gv.y1 + '" x2="' + gv.x2 + '" y2="' + gv.y2 + '">'
        + '<stop offset="0" stop-color="' + (fill.color || '#dfe6f2') + '"/>'
        + '<stop offset="1" stop-color="' + (fill.color2 || '#c3d1ea') + '"/></linearGradient>';
      fillAttr = 'url(#' + uid2 + 'g)';
    } else if (fill.type === 'texture' && fill.texture !== 'none') {
      defs += svgPatternDef(uid2 + 'p', fill.texture, fill.color || n.color || '#3568d4', cssVar('--panel'), fill.scale);
      fillAttr = 'url(#' + uid2 + 'p)';
    } else {
      fillAttr = fill.color || cssVar('--panel');
    }
    var stroke = border.color || cssVar('--line');
    var dash = border.dash === 'dashed' ? (sw * 2.5) + ' ' + (sw * 2)
      : (border.dash === 'dotted' ? '1 ' + (sw * 2.2) : '');
    var d = shapePath(n.shape, iw, ih, cornerRadius(n));
    var extra = '';
    // Photo-only cards clip the picture to the outline itself, so the image
    // takes the shape rather than sitting in a rectangle behind it.
    if (isPhotoOnly(n)) {
      defs += '<clipPath id="' + uid2 + 'c"><path d="' + d + '"/></clipPath>';
      extra += '<image href="' + n.photo + '" x="0" y="0" width="' + iw + '" height="' + ih + '"'
        + ' preserveAspectRatio="xMidYMid slice" clip-path="url(#' + uid2 + 'c)"/>';
      fillAttr = 'none';
    }
    if (def.kind === 'cylinder') {
      extra = '<path d="' + cylinderLip(iw, ih).lip + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '" opacity=".55"/>';
    }
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.innerHTML = (defs ? '<defs>' + defs + '</defs>' : '')
      + '<g transform="translate(' + (sw / 2) + ',' + (sw / 2) + ')">'
      + '<path d="' + d + '" fill="' + fillAttr + '" stroke="none"/>'
      + extra
      + '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '"'
      + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>'
      + '</g>';
  }

  var cssVarCache = {};
  function cssVar(name) {
    if (cssVarCache[name] === undefined || cssVarCache._theme !== document.documentElement.dataset.theme) {
      cssVarCache._theme = document.documentElement.dataset.theme;
      cssVarCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#ffffff';
    }
    return cssVarCache[name];
  }

  function render() {
    ensureBootstrapChart();
    applyChartVars();
    var chart = getActiveChart();
    chartNameInput.value = chart.name;
    var nodeIds = Object.keys(chart.nodes);
    emptyEl.style.display = (nodeIds.length || Object.keys(chart.notes).length) ? 'none' : 'flex';

    Object.keys(nodeEls).forEach(function (id) { if (!chart.nodes[id]) { nodeEls[id].remove(); delete nodeEls[id]; } });
    Object.keys(noteEls).forEach(function (id) { if (!chart.notes[id]) { noteEls[id].remove(); delete noteEls[id]; } });

    nodeIds.forEach(function (id) {
      var n = chart.nodes[id];
      var el = nodeEls[id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'node';
        el.dataset.id = id;
        el.innerHTML =
          '<svg class="shapelayer" preserveAspectRatio="none"></svg>' +
          '<div class="avatar"></div>' +
          '<div class="ntext"><div class="nname"></div><div class="ntitle"></div><div class="ndetail"></div></div>' +
          '<div class="handle n" data-dir="n"></div><div class="handle s" data-dir="s"></div>' +
          '<div class="handle e" data-dir="e"></div><div class="handle w" data-dir="w"></div>' +
          '<div class="szgrip"></div>';
        canvas.appendChild(el);
        nodeEls[id] = el;
        wireNodeEvents(el);
      }
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      var color = n.color || COLOR_SWATCHES[0];
      var avatar = el.querySelector('.avatar');
      if (showsPhoto(n)) { avatar.style.background = "center/cover no-repeat url('" + n.photo + "')"; avatar.textContent = ''; }
      else { avatar.style.background = color; avatar.textContent = badgeText(n); }
      el.querySelector('.nname').textContent = n.name || 'Unnamed';
      var t = el.querySelector('.ntitle');
      t.textContent = n.title || '';
      t.style.display = n.title ? 'block' : 'none';
      var dt = el.querySelector('.ndetail');
      dt.textContent = n.detail || '';
      dt.style.display = n.detail ? 'block' : 'none';
      applyNodeStyle(el, n);
    });

    Object.keys(chart.notes).forEach(function (id) {
      var note = chart.notes[id];
      var el = noteEls[id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'note';
        el.dataset.id = id;
        canvas.appendChild(el);
        noteEls[id] = el;
        wireNoteEvents(el);
      }
      el.textContent = note.text || '';
      el.style.background = note.color || '#ffe58a';
      var pos = noteAnchor(note);
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
    });

    renderGroups();
    renderTitleBlock();
    renderLegend();
    drawEdges();
  }

  function noteAnchor(note) {
    var chart = getActiveChart();
    if (note.attach && note.attach.type === 'node') {
      var n = chart.nodes[note.attach.id];
      if (n) return { x: n.x + nodeW(n) + 16 + (note.dx || 0), y: n.y + (note.dy || 0) };
    } else if (note.attach && note.attach.type === 'edge') {
      var e = chart.edges[note.attach.id];
      if (e) {
        var a = chart.nodes[e.from], b = chart.nodes[e.to];
        if (a && b) {
          var mx = (a.x + b.x) / 2 + nodeW(a) / 2, my = (a.y + b.y) / 2 + NODE_H_APPROX / 2;
          return { x: mx + (note.dx || 0), y: my + (note.dy || 0) };
        }
      }
    }
    return { x: note.x || 0, y: note.y || 0 };
  }

  // -------------------------------------------------------------------
  // Title block + legend (canvas overlays, draggable, exported)
  // -------------------------------------------------------------------
  var titleEl = null, legendEl = null;

  // Bounding box of just the boxes and notes, used to place these the first
  // time they're switched on.
  function contentBounds() {
    var chart = getActiveChart();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.keys(chart.nodes).forEach(function (id) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + nodeW(n)); maxY = Math.max(maxY, n.y + h);
    });
    Object.keys(chart.notes).forEach(function (id) {
      var p = noteAnchor(chart.notes[id]);
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + 132); maxY = Math.max(maxY, p.y + 70);
    });
    if (minX === Infinity) return { minX: 0, minY: 0, maxX: 200, maxY: 120 };
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  function renderTitleBlock() {
    var chart = getActiveChart();
    var tb = chart.titleBlock;
    if (!tb || !tb.show) { if (titleEl) { titleEl.remove(); titleEl = null; } return; }
    if (!titleEl) {
      titleEl = document.createElement('div');
      titleEl.className = 'titleblock';
      titleEl.innerHTML = '<div class="tbTitle"></div><div class="tbSub"></div><div class="tbDate"></div>';
      canvas.appendChild(titleEl);
      wireOverlayDrag(titleEl, function () { return getActiveChart().titleBlock; });
    }
    var t = titleEl.querySelector('.tbTitle');
    var sub = titleEl.querySelector('.tbSub');
    var dt = titleEl.querySelector('.tbDate');
    t.textContent = tb.title || chart.name || 'Untitled chart';
    sub.textContent = tb.subtitle || '';
    sub.style.display = tb.subtitle ? 'block' : 'none';
    dt.textContent = tb.date || '';
    dt.style.display = tb.date ? 'block' : 'none';
    if (tb.x === null || tb.x === undefined) {
      var b = contentBounds();
      tb.x = b.minX; tb.y = b.minY - 96;
    }
    titleEl.style.left = tb.x + 'px';
    titleEl.style.top = tb.y + 'px';
  }

  function legendSampleHtml(item) {
    if (item.type === 'line') {
      var dash = item.dash === 'dashed' ? 'dashed' : (item.dash === 'dotted' ? 'dotted' : 'solid');
      return '<span class="lgLine" style="border-top-color:' + item.color + '; border-top-style:' + dash + ';"></span>';
    }
    return '<span class="lgSwatch" style="background:' + item.color + '"></span>';
  }

  function renderLegend() {
    var chart = getActiveChart();
    var lg = chart.legend;
    if (!lg || !lg.show) { if (legendEl) { legendEl.remove(); legendEl = null; } return; }
    if (!legendEl) {
      legendEl = document.createElement('div');
      legendEl.className = 'legendbox';
      canvas.appendChild(legendEl);
      wireOverlayDrag(legendEl, function () { return getActiveChart().legend; });
    }
    legendEl.innerHTML =
      (lg.title ? '<div class="lgTitle">' + escapeHtml(lg.title) + '</div>' : '') +
      (lg.items || []).map(function (it) {
        return '<div class="lgRow">' + legendSampleHtml(it) + '<span>' + escapeHtml(it.label || '') + '</span></div>';
      }).join('');
    if (lg.x === null || lg.x === undefined) {
      var b = contentBounds();
      lg.x = b.maxX + 28; lg.y = b.maxY - 90;
    }
    legendEl.style.left = lg.x + 'px';
    legendEl.style.top = lg.y + 'px';
  }

  // Shared drag behaviour for the title block and legend.
  function wireOverlayDrag(el, getModel) {
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      var model = getModel();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      var sx = e.clientX, sy = e.clientY;
      var ox = model.x || 0, oy = model.y || 0;
      var moved = false, preSnap = null;
      function mv(ev) {
        var dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
        if (!moved && (Math.abs(ev.clientX - sx) > 6 || Math.abs(ev.clientY - sy) > 6)) {
          moved = true; preSnap = snapshot(); el.classList.add('dragging');
        }
        if (!moved) return;
        model.x = ox + dx; model.y = oy + dy;
        el.style.left = model.x + 'px';
        el.style.top = model.y + 'px';
      }
      function up() {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        if (moved) { commitUndo(preSnap); saveState(); }
        else openTitleSheet();
      }
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  // Endpoints for a note's leader line, or null for free-floating notes.
  function noteTether(noteId) {
    var chart = getActiveChart();
    var note = chart.notes[noteId];
    if (!note || !note.attach || note.attach.type === 'free') return null;
    var pos = noteAnchor(note);
    var el = noteEls[noteId];
    var nw = (el && el.offsetWidth) || 132, nh = (el && el.offsetHeight) || 70;
    var noteCx = pos.x + nw / 2, noteCy = pos.y + nh / 2;
    var target = null;
    if (note.attach.type === 'node') {
      var n = chart.nodes[note.attach.id];
      if (!n) return null;
      var h = (nodeEls[note.attach.id] && nodeEls[note.attach.id].offsetHeight) || NODE_H_APPROX;
      var a = anchorOnNode(n, h, noteCx, noteCy);
      target = { x: a.x, y: a.y };
    } else if (note.attach.type === 'edge') {
      var e = chart.edges[note.attach.id];
      if (!e) return null;
      var na = chart.nodes[e.from], nb = chart.nodes[e.to];
      if (!na || !nb) return null;
      var ha = (nodeEls[e.from] && nodeEls[e.from].offsetHeight) || NODE_H_APPROX;
      var hb = (nodeEls[e.to] && nodeEls[e.to].offsetHeight) || NODE_H_APPROX;
      var rb = nodeRect(nb, hb), ra = nodeRect(na, ha);
      var pA = anchorOnNode(na, ha, rb.cx, rb.cy);
      var pB = anchorOnNode(nb, hb, ra.cx, ra.cy);
      var mid = midOfPath(pA, pB, e.style || 'elbow');
      target = { x: mid.x, y: mid.y };
    }
    if (!target) return null;
    // Start the line at the note edge nearest the target, not its centre.
    var dx = target.x - noteCx, dy = target.y - noteCy;
    var sx = Math.abs(dx) < 1e-6 ? 1e-6 : dx, sy = Math.abs(dy) < 1e-6 ? 1e-6 : dy;
    var s = Math.min((nw / 2) / Math.abs(sx), (nh / 2) / Math.abs(sy));
    return { x1: noteCx + dx * s, y1: noteCy + dy * s, x2: target.x, y2: target.y };
  }

  function renderPositionsOnly() {
    var chart = getActiveChart();
    Object.keys(nodeEls).forEach(function (id) {
      var n = chart.nodes[id];
      if (!n) return;
      nodeEls[id].style.left = n.x + 'px';
      nodeEls[id].style.top = n.y + 'px';
    });
    Object.keys(noteEls).forEach(function (id) {
      var note = chart.notes[id];
      if (!note) return;
      var pos = noteAnchor(note);
      noteEls[id].style.left = pos.x + 'px';
      noteEls[id].style.top = pos.y + 'px';
    });
    drawEdges();
  }

  function drawEdges() {
    var chart = getActiveChart();
    var parts = [], defs = [];
    var heightOf = function (id) { return (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX; };
    var trunkPaths = computeTrunkPaths(chart, heightOf);
    Object.keys(chart.edges).forEach(function (id) {
      var e = chart.edges[id];
      var a = chart.nodes[e.from], b = chart.nodes[e.to];
      if (!a || !b) return;
      var aEl = nodeEls[e.from], bEl = nodeEls[e.to];
      var hA = (aEl && aEl.offsetHeight) || NODE_H_APPROX, hB = (bEl && bEl.offsetHeight) || NODE_H_APPROX;
      var rectB = nodeRect(b, hB), rectA = nodeRect(a, hA);
      var pA = anchorOnNode(a, hA, rectB.cx, rectB.cy);
      var pB = anchorOnNode(b, hB, rectA.cx, rectA.cy);
      var style = e.style || 'elbow';
      var d = trunkPaths[id] || edgePathBetween(pA, pB, style);
      if (trunkPaths[id]) { pB = { x: b.x + nodeW(b) / 2, y: b.y }; }
      var color = e.color || 'var(--accent)';
      var width = e.width || 2;
      var dashArr = e.dash === 'dashed' ? (width * 2.5) + ' ' + (width * 2) : (e.dash === 'dotted' ? '1 ' + (width * 2.2) : 'none');
      var markerStart = '', markerEnd = '';
      if (e.arrowStart) { defs.push(marker(id, color, 'start')); markerStart = 'marker-start="url(#mk-start-' + id + ')"'; }
      if (e.arrowEnd !== false) { defs.push(marker(id, color, 'end')); markerEnd = 'marker-end="url(#mk-end-' + id + ')"'; }
      parts.push('<path class="edge-hit" data-edge-id="' + id + '" d="' + d + '"/>');
      parts.push('<path class="edge-line" d="' + d + '" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round" ' +
        (dashArr !== 'none' ? 'stroke-dasharray="' + dashArr + '"' : '') + ' ' + markerStart + ' ' + markerEnd + '/>');
      if (e.label) {
        var mid = trunkPaths[id] ? { x: pB.x, y: pB.y - 14 } : midOfPath(pA, pB, style);
        var w = Math.max(20, e.label.length * 6.4 + 10);
        parts.push('<rect class="edge-label-bg" x="' + (mid.x - w / 2) + '" y="' + (mid.y - 10) + '" width="' + w + '" height="18" rx="4" fill="var(--panel)" stroke="var(--line)"/>');
        parts.push('<text class="edge-label" x="' + mid.x + '" y="' + (mid.y + 1) + '" font-size="11" fill="var(--text)">' + escapeHtml(e.label) + '</text>');
      }
    });
    // Faint leader lines tethering each attached note to its box / connector,
    // so it stays obvious what a note is annotating once it's been moved.
    Object.keys(chart.notes).forEach(function (nid) {
      var tether = noteTether(nid);
      if (!tether) return;
      parts.push('<line class="note-tether" x1="' + tether.x1 + '" y1="' + tether.y1 + '" x2="' + tether.x2 + '" y2="' + tether.y2 + '"/>');
    });
    edgesSvg.innerHTML = (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') + parts.join('');
    edgesSvg.querySelectorAll('.edge-hit').forEach(function (p) {
      p.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      p.addEventListener('click', function (ev) { ev.stopPropagation(); openEdgeSheet(p.dataset.edgeId); });
    });
  }

  function marker(edgeId, color, dir) {
    var id = 'mk-' + dir + '-' + edgeId;
    var path = dir === 'end' ? 'M0,0 L8,4 L0,8 Z' : 'M8,0 L0,4 L8,8 Z';
    return '<marker id="' + id + '" markerWidth="9" markerHeight="9" refX="' + (dir === 'end' ? 7 : 1) + '" refY="4" orient="auto" markerUnits="userSpaceOnUse">' +
      '<path d="' + path + '" fill="' + color + '"/></marker>';
  }

  function fitToScreen() {
    var chart = getActiveChart();
    var nodeIds = Object.keys(chart.nodes);
    var noteIds = Object.keys(chart.notes);
    if (!nodeIds.length && !noteIds.length) { panX = stage.clientWidth / 2 - NODE_W / 2; panY = 40; scale = 1; applyTransform(); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeIds.forEach(function (id) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + nodeW(n)); maxY = Math.max(maxY, n.y + h);
    });
    noteIds.forEach(function (id) {
      var pos = noteAnchor(chart.notes[id]);
      minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + 132); maxY = Math.max(maxY, pos.y + 70);
    });
    // Title block and legend are part of the drawing, so fit them in too.
    if (chart.titleBlock && chart.titleBlock.show && titleEl) {
      minX = Math.min(minX, chart.titleBlock.x); minY = Math.min(minY, chart.titleBlock.y);
      maxX = Math.max(maxX, chart.titleBlock.x + titleEl.offsetWidth);
      maxY = Math.max(maxY, chart.titleBlock.y + titleEl.offsetHeight);
    }
    if (chart.legend && chart.legend.show && legendEl) {
      minX = Math.min(minX, chart.legend.x); minY = Math.min(minY, chart.legend.y);
      maxX = Math.max(maxX, chart.legend.x + legendEl.offsetWidth);
      maxY = Math.max(maxY, chart.legend.y + legendEl.offsetHeight);
    }
    var bw = maxX - minX, bh = maxY - minY;
    var pad = 60;
    var sw = stage.clientWidth - pad * 2, sh = stage.clientHeight - pad * 2;
    var s = Math.min(sw / bw, sh / bh, 1.15);
    s = Math.max(s, 0.12);
    scale = s;
    panX = (stage.clientWidth - bw * s) / 2 - minX * s;
    panY = (stage.clientHeight - bh * s) / 2 - minY * s;
    applyTransform();
  }

  // ---------------------------------------------------------------------
  // Node interaction: tap = edit, drag body = move, drag handle = connect
  // ---------------------------------------------------------------------
  function wireNodeEvents(el) {
    el.addEventListener('pointerdown', onNodeDown);
    el.querySelectorAll('.handle').forEach(function (h) { h.addEventListener('pointerdown', onHandleDown); });
    el.querySelector('.szgrip').addEventListener('pointerdown', onResizeDown);
  }

  // Live size readout while dragging a grip, so you can hit a number exactly.
  var sizeReadout = $('sizeReadout');
  function showSize(w, h) {
    sizeReadout.textContent = Math.round(w) + ' × ' + (h ? Math.round(h) : 'auto');
    sizeReadout.classList.add('show');
  }
  function hideSize() { sizeReadout.classList.remove('show'); }

  // Drag the corner grip to resize. Circles and squares stay square; every
  // other shape gets an explicit width and height from the drag.
  function onResizeDown(e) {
    e.stopPropagation();
    var grip = e.currentTarget;
    var el = grip.closest('.node');
    var id = el.dataset.id;
    var n = getActiveChart().nodes[id];
    if (!n) return;
    try { grip.setPointerCapture(e.pointerId); } catch (err) {}
    var sx = e.clientX, sy = e.clientY;
    var ow = nodeW(n), oh = el.offsetHeight || NODE_H_APPROX;
    var square = isFixedAspect(n);
    var moved = false, preSnap = null;

    function mv(ev) {
      var dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (!moved) {
        if (Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return;
        moved = true; preSnap = snapshot(); el.classList.add('resizing');
      }
      if (square) {
        // One dimension drives both — take whichever the finger moved more.
        n.width = clamp(Math.round((ow + (Math.abs(dx) > Math.abs(dy) ? dx : dy)) / 2) * 2, MIN_W, MAX_W);
        n.height = 0;
      } else {
        n.width = clamp(Math.round((ow + dx) / 2) * 2, MIN_W, MAX_W);
        n.height = clamp(Math.round((oh + dy) / 2) * 2, MIN_H, MAX_H);
      }
      applyNodeStyle(el, n);
      showSize(nodeW(n), forcedH(n));
      drawEdges();
    }
    function up() {
      grip.removeEventListener('pointermove', mv);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      el.classList.remove('resizing');
      hideSize();
      if (moved) { commitUndo(preSnap); saveState(); render(); }
    }
    grip.addEventListener('pointermove', mv);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  function clientToCanvas(clientX, clientY) {
    var rect = stage.getBoundingClientRect();
    return { x: (clientX - rect.left - panX) / scale, y: (clientY - rect.top - panY) / scale };
  }

  // -------------------------------------------------------------------
  // Snapping + alignment guides
  // -------------------------------------------------------------------
  // Professional charts want peers on the same line and even spacing, which
  // is hard to hit with a finger. While dragging we snap the box's edges and
  // centre to nearby boxes and show a guide where it locked on.
  var SNAP_TOL = 7;    // chart-space px within which we snap
  var GRID = 8;        // fallback grid when nothing else is near

  function applySnap(dragId, rawX, rawY) {
    var chart = getActiveChart();
    if (chart.snap === false) return { x: rawX, y: rawY, guides: [] };
    var w = nodeW(chart.nodes[dragId]);
    var h = (nodeEls[dragId] && nodeEls[dragId].offsetHeight) || NODE_H_APPROX;
    var tol = SNAP_TOL / Math.max(scale, 0.35);   // keep it usable when zoomed out
    var bestX = null, bestY = null, guides = [];

    Object.keys(chart.nodes).forEach(function (oid) {
      if (oid === dragId) return;
      var o = chart.nodes[oid];
      var ow = nodeW(o);
      var oh = (nodeEls[oid] && nodeEls[oid].offsetHeight) || NODE_H_APPROX;
      // candidate: [draggedEdgeValue, targetValue]
      [[rawX, o.x], [rawX + w / 2, o.x + ow / 2], [rawX + w, o.x + ow],
       [rawX, o.x + ow - w], [rawX + w, o.x]].forEach(function (pair, i) {
        var d = Math.abs(pair[0] - pair[1]);
        if (d > tol) return;
        if (bestX && d >= bestX.d) return;
        var offset = [0, w / 2, w, 0, w][i];
        bestX = { d: d, x: pair[1] - offset, line: pair[1] };
      });
      [[rawY, o.y], [rawY + h / 2, o.y + oh / 2], [rawY + h, o.y + oh],
       [rawY, o.y + oh - h], [rawY + h, o.y]].forEach(function (pair, i) {
        var d = Math.abs(pair[0] - pair[1]);
        if (d > tol) return;
        if (bestY && d >= bestY.d) return;
        var offset = [0, h / 2, h, 0, h][i];
        bestY = { d: d, y: pair[1] - offset, line: pair[1] };
      });
    });

    var outX = bestX ? bestX.x : Math.round(rawX / GRID) * GRID;
    var outY = bestY ? bestY.y : Math.round(rawY / GRID) * GRID;
    if (bestX) guides.push({ vertical: true, at: bestX.line });
    if (bestY) guides.push({ vertical: false, at: bestY.line });
    return { x: outX, y: outY, guides: guides };
  }

  // Guides live in their own SVG layer so redrawing edges doesn't wipe them.
  var guideSvg = null;
  function drawGuides(guides) {
    if (!guideSvg) {
      guideSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      guideSvg.setAttribute('id', 'guides');
      canvas.appendChild(guideSvg);
    }
    if (!guides || !guides.length) { guideSvg.innerHTML = ''; return; }
    var chart = getActiveChart();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    Object.keys(chart.nodes).forEach(function (id) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + nodeW(n)); maxY = Math.max(maxY, n.y + h);
    });
    var padG = 400;
    guideSvg.innerHTML = guides.map(function (g) {
      return g.vertical
        ? '<line class="guide" x1="' + g.at + '" y1="' + (minY - padG) + '" x2="' + g.at + '" y2="' + (maxY + padG) + '"/>'
        : '<line class="guide" x1="' + (minX - padG) + '" y1="' + g.at + '" x2="' + (maxX + padG) + '" y2="' + g.at + '"/>';
    }).join('');
  }

  function onNodeDown(e) {
    if (e.target.closest('.handle, .szgrip')) return;
    e.stopPropagation();
    var el = e.currentTarget;
    var id = el.dataset.id;
    var chart = getActiveChart();
    var n = chart.nodes[id];
    if (!n) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    var startX = e.clientX, startY = e.clientY;
    var origX = n.x, origY = n.y;
    var moved = false, preSnap = null;

    function move(ev) {
      var dx = (ev.clientX - startX) / scale, dy = (ev.clientY - startY) / scale;
      if (!moved && (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6)) {
        moved = true; preSnap = snapshot(); el.classList.add('dragging');
      }
      if (!moved) return;
      var snapped = applySnap(id, origX + dx, origY + dy);
      n.x = snapped.x; n.y = snapped.y;
      renderPositionsOnly();
      drawGuides(snapped.guides);
    }
    function up() {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      drawGuides([]);
      if (moved) { commitUndo(preSnap); saveState(); renderPositionsOnly(); }
      else openEditSheet(id);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onHandleDown(e) {
    e.stopPropagation();
    var handle = e.currentTarget;
    var nodeEl = handle.closest('.node');
    var sourceId = nodeEl.dataset.id;
    try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    var startX = e.clientX, startY = e.clientY, dragged = false;
    var tempPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tempPath.setAttribute('class', 'temp-edge');
    edgesSvg.appendChild(tempPath);
    showHint('Drag to another box to connect, or release on empty space to create one');

    function move(ev) {
      if (!dragged && (Math.abs(ev.clientX - startX) > DRAG_THRESHOLD || Math.abs(ev.clientY - startY) > DRAG_THRESHOLD)) dragged = true;
      if (!dragged) return;
      var chart = getActiveChart();
      var n = chart.nodes[sourceId];
      var pt = clientToCanvas(ev.clientX, ev.clientY);
      var h = nodeEl.offsetHeight || NODE_H_APPROX;
      var pA = anchorOnNode(n, h, pt.x, pt.y);
      tempPath.setAttribute('d', 'M ' + pA.x + ' ' + pA.y + ' L ' + pt.x + ' ' + pt.y);
    }
    function up(ev) {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      tempPath.remove();
      hideHint();
      // A tap without a real drag is almost always accidental — the handles are
      // small touch targets. Do nothing rather than spawning a stray box.
      if (!dragged) return;
      var hits = document.elementsFromPoint(ev.clientX, ev.clientY);
      var targetEl = null;
      for (var i = 0; i < hits.length; i++) {
        var hEl = hits[i].closest && hits[i].closest('.node');
        if (hEl && hEl !== nodeEl) { targetEl = hEl; break; }
      }
      if (targetEl) {
        var preSnap = snapshot();
        var made = addEdge(sourceId, targetEl.dataset.id, true);
        if (!made) { toast('Already connected'); return; }
        commitUndo(preSnap);
        saveState(); render();
      } else {
        pushUndo();
        var pt = clientToCanvas(ev.clientX, ev.clientY);
        var newId = createNodeAt(pt.x - NODE_W / 2, pt.y - NODE_H_APPROX / 2, true);
        addEdge(sourceId, newId, true);
        saveState(); render();
        openEditSheet(newId, true);
      }
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------------
  // Note interaction: tap = edit, drag = reposition
  // ---------------------------------------------------------------------
  function wireNoteEvents(el) { el.addEventListener('pointerdown', onNoteDown); }
  function onNoteDown(e) {
    e.stopPropagation();
    var el = e.currentTarget;
    var id = el.dataset.id;
    var chart = getActiveChart();
    var note = chart.notes[id];
    if (!note) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    var startX = e.clientX, startY = e.clientY;
    var origDx = note.dx || 0, origDy = note.dy || 0, origX = note.x || 0, origY = note.y || 0;
    var moved = false, preSnap = null;
    function move(ev) {
      var dx = (ev.clientX - startX) / scale, dy = (ev.clientY - startY) / scale;
      if (!moved && (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6)) { moved = true; preSnap = snapshot(); el.classList.add('dragging'); }
      if (!moved) return;
      if (note.attach && note.attach.type !== 'free') { note.dx = origDx + dx; note.dy = origDy + dy; }
      else { note.x = origX + dx; note.y = origY + dy; }
      renderPositionsOnly();
    }
    function up() {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      if (moved) { commitUndo(preSnap); saveState(); }
      else openNoteSheet(id);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function addBoxAtClient(pos) {
    var pt = clientToCanvas(pos.x, pos.y);
    pushUndo();
    var newId = createNodeAt(pt.x - NODE_W / 2, pt.y - NODE_H_APPROX / 2, true);
    saveState(); render();
    openEditSheet(newId, true);
  }

  var tapBackdrop = $('tapBackdrop'), tapSheet = $('tapSheet');
  var pendingTapPos = null, tapNeverAskChecked = false;
  function askAddBox(pos) {
    pendingTapPos = pos;
    tapNeverAskChecked = false;
    $('tapNeverAsk').classList.remove('on');
    $('tapNeverAsk').querySelector('.cbox').textContent = '';
    tapBackdrop.classList.add('show');
    tapSheet.classList.add('show');
  }
  function closeTapSheet() { tapBackdrop.classList.remove('show'); tapSheet.classList.remove('show'); pendingTapPos = null; }
  $('tapNeverAsk').addEventListener('click', function () {
    tapNeverAskChecked = !tapNeverAskChecked;
    this.classList.toggle('on', tapNeverAskChecked);
    this.querySelector('.cbox').textContent = tapNeverAskChecked ? '\u2713' : '';
  });
  $('tapAdd').addEventListener('click', function () {
    var pos = pendingTapPos;
    if (tapNeverAskChecked) { prefs.tapAdd = 'always'; savePrefs(); }
    closeTapSheet();
    if (pos) addBoxAtClient(pos);
  });
  $('tapCancel').addEventListener('click', closeTapSheet);
  $('tapNeverAdd').addEventListener('click', function () {
    prefs.tapAdd = 'never';
    savePrefs();
    closeTapSheet();
    toast('Tapping empty space won\u2019t add boxes — use the + button');
  });
  tapBackdrop.addEventListener('click', function (e) { if (e.target === tapBackdrop) closeTapSheet(); });

  function showHint(msg) { hintEl.textContent = msg; hintEl.classList.add('show'); }
  function hideHint() { hintEl.classList.remove('show'); }

  // ---------------------------------------------------------------------
  // Stage pan / pinch-zoom / tap-empty-to-add
  // ---------------------------------------------------------------------
  var stagePointers = {};
  var panStart = null, pinchStart = null;
  var tapCandidate = null, sawMultiTouch = false;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.node, .note, button, .handle')) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    stagePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var keys = Object.keys(stagePointers);
    if (keys.length === 1) {
      panStart = { x: e.clientX, y: e.clientY, panX: panX, panY: panY };
      pinchStart = null;
      sawMultiTouch = false;
      tapCandidate = { x: e.clientX, y: e.clientY, moved: false };
    } else if (keys.length === 2) {
      sawMultiTouch = true;
      tapCandidate = null;
      var pts = keys.map(function (k) { return stagePointers[k]; });
      pinchStart = { dist: dist(pts[0], pts[1]), scale: scale, mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, panX: panX, panY: panY };
      panStart = null;
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!stagePointers[e.pointerId]) return;
    stagePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var keys = Object.keys(stagePointers);
    if (tapCandidate && (Math.abs(e.clientX - tapCandidate.x) > 6 || Math.abs(e.clientY - tapCandidate.y) > 6)) tapCandidate.moved = true;
    if (keys.length === 1 && panStart) {
      panX = panStart.panX + (e.clientX - panStart.x);
      panY = panStart.panY + (e.clientY - panStart.y);
      applyTransform();
    } else if (keys.length === 2 && pinchStart) {
      var pts = keys.map(function (k) { return stagePointers[k]; });
      var d = dist(pts[0], pts[1]);
      var newScale = clamp(pinchStart.scale * (d / pinchStart.dist), 0.12, 3);
      var m = pinchStart.mid;
      var cx = (m.x - pinchStart.panX) / pinchStart.scale;
      var cy = (m.y - pinchStart.panY) / pinchStart.scale;
      panX = m.x - cx * newScale;
      panY = m.y - cy * newScale;
      scale = newScale;
      applyTransform();
    }
  });
  function stageUp(e) {
    delete stagePointers[e.pointerId];
    var keys = Object.keys(stagePointers);
    var wasTap = tapCandidate && !tapCandidate.moved && !sawMultiTouch;
    var tapPos = tapCandidate ? { x: tapCandidate.x, y: tapCandidate.y } : null;
    pinchStart = null;
    if (keys.length === 1) {
      var pt = stagePointers[keys[0]];
      panStart = { x: pt.x, y: pt.y, panX: panX, panY: panY };
    } else {
      panStart = null;
    }
    if (keys.length === 0 && wasTap && tapPos && prefs.tapAdd !== 'never') {
      if (prefs.tapAdd === 'ask') askAddBox(tapPos);
      else addBoxAtClient(tapPos);
    }
    tapCandidate = null;
  }
  stage.addEventListener('pointerup', stageUp);
  stage.addEventListener('pointercancel', stageUp);

  // ---------------------------------------------------------------------
  // Node / Edge / Note CRUD
  // ---------------------------------------------------------------------
  function randomColor() { return COLOR_SWATCHES[Math.floor(Math.random() * COLOR_SWATCHES.length)]; }

  function createNodeAt(x, y, skipUndo) {
    if (!skipUndo) pushUndo();
    var chart = getActiveChart();
    var id = uid();
    chart.nodes[id] = {
      id: id, name: '', title: '', detail: '', nickname: '', photo: null, x: x, y: y,
      shape: 'rounded', color: randomColor(), fill: defaultFill(), border: defaultBorder(),
      font: '', textColor: '', avatarMode: (chart.badges === 'hide' ? 'none' : 'auto'), layout: 'stack', align: 'center', fontScale: 1, width: NODE_W, height: 0, corner: 14, order: Date.now()
    };
    return id;
  }

  function addNode() {
    var center = clientToCanvas(stage.clientWidth / 2, stage.clientHeight / 2);
    pushUndo();
    var id = createNodeAt(center.x - NODE_W / 2, center.y - NODE_H_APPROX / 2, true);
    saveState(); render();
    openEditSheet(id, true);
  }

  function addEdge(fromId, toId, skipUndo) {
    if (fromId === toId) return null;
    var chart = getActiveChart();
    var dup = Object.values(chart.edges).some(function (e) { return e.from === fromId && e.to === toId; });
    if (dup) return null;
    if (!skipUndo) pushUndo();
    var id = uid();
    chart.edges[id] = { id: id, from: fromId, to: toId, color: '', width: 2, dash: 'solid', arrowStart: false, arrowEnd: true, style: 'elbow', label: '', order: Date.now() };
    return id;
  }

  function addNoteAttached(attach) {
    pushUndo();
    var chart = getActiveChart();
    var id = uid();
    var note = { id: id, text: '', color: '#ffe58a', attach: attach || { type: 'free' }, x: 0, y: 0, dx: 0, dy: -20 };
    if (attach && attach.type === 'free') {
      var center = clientToCanvas(stage.clientWidth / 2, stage.clientHeight / 2);
      note.x = center.x; note.y = center.y;
    }
    chart.notes[id] = note;
    saveState(); render();
    openNoteSheet(id, true);
  }

  function deleteNode(id) {
    var chart = getActiveChart();
    if (!chart.nodes[id]) return;
    var edgeCount = Object.values(chart.edges).filter(function (e) { return e.from === id || e.to === id; }).length;
    var msg = edgeCount ? ('Delete this box and its ' + edgeCount + ' connector line' + (edgeCount > 1 ? 's' : '') + '?') : 'Delete this box?';
    if (!window.confirm(msg)) return;
    pushUndo();
    Object.keys(chart.edges).forEach(function (eid) {
      var e = chart.edges[eid];
      if (e.from === id || e.to === id) {
        Object.keys(chart.notes).forEach(function (nid) { if (chart.notes[nid].attach && chart.notes[nid].attach.type === 'edge' && chart.notes[nid].attach.id === eid) delete chart.notes[nid]; });
        delete chart.edges[eid];
      }
    });
    Object.keys(chart.notes).forEach(function (nid) { if (chart.notes[nid].attach && chart.notes[nid].attach.type === 'node' && chart.notes[nid].attach.id === id) delete chart.notes[nid]; });
    delete chart.nodes[id];
    saveState();
    closeEditSheet();
    render();
  }

  function deleteEdge(id) {
    var chart = getActiveChart();
    if (!chart.edges[id]) return;
    if (!window.confirm('Delete this connector line?')) return;
    pushUndo();
    Object.keys(chart.notes).forEach(function (nid) { if (chart.notes[nid].attach && chart.notes[nid].attach.type === 'edge' && chart.notes[nid].attach.id === id) delete chart.notes[nid]; });
    delete chart.edges[id];
    saveState();
    closeEdgeSheet();
    render();
  }

  function deleteNote(id) {
    var chart = getActiveChart();
    if (!chart.notes[id]) return;
    pushUndo();
    delete chart.notes[id];
    saveState();
    closeNoteSheet();
    render();
  }

  // ---------------------------------------------------------------------
  // Reusable color / texture pickers
  // ---------------------------------------------------------------------
  function buildColorRow(container, value, onChange, allowDefault) {
    container.innerHTML = '';
    var isCustom = value && COLOR_SWATCHES.indexOf(value) === -1;
    if (allowDefault) {
      var none = document.createElement('button');
      none.type = 'button';
      none.className = 'swatch noneswatch' + (!value ? ' sel' : '');
      none.title = 'Default (theme card colour)';
      none.addEventListener('click', function () {
        container.querySelectorAll('.swatch,.customswatch').forEach(function (s) { s.classList.remove('sel'); });
        none.classList.add('sel');
        container.dataset.value = '';
        onChange && onChange('');
      });
      container.appendChild(none);
    }
    COLOR_SWATCHES.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === value ? ' sel' : '');
      b.style.background = c;
      b.addEventListener('click', function () {
        container.querySelectorAll('.swatch,.customswatch').forEach(function (s) { s.classList.remove('sel'); });
        b.classList.add('sel');
        container.dataset.value = c;
        onChange && onChange(c);
      });
      container.appendChild(b);
    });
    var custom = document.createElement('label');
    custom.className = 'customswatch' + (isCustom ? ' sel' : '');
    var inp = document.createElement('input');
    inp.type = 'color';
    inp.value = /^#[0-9a-f]{6}$/i.test(value) ? value : '#888888';
    inp.addEventListener('input', function () {
      container.querySelectorAll('.swatch,.customswatch').forEach(function (s) { s.classList.remove('sel'); });
      custom.classList.add('sel');
      container.dataset.value = inp.value;
      onChange && onChange(inp.value);
    });
    custom.appendChild(inp);
    container.appendChild(custom);
    container.dataset.value = value || (allowDefault ? '' : COLOR_SWATCHES[0]);
  }

  function buildTextureGrid(container, value, inkColor, onChange) {
    container.innerHTML = '';
    TEXTURES.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'texswatch' + (t === value ? ' sel' : '');
      b.title = TEXTURE_LABELS[t];
      b.style.background = t === 'none' ? 'var(--panel2)' : textureCss(t, inkColor || '#3568d4', 'var(--panel2)');
      b.addEventListener('click', function () {
        container.querySelectorAll('.texswatch').forEach(function (s) { s.classList.remove('sel'); });
        b.classList.add('sel');
        container.dataset.value = t;
        onChange && onChange(t);
      });
      container.appendChild(b);
    });
    container.dataset.value = value || 'dots';
  }

  function wireSeg(container, value, onChange) {
    container.querySelectorAll('button').forEach(function (btn) {
      btn.classList.toggle('sel', btn.dataset.v === value);
      btn.onclick = function () {
        container.querySelectorAll('button').forEach(function (b) { b.classList.remove('sel'); });
        btn.classList.add('sel');
        onChange && onChange(btn.dataset.v);
      };
    });
  }
  function segValue(container) {
    var sel = container.querySelector('button.sel');
    return sel ? sel.dataset.v : container.querySelector('button').dataset.v;
  }

  function populateFontSelect(sel, value) {
    sel.innerHTML = '';
    if (sel === fFont) {
      var opt0 = document.createElement('option'); opt0.value = ''; opt0.textContent = 'Inherit chart default';
      sel.appendChild(opt0);
    }
    FONT_ORDER.forEach(function (key) {
      var opt = document.createElement('option');
      opt.value = key; opt.textContent = FONT_LABELS[key];
      sel.appendChild(opt);
    });
    sel.value = value || '';
  }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ---------------------------------------------------------------------
  // Node edit sheet
  // ---------------------------------------------------------------------
  var fFont = $('fFont');
  var segShape = $('segShape'), segFillType = $('segFillType'), segBorderWidth = $('segBorderWidth'), segBorderDash = $('segBorderDash');
  var colorPicker = $('colorPicker'), fillColorPicker = $('fillColorPicker'), fillColor2Picker = $('fillColor2Picker'), fillTextureGrid = $('fillTextureGrid');
  var borderColorPicker = $('borderColorPicker'), textColorPicker = $('textColorPicker');

  function refreshPhotoPreview(n) {
    pendingPhoto = n.photo || null;
    drawBadgePreview();
  }
  // The preview mirrors what the card will actually show, which depends on
  // the badge mode as well as the photo — "Nickname only" has to hide an
  // attached photo here too, or typing a nickname looks like it does nothing.
  function drawBadgePreview() {
    var mode = segValue($('segAvatar'));
    var usePhoto = !!pendingPhoto && mode === 'auto';
    photoPreview.classList.toggle('dimmed', mode === 'none');
    if (usePhoto) {
      photoPreview.style.background = "center/cover no-repeat url('" + pendingPhoto + "')";
      photoPreview.textContent = '';
    } else {
      photoPreview.style.background = (colorPicker && colorPicker.dataset.value) || COLOR_SWATCHES[0];
      photoPreview.textContent = $('fNickname').value.trim() || initials(fName.value);
    }
  }
  // Live-preview the badge text as it's typed.
  $('fNickname').addEventListener('input', drawBadgePreview);
  fName.addEventListener('input', drawBadgePreview);

  function updateFillPickerVisibility() {
    var t = segValue(segFillType);
    $('gradientBlock').style.display = t === 'gradient' ? 'block' : 'none';
    fillColor2Picker.style.display = t === 'gradient' ? 'flex' : 'none';
    fillTextureGrid.style.display = t === 'texture' ? 'flex' : 'none';
  }

  var fGradAngle = $('fGradAngle'), fGradAngleVal = $('fGradAngleVal');
  function paintGradAngle() { fGradAngleVal.textContent = fGradAngle.value + '\u00b0'; }
  fGradAngle.addEventListener('input', paintGradAngle);

  // Preset blends fill in both colours and the angle in one tap; the pickers
  // stay live afterwards so a preset is a starting point, not a lock-in.
  function buildGradPresets(selA, selB) {
    var box = $('gradPresets');
    box.innerHTML = '';
    GRADIENT_PRESETS.forEach(function (g) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gradswatch' + ((selA === g.a && selB === g.b) ? ' sel' : '');
      b.title = g.name;
      b.style.background = 'linear-gradient(' + g.angle + 'deg, ' + g.a + ', ' + g.b + ')';
      b.addEventListener('click', function () {
        buildColorRow(fillColorPicker, g.a, null, true);
        buildColorRow(fillColor2Picker, g.b);
        fGradAngle.value = String(g.angle);
        paintGradAngle();
        box.querySelectorAll('.gradswatch').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
      });
      box.appendChild(b);
    });
  }

  // ---------------------------------------------------------------------
  // Box size controls: preset buttons, a width slider and an optional
  // explicit height. The three stay in sync — moving a slider clears the
  // preset selection, tapping a preset moves the slider.
  // ---------------------------------------------------------------------
  var fWidth = $('fWidth'), fHeight = $('fHeight');
  var fWidthVal = $('fWidthVal'), fHeightVal = $('fHeightVal');
  var segWidth = $('segWidth'), segHeightMode = $('segHeightMode'), heightRow = $('heightRow');

  function paintSizeVals() {
    var fixed = segValue(segHeightMode) === 'fixed';
    fWidthVal.textContent = fWidth.value + ' px';
    fHeightVal.textContent = fixed ? fHeight.value + ' px' : 'Auto';
    heightRow.classList.toggle('off', !fixed);
    segWidth.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.v === fWidth.value);
    });
  }
  // Circles and squares are always as tall as they are wide, so the height
  // control would be a lie for them.
  function syncSizeForShape() {
    var sq = isFixedAspectShape(segShape.dataset.value);
    segHeightMode.classList.toggle('off', sq);
    segHeightMode.style.opacity = sq ? '.38' : '';
    segHeightMode.style.pointerEvents = sq ? 'none' : '';
    if (sq) { heightRow.classList.add('off'); fHeightVal.textContent = 'Same as width'; }
    else paintSizeVals();
  }
  function setSizeControls(n) {
    fWidth.value = String(clamp(nodeW(n), MIN_W, MAX_W));
    var h = n.height || 0;
    wireSeg(segHeightMode, h ? 'fixed' : 'auto', paintSizeVals);
    fHeight.value = String(clamp(h || NODE_H_APPROX, MIN_H, MAX_H));
    wireSeg(segWidth, String(n.width || NODE_W), function (v) { fWidth.value = v; paintSizeVals(); });
    paintSizeVals();
  }
  fWidth.addEventListener('input', paintSizeVals);
  fHeight.addEventListener('input', paintSizeVals);

  // Text size: the four presets are shortcuts that move a continuous slider,
  // the same arrangement the box-width control uses.
  var fFontScale = $('fFontScale'), fFontScaleVal = $('fFontScaleVal');
  var segFontScale = $('segFontScale');
  function paintFontScale() {
    var pct = parseInt(fFontScale.value, 10);
    fFontScaleVal.textContent = pct + '%';
    segFontScale.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('sel', Math.round(parseFloat(b.dataset.v) * 100) === pct);
    });
  }
  function setFontScaleControls(n) {
    var pct = Math.round(clamp(nodeScale(n), MIN_FS, MAX_FS) * 100);
    fFontScale.value = String(pct);
    wireSeg(segFontScale, String(nodeScale(n)), function (v) {
      fFontScale.value = String(Math.round(parseFloat(v) * 100));
      paintFontScale();
    });
    paintFontScale();
  }
  fFontScale.addEventListener('input', paintFontScale);

  // Shape picker tiles preview the actual outline, generated by shapePath so
  // the swatch cannot disagree with the card.
  var fCorner = $('fCorner'), fCornerVal = $('fCornerVal'), cornerRow = $('cornerRow');
  function shapeTileSvg(key) {
    var d = shapeDef(key);
    // Fixed-aspect shapes preview in a square tile, or a circle would read as
    // an ellipse. Radius is scaled to the tile so a pill still looks like one.
    var h = 22, w = d.fixedAspect ? 22 : 34;
    var r = (d.kind === 'rect' || d.kind === 'poly') ? (d.defRadius || 0) * (h / 100) : 0;
    return '<svg viewBox="-1 -1 ' + (w + 2) + ' ' + (h + 2) + '" width="' + w + '" height="' + h + '">'
      + '<path d="' + shapePath(key, w, h, r) + '"/></svg>';
  }
  function buildShapeGrid(selected) {
    var box = segShape;
    box.innerHTML = '';
    SHAPE_ORDER.forEach(function (key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = key;
      if (key === selected) b.classList.add('sel');
      b.innerHTML = shapeTileSvg(key) + '<span>' + shapeDef(key).label + '</span>';
      b.addEventListener('click', function () {
        box.querySelectorAll('button').forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
        box.dataset.value = key;
        // Adopt the new shape's natural rounding rather than carrying over a
        // radius that was chosen for a different outline.
        fCorner.value = String(Math.min(60, shapeDef(key).defRadius || 0));
        paintCorner();
        syncSizeForShape();
      });
      box.appendChild(b);
    });
    box.dataset.value = selected;
  }
  function paintCorner() {
    var key = segShape.dataset.value || 'rounded';
    var kind = shapeDef(key).kind;
    var roundable = (kind === 'rect' || kind === 'poly');
    cornerRow.classList.toggle('off', !roundable);
    fCornerVal.textContent = roundable
      ? (parseInt(fCorner.value, 10) >= 60 ? 'Max' : fCorner.value + ' px')
      : 'n/a';
  }
  fCorner.addEventListener('input', paintCorner);

  function updatePhotoHint() {
    $('photoHint').style.display = segValue($('segLayout')) === 'photo' ? 'block' : 'none';
  }

  function openEditSheet(id, focusEmpty) {
    editingId = id;
    var chart = getActiveChart();
    var n = chart.nodes[id];
    if (!n) return;
    fName.value = n.name || '';
    fTitle.value = n.title || '';
    $('fDetail').value = n.detail || '';
    $('fNickname').value = n.nickname || '';
    $('fNickname').placeholder = 'Auto from name — e.g. ' + initials(n.name || 'Jane Wilson');
    // The badge mode and accent colour both feed the preview, so settle them
    // before drawing it.
    wireSeg($('segAvatar'), n.avatarMode || 'auto', drawBadgePreview);
    buildColorRow(colorPicker, n.color || COLOR_SWATCHES[0], drawBadgePreview);
    refreshPhotoPreview(n);
    wireSeg($('segLayout'), n.layout || 'stack', updatePhotoHint);
    updatePhotoHint();
    wireSeg($('segAlign'), n.align || 'center');
    setFontScaleControls(n);
    setSizeControls(n);
    buildShapeGrid(n.shape || 'rounded');
    fCorner.value = String(Math.min(60, cornerRadius(n)));
    paintCorner();
    syncSizeForShape();
    var fill = n.fill || defaultFill();
    wireSeg(segFillType, fill.type, updateFillPickerVisibility);
    buildColorRow(fillColorPicker, fill.color || '', null, true);
    buildColorRow(fillColor2Picker, fill.color2 || '#c3d1ea');
    fGradAngle.value = String(fillAngle(fill));
    paintGradAngle();
    buildGradPresets(fill.color, fill.color2);
    buildTextureGrid(fillTextureGrid, fill.texture || 'dots', fill.color || n.color);
    updateFillPickerVisibility();
    var border = n.border || defaultBorder();
    buildColorRow(borderColorPicker, border.color || '', null, true);
    wireSeg(segBorderWidth, String(border.width || 1));
    wireSeg(segBorderDash, border.dash || 'solid');
    populateFontSelect(fFont, n.font);
    buildColorRow(textColorPicker, n.textColor || '', null, true);
    editBackdrop.classList.add('show');
    editSheet.classList.add('show');
    if (focusEmpty) setTimeout(function () { fName.focus(); }, 260);
  }
  function closeEditSheet() { editBackdrop.classList.remove('show'); editSheet.classList.remove('show'); editingId = null; pendingPhoto = null; }

  $('fSave').addEventListener('click', function () {
    if (!editingId) return;
    var chart = getActiveChart();
    var n = chart.nodes[editingId];
    pushUndo();
    n.name = fName.value.trim() || 'Unnamed';
    n.title = fTitle.value.trim();
    n.detail = $('fDetail').value.trim();
    n.nickname = $('fNickname').value.trim();
    n.photo = pendingPhoto || null;
    n.avatarMode = segValue($('segAvatar'));
    n.layout = segValue($('segLayout'));
    n.align = segValue($('segAlign'));
    n.fontScale = clamp(parseInt(fFontScale.value, 10) / 100, MIN_FS, MAX_FS);
    n.width = clamp(parseInt(fWidth.value, 10) || NODE_W, MIN_W, MAX_W);
    n.height = segValue(segHeightMode) === 'fixed'
      ? clamp(parseInt(fHeight.value, 10) || NODE_H_APPROX, MIN_H, MAX_H) : 0;
    n.shape = segShape.dataset.value || 'rounded';
    n.corner = Math.max(0, parseInt(fCorner.value, 10) || 0);
    n.color = colorPicker.dataset.value;
    n.fill = { type: segValue(segFillType), color: fillColorPicker.dataset.value, color2: fillColor2Picker.dataset.value,
      texture: fillTextureGrid.dataset.value, angle: parseInt(fGradAngle.value, 10) };
    n.border = { color: borderColorPicker.dataset.value, width: parseFloat(segValue(segBorderWidth)), dash: segValue(segBorderDash) };
    n.font = fFont.value;
    n.textColor = textColorPicker.dataset.value;
    saveState();
    closeEditSheet();
    render();
  });
  $('fDuplicate').addEventListener('click', function () {
    if (!editingId) return;
    var chart = getActiveChart();
    var src = chart.nodes[editingId];
    if (!src) return;
    pushUndo();
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.x = src.x + nodeW(src) + SIB_GAP;
    copy.y = src.y;
    copy.order = Date.now();
    chart.nodes[copy.id] = copy;
    saveState();
    closeEditSheet();
    render();
    openEditSheet(copy.id, true);
    toast('Duplicated — styling copied');
  });
  // ---------------------------------------------------------------------
  // Apply one box's look to every box
  // ---------------------------------------------------------------------
  // Each group lists the node properties it copies. Text, photos and
  // positions are deliberately excluded — this only ever copies styling.
  var APPLY_GROUPS = [
    { key: 'shape', label: 'Shape & card layout', sub: 'Shape, stacked/compact, and text alignment', props: ['shape', 'corner', 'layout', 'align'] },
    { key: 'colors', label: 'Colours', sub: 'Fill, border, text and badge colour', props: ['fill', 'border', 'textColor', 'color'] },
    { key: 'size', label: 'Text size & box size', sub: 'Makes every card a consistent size', props: ['fontScale', 'width', 'height'] },
    { key: 'font', label: 'Font', sub: 'This box’s typeface override', props: ['font'] },
    { key: 'badge', label: 'Badge visibility', sub: 'Photo/badge, badge only, or hidden', props: ['avatarMode'] }
  ];
  var applySelection = { shape: true, colors: true, size: true, font: true, badge: true };
  var applySourceId = null;
  var applyBackdrop = $('applyBackdrop'), applySheet = $('applySheet');

  function openApplySheet(sourceId) {
    applySourceId = sourceId;
    var chart = getActiveChart();
    var others = Object.keys(chart.nodes).length - 1;
    $('applyIntro').textContent = others > 0
      ? 'Copy this box’s styling to the other ' + others + ' box' + (others === 1 ? '' : 'es') + '. Choose what to copy:'
      : 'There are no other boxes in this chart yet.';
    var box = $('applyOptions');
    box.innerHTML = '';
    APPLY_GROUPS.forEach(function (g) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'checkrow' + (applySelection[g.key] ? ' on' : '');
      row.innerHTML = '<div class="cbox">' + (applySelection[g.key] ? '✓' : '') + '</div>' +
        '<div class="ctext"><div class="ctitle">' + escapeHtml(g.label) + '</div><div class="csub">' + escapeHtml(g.sub) + '</div></div>';
      row.addEventListener('click', function () {
        applySelection[g.key] = !applySelection[g.key];
        row.classList.toggle('on', applySelection[g.key]);
        row.querySelector('.cbox').textContent = applySelection[g.key] ? '✓' : '';
      });
      box.appendChild(row);
    });
    applyBackdrop.classList.add('show');
    applySheet.classList.add('show');
  }
  function closeApplySheet() { applyBackdrop.classList.remove('show'); applySheet.classList.remove('show'); }

  $('fApplyAll').addEventListener('click', function () {
    if (!editingId) return;
    var id = editingId;
    // Commit any pending edits first, so the look being copied is what's shown.
    $('fSave').click();
    setTimeout(function () { openApplySheet(id); }, 60);
  });
  $('applyCancel').addEventListener('click', closeApplySheet);
  applyBackdrop.addEventListener('click', function (e) { if (e.target === applyBackdrop) closeApplySheet(); });

  $('applyGo').addEventListener('click', function () {
    var chart = getActiveChart();
    var src = chart.nodes[applySourceId];
    if (!src) { closeApplySheet(); return; }
    var props = [];
    APPLY_GROUPS.forEach(function (g) { if (applySelection[g.key]) props = props.concat(g.props); });
    if (!props.length) { toast('Nothing selected'); return; }
    pushUndo();
    var count = 0;
    Object.keys(chart.nodes).forEach(function (nid) {
      if (nid === applySourceId) return;
      var n = chart.nodes[nid];
      props.forEach(function (p) {
        var v = src[p];
        n[p] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
      });
      count++;
    });
    // Keep the chart-wide badge default in step when badge mode was copied.
    if (applySelection.badge) chart.badges = (src.avatarMode === 'none') ? 'hide' : 'show';
    saveState();
    closeApplySheet();
    render();
    toast(count ? ('Applied to ' + count + ' box' + (count === 1 ? '' : 'es')) : 'No other boxes to update');
  });

  $('fAddNote').addEventListener('click', function () { if (editingId) { var id = editingId; closeEditSheet(); addNoteAttached({ type: 'node', id: id }); } });
  $('fDelete').addEventListener('click', function () { if (editingId) deleteNode(editingId); });
  $('fCancel').addEventListener('click', closeEditSheet);
  editBackdrop.addEventListener('click', function (e) { if (e.target === editBackdrop) closeEditSheet(); });

  $('fChoosePhoto').addEventListener('click', function () { photoFile.value = ''; photoFile.click(); });
  $('fRemovePhoto').addEventListener('click', function () {
    pendingPhoto = null;
    photoPreview.style.background = colorPicker.dataset.value || COLOR_SWATCHES[0];
    photoPreview.textContent = initials(fName.value);
  });
  photoFile.addEventListener('change', function () {
    var file = photoFile.files[0];
    if (!file) return;
    var img = new Image();
    var reader = new FileReader();
    reader.onload = function () {
      img.onload = function () {
        var size = 160;
        var cnv = document.createElement('canvas');
        cnv.width = size; cnv.height = size;
        var ctx = cnv.getContext('2d');
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2, sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        pendingPhoto = cnv.toDataURL('image/jpeg', 0.85);
        photoPreview.style.background = "center/cover no-repeat url('" + pendingPhoto + "')";
        photoPreview.textContent = '';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  // ---------------------------------------------------------------------
  // Edge edit sheet
  // ---------------------------------------------------------------------
  var edgeColorPicker = $('edgeColorPicker'), segEdgeWidth = $('segEdgeWidth'), segEdgeDash = $('segEdgeDash'), segEdgeStyle = $('segEdgeStyle'), segEdgeArrows = $('segEdgeArrows');
  var eLabel = $('eLabel'), edgePreviewPath = $('edgePreviewPath');

  function refreshEdgePreview() {
    var color = edgeColorPicker.dataset.value || '#3568d4';
    var width = parseFloat(segValue(segEdgeWidth));
    var dash = segValue(segEdgeDash);
    var dashArr = dash === 'dashed' ? (width * 2.5) + ' ' + (width * 2) : (dash === 'dotted' ? '1 ' + (width * 2.2) : 'none');
    edgePreviewPath.setAttribute('stroke', color);
    edgePreviewPath.setAttribute('stroke-width', width);
    edgePreviewPath.setAttribute('stroke-linecap', 'round');
    if (dashArr !== 'none') edgePreviewPath.setAttribute('stroke-dasharray', dashArr); else edgePreviewPath.removeAttribute('stroke-dasharray');
  }

  function openEdgeSheet(id) {
    editingEdgeId = id;
    var chart = getActiveChart();
    var e = chart.edges[id];
    if (!e) return;
    eLabel.value = e.label || '';
    buildColorRow(edgeColorPicker, e.color || '#3568d4', refreshEdgePreview);
    wireSeg(segEdgeWidth, String(e.width || 2), refreshEdgePreview);
    wireSeg(segEdgeDash, e.dash || 'solid', refreshEdgePreview);
    wireSeg(segEdgeStyle, e.style || 'elbow');
    var arrowsV = e.arrowStart ? 'both' : (e.arrowEnd !== false ? 'end' : 'none');
    wireSeg(segEdgeArrows, arrowsV);
    refreshEdgePreview();
    edgeBackdrop.classList.add('show');
    edgeSheet.classList.add('show');
  }
  function closeEdgeSheet() { edgeBackdrop.classList.remove('show'); edgeSheet.classList.remove('show'); editingEdgeId = null; }

  $('eSave').addEventListener('click', function () {
    if (!editingEdgeId) return;
    var chart = getActiveChart();
    var e = chart.edges[editingEdgeId];
    pushUndo();
    e.label = eLabel.value.trim();
    e.color = edgeColorPicker.dataset.value;
    e.width = parseFloat(segValue(segEdgeWidth));
    e.dash = segValue(segEdgeDash);
    e.style = segValue(segEdgeStyle);
    var arrows = segValue(segEdgeArrows);
    e.arrowStart = arrows === 'both';
    e.arrowEnd = arrows !== 'none';
    saveState();
    closeEdgeSheet();
    render();
  });
  $('eAddNote').addEventListener('click', function () { if (editingEdgeId) { var id = editingEdgeId; closeEdgeSheet(); addNoteAttached({ type: 'edge', id: id }); } });
  $('eDelete').addEventListener('click', function () { if (editingEdgeId) deleteEdge(editingEdgeId); });
  $('eCancel').addEventListener('click', closeEdgeSheet);
  edgeBackdrop.addEventListener('click', function (e) { if (e.target === edgeBackdrop) closeEdgeSheet(); });

  // ---------------------------------------------------------------------
  // Note edit sheet
  // ---------------------------------------------------------------------
  var nText = $('nText'), noteColorPicker = $('noteColorPicker');
  var NOTE_COLORS = ['#ffe58a', '#ffb3ba', '#bae1ff', '#baffc9', '#ffdfba', '#e0bbff', '#ffffff', '#d9d9d9'];

  function openNoteSheet(id, focusEmpty) {
    editingNoteId = id;
    var chart = getActiveChart();
    var note = chart.notes[id];
    if (!note) return;
    nText.value = note.text || '';
    buildNoteColorRow(note.color || NOTE_COLORS[0]);
    noteBackdrop.classList.add('show');
    noteSheet.classList.add('show');
    if (focusEmpty) setTimeout(function () { nText.focus(); }, 260);
  }
  function buildNoteColorRow(value) {
    noteColorPicker.innerHTML = '';
    NOTE_COLORS.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === value ? ' sel' : '');
      b.style.background = c;
      b.style.border = '2px solid ' + (c === value ? 'var(--text)' : 'rgba(0,0,0,.15)');
      b.addEventListener('click', function () {
        noteColorPicker.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('sel'); });
        b.classList.add('sel');
        noteColorPicker.dataset.value = c;
      });
      noteColorPicker.appendChild(b);
    });
    noteColorPicker.dataset.value = value;
  }
  function closeNoteSheet() { noteBackdrop.classList.remove('show'); noteSheet.classList.remove('show'); editingNoteId = null; }

  $('nSave').addEventListener('click', function () {
    if (!editingNoteId) return;
    var chart = getActiveChart();
    var note = chart.notes[editingNoteId];
    pushUndo();
    note.text = nText.value.trim();
    note.color = noteColorPicker.dataset.value;
    saveState();
    closeNoteSheet();
    render();
  });
  $('nDelete').addEventListener('click', function () { if (editingNoteId) deleteNote(editingNoteId); });
  $('nCancel').addEventListener('click', closeNoteSheet);
  noteBackdrop.addEventListener('click', function (e) { if (e.target === noteBackdrop) closeNoteSheet(); });

  // ---------------------------------------------------------------------
  // Top bar
  // ---------------------------------------------------------------------
  chartNameInput.addEventListener('change', function () { getActiveChart().name = chartNameInput.value.trim() || 'Untitled chart'; saveState(); });
  chartNameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') chartNameInput.blur(); });
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('fitbtn').addEventListener('click', function () { fitToScreen(); });
  $('fab').addEventListener('click', function () { addNode(); });
  $('noteFab').addEventListener('click', function () { addNoteAttached({ type: 'free' }); });

  // ---------------------------------------------------------------------
  // Search — find a box / note / connector label and jump to it
  // ---------------------------------------------------------------------
  var searchBackdrop = $('searchBackdrop'), searchSheet = $('searchSheet');
  var searchInput = $('searchInput'), searchResults = $('searchResults');

  function openSearch() {
    searchInput.value = '';
    renderSearchResults('');
    searchBackdrop.classList.add('show');
    searchSheet.classList.add('show');
    setTimeout(function () { searchInput.focus(); }, 260);
  }
  function closeSearch() {
    searchBackdrop.classList.remove('show');
    searchSheet.classList.remove('show');
    searchInput.blur();
  }
  $('searchFab').addEventListener('click', openSearch);
  $('searchCloseBtn').addEventListener('click', closeSearch);
  searchBackdrop.addEventListener('click', function (e) { if (e.target === searchBackdrop) closeSearch(); });
  searchInput.addEventListener('input', function () { renderSearchResults(searchInput.value); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var first = searchResults.querySelector('.searchresult');
    if (first) first.click();
  });

  function highlightMatch(text, q) {
    var safe = escapeHtml(text || '');
    if (!q) return safe;
    var i = (text || '').toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return safe;
    return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
  }

  function collectSearchItems(q) {
    var chart = getActiveChart();
    var ql = q.trim().toLowerCase();
    var out = [];
    Object.keys(chart.nodes).forEach(function (id) {
      var n = chart.nodes[id];
      var hay = [n.name || '', n.title || ''];
      if (!ql || hay.some(function (h) { return h.toLowerCase().indexOf(ql) !== -1; })) {
        out.push({ kind: 'node', id: id, name: n.name || 'Unnamed', sub: n.title || '', color: n.color, photo: n.photo });
      }
    });
    Object.keys(chart.notes).forEach(function (id) {
      var note = chart.notes[id];
      if (!ql || (note.text || '').toLowerCase().indexOf(ql) !== -1) {
        out.push({ kind: 'note', id: id, name: note.text || 'Empty note', sub: 'Note', color: note.color, isNote: true });
      }
    });
    Object.keys(chart.edges).forEach(function (id) {
      var e = chart.edges[id];
      if (!e.label) return;
      if (!ql || e.label.toLowerCase().indexOf(ql) !== -1) {
        var a = chart.nodes[e.from], b = chart.nodes[e.to];
        out.push({ kind: 'edge', id: id, name: e.label, sub: 'Line: ' + ((a && a.name) || '?') + ' → ' + ((b && b.name) || '?'), color: e.color || '#6b7684' });
      }
    });
    // Alphabetical when browsing, best-prefix-match first when searching.
    if (ql) {
      out.sort(function (x, y) {
        var xs = x.name.toLowerCase().indexOf(ql) === 0 ? 0 : 1;
        var ys = y.name.toLowerCase().indexOf(ql) === 0 ? 0 : 1;
        return xs - ys || x.name.localeCompare(y.name);
      });
    } else {
      out.sort(function (x, y) { return x.name.localeCompare(y.name); });
    }
    return out;
  }

  function renderSearchResults(q) {
    var items = collectSearchItems(q);
    searchResults.innerHTML = '';
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'smallmuted';
      empty.textContent = q.trim() ? 'Nothing matches “' + q.trim() + '”.' : 'This chart is empty.';
      searchResults.appendChild(empty);
      return;
    }
    items.slice(0, 40).forEach(function (item) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'searchresult';
      var av = document.createElement('div');
      av.className = 'ravatar';
      if (item.photo) { av.style.background = "center/cover no-repeat url('" + item.photo + "')"; }
      else if (item.kind === 'note') { av.style.background = item.color || '#ffe58a'; av.style.color = '#3a3420'; av.textContent = '🗒'; }
      else if (item.kind === 'edge') { av.style.background = 'transparent'; av.style.color = item.color; av.textContent = '↘'; }
      else { av.style.background = item.color || COLOR_SWATCHES[0]; av.textContent = initials(item.name); }
      var txt = document.createElement('div');
      txt.className = 'rtext';
      txt.innerHTML = '<div class="rname">' + highlightMatch(item.name, q.trim()) + '</div>' +
        (item.sub ? '<div class="rsub">' + highlightMatch(item.sub, q.trim()) + '</div>' : '');
      row.appendChild(av); row.appendChild(txt);
      row.addEventListener('click', function () { closeSearch(); jumpTo(item); });
      searchResults.appendChild(row);
    });
  }

  // Centre the viewport on a search hit and flash it so it's easy to spot.
  function jumpTo(item) {
    var chart = getActiveChart();
    var cx, cy, el = null;
    if (item.kind === 'node') {
      var n = chart.nodes[item.id];
      if (!n) return;
      el = nodeEls[item.id];
      var h = (el && el.offsetHeight) || NODE_H_APPROX;
      cx = n.x + nodeW(n) / 2; cy = n.y + h / 2;
    } else if (item.kind === 'note') {
      var note = chart.notes[item.id];
      if (!note) return;
      el = noteEls[item.id];
      var pos = noteAnchor(note);
      cx = pos.x + ((el && el.offsetWidth) || 132) / 2;
      cy = pos.y + ((el && el.offsetHeight) || 70) / 2;
    } else {
      var e = chart.edges[item.id];
      if (!e) return;
      var a = chart.nodes[e.from], b = chart.nodes[e.to];
      if (!a || !b) return;
      var ha = (nodeEls[e.from] && nodeEls[e.from].offsetHeight) || NODE_H_APPROX;
      var hb = (nodeEls[e.to] && nodeEls[e.to].offsetHeight) || NODE_H_APPROX;
      cx = (a.x + nodeW(a) / 2 + b.x + nodeW(b) / 2) / 2;
      cy = (a.y + ha / 2 + b.y + hb / 2) / 2;
    }
    scale = Math.min(Math.max(scale, 0.75), 1.4);
    panX = stage.clientWidth / 2 - cx * scale;
    panY = stage.clientHeight / 2 - cy * scale;
    applyTransform();
    if (el) {
      el.classList.remove('found');
      void el.offsetWidth; // restart the animation
      el.classList.add('found');
      setTimeout(function () { el.classList.remove('found'); }, 1600);
    }
  }

  // ---------------------------------------------------------------------
  // Menu sheet
  // ---------------------------------------------------------------------
  function openMenu() { renderChartList(); menuBackdrop.classList.add('show'); menuSheet.classList.add('show'); }
  function closeMenu() { menuBackdrop.classList.remove('show'); menuSheet.classList.remove('show'); }
  $('menuBtn').addEventListener('click', openMenu);
  $('menuCloseBtn').addEventListener('click', closeMenu);
  menuBackdrop.addEventListener('click', function (e) { if (e.target === menuBackdrop) closeMenu(); });

  // "Foo" -> "Foo (copy)" -> "Foo (copy 2)", skipping names already taken.
  function copyName(base) {
    var taken = {};
    Object.keys(state.charts).forEach(function (id) { taken[state.charts[id].name] = true; });
    var stem = base.replace(/ \(copy( \d+)?\)$/, '');
    var candidate = stem + ' (copy)';
    var i = 2;
    while (taken[candidate]) { candidate = stem + ' (copy ' + i + ')'; i++; }
    return candidate;
  }

  // Snapshot a whole chart. The copy stays in the background so you can keep
  // working on the original — that's the point of taking a snapshot.
  function duplicateChart(sourceId) {
    var src = state.charts[sourceId];
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    copy.name = copyName(src.name);
    // Node/edge ids only have to be unique inside a chart, so they carry over.
    copy.updatedAt = Date.now() - 1; // just behind the original in the list
    state.charts[copy.id] = copy;
    saveState();
    renderChartList();
    toast('Saved a copy — “' + copy.name + '”');
  }

  function renderChartList() {
    chartListEl.innerHTML = '';
    var charts = Object.values(state.charts).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var canDelete = charts.length > 1;
    charts.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'listrow' + (c.id === state.activeId ? ' active' : '');
      var count = Object.keys(c.nodes).length;
      row.innerHTML =
        '<button class="lmain" data-act="open">' +
          '<span class="lname">' + (c.id === state.activeId ? '● ' : '') + escapeHtml(c.name) + '</span>' +
          '<span class="lmeta">' + count + ' box' + (count === 1 ? '' : 'es') + '</span>' +
        '</button>' +
        '<div class="lactions">' +
          '<button class="rowbtn" data-act="open2">Open</button>' +
          '<button class="rowbtn" data-act="rename">Rename</button>' +
          '<button class="rowbtn" data-act="copy">Save a copy</button>' +
          (canDelete ? '<button class="rowbtn danger" data-act="del">Delete</button>' : '') +
        '</div>';

      // Opening a chart isn't an edit, so it must not restamp it for sync.
      function open() { state.activeId = c.id; saveState(true); closeMenu(); render(); fitToScreen(); }
      row.querySelector('[data-act="open"]').addEventListener('click', open);
      row.querySelector('[data-act="open2"]').addEventListener('click', open);
      row.querySelector('[data-act="copy"]').addEventListener('click', function () { duplicateChart(c.id); });

      row.querySelector('[data-act="rename"]').addEventListener('click', function () {
        var main = row.querySelector('.lmain');
        if (row.querySelector('.lrename')) return;
        var input = document.createElement('input');
        input.className = 'lrename';
        input.value = c.name;
        input.maxLength = 60;
        main.replaceWith(input);
        input.focus();
        input.select();
        var done = false;
        function commit() {
          if (done) return;
          done = true;
          var next = input.value.trim();
          if (next && next !== c.name) {
            c.name = next;
            if (c.id === state.activeId) chartNameInput.value = next;
            saveState();
          }
          renderChartList();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { done = true; renderChartList(); }
        });
      });

      var delBtn = row.querySelector('[data-act="del"]');
      if (delBtn) delBtn.addEventListener('click', function () {
        if (!window.confirm('Delete "' + c.name + '"? This cannot be undone.')) return;
        delete state.charts[c.id];
        // Tombstone, so the delete travels to your other devices instead of
        // the chart coming back on the next pull.
        state.deleted[c.id] = Date.now();
        if (state.activeId === c.id) state.activeId = Object.keys(state.charts)[0];
        saveState(true); renderChartList(); render(); fitToScreen();
      });
      chartListEl.appendChild(row);
    });
  }

  $('newChartBtn').addEventListener('click', function () {
    var id = uid();
    state.charts[id] = newChartObj(id, 'Untitled chart');
    state.activeId = id;
    saveState(); closeMenu(); render(); fitToScreen();
  });

  function tidyLayout() {
    var chart = getActiveChart();
    var ids = Object.keys(chart.nodes);
    if (!ids.length) return;
    var indeg = {}; ids.forEach(function (id) { indeg[id] = 0; });
    Object.values(chart.edges).forEach(function (e) { if (indeg[e.to] !== undefined) indeg[e.to]++; });
    var level = {};
    var queue = ids.filter(function (id) { return indeg[id] === 0; });
    if (!queue.length) queue = [ids[0]];
    queue.forEach(function (id) { level[id] = 0; });
    var visited = {}; queue.forEach(function (id) { visited[id] = true; });
    var i = 0;
    while (i < queue.length) {
      var cur = queue[i++];
      Object.values(chart.edges).forEach(function (e) {
        if (e.from === cur && chart.nodes[e.to]) {
          var lvl = level[cur] + 1;
          if (level[e.to] === undefined || lvl > level[e.to]) level[e.to] = lvl;
          if (!visited[e.to]) { visited[e.to] = true; queue.push(e.to); }
        }
      });
    }
    ids.forEach(function (id) { if (level[id] === undefined) level[id] = 0; });
    ids.sort(function (a, b) { return (chart.nodes[a].order || 0) - (chart.nodes[b].order || 0); });
    var byLevel = {};
    ids.forEach(function (id) { var l = level[id]; (byLevel[l] = byLevel[l] || []).push(id); });
    Object.keys(byLevel).forEach(function (l) {
      var row = byLevel[l];
      var totalW = row.reduce(function (acc, id) { return acc + nodeW(chart.nodes[id]) + SIB_GAP; }, -SIB_GAP);
      var cursorX = -totalW / 2;
      row.forEach(function (id) {
        chart.nodes[id].x = cursorX;
        chart.nodes[id].y = Number(l) * (NODE_H_APPROX + LEVEL_GAP);
        cursorX += nodeW(chart.nodes[id]) + SIB_GAP;
      });
    });
  }
  $('relayoutBtn').addEventListener('click', function () { pushUndo(); tidyLayout(); saveState(); closeMenu(); render(); fitToScreen(); toast('Tidied up'); });
  $('relayoutBtn2').addEventListener('click', function () { pushUndo(); tidyLayout(); saveState(); render(); fitToScreen(); toast('Tidied up'); });

  var APPEARANCE_PALETTES = {
    light: { bg: '#f4f6f8', panel: '#ffffff', panel2: '#eef1f4', text: '#1c2530', muted: '#6b7684', line: '#dbe0e6' },
    dim: { bg: '#2f353c', panel: '#383e46', panel2: '#414850', text: '#eef1f4', muted: '#a8b0b9', line: '#4c545e' },
    dark: { bg: '#12161c', panel: '#1b2129', panel2: '#232a33', text: '#eef1f5', muted: '#93a0b0', line: '#2c3541' }
  };
  function getAppearance() { return localStorage.getItem('orgchart.theme') || 'auto'; }
  function resolvedAppearance() {
    var v = getAppearance();
    if (v !== 'auto') return v;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function setAppearance(v) {
    var root = document.documentElement;
    if (v === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', v);
    localStorage.setItem('orgchart.theme', v === 'auto' ? '' : v);
    applyTokens();
  }

  // ---- design tokens -------------------------------------------------
  // One call republishes every CSS custom property for the current
  // appearance, density and contrast. Density lives on the chart, contrast
  // on the device.
  function applyTokens() {
    if (!global_tokens) return;
    var chart = state.charts[state.activeId];
    global_tokens.apply({
      appearance: resolvedAppearance(),
      density: (chart && chart.density) || 'standard',
      contrast: prefs.contrast === 'high'
    });
    cssVarCache = {};
    // Chart geometry follows density, so the constants the layout code uses
    // are re-derived rather than frozen at load.
    var k = global_tokens.chartScale();
    NODE_W = Math.round(global_tokens.BASE.node.width * k);
    NODE_H_APPROX = Math.round(global_tokens.BASE.node.height * k);
    SIB_GAP = Math.round(global_tokens.BASE.node.gapSib * k);
    LEVEL_GAP = Math.round(global_tokens.BASE.node.gapLevel * k);
  }
  var global_tokens = window.OrgChartTokens || null;
  (function initTheme() { var t = getAppearance(); if (t !== 'auto') document.documentElement.setAttribute('data-theme', t); })();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { applyTokens(); render(); });

  // ---------------------------------------------------------------------
  // Chart design sheet (background, default font, presets, tidy)
  // ---------------------------------------------------------------------
  var segBgType = $('segBgType'), bgColorPicker = $('bgColorPicker'), bgColor2Picker = $('bgColor2Picker'), bgTextureGrid = $('bgTextureGrid'), chartFontSel = $('chartFont');

  var fBgAngle = $('fBgAngle'), fBgScale = $('fBgScale');

  // Two dozen ready-made canvases. Every one is just a background object, so
  // picking one still leaves each part editable underneath.
  var BG_PRESETS = [
    { t: 'solid', c: '' },
    { t: 'solid', c: '#ffffff' }, { t: 'solid', c: '#f4f6f8' }, { t: 'solid', c: '#e8eef7' },
    { t: 'solid', c: '#f6f1e7' }, { t: 'solid', c: '#eef4ee' }, { t: 'solid', c: '#2b3038' }, { t: 'solid', c: '#12161c' },
    { t: 'gradient', c: '#eaf1fb', c2: '#ffffff', a: 160 },
    { t: 'gradient', c: '#dfe8f5', c2: '#f7fafc', a: 135 },
    { t: 'gradient', c: '#f7e9d7', c2: '#fffaf3', a: 120 },
    { t: 'gradient', c: '#e6f2ea', c2: '#ffffff', a: 150 },
    { t: 'gradient', c: '#3d4c63', c2: '#1b2129', a: 160 },
    { t: 'gradient', c: '#1f3b57', c2: '#0d1620', a: 135 },
    { t: 'gradient', c: '#5b3f6e', c2: '#241a2c', a: 140 },
    { t: 'gradient', c: '#8a5a3b', c2: '#2a1d14', a: 150 },
    { t: 'texture', tex: 'dots', c: '#8a94a6', c2: '#ffffff', sc: 1 },
    { t: 'texture', tex: 'grid', c: '#8a94a6', c2: '#fbfcfd', sc: 1 },
    { t: 'texture', tex: 'graph', c: '#5b8fd6', c2: '#fbfdff', sc: 1 },
    { t: 'texture', tex: 'cross', c: '#a08a6a', c2: '#faf6ee', sc: 1 },
    { t: 'texture', tex: 'checks', c: '#8a94a6', c2: '#f4f6f8', sc: 1 },
    { t: 'texture', tex: 'hlines', c: '#9aa4b2', c2: '#ffffff', sc: 1.2 },
    { t: 'texture', tex: 'weave', c: '#7d8ea6', c2: '#eef2f6', sc: 1.4 },
    { t: 'texture', tex: 'graph', c: '#6f8fbf', c2: '#16202b', sc: 1 }
  ];
  function presetToBg(p) {
    return { type: p.t, color: p.c || '', color2: p.c2 || '', texture: p.tex || 'dots', angle: p.a || 135, scale: p.sc || 1 };
  }
  function bgPreviewCss(bg) {
    if (bg.type === 'gradient') return 'linear-gradient(' + fillAngle(bg) + 'deg,' + (bg.color || '#dfe8f5') + ',' + (bg.color2 || '#ffffff') + ')';
    if (bg.type === 'texture') return textureCss(bg.texture, bg.color || '#8a94a6', bg.color2 || '#ffffff', bg.scale);
    return bg.color || 'var(--bg)';
  }
  function sameBg(a, b) {
    return a.type === b.type && (a.color || '') === (b.color || '') && (a.color2 || '') === (b.color2 || '')
      && (a.type !== 'texture' || a.texture === b.texture);
  }
  function buildBgPresets() {
    var box = $('bgPresets');
    var current = getActiveChart().background || defaultBackground();
    box.innerHTML = '';
    BG_PRESETS.forEach(function (p) {
      var bg = presetToBg(p);
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bgswatch' + (sameBg(bg, current) ? ' sel' : '');
      b.style.background = bgPreviewCss(bg);
      b.title = p.t + (p.tex ? ' · ' + p.tex : '');
      b.addEventListener('click', function () {
        pushUndo();
        getActiveChart().background = bg;
        saveState();
        applyChartVars();
        openDesign();
        toast('Background applied');
      });
      box.appendChild(b);
    });
  }

  function updateBgPickerVisibility() {
    var t = segValue(segBgType);
    $('bgSecondBlock').style.display = (t === 'gradient' || t === 'texture') ? 'block' : 'none';
    $('bgAngleRow').style.display = t === 'gradient' ? 'flex' : 'none';
    $('bgTextureBlock').style.display = t === 'texture' ? 'block' : 'none';
    $('bgInkLabel').textContent = t === 'texture' ? 'Pattern colour' : 'Colour';
    $('bgBaseLabel').textContent = t === 'texture' ? 'Behind the pattern' : 'Second colour';
    $('fBgAngleVal').textContent = fBgAngle.value + '\u00b0';
    $('fBgScaleVal').textContent = fBgScale.value + '%';
  }
  function applyBgLive() {
    var chart = getActiveChart();
    chart.background = {
      type: segValue(segBgType),
      color: bgColorPicker.dataset.value,
      color2: bgColor2Picker.dataset.value,
      texture: bgTextureGrid.dataset.value,
      angle: parseInt(fBgAngle.value, 10),
      scale: parseInt(fBgScale.value, 10) / 100
    };
    updateBgPickerVisibility();
    applyChartVars();
    // Keep the gallery highlight honest as the pieces are tweaked by hand.
    var box = $('bgPresets');
    if (box) {
      var kids = box.querySelectorAll('.bgswatch');
      BG_PRESETS.forEach(function (p, i) {
        if (kids[i]) kids[i].classList.toggle('sel', sameBg(presetToBg(p), chart.background));
      });
    }
  }
  fBgAngle.addEventListener('input', applyBgLive);
  fBgScale.addEventListener('input', applyBgLive);

  function onBgTypeChange(newType) {
    if (newType === 'texture' && (bgColorPicker.dataset.value === '#eef1f4' || !bgColorPicker.dataset.value)) {
      buildColorRow(bgColorPicker, '#6b7684', applyBgLive);
      buildTextureGrid(bgTextureGrid, bgTextureGrid.dataset.value || 'dots', '#6b7684', applyBgLive);
    }
    updateBgPickerVisibility();
    applyBgLive();
  }

  function buildThemeGrid() {
    themeGrid.innerHTML = '';
    PRESET_ORDER.forEach(function (key) {
      var p = PRESETS[key];
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'themecard';
      var swatch = p.bg.type === 'gradient' ? 'linear-gradient(135deg,' + p.bg.color + ',' + p.bg.color2 + ')' : (p.bg.type === 'texture' ? textureCss(p.bg.texture, p.bg.color, '#f4f6f8') : (p.bg.color || '#eef1f4'));
      card.innerHTML = '<span style="width:100%;height:20px;border-radius:6px;display:block;background:' + swatch + '"></span><span>' + p.label + '</span>';
      card.addEventListener('click', function () {
        pushUndo();
        var chart = getActiveChart();
        chart.background = { type: p.bg.type, color: p.bg.color || '', color2: p.bg.color2 || '', texture: p.bg.texture || 'dots', angle: p.bg.angle || 135, scale: p.bg.scale || 1 };
        chart.font = p.font;
        saveState();
        openDesign();
        applyChartVars();
        render();
        toast('Applied ' + p.label);
      });
      themeGrid.appendChild(card);
    });
  }

  function openDesign() {
    var chart = getActiveChart();
    var bg = chart.background || defaultBackground();
    wireSeg(segBgType, bg.type, onBgTypeChange);
    var bgInkFallback = bg.type === 'texture' ? '#6b7684' : '#eef1f4';
    buildColorRow(bgColorPicker, bg.color || bgInkFallback, applyBgLive);
    buildColorRow(bgColor2Picker, bg.color2 || '#dbe0e6', applyBgLive);
    buildTextureGrid(bgTextureGrid, bg.texture || 'dots', bg.color || '#6b7684', applyBgLive);
    fBgAngle.value = String(fillAngle(bg));
    fBgScale.value = String(Math.round(texScale(bg.scale) * 100));
    buildBgPresets();
    updateBgPickerVisibility();
    wireSeg($('segTrunk'), chart.trunk === false ? 'separate' : 'trunk', function (v) {
      pushUndo();
      getActiveChart().trunk = (v === 'trunk');
      saveState(); render();
      toast(v === 'trunk' ? 'Shared trunk lines' : 'Separate lines');
    });
    wireSeg($('segSnap'), chart.snap === false ? 'off' : 'on', function (v) {
      getActiveChart().snap = (v === 'on');
      saveState();
      toast(v === 'on' ? 'Snapping on' : 'Free drag');
    });
    wireSeg($('segDensity'), chart.density || 'standard', function (v) {
      pushUndo();
      getActiveChart().density = v;
      saveState();
      applyTokens();
      render();
      fitToScreen();
      toast(v.charAt(0).toUpperCase() + v.slice(1) + ' spacing');
    });
    wireSeg($('segContrast'), prefs.contrast || 'normal', function (v) {
      prefs.contrast = v;
      savePrefs();
      applyTokens();
      render();
      toast(v === 'high' ? 'High contrast on' : 'Normal contrast');
    });
    wireSeg($('segTapAdd'), prefs.tapAdd, function (v) {
      prefs.tapAdd = v;
      savePrefs();
      toast(v === 'ask' ? 'Will ask before adding' : (v === 'always' ? 'Tap adds a box' : 'Tapping won\u2019t add boxes'));
    });
    wireSeg($('segChartBadges'), chart.badges || 'show', function (v) {
      pushUndo();
      var c = getActiveChart();
      c.badges = v;
      // Apply to every existing box so one switch clears them all. Showing
      // badges again restores each card's own mode rather than forcing
      // "photo", so a box set to nickname-only keeps its nickname.
      Object.keys(c.nodes).forEach(function (id) {
        var node = c.nodes[id];
        if (v === 'hide') {
          if (node.avatarMode !== 'none') node.prevAvatarMode = node.avatarMode;
          node.avatarMode = 'none';
        } else {
          node.avatarMode = node.prevAvatarMode || 'auto';
        }
      });
      saveState();
      render();
      toast(v === 'hide' ? 'Badges hidden' : 'Badges shown');
    });
    populateFontSelect(chartFontSel, chart.font);
    buildThemeGrid();
    wireSeg($('segAppearance'), getAppearance(), setAppearance);
    designBackdrop.classList.add('show');
    designSheet.classList.add('show');
  }
  // Background edits are applied live to the chart object, so dismissing the
  // sheet by tapping outside used to drop them on the floor — only the Done
  // button ever wrote to disk. Persist on any close.
  function closeDesign() {
    designBackdrop.classList.remove('show');
    designSheet.classList.remove('show');
    saveState();
  }
  $('designBtn').addEventListener('click', openDesign);
  $('designOpenBtn').addEventListener('click', function () { closeMenu(); openDesign(); });
  $('designDoneBtn').addEventListener('click', function () {
    var chart = getActiveChart();
    chart.font = chartFontSel.value;
    saveState();
    applyChartVars();
    render();
    closeDesign();
  });
  designBackdrop.addEventListener('click', function (e) { if (e.target === designBackdrop) closeDesign(); });

  // -------------------------------------------------------------------
  // Department containers
  // -------------------------------------------------------------------
  // A labelled panel drawn behind cards to bundle a division visually.
  // Dragging the panel moves the cards sitting inside it, which is what
  // makes it feel like a real group rather than a rectangle.
  var groupEls = {};

  function renderGroups() {
    var chart = getActiveChart();
    Object.keys(groupEls).forEach(function (id) {
      if (!chart.groups[id]) { groupEls[id].remove(); delete groupEls[id]; }
    });
    Object.keys(chart.groups).forEach(function (id) {
      var g = chart.groups[id];
      var el = groupEls[id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'groupbox';
        el.dataset.id = id;
        el.innerHTML = '<div class="gbLabel"></div><div class="gbGrip"></div>';
        // Behind the cards but above the background.
        canvas.insertBefore(el, canvas.firstChild);
        groupEls[id] = el;
        wireGroupEvents(el);
      }
      el.style.left = g.x + 'px';
      el.style.top = g.y + 'px';
      el.style.width = g.w + 'px';
      el.style.height = g.h + 'px';
      el.style.borderColor = g.color;
      el.style.background = hexToRgba(g.color, 0.08);
      el.style.borderStyle = g.dash === 'dashed' ? 'dashed' : 'solid';
      var lab = el.querySelector('.gbLabel');
      lab.textContent = g.label || '';
      lab.style.display = g.label ? 'block' : 'none';
      lab.style.background = g.color;
    });
  }

  function hexToRgba(hex, a) {
    var c = hexToRgb(hex) || { r: 53, g: 104, b: 212 };
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  // Which boxes currently sit inside this container.
  function nodesInGroup(g) {
    var chart = getActiveChart();
    return Object.keys(chart.nodes).filter(function (id) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      var cx = n.x + nodeW(n) / 2, cy = n.y + h / 2;
      return cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h;
    });
  }

  function wireGroupEvents(el) {
    var id = el.dataset.id;
    // Resize from the corner grip.
    el.querySelector('.gbGrip').addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      var grip = e.currentTarget;
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      var g = getActiveChart().groups[id];
      var sx = e.clientX, sy = e.clientY, ow = g.w, oh = g.h;
      var preSnap = snapshot(), moved = false;
      function mv(ev) {
        moved = true;
        g.w = Math.max(120, ow + (ev.clientX - sx) / scale);
        g.h = Math.max(90, oh + (ev.clientY - sy) / scale);
        el.style.width = g.w + 'px';
        el.style.height = g.h + 'px';
      }
      function up() {
        grip.removeEventListener('pointermove', mv);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        if (moved) { commitUndo(preSnap); saveState(); }
      }
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });

    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.gbGrip')) return;
      e.stopPropagation();
      var chart = getActiveChart();
      var g = chart.groups[id];
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      var sx = e.clientX, sy = e.clientY;
      var ox = g.x, oy = g.y;
      // Capture the members up front so boxes don't join or leave mid-drag.
      var members = nodesInGroup(g).map(function (nid) {
        return { id: nid, x: chart.nodes[nid].x, y: chart.nodes[nid].y };
      });
      var moved = false, preSnap = null;
      function mv(ev) {
        var dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
        if (!moved && (Math.abs(ev.clientX - sx) > 6 || Math.abs(ev.clientY - sy) > 6)) {
          moved = true; preSnap = snapshot(); el.classList.add('dragging');
        }
        if (!moved) return;
        g.x = ox + dx; g.y = oy + dy;
        el.style.left = g.x + 'px';
        el.style.top = g.y + 'px';
        members.forEach(function (m) {
          chart.nodes[m.id].x = m.x + dx;
          chart.nodes[m.id].y = m.y + dy;
        });
        renderPositionsOnly();
      }
      function up() {
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.classList.remove('dragging');
        if (moved) { commitUndo(preSnap); saveState(); }
        else openGroupSheet(id);
      }
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  function addGroup() {
    pushUndo();
    var chart = getActiveChart();
    var id = uid();
    var c = clientToCanvas(stage.clientWidth / 2, stage.clientHeight / 2);
    chart.groups[id] = {
      id: id, label: 'Department', color: COLOR_SWATCHES[Object.keys(chart.groups).length % COLOR_SWATCHES.length],
      dash: 'solid', x: c.x - 170, y: c.y - 120, w: 340, h: 240
    };
    saveState(); render();
    openGroupSheet(id);
  }
  $('groupFab').addEventListener('click', addGroup);

  // ---- group editor ----
  var editingGroupId = null;
  var groupBackdrop = $('groupBackdrop'), groupSheet = $('groupSheet');
  function openGroupSheet(id) {
    editingGroupId = id;
    var g = getActiveChart().groups[id];
    if (!g) return;
    $('gLabel').value = g.label || '';
    buildColorRow($('gColor'), g.color, function (c) {
      g.color = c; renderGroups();
    });
    wireSeg($('segGroupDash'), g.dash || 'solid', function (v) { g.dash = v; renderGroups(); });
    $('gFit').onclick = function () {
      // Shrink-wrap the container around the cards inside it.
      var chart = getActiveChart();
      var ids = nodesInGroup(g);
      if (!ids.length) { toast('No boxes inside this container'); return; }
      pushUndo();
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      ids.forEach(function (nid) {
        var n = chart.nodes[nid];
        var h = (nodeEls[nid] && nodeEls[nid].offsetHeight) || NODE_H_APPROX;
        minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + nodeW(n)); maxY = Math.max(maxY, n.y + h);
      });
      var m = 26;
      g.x = minX - m; g.y = minY - m;
      g.w = (maxX - minX) + m * 2; g.h = (maxY - minY) + m * 2;
      saveState(); render();
      toast('Wrapped ' + ids.length + ' box' + (ids.length === 1 ? '' : 'es'));
    };
    groupBackdrop.classList.add('show');
    groupSheet.classList.add('show');
  }
  function closeGroupSheet() { groupBackdrop.classList.remove('show'); groupSheet.classList.remove('show'); editingGroupId = null; }
  $('gLabel').addEventListener('input', function () {
    if (!editingGroupId) return;
    getActiveChart().groups[editingGroupId].label = $('gLabel').value;
    renderGroups();
  });
  $('gSave').addEventListener('click', function () { saveState(); closeGroupSheet(); render(); });
  $('gDelete').addEventListener('click', function () {
    if (!editingGroupId) return;
    if (!window.confirm('Delete this container? The boxes inside are kept.')) return;
    pushUndo();
    delete getActiveChart().groups[editingGroupId];
    saveState(); closeGroupSheet(); render();
  });
  groupBackdrop.addEventListener('click', function (e) { if (e.target === groupBackdrop) { saveState(); closeGroupSheet(); } });

  // ---------------------------------------------------------------------
  // Title block & legend editor
  // ---------------------------------------------------------------------
  var titleBackdrop = $('titleBackdrop'), titleSheet = $('titleSheet');

  function renderLegendEditor() {
    var lg = getActiveChart().legend;
    var box = $('legendItems');
    box.innerHTML = '';
    (lg.items || []).forEach(function (item, i) {
      var row = document.createElement('div');
      row.className = 'legendrow';
      var sw = document.createElement('label');
      sw.className = 'lrSwatch';
      sw.style.background = item.type === 'line' ? 'var(--panel2)' : item.color;
      if (item.type === 'line') {
        sw.innerHTML = '<span style="position:absolute;left:4px;right:4px;top:50%;border-top:3px ' +
          (item.dash === 'dashed' ? 'dashed' : item.dash === 'dotted' ? 'dotted' : 'solid') + ' ' + item.color + '"></span>';
      }
      var ci = document.createElement('input');
      ci.type = 'color'; ci.value = /^#[0-9a-f]{6}$/i.test(item.color) ? item.color : '#3568d4';
      ci.addEventListener('input', function () { item.color = ci.value; saveState(); renderLegendEditor(); renderLegend(); });
      sw.appendChild(ci);

      var label = document.createElement('input');
      label.className = 'lrLabel';
      label.value = item.label || '';
      label.placeholder = item.type === 'line' ? 'e.g. Dotted-line report' : 'e.g. Operations';
      label.addEventListener('input', function () { item.label = label.value; renderLegend(); });
      label.addEventListener('change', function () { saveState(); });

      var del = document.createElement('button');
      del.type = 'button'; del.className = 'lrDel'; del.textContent = '✕';
      del.addEventListener('click', function () {
        pushUndo(); lg.items.splice(i, 1); saveState(); renderLegendEditor(); renderLegend();
      });

      row.appendChild(sw); row.appendChild(label);
      // A line key cycles solid -> dashed -> dotted when its sample is tapped.
      if (item.type === 'line') {
        var cyc = document.createElement('button');
        cyc.type = 'button'; cyc.className = 'lrDel'; cyc.textContent = '⋯';
        cyc.style.color = 'var(--text)';
        cyc.addEventListener('click', function () {
          item.dash = item.dash === 'solid' ? 'dashed' : (item.dash === 'dashed' ? 'dotted' : 'solid');
          saveState(); renderLegendEditor(); renderLegend();
        });
        row.appendChild(cyc);
      }
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  // Seed the key from the colours and line styles actually used in the chart.
  function autoLegend() {
    var chart = getActiveChart();
    var lg = chart.legend;
    var seen = {}, items = [];
    Object.keys(chart.nodes).forEach(function (id) {
      var n = chart.nodes[id];
      var c = (n.fill && n.fill.type === 'solid' && n.fill.color) ? n.fill.color : n.color;
      if (!c || seen['f' + c]) return;
      seen['f' + c] = 1;
      items.push({ type: 'fill', color: c, label: '' });
    });
    Object.keys(chart.edges).forEach(function (id) {
      var e = chart.edges[id];
      var dash = e.dash || 'solid';
      var col = e.color || '#3568d4';
      var k = 'l' + dash + col;
      if (seen[k]) return;
      seen[k] = 1;
      items.push({ type: 'line', color: col, dash: dash, label: dash === 'solid' ? 'Direct report' : 'Dotted-line report' });
    });
    lg.items = items.slice(0, 10);
  }

  function openTitleSheet() {
    var chart = getActiveChart();
    var tb = chart.titleBlock, lg = chart.legend;
    wireSeg($('segTitleShow'), tb.show ? 'on' : 'off', function (v) {
      pushUndo(); tb.show = (v === 'on');
      if (tb.show && !tb.title) tb.title = chart.name || '';
      saveState(); render(); $('tTitle').value = tb.title || '';
    });
    $('tTitle').value = tb.title || '';
    $('tSubtitle').value = tb.subtitle || '';
    $('tDate').value = tb.date || '';
    wireSeg($('segLegendShow'), lg.show ? 'on' : 'off', function (v) {
      pushUndo(); lg.show = (v === 'on');
      if (lg.show && !(lg.items || []).length) autoLegend();
      saveState(); render(); renderLegendEditor();
    });
    $('lTitle').value = lg.title || '';
    renderLegendEditor();
    titleBackdrop.classList.add('show');
    titleSheet.classList.add('show');
  }
  function closeTitleSheet() { titleBackdrop.classList.remove('show'); titleSheet.classList.remove('show'); }

  ['tTitle', 'tSubtitle', 'tDate'].forEach(function (id) {
    var key = { tTitle: 'title', tSubtitle: 'subtitle', tDate: 'date' }[id];
    $(id).addEventListener('input', function () { getActiveChart().titleBlock[key] = $(id).value; renderTitleBlock(); });
    $(id).addEventListener('change', function () { saveState(); });
  });
  $('lTitle').addEventListener('input', function () { getActiveChart().legend.title = $('lTitle').value; renderLegend(); });
  $('lTitle').addEventListener('change', function () { saveState(); });

  $('legendAddFill').addEventListener('click', function () {
    var lg = getActiveChart().legend;
    pushUndo();
    lg.items = lg.items || [];
    lg.items.push({ type: 'fill', color: COLOR_SWATCHES[lg.items.length % COLOR_SWATCHES.length], label: '' });
    lg.show = true;
    saveState(); renderLegendEditor(); render();
    wireSeg($('segLegendShow'), 'on');
  });
  $('legendAddLine').addEventListener('click', function () {
    var lg = getActiveChart().legend;
    pushUndo();
    lg.items = lg.items || [];
    lg.items.push({ type: 'line', color: '#6b7684', dash: 'dashed', label: '' });
    lg.show = true;
    saveState(); renderLegendEditor(); render();
    wireSeg($('segLegendShow'), 'on');
  });
  $('legendAuto').addEventListener('click', function () {
    pushUndo();
    autoLegend();
    getActiveChart().legend.show = true;
    saveState(); renderLegendEditor(); render();
    wireSeg($('segLegendShow'), 'on');
    toast('Key built from chart colours');
  });

  $('titleOpenBtn').addEventListener('click', function () { closeDesign(); openTitleSheet(); });
  $('titleDone').addEventListener('click', function () { saveState(); closeTitleSheet(); render(); });
  titleBackdrop.addEventListener('click', function (e) { if (e.target === titleBackdrop) { saveState(); closeTitleSheet(); } });

  // ---------------------------------------------------------------------
  // Export sheet
  // ---------------------------------------------------------------------
  function openExport() { exportBackdrop.classList.add('show'); exportSheet.classList.add('show'); }
  function closeExport() { exportBackdrop.classList.remove('show'); exportSheet.classList.remove('show'); }
  $('exportOpenBtn').addEventListener('click', function () { closeMenu(); openExport(); });
  $('exportCloseBtn').addEventListener('click', closeExport);
  exportBackdrop.addEventListener('click', function (e) { if (e.target === exportBackdrop) closeExport(); });
  $('shareBtn').addEventListener('click', function () { openExport(); });

  // ---------------------------------------------------------------------
  // JSON export / import
  // ---------------------------------------------------------------------
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 1000);
  }
  function baseFilename() { var chart = getActiveChart(); return (chart.name || 'orgchart').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'orgchart'; }
  function shareOrDownload(blob, filename, mime) {
    if (!blob) return;
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
      navigator.share({ files: [new File([blob], filename, { type: mime })] }).catch(function () {});
    } else downloadBlob(blob, filename);
  }

  $('exportBtn').addEventListener('click', function () {
    var chart = getActiveChart();
    var blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' });
    shareOrDownload(blob, baseFilename() + '.json', 'application/json');
  });
  $('importBtn').addEventListener('click', function () { importFile.value = ''; importFile.click(); });
  importFile.addEventListener('change', function () {
    var file = importFile.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!data.nodes) throw new Error('bad file');
        migrateChart(data);
        var id = uid();
        data.id = id;
        data.name = data.name || 'Imported chart';
        state.charts[id] = data;
        state.activeId = id;
        saveState(); closeExport(); render(); fitToScreen();
        toast('Imported');
      } catch (e) { alert('That file doesn\'t look like a valid OrgChart export.'); }
    };
    reader.readAsText(file);
  });

  // ---------------------------------------------------------------------
  // Shared SVG builder — PNG / JPG / SVG / PDF
  // ---------------------------------------------------------------------
  function buildChartSvg() {
    var chart = getActiveChart();
    var nodeIds = Object.keys(chart.nodes);
    var noteIds = Object.keys(chart.notes);
    if (!nodeIds.length && !noteIds.length) return null;
    var pal = APPEARANCE_PALETTES[resolvedAppearance()] || APPEARANCE_PALETTES.light;
    var isDark = resolvedAppearance() !== 'light';
    var panelBg = pal.panel;
    var panelLine = pal.line;
    var textColorDefault = pal.text;
    var mutedColor = pal.muted;
    var pageBg = pal.bg;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodeIds.forEach(function (id) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + nodeW(n)); maxY = Math.max(maxY, n.y + h);
    });
    noteIds.forEach(function (id) {
      var pos = noteAnchor(chart.notes[id]);
      minX = Math.min(minX, pos.x); minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + 132); maxY = Math.max(maxY, pos.y + 70);
    });
    Object.keys(chart.groups || {}).forEach(function (id) {
      var g = chart.groups[id];
      minX = Math.min(minX, g.x); minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h);
    });
    // The title block and legend are part of the drawing, so they have to
    // widen the export bounds too or they'd be cropped off.
    var tb = chart.titleBlock, lg = chart.legend;
    var tbW = 0, tbH = 0;
    if (tb && tb.show) {
      tbW = titleEl ? titleEl.offsetWidth : 320;
      tbH = titleEl ? titleEl.offsetHeight : 70;
      minX = Math.min(minX, tb.x); minY = Math.min(minY, tb.y);
      maxX = Math.max(maxX, tb.x + tbW); maxY = Math.max(maxY, tb.y + tbH);
    }
    var lgW = 0, lgH = 0;
    if (lg && lg.show) {
      lgW = legendEl ? legendEl.offsetWidth : 170;
      lgH = legendEl ? legendEl.offsetHeight : 90;
      minX = Math.min(minX, lg.x); minY = Math.min(minY, lg.y);
      maxX = Math.max(maxX, lg.x + lgW); maxY = Math.max(maxY, lg.y + lgH);
    }
    var pad = 40;
    var W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
    var fontFamily = (FONT_STACKS[chart.font] || FONT_STACKS.system).replace(/"/g, "'");
    var defs = [], parts = [];

    parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + fontFamily + '">');
    var bg = chart.background || defaultBackground();
    if (bg.type === 'gradient') {
      var bgv = angleVector(fillAngle(bg));
      defs.push('<linearGradient id="bgGrad" x1="' + bgv.x1 + '" y1="' + bgv.y1 + '" x2="' + bgv.x2 + '" y2="' + bgv.y2 + '"><stop offset="0" stop-color="' + (bg.color || panelLine) + '"/><stop offset="1" stop-color="' + (bg.color2 || pageBg) + '"/></linearGradient>');
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#bgGrad)"/>');
    } else if (bg.type === 'texture' && bg.texture !== 'none') {
      var pid = 'bgpat';
      var bgBaseX = (bg.color2 && bg.color2.charAt(0) === '#') ? bg.color2 : pageBg;
      defs.push(svgPatternDef(pid, bg.texture, bg.color || mutedColor, bgBaseX, bg.scale));
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + bgBaseX + '"/>');
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#' + pid + ')"/>');
    } else {
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + (bg.color || pageBg) + '"/>');
    }

    function toDoc(x, y) { return { x: x - minX + pad, y: y - minY + pad }; }

    // Department containers sit behind the cards and connectors.
    Object.keys(chart.groups || {}).forEach(function (id) {
      var g = chart.groups[id];
      var gp = toDoc(g.x, g.y);
      var gc = hexToRgb(g.color) || { r: 53, g: 104, b: 212 };
      var gFill = 'rgba(' + gc.r + ',' + gc.g + ',' + gc.b + ',0.08)';
      parts.push('<rect x="' + gp.x + '" y="' + gp.y + '" width="' + g.w + '" height="' + g.h + '" rx="14" fill="' + gFill + '" stroke="' + g.color + '" stroke-width="2"' + (g.dash === 'dashed' ? ' stroke-dasharray="8 6"' : '') + '/>');
      if (g.label) {
        var lw = measureTextWidth(g.label.toUpperCase(), 11.5, true, fontFamily) + 18;
        parts.push('<rect x="' + (gp.x + 14) + '" y="' + (gp.y - 11) + '" width="' + lw + '" height="21" rx="10.5" fill="' + g.color + '"/>');
        parts.push('<text x="' + (gp.x + 14 + lw / 2) + '" y="' + (gp.y + 3.5) + '" font-family="' + fontFamily + '" font-size="11.5" font-weight="700" letter-spacing="0.5" fill="#ffffff" text-anchor="middle">' + escapeHtml(g.label.toUpperCase()) + '</text>');
      }
    });

    var heightOfExp = function (id) { return (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX; };
    // Build trunk routes in chart space, then shift them into page space.
    var trunkRaw = computeTrunkPaths(chart, heightOfExp);
    var trunkDoc = {};
    Object.keys(trunkRaw).forEach(function (id) {
      trunkDoc[id] = trunkRaw[id].replace(/(-?[\d.]+) (-?[\d.]+)/g, function (m, mx, my) {
        return (parseFloat(mx) - minX + pad) + ' ' + (parseFloat(my) - minY + pad);
      });
    });
    Object.keys(chart.edges).forEach(function (id, idx) {
      var e = chart.edges[id];
      var a = chart.nodes[e.from], b = chart.nodes[e.to];
      if (!a || !b) return;
      var hA = (nodeEls[e.from] && nodeEls[e.from].offsetHeight) || NODE_H_APPROX;
      var hB = (nodeEls[e.to] && nodeEls[e.to].offsetHeight) || NODE_H_APPROX;
      var aDoc = Object.assign({}, a, toDoc(a.x, a.y));
      var bDoc = Object.assign({}, b, toDoc(b.x, b.y));
      var pA = anchorOnNode(aDoc, hA, bDoc.x + nodeW(b) / 2, bDoc.y + hB / 2);
      var pB = anchorOnNode(bDoc, hB, aDoc.x + nodeW(a) / 2, aDoc.y + hA / 2);
      var style = e.style || 'elbow';
      var d = trunkDoc[id] || edgePathBetween(pA, pB, style);
      if (trunkDoc[id]) pB = { x: bDoc.x + nodeW(b) / 2, y: bDoc.y };
      var color = e.color || (isDark ? '#5c8bef' : '#3568d4');
      var width = e.width || 2;
      var dashArr = e.dash === 'dashed' ? (width * 2.5) + ' ' + (width * 2) : (e.dash === 'dotted' ? '1 ' + (width * 2.2) : '');
      var markStart = '', markEnd = '';
      if (e.arrowStart) { defs.push('<marker id="es' + idx + '" markerWidth="9" markerHeight="9" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,4 L8,8 Z" fill="' + color + '"/></marker>'); markStart = 'marker-start="url(#es' + idx + ')"'; }
      if (e.arrowEnd !== false) { defs.push('<marker id="ee' + idx + '" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="' + color + '"/></marker>'); markEnd = 'marker-end="url(#ee' + idx + ')"'; }
      parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round"' + (dashArr ? ' stroke-dasharray="' + dashArr + '"' : '') + ' ' + markStart + ' ' + markEnd + '/>');
      if (e.label) {
        var mid = trunkDoc[id] ? { x: pB.x, y: pB.y - 14 } : midOfPath(pA, pB, style);
        var w = Math.max(20, e.label.length * 6.4 + 10);
        parts.push('<rect x="' + (mid.x - w / 2) + '" y="' + (mid.y - 10) + '" width="' + w + '" height="18" rx="4" fill="' + panelBg + '" stroke="' + panelLine + '"/>');
        parts.push('<text x="' + mid.x + '" y="' + (mid.y + 4) + '" font-size="11" fill="' + textColorDefault + '" text-anchor="middle">' + escapeHtml(e.label) + '</text>');
      }
    });

    nodeIds.forEach(function (id, idx) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      var p = toDoc(n.x, n.y);
      var x = p.x, y = p.y;
      var accent = n.color || COLOR_SWATCHES[0];
      var shape = n.shape || 'rounded';
      var W = nodeW(n), fs = nodeScale(n);
      var sdefX = shapeDef(shape);
      var fixedAspect = !!sdefX.fixedAspect;
      var boxH = fixedAspect ? W : (n.height || h);
      // Fixed-aspect shapes, explicit heights and the shapes that centre on
      // screen all centre their content here too.
      var centreV = fixedAspect || !!n.height || shape === 'diamond' || shape === 'octagon' || shape === 'cylinder';
      var fill = n.fill || defaultFill();
      var fillAttr;
      if (fill.type === 'gradient') {
        var gid = 'ng' + idx;
        var gv = angleVector(fillAngle(fill));
        defs.push('<linearGradient id="' + gid + '" x1="' + gv.x1 + '" y1="' + gv.y1 + '" x2="' + gv.x2 + '" y2="' + gv.y2 + '">'
          + '<stop offset="0" stop-color="' + (fill.color || accent) + '"/>'
          + '<stop offset="1" stop-color="' + (fill.color2 || accent) + '"/></linearGradient>');
        fillAttr = 'url(#' + gid + ')';
      } else if (fill.type === 'texture' && fill.texture !== 'none') {
        var tid = 'nt' + idx;
        defs.push(svgPatternDef(tid, fill.texture, fill.color || accent, panelBg, fill.scale));
        fillAttr = 'url(#' + tid + ')';
      } else fillAttr = fill.color || panelBg;
      var border = n.border || defaultBorder();
      var dashArr2 = border.dash === 'dashed' ? (border.width * 2.5) + ' ' + (border.width * 2) : (border.dash === 'dotted' ? '1 ' + (border.width * 2.2) : '');
      // Same path generator as the on-screen card, so the two cannot diverge.
      var swX = border.width || 1;
      var pathD = shapePath(shape, W - swX, boxH - swX, cornerRadius(n));
      var photoOnlyX = isPhotoOnly(n);
      var photoMarkup = '';
      if (photoOnlyX) {
        var pcId = 'pc' + idx;
        defs.push('<clipPath id="' + pcId + '" clipPathUnits="userSpaceOnUse"><path d="' + pathD + '"/></clipPath>');
        photoMarkup = '<image href="' + n.photo + '" x="0" y="0" width="' + (W - swX) + '" height="' + (boxH - swX) + '"'
          + ' preserveAspectRatio="xMidYMid slice" clip-path="url(#' + pcId + ')"/>';
        fillAttr = 'none';
      }
      parts.push('<g transform="translate(' + (x + swX / 2) + ',' + (y + swX / 2) + ')">'
        + '<path d="' + pathD + '" fill="' + fillAttr + '" stroke="none"/>'
        + photoMarkup
        + '<path d="' + pathD + '" fill="none" stroke="' + (border.color || panelLine) + '" stroke-width="' + swX + '"'
        + (dashArr2 ? ' stroke-dasharray="' + dashArr2 + '"' : '') + '/>'
        + (sdefX.kind === 'cylinder'
            ? '<path d="' + cylinderLip(W - swX, boxH - swX).lip + '" fill="none" stroke="' + (border.color || panelLine) + '" stroke-width="' + swX + '" opacity=".55"/>'
            : '')
        + '</g>');

      // A photo-only card is just the picture — no badge, no text.
      if (photoOnlyX) return;

      var isRow = (n.layout || 'stack') === 'row';
      var align = n.align || 'center';
      var padT = 10 * fs + boxH * (sdefX.insetY || 0);
      var padL = 12 * fs + W * (sdefX.insetX || 0);
      var avR = (AVATAR_SIZES[fs] || 44 * fs) / 2;
      var hasAvatar = showsAvatar(n);
      var nameFont = (n.font ? FONT_STACKS[n.font] : fontFamily).replace(/"/g, "'");

      // Badge metrics. A nickname longer than initials becomes a pill that
      // grows sideways, so its width has to be known before anything is laid
      // out around it. Mirrors the CSS in applyNodeStyle.
      var badgeStr = badgeText(n);
      var isPill = badgeIsPill(n);
      var badgeSize = isPill ? Math.min(14 * fs, avR * 0.84)
        : Math.min(15 * fs, (avR * 1.75) / Math.max(1, badgeStr.length) * 1.6);
      var badgeW = isPill
        ? Math.max(avR * 2, measureTextWidth(badgeStr, badgeSize, true, nameFont) + avR * 1.12)
        : avR * 2;

      // Horizontal placement of the text block, honouring the alignment
      // setting. In compact mode the text sits to the right of the badge.
      var textLeft, innerW;
      if (isRow) {
        textLeft = x + padL + (hasAvatar ? badgeW + 10 : 0);
        innerW = W - (textLeft - x) - padL;
      } else {
        textLeft = x + padL;
        innerW = W - padL * 2;
      }
      var textAnchor = align === 'left' ? 'start' : (align === 'right' ? 'end' : 'middle');
      var textX = align === 'left' ? textLeft
        : (align === 'right' ? textLeft + innerW : textLeft + innerW / 2);
      // The badge follows the alignment in stacked mode so the card reads as
      // one aligned block; in compact mode it always leads on the left.
      var cx = isRow ? x + padL + badgeW / 2
        : (align === 'left' ? x + padL + badgeW / 2
          : (align === 'right' ? x + W - padL - badgeW / 2 : x + W / 2));

      var tcx = textColorsFor(n);
      var nameColor = tcx.name || textColorDefault;
      var titleColor = tcx.title || mutedColor;
      var nameSize = 14.5 * fs, titleSize = 12 * fs, detailSize = 11 * fs;
      // Wrap rather than truncate, so the exported chart matches the screen.
      var nameLines = wrapSvgText(n.name || 'Unnamed', innerW, nameSize, true, nameFont);
      var titleLines = n.title ? wrapSvgText(n.title, innerW, titleSize, false, nameFont) : [];
      var detailLines = n.detail ? wrapSvgText(n.detail, innerW, detailSize, false, nameFont) : [];

      var textBlockH = nameLines.length * nameSize * 1.25
        + (titleLines.length ? titleSize * 1.35 + (titleLines.length - 1) * titleSize * 1.2 : 0)
        + (detailLines.length ? detailSize * 1.35 + (detailLines.length - 1) * detailSize * 1.2 : 0);

      // Work out where the badge and text start before drawing either, so
      // fixed-height shapes can centre the whole group vertically.
      var avatarCy, cursorY;
      if (isRow) {
        avatarCy = y + boxH / 2;
        cursorY = y + boxH / 2 - textBlockH / 2;
      } else if (centreV) {
        var wholeH = (hasAvatar ? avR * 2 + 6 * fs : 0) + textBlockH;
        var blockTop = y + boxH / 2 - wholeH / 2;
        avatarCy = blockTop + avR;
        cursorY = blockTop + (hasAvatar ? avR * 2 + 6 * fs : 0);
      } else {
        avatarCy = y + padT + avR;
        cursorY = y + padT + (hasAvatar ? avR * 2 + 6 * fs : 0);
      }

      if (hasAvatar) {
        if (showsPhoto(n)) {
          var clipId = 'clip' + idx;
          defs.push('<clipPath id="' + clipId + '"><circle cx="' + cx + '" cy="' + avatarCy + '" r="' + avR + '"/></clipPath>');
          parts.push('<image href="' + n.photo + '" x="' + (cx - avR) + '" y="' + (avatarCy - avR) + '" width="' + (avR * 2) + '" height="' + (avR * 2) + '" clip-path="url(#' + clipId + ')" preserveAspectRatio="xMidYMid slice"/>');
        } else {
          if (isPill) {
            parts.push('<rect x="' + (cx - badgeW / 2) + '" y="' + (avatarCy - avR) + '" width="' + badgeW + '" height="' + (avR * 2) + '" rx="' + avR + '" fill="' + accent + '"/>');
          } else {
            parts.push('<circle cx="' + cx + '" cy="' + avatarCy + '" r="' + avR + '" fill="' + accent + '"/>');
          }
          parts.push('<text x="' + cx + '" y="' + (avatarCy + badgeSize * 0.35) + '" font-family="' + nameFont + '" font-size="' + badgeSize.toFixed(1) + '" font-weight="700" fill="#fff" text-anchor="middle">' + escapeHtml(badgeStr) + '</text>');
        }
      }

      cursorY += nameSize;
      nameLines.forEach(function (line, li) {
        parts.push('<text x="' + textX + '" y="' + (cursorY + li * nameSize * 1.25) + '" font-family="' + nameFont + '" font-size="' + nameSize.toFixed(1) + '" font-weight="700" fill="' + nameColor + '" text-anchor="' + textAnchor + '">' + escapeHtml(line) + '</text>');
      });
      cursorY += (nameLines.length - 1) * nameSize * 1.25;

      if (titleLines.length) {
        cursorY += titleSize * 1.35;
        titleLines.forEach(function (line, li) {
          parts.push('<text x="' + textX + '" y="' + (cursorY + li * titleSize * 1.2) + '" font-family="' + nameFont + '" font-size="' + titleSize.toFixed(1) + '" fill="' + titleColor + '" text-anchor="' + textAnchor + '">' + escapeHtml(line) + '</text>');
        });
        cursorY += (titleLines.length - 1) * titleSize * 1.2;
      }
      if (detailLines.length) {
        cursorY += detailSize * 1.35;
        detailLines.forEach(function (line, li) {
          parts.push('<text x="' + textX + '" y="' + (cursorY + li * detailSize * 1.2) + '" font-family="' + nameFont + '" font-size="' + detailSize.toFixed(1) + '" fill="' + titleColor + '" text-anchor="' + textAnchor + '">' + escapeHtml(line) + '</text>');
        });
      }
    });

    noteIds.forEach(function (id) {
      var t = noteTether(id);
      if (t) {
        parts.push('<line x1="' + (t.x1 - minX + pad) + '" y1="' + (t.y1 - minY + pad) + '" x2="' + (t.x2 - minX + pad) + '" y2="' + (t.y2 - minY + pad) + '" stroke="' + mutedColor + '" stroke-width="1.5" stroke-dasharray="3 4" opacity=".6"/>');
      }
    });

    noteIds.forEach(function (id) {
      var note = chart.notes[id];
      var pos = noteAnchor(note);
      var p = toDoc(pos.x, pos.y);
      var w = 132;
      var lines = wrapSvgText(note.text || '', w - 20, 11.5, false, fontFamily);
      var h2 = Math.max(70, 16 + lines.length * 14);
      parts.push('<rect x="' + p.x + '" y="' + p.y + '" width="' + w + '" height="' + h2 + '" rx="8" fill="' + (note.color || '#ffe58a') + '" stroke="rgba(0,0,0,.15)"/>');
      lines.forEach(function (line, li) {
        parts.push('<text x="' + (p.x + 10) + '" y="' + (p.y + 20 + li * 14) + '" font-size="11.5" fill="#3a3420">' + escapeHtml(line) + '</text>');
      });
    });

    // ---- title block ----
    if (tb && tb.show) {
      var tX = tb.x - minX + pad, tY = tb.y - minY + pad;
      // Match the on-screen .titleblock max-width, with a little slack so a
      // title that fits on one line on screen doesn't wrap in the export.
      var titleWrapW = Math.min(420, Math.max(tbW + 4, 200));
      var tLines = wrapSvgText(tb.title || chart.name || '', titleWrapW, 26, true, fontFamily);
      var ty = tY + 26;
      tLines.forEach(function (line, li) {
        parts.push('<text x="' + tX + '" y="' + (ty + li * 30) + '" font-family="' + fontFamily + '" font-size="26" font-weight="700" fill="' + textColorDefault + '">' + escapeHtml(line) + '</text>');
      });
      ty += (tLines.length - 1) * 30;
      if (tb.subtitle) { ty += 21; parts.push('<text x="' + tX + '" y="' + ty + '" font-family="' + fontFamily + '" font-size="14" fill="' + mutedColor + '">' + escapeHtml(tb.subtitle) + '</text>'); }
      if (tb.date) { ty += 18; parts.push('<text x="' + tX + '" y="' + ty + '" font-family="' + fontFamily + '" font-size="11.5" fill="' + mutedColor + '">' + escapeHtml(tb.date) + '</text>'); }
    }

    // ---- legend ----
    if (lg && lg.show) {
      var items = lg.items || [];
      var lX = lg.x - minX + pad, lY = lg.y - minY + pad;
      var lw = Math.max(150, lgW || 170);
      var lh = 20 + (lg.title ? 19 : 0) + items.length * 20;
      parts.push('<rect x="' + lX + '" y="' + lY + '" width="' + lw + '" height="' + lh + '" rx="10" fill="' + panelBg + '" stroke="' + panelLine + '"/>');
      var ly = lY + 12;
      if (lg.title) {
        ly += 11;
        parts.push('<text x="' + (lX + 12) + '" y="' + ly + '" font-family="' + fontFamily + '" font-size="10.5" font-weight="700" letter-spacing="1" fill="' + mutedColor + '">' + escapeHtml(String(lg.title).toUpperCase()) + '</text>');
        ly += 8;
      }
      items.forEach(function (it) {
        ly += 20;
        if (it.type === 'line') {
          var da = it.dash === 'dashed' ? '5 4' : (it.dash === 'dotted' ? '1 4' : '');
          parts.push('<line x1="' + (lX + 12) + '" y1="' + (ly - 4) + '" x2="' + (lX + 34) + '" y2="' + (ly - 4) + '" stroke="' + it.color + '" stroke-width="2.5" stroke-linecap="round"' + (da ? ' stroke-dasharray="' + da + '"' : '') + '/>');
        } else {
          parts.push('<rect x="' + (lX + 12) + '" y="' + (ly - 11) + '" width="15" height="15" rx="4" fill="' + it.color + '" stroke="rgba(0,0,0,.12)"/>');
        }
        parts.push('<text x="' + (lX + 42) + '" y="' + ly + '" font-family="' + fontFamily + '" font-size="12.5" fill="' + textColorDefault + '">' + escapeHtml(it.label || '') + '</text>');
      });
    }

    if (defs.length) parts.push('<defs>' + defs.join('') + '</defs>');
    parts.push('</svg>');
    return { svg: parts.join(''), width: W, height: H };
  }

  // Real text measurement, so exported line breaks match what the browser
  // actually renders on screen instead of a characters-per-line guess.
  var measureCtx = null;
  function measureTextWidth(text, fontSize, bold, family) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = (bold ? '700 ' : '400 ') + fontSize + 'px ' + (family || FONT_STACKS.system);
    return measureCtx.measureText(text).width;
  }

  // Greedy word wrap for SVG text (SVG has no automatic wrapping).
  // Long single words are hard-split so they can never overflow the box.
  function wrapSvgText(text, maxWidth, fontSize, bold, family) {
    var words = String(text || '').trim().split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    var fits = function (t) { return measureTextWidth(t, fontSize, bold, family) <= maxWidth; };
    words.forEach(function (w) {
      // Hard-split a single word too long to fit a line on its own.
      while (!fits(w) && w.length > 1) {
        var cut = w.length;
        while (cut > 1 && !fits(w.slice(0, cut) + '-')) cut--;
        if (cut <= 1) break;
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, cut) + '-');
        w = w.slice(cut);
      }
      var candidate = cur ? cur + ' ' + w : w;
      if (cur && !fits(candidate)) { lines.push(cur); cur = w; }
      else cur = candidate;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function svgPatternDef(id, pattern, ink, base, sc) {
    var k = texScale(sc);
    // Mirrors textureCss tile-for-tile so an export matches the screen.
    function pat(size, body, extraOpacity) {
      var sz = (size * k).toFixed(2);
      return '<pattern id="' + id + '" width="' + sz + '" height="' + sz + '" patternUnits="userSpaceOnUse"'
        + ' patternTransform="scale(1)">' + '<rect width="' + sz + '" height="' + sz + '" fill="' + base + '"/>'
        + body(size * k) + '</pattern>';
    }
    switch (pattern) {
      case 'dots':
        return pat(11, function (u) { return '<circle cx="' + (u * 0.18) + '" cy="' + (u * 0.18) + '" r="' + (1.3 * k) + '" fill="' + ink + '" opacity=".5"/>'; });
      case 'bigdots':
        return pat(20, function (u) { return '<circle cx="' + (u * 0.3) + '" cy="' + (u * 0.3) + '" r="' + (3 * k) + '" fill="' + ink + '" opacity=".42"/>'; });
      case 'lines':
        return pat(9, function (u) { return '<line x1="0" y1="' + u + '" x2="' + u + '" y2="0" stroke="' + ink + '" stroke-width="' + (2 * k) + '" opacity=".4"/>'; });
      case 'vlines':
        return pat(10, function (u) { return '<line x1="0" y1="0" x2="0" y2="' + u + '" stroke="' + ink + '" stroke-width="' + (1.5 * k) + '" opacity=".35"/>'; });
      case 'hlines':
        return pat(10, function (u) { return '<line x1="0" y1="0" x2="' + u + '" y2="0" stroke="' + ink + '" stroke-width="' + (1.5 * k) + '" opacity=".35"/>'; });
      case 'grid':
        return pat(14, function (u) { return '<path d="M0,0 H' + u + ' M0,0 V' + u + '" stroke="' + ink + '" stroke-width="' + (1 * k) + '" opacity=".3" fill="none"/>'; });
      case 'graph':
        return pat(40, function (u) {
          var minor = u / 5, out = '';
          for (var i = 1; i < 5; i++) {
            out += '<path d="M0,' + (minor * i) + ' H' + u + ' M' + (minor * i) + ',0 V' + u + '" stroke="' + ink + '" stroke-width="' + (1 * k) + '" opacity=".18" fill="none"/>';
          }
          return out + '<path d="M0,0 H' + u + ' M0,0 V' + u + '" stroke="' + ink + '" stroke-width="' + (1.4 * k) + '" opacity=".38" fill="none"/>';
        });
      case 'cross':
        return pat(10, function (u) {
          return '<line x1="0" y1="' + u + '" x2="' + u + '" y2="0" stroke="' + ink + '" stroke-width="' + (1.4 * k) + '" opacity=".35"/>'
            + '<line x1="0" y1="0" x2="' + u + '" y2="' + u + '" stroke="' + ink + '" stroke-width="' + (1.4 * k) + '" opacity=".35"/>';
        });
      case 'checks':
        return pat(18, function (u) {
          var h = u / 2;
          return '<rect width="' + h + '" height="' + h + '" fill="' + ink + '" opacity=".13"/>'
            + '<rect x="' + h + '" y="' + h + '" width="' + h + '" height="' + h + '" fill="' + ink + '" opacity=".13"/>';
        });
      case 'zigzag':
        return pat(8, function (u) {
          return '<path d="M0,' + u + ' L' + (u / 2) + ',0 L' + u + ',' + u + '" fill="none" stroke="' + ink + '" stroke-width="' + (1.6 * k) + '" opacity=".3"/>';
        });
      case 'weave':
        return pat(6, function (u) {
          return '<rect width="' + u + '" height="' + (3 * k) + '" fill="' + ink + '" opacity=".13"/>'
            + '<rect width="' + (3 * k) + '" height="' + u + '" fill="' + ink + '" opacity=".13"/>';
        });
      default:
        return '<pattern id="' + id + '" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="' + base + '"/></pattern>';
    }
  }


  // -------------------------------------------------------------------
  // Page framing for PDF / print
  // -------------------------------------------------------------------
  // Wraps the chart SVG onto a real paper size at 96dpi with margins, so a
  // PDF reads as a document instead of a tight crop of the artwork.
  var PAGE_SIZES = { letter: [816, 1056], a4: [794, 1123] };
  var pageChoice = 'fit', pageOrient = 'landscape';

  function framedSvg(built) {
    if (pageChoice === 'fit' || !PAGE_SIZES[pageChoice]) return built;
    var dims = PAGE_SIZES[pageChoice].slice();
    if (pageOrient === 'landscape') dims.reverse();
    var PW = dims[0], PH = dims[1];
    var margin = 48;
    var availW = PW - margin * 2, availH = PH - margin * 2;
    var k = Math.min(availW / built.width, availH / built.height, 1);
    var dw = built.width * k, dh = built.height * k;
    var dx = (PW - dw) / 2, dy = (PH - dh) / 2;
    // Strip the outer <svg> wrapper and re-nest the content at page scale.
    var inner = built.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    var isDark = resolvedAppearance() !== 'light';
    var paper = isDark ? '#12161c' : '#ffffff';
    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + PW + '" height="' + PH + '" viewBox="0 0 ' + PW + ' ' + PH + '">' +
           '<rect x="0" y="0" width="' + PW + '" height="' + PH + '" fill="' + paper + '"/>' +
           '<g transform="translate(' + dx + ',' + dy + ') scale(' + k + ')">' + inner + '</g>' +
           '</svg>',
      width: PW, height: PH
    };
  }

  function rasterize(svgStr, W, H, mime, quality, cb) {
    var svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(svgBlob);
    var img = new Image();
    img.onload = function () {
      var scaleFactor = 2;
      var cnv = document.createElement('canvas');
      cnv.width = W * scaleFactor; cnv.height = H * scaleFactor;
      var ctx = cnv.getContext('2d');
      if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cnv.width, cnv.height); }
      ctx.scale(scaleFactor, scaleFactor);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cnv.toBlob(function (blob) { cb(blob); }, mime, quality);
    };
    img.onerror = function () { toast('Export failed'); URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }

  function exportRaster(mime, ext, quality) {
    var built = buildChartSvg();
    if (!built) { toast('Nothing to export'); return; }
    rasterize(built.svg, built.width, built.height, mime, quality, function (blob) { shareOrDownload(blob, baseFilename() + '.' + ext, mime); });
  }
  wireSeg($('segPage'), 'fit', function (v) { pageChoice = v; });
  wireSeg($('segOrient'), 'landscape', function (v) { pageOrient = v; });

  $('exportPngBtn').addEventListener('click', function () { exportRaster('image/png', 'png'); });
  $('exportJpgBtn').addEventListener('click', function () { exportRaster('image/jpeg', 'jpg', 0.92); });
  $('exportSvgBtn').addEventListener('click', function () {
    var built = buildChartSvg();
    if (!built) { toast('Nothing to export'); return; }
    shareOrDownload(new Blob([built.svg], { type: 'image/svg+xml' }), baseFilename() + '.svg', 'image/svg+xml');
  });
  $('exportPdfBtn').addEventListener('click', function () {
    var built = buildChartSvg();
    if (!built) { toast('Nothing to export'); return; }
    built = framedSvg(built);
    printArea.innerHTML = built.svg;
    closeExport();
    setTimeout(function () { window.print(); }, 50);
  });

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  ensureBootstrapChart();
  applyTokens();
  // Quiet: merely launching the app must not make this device's charts look
  // newer than an edit waiting on the server.
  saveState(true);
  try { localStorage.removeItem(OLD_STORE_KEY); } catch (e) {}
  render();
  requestAnimationFrame(function () { fitToScreen(); });
  applyTransform();
  window.addEventListener('resize', function () { fitToScreen(); });
  refreshSyncUi();
  startSyncLoop();
  if (syncEnabled()) syncNow({ silentToast: true });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();

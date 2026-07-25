(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  var NODE_W = 168;            // default box width; each box may override it
  var NODE_H_APPROX = 96;
  var BOX_WIDTHS = [140, 168, 210, 260];
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

  var COLOR_SWATCHES = ['#3568d4', '#2f9e6e', '#c2762a', '#a24fd6', '#d6486b', '#2aa1a1', '#6b6f76', '#b5322f', '#e0a13a', '#4f6bd6', '#1a1d21', '#8a6a3a'];

  var TEXTURES = ['none', 'dots', 'lines', 'grid', 'cross'];
  var TEXTURE_LABELS = { none: 'Flat', dots: 'Dots', lines: 'Diagonal', grid: 'Grid', cross: 'Crosshatch' };

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
    return { activeId: id, charts: {} };
  }

  function defaultFill() { return { type: 'solid', color: '', color2: '', texture: 'dots' }; }
  function defaultBorder() { return { color: '', width: 1, dash: 'solid' }; }
  function defaultBackground() { return { type: 'solid', color: '', color2: '', texture: 'dots' }; }

  function migrateChart(c) {
    c.nodes = c.nodes || {};
    c.edges = c.edges || {};
    c.notes = c.notes || {};
    if (!c.background) c.background = defaultBackground();
    if (!c.font) c.font = (c.settings && c.settings.font) || 'system';
    if (!c.badges) c.badges = 'show';
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
      if (!n.fontScale) n.fontScale = 1;
      if (!n.width) n.width = NODE_W;
    });
    delete c.settings;
    delete c.autoLayout;
    return c;
  }

  function ensureBootstrapChart() {
    if (Object.keys(state.charts).length === 0) {
      var id = state.activeId || uid();
      state.charts[id] = newChartObj(id, 'My Org Chart');
      state.activeId = id;
    }
    if (!state.charts[state.activeId]) state.activeId = Object.keys(state.charts)[0];
    Object.values(state.charts).forEach(function (c) { migrateChart(c); });
  }

  function newChartObj(id, name) {
    return { id: id, name: name || 'Untitled chart', nodes: {}, edges: {}, notes: {}, background: defaultBackground(), font: 'system', badges: 'show', updatedAt: Date.now() };
  }

  var redoStack = [];
  var storageWarned = false;
  function saveState() {
    getActiveChart().updatedAt = Date.now();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageWarned = false;
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
  function textureCss(pattern, ink, base) {
    ink = ink || '#3568d4';
    base = base || 'var(--panel)';
    switch (pattern) {
      case 'dots': return 'radial-gradient(' + ink + '55 1.3px, transparent 1.3px) 0 0/11px 11px, ' + base;
      case 'lines': return 'repeating-linear-gradient(45deg, ' + ink + '40 0 2px, transparent 2px 9px), ' + base;
      case 'grid': return 'linear-gradient(' + ink + '30 1px, transparent 1px) 0 0/14px 14px, linear-gradient(90deg, ' + ink + '30 1px, transparent 1px) 0 0/14px 14px, ' + base;
      case 'cross': return 'repeating-linear-gradient(45deg, ' + ink + '30 0 2px, transparent 2px 10px), repeating-linear-gradient(-45deg, ' + ink + '30 0 2px, transparent 2px 10px), ' + base;
      default: return base;
    }
  }

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

  function applyChartVars() {
    var chart = getActiveChart();
    document.documentElement.style.setProperty('--chart-font', FONT_STACKS[chart.font] || FONT_STACKS.system);
    var bg = chart.background || defaultBackground();
    var css;
    if (bg.type === 'gradient') css = 'linear-gradient(135deg, ' + (bg.color || 'var(--panel2)') + ', ' + (bg.color2 || 'var(--bg)') + ')';
    else if (bg.type === 'texture') css = textureCss(bg.texture, bg.color || '#6b7684', 'var(--bg)');
    else css = bg.color || 'var(--bg)';
    stage.style.background = css;
  }

  function applyNodeStyle(el, n) {
    el.dataset.shape = n.shape || 'rounded';
    el.dataset.layout = n.layout || 'stack';
    var w = nodeW(n);
    var fs = nodeScale(n);
    el.style.width = w + 'px';
    el.style.height = n.shape === 'circle' ? w + 'px' : '';
    el.style.padding = Math.round(10 * fs) + 'px ' + Math.round(12 * fs) + 'px';
    var av = el.querySelector('.avatar');
    var avSize = AVATAR_SIZES[fs] || Math.round(44 * fs);
    av.style.width = avSize + 'px';
    av.style.height = avSize + 'px';
    // Shrink the badge text when it's longer than plain initials so a
    // nickname like "Jess" still sits comfortably inside the circle.
    var chars = showsPhoto(n) ? 2 : Math.max(1, badgeText(n).length);
    var badgeFs = Math.min(15 * fs, (avSize * 0.86) / chars * 1.55);
    av.style.fontSize = badgeFs.toFixed(1) + 'px';
    av.style.display = showsAvatar(n) ? 'flex' : 'none';
    el.querySelector('.nname').style.fontSize = (14.5 * fs).toFixed(1) + 'px';
    el.querySelector('.ntitle').style.fontSize = (12 * fs).toFixed(1) + 'px';
    el.querySelector('.ndetail').style.fontSize = (11 * fs).toFixed(1) + 'px';
    var fill = n.fill || defaultFill();
    if (fill.type === 'gradient') el.style.background = 'linear-gradient(135deg, ' + (fill.color || '#dfe6f2') + ', ' + (fill.color2 || '#c3d1ea') + ')';
    else if (fill.type === 'texture') el.style.background = textureCss(fill.texture, fill.color || n.color || '#3568d4', 'var(--panel)');
    else el.style.background = fill.color || 'var(--panel)';
    var border = n.border || defaultBorder();
    el.style.borderColor = border.color || 'var(--line)';
    el.style.borderWidth = (border.width || 1) + 'px';
    el.style.borderStyle = border.dash === 'dashed' ? 'dashed' : (border.dash === 'dotted' ? 'dotted' : 'solid');
    el.style.fontFamily = n.font ? FONT_STACKS[n.font] : '';
    var tc = textColorsFor(n);
    el.querySelector('.nname').style.color = tc.name;
    el.querySelector('.ntitle').style.color = tc.title;
    el.querySelector('.ndetail').style.color = tc.title;
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
          '<div class="avatar"></div>' +
          '<div class="ntext"><div class="nname"></div><div class="ntitle"></div><div class="ndetail"></div></div>' +
          '<div class="handle n" data-dir="n"></div><div class="handle s" data-dir="s"></div>' +
          '<div class="handle e" data-dir="e"></div><div class="handle w" data-dir="w"></div>';
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
      var d = edgePathBetween(pA, pB, style);
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
        var mid = midOfPath(pA, pB, style);
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
  }

  function clientToCanvas(clientX, clientY) {
    var rect = stage.getBoundingClientRect();
    return { x: (clientX - rect.left - panX) / scale, y: (clientY - rect.top - panY) / scale };
  }

  function onNodeDown(e) {
    if (e.target.closest('.handle')) return;
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
      n.x = origX + dx; n.y = origY + dy;
      renderPositionsOnly();
    }
    function up() {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
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
    if (keys.length === 0 && wasTap && tapPos) {
      var pt2 = clientToCanvas(tapPos.x, tapPos.y);
      pushUndo();
      var newId = createNodeAt(pt2.x - NODE_W / 2, pt2.y - NODE_H_APPROX / 2, true);
      saveState(); render();
      openEditSheet(newId, true);
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
      font: '', textColor: '', avatarMode: (chart.badges === 'hide' ? 'none' : 'auto'), layout: 'stack', fontScale: 1, width: NODE_W, order: Date.now()
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
    if (pendingPhoto) { photoPreview.style.background = "center/cover no-repeat url('" + pendingPhoto + "')"; photoPreview.textContent = ''; }
    else { photoPreview.style.background = n.color || COLOR_SWATCHES[0]; photoPreview.textContent = badgeText(n); }
  }
  // Live-preview the badge text as it's typed.
  $('fNickname').addEventListener('input', function () {
    if (pendingPhoto) return;
    photoPreview.textContent = $('fNickname').value.trim() || initials(fName.value);
  });
  fName.addEventListener('input', function () {
    if (pendingPhoto || $('fNickname').value.trim()) return;
    photoPreview.textContent = initials(fName.value);
  });

  function updateFillPickerVisibility() {
    var t = segValue(segFillType);
    fillColor2Picker.style.display = t === 'gradient' ? 'flex' : 'none';
    fillTextureGrid.style.display = t === 'texture' ? 'flex' : 'none';
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
    refreshPhotoPreview(n);
    wireSeg($('segAvatar'), n.avatarMode || 'auto');
    wireSeg($('segLayout'), n.layout || 'stack');
    wireSeg($('segFontScale'), String(n.fontScale || 1));
    wireSeg($('segWidth'), String(n.width || NODE_W));
    wireSeg(segShape, n.shape || 'rounded');
    buildColorRow(colorPicker, n.color || COLOR_SWATCHES[0]);
    var fill = n.fill || defaultFill();
    wireSeg(segFillType, fill.type, updateFillPickerVisibility);
    buildColorRow(fillColorPicker, fill.color || '', null, true);
    buildColorRow(fillColor2Picker, fill.color2 || '#c3d1ea');
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
    n.fontScale = parseFloat(segValue($('segFontScale')));
    n.width = parseInt(segValue($('segWidth')), 10);
    n.shape = segValue(segShape);
    n.color = colorPicker.dataset.value;
    n.fill = { type: segValue(segFillType), color: fillColorPicker.dataset.value, color2: fillColor2Picker.dataset.value, texture: fillTextureGrid.dataset.value };
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

  function renderChartList() {
    chartListEl.innerHTML = '';
    var charts = Object.values(state.charts).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    charts.forEach(function (c) {
      var row = document.createElement('div');
      row.className = 'listrow';
      var count = Object.keys(c.nodes).length;
      row.innerHTML =
        '<div style="flex:1;min-width:0;">' +
          '<div class="lname">' + (c.id === state.activeId ? '● ' : '') + escapeHtml(c.name) + '</div>' +
          '<div class="lmeta">' + count + ' box' + (count === 1 ? '' : 'es') + '</div>' +
        '</div>' +
        '<button class="rowbtn" data-act="open">Open</button>' +
        (Object.keys(state.charts).length > 1 ? '<button class="rowbtn" data-act="del">Delete</button>' : '');
      row.querySelector('[data-act="open"]').addEventListener('click', function () { state.activeId = c.id; saveState(); closeMenu(); render(); fitToScreen(); });
      var delBtn = row.querySelector('[data-act="del"]');
      if (delBtn) delBtn.addEventListener('click', function () {
        if (!window.confirm('Delete "' + c.name + '"? This cannot be undone.')) return;
        delete state.charts[c.id];
        if (state.activeId === c.id) state.activeId = Object.keys(state.charts)[0];
        saveState(); renderChartList(); render(); fitToScreen();
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
  }
  (function initTheme() { var t = getAppearance(); if (t !== 'auto') document.documentElement.setAttribute('data-theme', t); })();

  // ---------------------------------------------------------------------
  // Chart design sheet (background, default font, presets, tidy)
  // ---------------------------------------------------------------------
  var segBgType = $('segBgType'), bgColorPicker = $('bgColorPicker'), bgColor2Picker = $('bgColor2Picker'), bgTextureGrid = $('bgTextureGrid'), chartFontSel = $('chartFont');

  function updateBgPickerVisibility() {
    var t = segValue(segBgType);
    bgColor2Picker.style.display = t === 'gradient' ? 'flex' : 'none';
    bgTextureGrid.style.display = t === 'texture' ? 'flex' : 'none';
  }
  function applyBgLive() {
    var chart = getActiveChart();
    chart.background = { type: segValue(segBgType), color: bgColorPicker.dataset.value, color2: bgColor2Picker.dataset.value, texture: bgTextureGrid.dataset.value };
    applyChartVars();
  }
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
        chart.background = { type: p.bg.type, color: p.bg.color || '', color2: p.bg.color2 || '', texture: p.bg.texture || 'dots' };
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
    updateBgPickerVisibility();
    wireSeg($('segChartBadges'), chart.badges || 'show', function (v) {
      pushUndo();
      var c = getActiveChart();
      c.badges = v;
      // Apply to every existing box so one switch clears them all.
      Object.keys(c.nodes).forEach(function (id) {
        c.nodes[id].avatarMode = (v === 'hide') ? 'none' : 'auto';
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
  function closeDesign() { designBackdrop.classList.remove('show'); designSheet.classList.remove('show'); }
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
    var pad = 40;
    var W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
    var fontFamily = (FONT_STACKS[chart.font] || FONT_STACKS.system).replace(/"/g, "'");
    var defs = [], parts = [];

    parts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + fontFamily + '">');
    var bg = chart.background || defaultBackground();
    if (bg.type === 'gradient') {
      defs.push('<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + (bg.color || panelLine) + '"/><stop offset="1" stop-color="' + (bg.color2 || pageBg) + '"/></linearGradient>');
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#bgGrad)"/>');
    } else if (bg.type === 'texture' && bg.texture !== 'none') {
      var pid = 'bgpat';
      defs.push(svgPatternDef(pid, bg.texture, bg.color || mutedColor, pageBg));
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + pageBg + '"/>');
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#' + pid + ')"/>');
    } else {
      parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + (bg.color || pageBg) + '"/>');
    }

    function toDoc(x, y) { return { x: x - minX + pad, y: y - minY + pad }; }

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
      var d = edgePathBetween(pA, pB, style);
      var color = e.color || (isDark ? '#5c8bef' : '#3568d4');
      var width = e.width || 2;
      var dashArr = e.dash === 'dashed' ? (width * 2.5) + ' ' + (width * 2) : (e.dash === 'dotted' ? '1 ' + (width * 2.2) : '');
      var markStart = '', markEnd = '';
      if (e.arrowStart) { defs.push('<marker id="es' + idx + '" markerWidth="9" markerHeight="9" refX="1" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M8,0 L0,4 L8,8 Z" fill="' + color + '"/></marker>'); markStart = 'marker-start="url(#es' + idx + ')"'; }
      if (e.arrowEnd !== false) { defs.push('<marker id="ee' + idx + '" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="' + color + '"/></marker>'); markEnd = 'marker-end="url(#ee' + idx + ')"'; }
      parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-linecap="round"' + (dashArr ? ' stroke-dasharray="' + dashArr + '"' : '') + ' ' + markStart + ' ' + markEnd + '/>');
      if (e.label) {
        var mid = midOfPath(pA, pB, style);
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
      var rx = shape === 'rect' ? 3 : (shape === 'pill' ? h / 2 : (shape === 'circle' ? W / 2 : 14));
      var boxH = shape === 'circle' ? W : h;
      var fill = n.fill || defaultFill();
      var fillAttr;
      if (fill.type === 'gradient') {
        var gid = 'ng' + idx;
        defs.push('<linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + (fill.color || accent) + '"/><stop offset="1" stop-color="' + (fill.color2 || accent) + '"/></linearGradient>');
        fillAttr = 'url(#' + gid + ')';
      } else if (fill.type === 'texture' && fill.texture !== 'none') {
        var tid = 'nt' + idx;
        defs.push(svgPatternDef(tid, fill.texture, fill.color || accent, panelBg));
        fillAttr = 'url(#' + tid + ')';
      } else fillAttr = fill.color || panelBg;
      var border = n.border || defaultBorder();
      var dashArr2 = border.dash === 'dashed' ? (border.width * 2.5) + ' ' + (border.width * 2) : (border.dash === 'dotted' ? '1 ' + (border.width * 2.2) : '');
      parts.push('<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + boxH + '" rx="' + rx + '" fill="' + fillAttr + '" stroke="' + (border.color || panelLine) + '" stroke-width="' + (border.width || 1) + '"' + (dashArr2 ? ' stroke-dasharray="' + dashArr2 + '"' : '') + '/>');

      var isRow = (n.layout || 'stack') === 'row';
      var padT = 10 * fs, padL = 12 * fs;
      var avR = (AVATAR_SIZES[fs] || 44 * fs) / 2;
      var cx = isRow ? x + padL + avR : x + W / 2;
      var cursorY = y + padT;
      // Compact layout: badge on the left, text left-aligned beside it.
      var textAnchor = isRow ? 'start' : 'middle';
      var textX = isRow ? (x + padL + (showsAvatar(n) ? avR * 2 + 10 : 0)) : x + W / 2;
      var innerW = isRow ? (W - (textX - x) - padL) : (W - 20 * fs);
      if (showsAvatar(n)) {
        var avatarCy = isRow ? y + boxH / 2 : cursorY + avR;
        if (showsPhoto(n)) {
          var clipId = 'clip' + idx;
          defs.push('<clipPath id="' + clipId + '"><circle cx="' + cx + '" cy="' + avatarCy + '" r="' + avR + '"/></clipPath>');
          parts.push('<image href="' + n.photo + '" x="' + (cx - avR) + '" y="' + (avatarCy - avR) + '" width="' + (avR * 2) + '" height="' + (avR * 2) + '" clip-path="url(#' + clipId + ')" preserveAspectRatio="xMidYMid slice"/>');
        } else {
          var badge = badgeText(n);
          // Shrink the badge text if the user typed something longer than initials.
          var badgeSize = Math.min(15 * fs, (avR * 1.75) / Math.max(1, badge.length) * 1.6);
          parts.push('<circle cx="' + cx + '" cy="' + avatarCy + '" r="' + avR + '" fill="' + accent + '"/>');
          parts.push('<text x="' + cx + '" y="' + (avatarCy + badgeSize * 0.35) + '" font-family="' + ((n.font ? FONT_STACKS[n.font] : fontFamily).replace(/"/g, "'")) + '" font-size="' + badgeSize.toFixed(1) + '" font-weight="700" fill="#fff" text-anchor="middle">' + escapeHtml(badge) + '</text>');
        }
        if (!isRow) cursorY = avatarCy + avR + 6 * fs;
      }

      var tcx = textColorsFor(n);
      var nameColor = tcx.name || textColorDefault;
      var titleColor = tcx.title || mutedColor;
      var nameFont = (n.font ? FONT_STACKS[n.font] : fontFamily).replace(/"/g, "'");
      var nameSize = 14.5 * fs, titleSize = 12 * fs, detailSize = 11 * fs;
      // Wrap rather than truncate, so the exported chart matches the screen.
      var nameLines = wrapSvgText(n.name || 'Unnamed', innerW, nameSize, true);
      var titleLines = n.title ? wrapSvgText(n.title, innerW, titleSize, false) : [];
      var detailLines = n.detail ? wrapSvgText(n.detail, innerW, detailSize, false) : [];

      if (isRow) {
        var blockH = nameLines.length * nameSize * 1.25
          + (titleLines.length ? titleSize * 1.35 + (titleLines.length - 1) * titleSize * 1.2 : 0)
          + (detailLines.length ? detailSize * 1.35 + (detailLines.length - 1) * detailSize * 1.2 : 0);
        cursorY = y + boxH / 2 - blockH / 2;
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
      var lines = wrapSvgText(note.text || '', w - 20, 11.5, false);
      var h2 = Math.max(70, 16 + lines.length * 14);
      parts.push('<rect x="' + p.x + '" y="' + p.y + '" width="' + w + '" height="' + h2 + '" rx="8" fill="' + (note.color || '#ffe58a') + '" stroke="rgba(0,0,0,.15)"/>');
      lines.forEach(function (line, li) {
        parts.push('<text x="' + (p.x + 10) + '" y="' + (p.y + 20 + li * 14) + '" font-size="11.5" fill="#3a3420">' + escapeHtml(line) + '</text>');
      });
    });

    if (defs.length) parts.push('<defs>' + defs.join('') + '</defs>');
    parts.push('</svg>');
    return { svg: parts.join(''), width: W, height: H };
  }

  // Greedy word wrap for SVG text (SVG has no automatic wrapping).
  // Long single words are hard-split so they can never overflow the box.
  function wrapSvgText(text, maxWidth, fontSize, bold) {
    var avgChar = fontSize * (bold ? 0.58 : 0.52);
    var maxChars = Math.max(6, Math.floor(maxWidth / avgChar));
    var words = String(text || '').trim().split(/\s+/).filter(Boolean);
    var lines = [], cur = '';
    words.forEach(function (w) {
      while (w.length > maxChars) {
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, maxChars - 1) + '-');
        w = w.slice(maxChars - 1);
      }
      var candidate = cur ? cur + ' ' + w : w;
      if (candidate.length > maxChars) { if (cur) lines.push(cur); cur = w; }
      else cur = candidate;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function svgPatternDef(id, pattern, ink, base) {
    var content;
    switch (pattern) {
      case 'dots': content = '<rect width="11" height="11" fill="' + base + '"/><circle cx="2" cy="2" r="1.3" fill="' + ink + '" opacity=".5"/>'; return '<pattern id="' + id + '" width="11" height="11" patternUnits="userSpaceOnUse">' + content + '</pattern>';
      case 'lines': content = '<rect width="9" height="9" fill="' + base + '"/><line x1="0" y1="9" x2="9" y2="0" stroke="' + ink + '" stroke-width="2" opacity=".4"/>'; return '<pattern id="' + id + '" width="9" height="9" patternUnits="userSpaceOnUse">' + content + '</pattern>';
      case 'grid': content = '<rect width="14" height="14" fill="' + base + '"/><path d="M0,0 H14 M0,0 V14" stroke="' + ink + '" stroke-width="1" opacity=".3"/>'; return '<pattern id="' + id + '" width="14" height="14" patternUnits="userSpaceOnUse">' + content + '</pattern>';
      case 'cross': content = '<rect width="10" height="10" fill="' + base + '"/><line x1="0" y1="10" x2="10" y2="0" stroke="' + ink + '" stroke-width="1.4" opacity=".35"/><line x1="0" y1="0" x2="10" y2="10" stroke="' + ink + '" stroke-width="1.4" opacity=".35"/>'; return '<pattern id="' + id + '" width="10" height="10" patternUnits="userSpaceOnUse">' + content + '</pattern>';
      default: return '<pattern id="' + id + '" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="' + base + '"/></pattern>';
    }
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
  saveState();
  try { localStorage.removeItem(OLD_STORE_KEY); } catch (e) {}
  render();
  requestAnimationFrame(function () { fitToScreen(); });
  applyTransform();
  window.addEventListener('resize', function () { fitToScreen(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();

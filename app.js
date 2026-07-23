(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------
  var NODE_W = 168;
  var NODE_H_APPROX = 96;
  var SIB_GAP = 26;
  var LEVEL_GAP = 90;
  var STORE_KEY = 'orgchart.v1';

  var FONT_STACKS = {
    system: "-apple-system,BlinkMacSystemFont,'SF Pro Text',Segoe UI,Roboto,Arial,sans-serif",
    serif: "Georgia,'Times New Roman',Times,serif",
    rounded: "ui-rounded,-apple-system,'SF Pro Rounded',Verdana,sans-serif",
    mono: "'SF Mono',ui-monospace,Menlo,Consolas,monospace"
  };

  var THEMES = {
    ocean: { label: 'Ocean Blue', accent: '#3568d4', accent2: '#274a99', font: 'system',
      palette: ['#3568d4', '#2f9e6e', '#c2762a', '#a24fd6', '#d6486b', '#2aa1a1', '#6b6f76', '#b5322f'] },
    slate: { label: 'Slate Pro', accent: '#51606f', accent2: '#333e48', font: 'serif',
      palette: ['#51606f', '#7d5a3c', '#3d6b8a', '#6b6f76', '#8a6a3a', '#4a5a4a', '#5c4a63', '#2f3a44'] },
    forest: { label: 'Forest', accent: '#2f9e6e', accent2: '#1f7a54', font: 'system',
      palette: ['#2f9e6e', '#4a8f3d', '#8a6a3a', '#3f9e8e', '#6b8f3a', '#5a7d4a', '#2a6b52', '#7a9e4a'] },
    sunset: { label: 'Sunset', accent: '#e0703a', accent2: '#b85422', font: 'rounded',
      palette: ['#e0703a', '#d6486b', '#e0a13a', '#c2762a', '#d64545', '#e08a5a', '#b5322f', '#d68a3a'] },
    grape: { label: 'Grape', accent: '#8451d6', accent2: '#5f34a8', font: 'system',
      palette: ['#8451d6', '#a24fd6', '#d6488f', '#5c6bd6', '#2aa1a1', '#6b4fd6', '#b34fd6', '#4f6bd6'] },
    ink: { label: 'Monochrome', accent: '#3a3f47', accent2: '#1a1d21', font: 'serif',
      palette: ['#3a3f47', '#565d67', '#717984', '#2a2e34', '#494f58', '#838991', '#20242a', '#636972'] }
  };
  var THEME_ORDER = ['ocean', 'slate', 'forest', 'sunset', 'grape', 'ink'];

  // ---------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'), canvas = $('canvas'), edgesSvg = $('edges'), emptyEl = $('empty');
  var chartNameInput = $('chartName');
  var editBackdrop = $('editBackdrop'), editSheet = $('editSheet');
  var menuBackdrop = $('menuBackdrop'), menuSheet = $('menuSheet');
  var designBackdrop = $('designBackdrop'), designSheet = $('designSheet');
  var exportBackdrop = $('exportBackdrop'), exportSheet = $('exportSheet');
  var fName = $('fName'), fTitle = $('fTitle'), colorPicker = $('colorPicker');
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
  var editingId = null;
  var pendingPhoto = null; // data URL staged in the edit sheet until Save

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    var id = uid();
    return { activeId: id, charts: {} };
  }

  function defaultSettings() {
    return { theme: 'ocean', layoutDir: 'vertical', connector: 'elbow', cardStyle: 'modern', font: 'system' };
  }

  function ensureBootstrapChart() {
    if (Object.keys(state.charts).length === 0) {
      var id = state.activeId || uid();
      state.charts[id] = newChartObj(id, 'My Org Chart');
      state.activeId = id;
    }
    if (!state.charts[state.activeId]) {
      state.activeId = Object.keys(state.charts)[0];
    }
    Object.values(state.charts).forEach(function (c) {
      if (!c.settings) c.settings = defaultSettings();
    });
  }

  function newChartObj(id, name) {
    return { id: id, name: name || 'Untitled chart', nodes: {}, autoLayout: true, settings: defaultSettings(), updatedAt: Date.now() };
  }

  function saveState() {
    getActiveChart().updatedAt = Date.now();
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function getActiveChart() { return state.charts[state.activeId]; }
  function getSettings() { return getActiveChart().settings; }
  function getTheme() { return THEMES[getSettings().theme] || THEMES.ocean; }
  function getPalette() { return getTheme().palette; }

  function snapshot() { return JSON.stringify(state.charts[state.activeId]); }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 25) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) { toast('Nothing to undo'); return; }
    var prev = undoStack.pop();
    state.charts[state.activeId] = JSON.parse(prev);
    saveState();
    render();
    applyDesignVars();
    toast('Undone');
  }

  // ---------------------------------------------------------------------
  // Layout (direction-aware: vertical = top-down tree, horizontal = left-right tree)
  // ---------------------------------------------------------------------
  function layout(chart) {
    var nodes = chart.nodes;
    var ids = Object.keys(nodes);
    if (!ids.length) return;
    var dir = (chart.settings && chart.settings.layoutDir) || 'vertical';
    var mainStep = dir === 'vertical' ? (NODE_H_APPROX + LEVEL_GAP) : (NODE_W + LEVEL_GAP);
    var crossStep = dir === 'vertical' ? (NODE_W + SIB_GAP) : (NODE_H_APPROX + SIB_GAP);

    var childrenOf = {};
    ids.forEach(function (id) { childrenOf[id] = []; });
    var roots = [];
    ids.forEach(function (id) {
      var n = nodes[id];
      if (n.parentId && nodes[n.parentId]) childrenOf[n.parentId].push(n);
      else roots.push(n);
    });
    Object.keys(childrenOf).forEach(function (k) {
      childrenOf[k].sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    });
    var cursor = 0;
    function place(node, depth) {
      var kids = childrenOf[node.id];
      if (!kids.length) {
        node._cross = cursor;
        cursor += crossStep;
      } else {
        kids.forEach(function (k) { place(k, depth + 1); });
        var first = kids[0], last = kids[kids.length - 1];
        node._cross = (first._cross + last._cross) / 2;
      }
      node._main = depth * mainStep;
    }
    roots.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    roots.forEach(function (r) { place(r, 0); });

    ids.forEach(function (id) {
      var n = nodes[id];
      if (dir === 'vertical') { n.x = n._cross; n.y = n._main; }
      else { n.x = n._main; n.y = n._cross; }
      delete n._cross; delete n._main;
    });
  }

  function defaultChildPosition(chart, parent, siblingCount) {
    var dir = (chart.settings && chart.settings.layoutDir) || 'vertical';
    if (!parent) return { x: 40, y: 40 };
    if (dir === 'vertical') {
      return { x: parent.x + siblingCount * (NODE_W + SIB_GAP), y: parent.y + NODE_H_APPROX + LEVEL_GAP };
    }
    return { x: parent.x + NODE_W + LEVEL_GAP, y: parent.y + siblingCount * (NODE_H_APPROX + SIB_GAP) };
  }

  function isDescendant(ancestorId, nodeId) {
    var chart = getActiveChart();
    var cur = chart.nodes[nodeId];
    var guard = 0;
    while (cur && cur.parentId && guard++ < 500) {
      if (cur.parentId === ancestorId) return true;
      cur = chart.nodes[cur.parentId];
    }
    return false;
  }

  function descendantCount(id) {
    var chart = getActiveChart();
    var count = 0;
    function walk(pid) {
      Object.values(chart.nodes).forEach(function (n) {
        if (n.parentId === pid) { count++; walk(n.id); }
      });
    }
    walk(id);
    return count;
  }

  function removeSubtree(id) {
    var chart = getActiveChart();
    var toRemove = [id];
    function walk(pid) {
      Object.values(chart.nodes).forEach(function (n) {
        if (n.parentId === pid) { toRemove.push(n.id); walk(n.id); }
      });
    }
    walk(id);
    toRemove.forEach(function (rid) { delete chart.nodes[rid]; });
  }

  // ---------------------------------------------------------------------
  // Edge path geometry — shared by live SVG render and export
  // ---------------------------------------------------------------------
  function edgePath(x1, y1, x2, y2, dir, connector) {
    if (connector === 'elbow') {
      if (dir === 'vertical') {
        var midY = (y1 + y2) / 2;
        return 'M ' + x1 + ' ' + y1 + ' L ' + x1 + ' ' + midY + ' L ' + x2 + ' ' + midY + ' L ' + x2 + ' ' + y2;
      }
      var midX = (x1 + x2) / 2;
      return 'M ' + x1 + ' ' + y1 + ' L ' + midX + ' ' + y1 + ' L ' + midX + ' ' + y2 + ' L ' + x2 + ' ' + y2;
    }
    if (dir === 'vertical') {
      var my = (y1 + y2) / 2;
      return 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + my + ', ' + x2 + ' ' + my + ', ' + x2 + ' ' + y2;
    }
    var mx = (x1 + x2) / 2;
    return 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2;
  }

  function anchorPoints(parent, pW, pH, child, dir) {
    if (dir === 'vertical') {
      return { x1: parent.x + pW / 2, y1: parent.y + pH, x2: child.x + pW / 2, y2: child.y };
    }
    return { x1: parent.x + pW, y1: parent.y + pH / 2, x2: child.x, y2: child.y + pH / 2 };
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  var nodeEls = {};

  function applyTransform() {
    canvas.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')';
  }

  function initials(name) {
    var parts = (name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function applyDesignVars() {
    var s = getSettings();
    var theme = getTheme();
    var root = document.documentElement;
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent2', theme.accent2);
    root.style.setProperty('--chart-font', FONT_STACKS[s.font] || FONT_STACKS.system);
    canvas.classList.remove('card-modern', 'card-classic', 'card-minimal', 'dir-vertical', 'dir-horizontal');
    canvas.classList.add('card-' + s.cardStyle, 'dir-' + s.layoutDir);
  }

  function render() {
    ensureBootstrapChart();
    applyDesignVars();
    var chart = getActiveChart();
    chartNameInput.value = chart.name;
    var ids = Object.keys(chart.nodes);
    emptyEl.style.display = ids.length ? 'none' : 'flex';
    var palette = getPalette();

    Object.keys(nodeEls).forEach(function (id) {
      if (!chart.nodes[id]) { nodeEls[id].remove(); delete nodeEls[id]; }
    });

    ids.forEach(function (id) {
      var n = chart.nodes[id];
      var el = nodeEls[id];
      if (!el) {
        el = document.createElement('div');
        el.className = 'node';
        el.dataset.id = id;
        el.innerHTML =
          '<div class="avatar"></div>' +
          '<div class="nname"></div>' +
          '<div class="ntitle"></div>' +
          '<button class="addchild" aria-label="Add report">+</button>';
        canvas.appendChild(el);
        nodeEls[id] = el;
        wireNodeEvents(el);
      }
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      var color = n.color || palette[0];
      el.style.setProperty('--node-color', color);
      var avatar = el.querySelector('.avatar');
      avatar.classList.toggle('has-photo', !!n.photo);
      if (n.photo) {
        avatar.style.background = "center/cover no-repeat url('" + n.photo + "')";
        avatar.textContent = '';
      } else {
        avatar.style.background = color;
        avatar.textContent = initials(n.name);
      }
      el.querySelector('.nname').textContent = n.name || 'Unnamed';
      el.querySelector('.ntitle').textContent = n.title || '';
      el.querySelector('.ntitle').style.display = n.title ? 'block' : 'none';
    });

    drawEdges();
  }

  function renderPositionsOnly() {
    var chart = getActiveChart();
    Object.keys(nodeEls).forEach(function (id) {
      var n = chart.nodes[id];
      if (!n) return;
      nodeEls[id].style.left = n.x + 'px';
      nodeEls[id].style.top = n.y + 'px';
    });
    drawEdges();
  }

  function drawEdges() {
    var chart = getActiveChart();
    var dir = getSettings().layoutDir;
    var connector = getSettings().connector;
    var parts = [];
    Object.keys(chart.nodes).forEach(function (id) {
      var n = chart.nodes[id];
      if (!n.parentId || !chart.nodes[n.parentId]) return;
      var el = nodeEls[id], pEl = nodeEls[n.parentId];
      if (!el || !pEl) return;
      var p = chart.nodes[n.parentId];
      var pH = pEl.offsetHeight || NODE_H_APPROX;
      var pts = anchorPoints(p, NODE_W, pH, n, dir);
      var d = edgePath(pts.x1, pts.y1, pts.x2, pts.y2, dir, connector);
      parts.push('<path class="edge" d="' + d + '"/>');
    });
    edgesSvg.innerHTML = parts.join('');
  }

  function fitToScreen() {
    var chart = getActiveChart();
    var ids = Object.keys(chart.nodes);
    if (!ids.length) { panX = stage.clientWidth / 2 - NODE_W / 2; panY = 40; scale = 1; applyTransform(); return; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
    });
    var bw = maxX - minX, bh = maxY - minY;
    var pad = 60;
    var sw = stage.clientWidth - pad * 2, sh = stage.clientHeight - pad * 2;
    var s = Math.min(sw / bw, sh / bh, 1.15);
    s = Math.max(s, 0.15);
    scale = s;
    panX = (stage.clientWidth - bw * s) / 2 - minX * s;
    panY = (stage.clientHeight - bh * s) / 2 - minY * s;
    applyTransform();
  }

  // ---------------------------------------------------------------------
  // Node interaction: tap to edit, drag to move/reparent
  // ---------------------------------------------------------------------
  function wireNodeEvents(el) {
    el.addEventListener('pointerdown', onNodeDown);
    el.querySelector('.addchild').addEventListener('click', function (e) {
      e.stopPropagation();
      addNode(el.dataset.id);
    });
  }

  function clearDragover() {
    Object.values(nodeEls).forEach(function (e) { e.classList.remove('dragover'); });
  }

  function onNodeDown(e) {
    if (e.target.closest('.addchild')) return;
    e.stopPropagation();
    var el = e.currentTarget;
    var id = el.dataset.id;
    var chart = getActiveChart();
    var n = chart.nodes[id];
    if (!n) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) {}
    var startX = e.clientX, startY = e.clientY;
    var origX = n.x, origY = n.y;
    var moved = false;
    var dropTarget = null;
    var preSnap = null;

    function move(ev) {
      var dx = (ev.clientX - startX) / scale, dy = (ev.clientY - startY) / scale;
      if (!moved && (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6)) {
        moved = true;
        preSnap = snapshot();
        el.classList.add('dragging');
      }
      if (!moved) return;
      n.x = origX + dx; n.y = origY + dy;
      renderPositionsOnly();
      clearDragover();
      dropTarget = null;
      var hits = document.elementsFromPoint(ev.clientX, ev.clientY);
      for (var i = 0; i < hits.length; i++) {
        var hEl = hits[i].closest && hits[i].closest('.node');
        if (hEl && hEl !== el) { dropTarget = hEl; break; }
      }
      if (dropTarget) dropTarget.classList.add('dragover');
    }
    function up(ev) {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      clearDragover();
      if (moved) {
        var targetId = dropTarget && dropTarget.dataset.id;
        if (targetId && targetId !== id && targetId !== n.parentId && !isDescendant(id, targetId)) {
          undoStack.push(preSnap);
          n.parentId = targetId;
          chart.autoLayout = false;
          var newParent = chart.nodes[targetId];
          var pH = (nodeEls[targetId] && nodeEls[targetId].offsetHeight) || NODE_H_APPROX;
          var futureSiblings = Object.values(chart.nodes).filter(function (s) { return s.parentId === targetId && s.id !== id; });
          var pos = defaultChildPosition(chart, newParent, futureSiblings.length);
          n.x = pos.x; n.y = pos.y;
          toast('Moved under ' + (newParent.name || 'that box'));
          saveState();
          render();
        } else {
          undoStack.push(preSnap);
          chart.autoLayout = false;
          saveState();
          renderPositionsOnly();
        }
      } else {
        openEditSheet(id);
      }
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // ---------------------------------------------------------------------
  // Stage pan / pinch-zoom
  // ---------------------------------------------------------------------
  var stagePointers = {};
  var panStart = null, pinchStart = null;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  stage.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.node, button')) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    stagePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var keys = Object.keys(stagePointers);
    if (keys.length === 1) {
      panStart = { x: e.clientX, y: e.clientY, panX: panX, panY: panY };
      pinchStart = null;
    } else if (keys.length === 2) {
      var pts = keys.map(function (k) { return stagePointers[k]; });
      pinchStart = { dist: dist(pts[0], pts[1]), scale: scale, mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, panX: panX, panY: panY };
      panStart = null;
    }
  });
  stage.addEventListener('pointermove', function (e) {
    if (!stagePointers[e.pointerId]) return;
    stagePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var keys = Object.keys(stagePointers);
    if (keys.length === 1 && panStart) {
      panX = panStart.panX + (e.clientX - panStart.x);
      panY = panStart.panY + (e.clientY - panStart.y);
      applyTransform();
    } else if (keys.length === 2 && pinchStart) {
      var pts = keys.map(function (k) { return stagePointers[k]; });
      var d = dist(pts[0], pts[1]);
      var newScale = clamp(pinchStart.scale * (d / pinchStart.dist), 0.15, 3);
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
    pinchStart = null;
    if (keys.length === 1) {
      var pt = stagePointers[keys[0]];
      panStart = { x: pt.x, y: pt.y, panX: panX, panY: panY };
    } else {
      panStart = null;
    }
  }
  stage.addEventListener('pointerup', stageUp);
  stage.addEventListener('pointercancel', stageUp);

  // ---------------------------------------------------------------------
  // Node CRUD
  // ---------------------------------------------------------------------
  function randomColor() { var p = getPalette(); return p[Math.floor(Math.random() * p.length)]; }

  function addNode(parentId) {
    pushUndo();
    var chart = getActiveChart();
    var id = uid();
    var parent = parentId ? chart.nodes[parentId] : null;
    var pos = { x: 40, y: 40 };
    if (parent) {
      var siblings = Object.values(chart.nodes).filter(function (n) { return n.parentId === parentId; });
      pos = defaultChildPosition(chart, parent, siblings.length);
    }
    chart.nodes[id] = { id: id, name: '', title: '', color: randomColor(), photo: null, parentId: parentId || null, x: pos.x, y: pos.y, order: Date.now() };
    if (chart.autoLayout !== false) layout(chart);
    saveState();
    render();
    openEditSheet(id, true);
  }

  function deleteNode(id) {
    var chart = getActiveChart();
    var n = chart.nodes[id];
    if (!n) return;
    var count = descendantCount(id);
    var msg = count ? ('Delete this box and ' + count + ' report' + (count > 1 ? 's' : '') + ' below it?') : 'Delete this box?';
    if (!window.confirm(msg)) return;
    pushUndo();
    removeSubtree(id);
    if (chart.autoLayout !== false) layout(chart);
    saveState();
    closeEditSheet();
    render();
  }

  // ---------------------------------------------------------------------
  // Edit sheet
  // ---------------------------------------------------------------------
  function buildColorPicker(selected) {
    colorPicker.innerHTML = '';
    getPalette().forEach(function (c) {
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'swatch' + (c === selected ? ' sel' : '');
      sw.style.background = c;
      sw.addEventListener('click', function () {
        colorPicker.querySelectorAll('.swatch').forEach(function (s) { s.classList.remove('sel'); });
        sw.classList.add('sel');
        colorPicker.dataset.value = c;
      });
      colorPicker.appendChild(sw);
    });
    colorPicker.dataset.value = selected;
  }

  function refreshPhotoPreview(n) {
    pendingPhoto = n.photo || null;
    if (pendingPhoto) {
      photoPreview.style.background = "center/cover no-repeat url('" + pendingPhoto + "')";
      photoPreview.textContent = '';
    } else {
      photoPreview.style.background = n.color || getPalette()[0];
      photoPreview.textContent = initials(n.name);
    }
  }

  function openEditSheet(id, focusEmpty) {
    editingId = id;
    var chart = getActiveChart();
    var n = chart.nodes[id];
    if (!n) return;
    $('editTitle').textContent = n.parentId ? 'Edit box' : 'Edit top box';
    fName.value = n.name || '';
    fTitle.value = n.title || '';
    buildColorPicker(n.color || getPalette()[0]);
    refreshPhotoPreview(n);
    editBackdrop.classList.add('show');
    editSheet.classList.add('show');
    if (focusEmpty) setTimeout(function () { fName.focus(); }, 260);
  }
  function closeEditSheet() {
    editBackdrop.classList.remove('show');
    editSheet.classList.remove('show');
    editingId = null;
    pendingPhoto = null;
  }

  $('fSave').addEventListener('click', function () {
    if (!editingId) return;
    var chart = getActiveChart();
    var n = chart.nodes[editingId];
    pushUndo();
    n.name = fName.value.trim() || 'Unnamed';
    n.title = fTitle.value.trim();
    n.color = colorPicker.dataset.value || n.color;
    n.photo = pendingPhoto || null;
    saveState();
    closeEditSheet();
    render();
  });
  $('fAddChild').addEventListener('click', function () {
    if (!editingId) return;
    var id = editingId;
    closeEditSheet();
    addNode(id);
  });
  $('fAddSibling').addEventListener('click', function () {
    if (!editingId) return;
    var chart = getActiveChart();
    var parentId = chart.nodes[editingId].parentId;
    closeEditSheet();
    addNode(parentId);
  });
  $('fDelete').addEventListener('click', function () { if (editingId) deleteNode(editingId); });
  $('fCancel').addEventListener('click', closeEditSheet);
  editBackdrop.addEventListener('click', function (e) { if (e.target === editBackdrop) closeEditSheet(); });

  $('fChoosePhoto').addEventListener('click', function () { photoFile.value = ''; photoFile.click(); });
  $('fRemovePhoto').addEventListener('click', function () {
    pendingPhoto = null;
    var chart = getActiveChart();
    var n = editingId ? chart.nodes[editingId] : { name: fName.value, color: colorPicker.dataset.value };
    photoPreview.style.background = n.color || getPalette()[0];
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
  // Top bar
  // ---------------------------------------------------------------------
  chartNameInput.addEventListener('change', function () {
    getActiveChart().name = chartNameInput.value.trim() || 'Untitled chart';
    saveState();
  });
  chartNameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') chartNameInput.blur(); });
  $('undoBtn').addEventListener('click', undo);
  $('fitbtn').addEventListener('click', function () { fitToScreen(); });
  $('fab').addEventListener('click', function () { addNode(null); });

  // ---------------------------------------------------------------------
  // Menu sheet: charts list, new/switch/rename/delete
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
      row.querySelector('[data-act="open"]').addEventListener('click', function () {
        state.activeId = c.id; saveState(); closeMenu(); render(); fitToScreen();
      });
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

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  $('newChartBtn').addEventListener('click', function () {
    var id = uid();
    state.charts[id] = newChartObj(id, 'Untitled chart');
    state.activeId = id;
    saveState();
    closeMenu();
    render();
    fitToScreen();
  });
  $('relayoutBtn').addEventListener('click', function () {
    pushUndo();
    var chart = getActiveChart();
    chart.autoLayout = true;
    layout(chart);
    saveState();
    closeMenu();
    render();
    fitToScreen();
    toast('Re-arranged');
  });
  $('themeBtn').addEventListener('click', function () {
    var root = document.documentElement;
    var cur = root.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : (cur === 'light' ? null : 'dark');
    if (next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
    localStorage.setItem('orgchart.theme', next || '');
  });
  (function initTheme() {
    var t = localStorage.getItem('orgchart.theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  })();

  // ---------------------------------------------------------------------
  // Design sheet
  // ---------------------------------------------------------------------
  function buildThemeGrid() {
    themeGrid.innerHTML = '';
    var s = getSettings();
    THEME_ORDER.forEach(function (key) {
      var t = THEMES[key];
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'themecard' + (s.theme === key ? ' sel' : '');
      card.innerHTML = '<div class="dots">' + t.palette.slice(0, 4).map(function (c) { return '<span class="dot" style="background:' + c + '"></span>'; }).join('') + '</div><span>' + t.label + '</span>';
      card.addEventListener('click', function () {
        s.theme = key;
        s.font = t.font;
        saveState();
        buildThemeGrid();
        syncFontSeg();
        applyDesignVars();
        render();
      });
      themeGrid.appendChild(card);
    });
  }

  function wireSeg(id, settingKey, onChange) {
    var seg = $(id);
    seg.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        seg.querySelectorAll('button').forEach(function (b) { b.classList.remove('sel'); });
        btn.classList.add('sel');
        var s = getSettings();
        s[settingKey] = btn.dataset.v;
        saveState();
        if (onChange) onChange();
        applyDesignVars();
      });
    });
  }
  function syncSeg(id, value) {
    $(id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('sel', b.dataset.v === value); });
  }
  function syncFontSeg() { syncSeg('segFont', getSettings().font); }

  wireSeg('segLayout', 'layoutDir', function () {
    var chart = getActiveChart();
    chart.autoLayout = true;
    layout(chart);
    render();
    fitToScreen();
  });
  wireSeg('segConnector', 'connector', function () { drawEdges(); });
  wireSeg('segCard', 'cardStyle');
  wireSeg('segFont', 'font');

  function openDesign() {
    var s = getSettings();
    syncSeg('segLayout', s.layoutDir);
    syncSeg('segConnector', s.connector);
    syncSeg('segCard', s.cardStyle);
    syncFontSeg();
    buildThemeGrid();
    designBackdrop.classList.add('show');
    designSheet.classList.add('show');
  }
  function closeDesign() { designBackdrop.classList.remove('show'); designSheet.classList.remove('show'); }
  $('designBtn').addEventListener('click', openDesign);
  $('designOpenBtn').addEventListener('click', function () { closeMenu(); openDesign(); });
  $('designDoneBtn').addEventListener('click', closeDesign);
  designBackdrop.addEventListener('click', function (e) { if (e.target === designBackdrop) closeDesign(); });

  // ---------------------------------------------------------------------
  // Export sheet
  // ---------------------------------------------------------------------
  function openExport() { exportBackdrop.classList.add('show'); exportSheet.classList.add('show'); }
  function closeExport() { exportBackdrop.classList.remove('show'); exportSheet.classList.remove('show'); }
  $('exportOpenBtn').addEventListener('click', function () { closeMenu(); openExport(); });
  $('exportCloseBtn').addEventListener('click', closeExport);
  exportBackdrop.addEventListener('click', function (e) { if (e.target === exportBackdrop) closeExport(); });

  // ---------------------------------------------------------------------
  // Export / Import JSON
  // ---------------------------------------------------------------------
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 1000);
  }

  function baseFilename() {
    var chart = getActiveChart();
    return (chart.name || 'orgchart').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'orgchart';
  }

  $('exportBtn').addEventListener('click', function () {
    var chart = getActiveChart();
    var blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' });
    var filename = baseFilename() + '.json';
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
      navigator.share({ files: [new File([blob], filename, { type: 'application/json' })], title: chart.name }).catch(function () {});
    } else {
      downloadBlob(blob, filename);
    }
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
        var id = uid();
        data.id = id;
        data.name = (data.name || 'Imported chart');
        if (!data.settings) data.settings = defaultSettings();
        state.charts[id] = data;
        state.activeId = id;
        saveState();
        closeExport();
        render();
        fitToScreen();
        toast('Imported');
      } catch (e) {
        alert('That file doesn\'t look like a valid OrgChart export.');
      }
    };
    reader.readAsText(file);
  });

  // ---------------------------------------------------------------------
  // Shared SVG builder — used by PNG, JPG, SVG and PDF export
  // ---------------------------------------------------------------------
  function buildChartSvg() {
    var chart = getActiveChart();
    var ids = Object.keys(chart.nodes);
    if (!ids.length) return null;
    var dir = getSettings().layoutDir, connector = getSettings().connector, cardStyle = getSettings().cardStyle;
    var palette = getPalette();
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(function (id) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + h);
    });
    var pad = 40;
    var W = maxX - minX + pad * 2, H = maxY - minY + pad * 2;
    var isDark = matchMedia('(prefers-color-scheme: dark)').matches;
    var dtRoot = document.documentElement.getAttribute('data-theme');
    if (dtRoot) isDark = dtRoot === 'dark';
    var bg = isDark ? '#12161c' : '#ffffff';
    var panelLine = isDark ? '#2c3541' : '#dbe0e6';
    var textColor = isDark ? '#eef1f5' : '#1c2530';
    var mutedColor = isDark ? '#93a0b0' : '#6b7684';
    var theme = getTheme();
    var fontFamily = (FONT_STACKS[getSettings().font] || FONT_STACKS.system).replace(/"/g, "'");

    var defs = [];
    var svgParts = [];
    svgParts.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + fontFamily + '">');
    svgParts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + bg + '"/>');

    ids.forEach(function (id) {
      var n = chart.nodes[id];
      if (!n.parentId || !chart.nodes[n.parentId]) return;
      var p = chart.nodes[n.parentId];
      var pH = (nodeEls[n.parentId] && nodeEls[n.parentId].offsetHeight) || NODE_H_APPROX;
      var pp = { x: p.x - minX + pad, y: p.y - minY + pad };
      var cc = { x: n.x - minX + pad, y: n.y - minY + pad };
      var pts = anchorPoints(pp, NODE_W, pH, cc, dir);
      var d = edgePath(pts.x1, pts.y1, pts.x2, pts.y2, dir, connector);
      var strokeColor = theme.accent;
      svgParts.push('<path d="' + d + '" fill="none" stroke="' + strokeColor + '" stroke-width="2" opacity=".6"/>');
    });

    ids.forEach(function (id, idx) {
      var n = chart.nodes[id];
      var h = (nodeEls[id] && nodeEls[id].offsetHeight) || NODE_H_APPROX;
      var x = n.x - minX + pad, y = n.y - minY + pad;
      var color = n.color || palette[0];
      var rx = cardStyle === 'classic' ? 3 : (cardStyle === 'minimal' ? 10 : 14);
      var strokeW = cardStyle === 'minimal' ? 1.5 : 1;
      var strokeColor = cardStyle === 'minimal' ? color : panelLine;
      svgParts.push('<rect x="' + x + '" y="' + y + '" width="' + NODE_W + '" height="' + h + '" rx="' + rx + '" fill="' + bg + '" stroke="' + strokeColor + '" stroke-width="' + strokeW + '"/>');
      if (cardStyle === 'classic') {
        svgParts.push('<path d="M ' + x + ' ' + (y + 4) + ' V ' + y + ' Q ' + x + ' ' + y + ' ' + (x + 4) + ' ' + y + ' H ' + (x + NODE_W - 4) + ' Q ' + (x + NODE_W) + ' ' + y + ' ' + (x + NODE_W) + ' ' + (y + 4) + ' V ' + (y + 4) + ' Z" fill="' + color + '"/>');
      }
      var cx = x + NODE_W / 2;
      var avatarCy = y + 30;
      if (n.photo) {
        var clipId = 'clip' + idx;
        defs.push('<clipPath id="' + clipId + '"><circle cx="' + cx + '" cy="' + avatarCy + '" r="22"/></clipPath>');
        svgParts.push('<image href="' + n.photo + '" x="' + (cx - 22) + '" y="' + (avatarCy - 22) + '" width="44" height="44" clip-path="url(#' + clipId + ')" preserveAspectRatio="xMidYMid slice"/>');
        if (cardStyle === 'minimal') svgParts.push('<circle cx="' + cx + '" cy="' + avatarCy + '" r="22" fill="none" stroke="' + color + '" stroke-width="2"/>');
      } else if (cardStyle === 'minimal') {
        svgParts.push('<circle cx="' + cx + '" cy="' + avatarCy + '" r="21" fill="none" stroke="' + color + '" stroke-width="2"/>');
        svgParts.push('<text x="' + cx + '" y="' + (avatarCy + 5) + '" font-size="13" font-weight="700" fill="' + color + '" text-anchor="middle">' + escapeHtml(initials(n.name)) + '</text>');
      } else {
        svgParts.push('<circle cx="' + cx + '" cy="' + avatarCy + '" r="22" fill="' + color + '"/>');
        svgParts.push('<text x="' + cx + '" y="' + (avatarCy + 5) + '" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">' + escapeHtml(initials(n.name)) + '</text>');
      }
      svgParts.push('<text x="' + cx + '" y="' + (y + 64) + '" font-size="13.5" font-weight="700" fill="' + textColor + '" text-anchor="middle">' + escapeHtml((n.name || 'Unnamed').slice(0, 24)) + '</text>');
      if (n.title) svgParts.push('<text x="' + cx + '" y="' + (y + 82) + '" font-size="11.5" fill="' + mutedColor + '" text-anchor="middle">' + escapeHtml(n.title.slice(0, 28)) + '</text>');
    });
    if (defs.length) svgParts.push('<defs>' + defs.join('') + '</defs>');
    svgParts.push('</svg>');
    return { svg: svgParts.join(''), width: W, height: H };
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

  function shareOrDownload(blob, filename, mime) {
    if (!blob) return;
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
      navigator.share({ files: [new File([blob], filename, { type: mime })] }).catch(function () {});
    } else {
      downloadBlob(blob, filename);
    }
  }

  function exportRaster(mime, ext, quality) {
    var built = buildChartSvg();
    if (!built) { toast('Nothing to export'); return; }
    rasterize(built.svg, built.width, built.height, mime, quality, function (blob) {
      shareOrDownload(blob, baseFilename() + '.' + ext, mime);
    });
  }

  $('exportPngBtn').addEventListener('click', function () { exportRaster('image/png', 'png'); });
  $('exportJpgBtn').addEventListener('click', function () { exportRaster('image/jpeg', 'jpg', 0.92); });

  $('exportSvgBtn').addEventListener('click', function () {
    var built = buildChartSvg();
    if (!built) { toast('Nothing to export'); return; }
    var blob = new Blob([built.svg], { type: 'image/svg+xml' });
    shareOrDownload(blob, baseFilename() + '.svg', 'image/svg+xml');
  });

  $('exportPdfBtn').addEventListener('click', function () {
    var built = buildChartSvg();
    if (!built) { toast('Nothing to export'); return; }
    printArea.innerHTML = built.svg;
    closeExport();
    setTimeout(function () { window.print(); }, 50);
  });

  // ---------------------------------------------------------------------
  // Share button (top bar) = quick JSON share
  // ---------------------------------------------------------------------
  $('shareBtn').addEventListener('click', function () { openExport(); });

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
  var chart = getActiveChart();
  if (Object.keys(chart.nodes).length > 0) layout(chart);
  render();
  requestAnimationFrame(function () { fitToScreen(); });
  applyTransform();

  window.addEventListener('resize', function () { fitToScreen(); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();

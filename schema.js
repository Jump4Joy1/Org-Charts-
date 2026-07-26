/**
 * Schema versioning and the migration runner.
 *
 * Charts are stored as plain JSON in localStorage and mirrored to the user's
 * own Supabase project, so an old chart can arrive from a device that has
 * not been opened in months. Every load funnels through `migrate()`, which
 * applies each pending step in order and stamps the result, so a v1 chart
 * from the very first release still opens.
 *
 * Migrations must be pure and idempotent: the same chart may be migrated on
 * two devices independently and then synced.
 */
(function (global) {
  'use strict';

  var CURRENT_SCHEMA_VERSION = 3;

  function defaultFill() { return { type: 'solid', color: '', color2: '', texture: 'dots', angle: 135, scale: 1 }; }
  function defaultBorder() { return { color: '', width: 1, dash: 'solid' }; }
  function defaultBackground() { return { type: 'solid', color: '', color2: '', texture: 'dots', angle: 135, scale: 1 }; }

  /**
   * v1 -> v2: the tree became a graph. A node's single `parentId` turns into
   * an edge, and per-node styling fields gain defaults.
   */
  function v1_to_v2(c, helpers) {
    c.nodes = c.nodes || {};
    c.edges = c.edges || {};
    c.notes = c.notes || {};
    Object.keys(c.nodes).forEach(function (id) {
      var n = c.nodes[id];
      if (n.parentId) {
        var eid = helpers.uid();
        c.edges[eid] = {
          id: eid, from: n.parentId, to: id, color: '', width: 2, dash: 'solid',
          arrowStart: false, arrowEnd: true, style: 'elbow', label: '', order: Date.now()
        };
      }
      delete n.parentId;
    });
    delete c.settings;
    delete c.autoLayout;
    return c;
  }

  /**
   * v2 -> v3: the ops fields. Every one is optional and empty by default, so
   * a chart that never uses them looks and behaves exactly as before.
   */
  function v2_to_v3(c) {
    if (!c.density) c.density = 'standard';
    Object.keys(c.nodes || {}).forEach(function (id) {
      var n = c.nodes[id];
      if (!Array.isArray(n.certs)) n.certs = [];
      if (!n.shift) n.shift = { onCall: false, days: '', start: '', end: '' };
      if (!n.contact) n.contact = { phone: '', email: '' };
      if (!n.status) n.status = 'none';
      if (n.backupOf === undefined) n.backupOf = '';
      if (!Array.isArray(n.tasks)) n.tasks = [];
    });
    return c;
  }

  var MIGRATIONS = [
    { to: 2, run: v1_to_v2 },
    { to: 3, run: v2_to_v3 }
  ];

  /**
   * Works out what version a chart is when it has no `version` field: the
   * very first release had no edges map, and v2 charts never had `density`.
   */
  function detectVersion(c) {
    if (typeof c.version === 'number') return c.version;
    var looksV1 = !c.edges || Object.keys(c.nodes || {}).some(function (id) {
      return c.nodes[id] && 'parentId' in c.nodes[id];
    });
    return looksV1 ? 1 : 2;
  }

  /**
   * Runs every pending migration. `helpers` supplies functions the app owns
   * (id generation) so this file stays free of app internals.
   */
  function migrate(chart, helpers) {
    helpers = helpers || { uid: function () { return Math.random().toString(36).slice(2, 12); } };
    var from = detectVersion(chart);
    MIGRATIONS.forEach(function (m) {
      if (from < m.to) {
        m.run(chart, helpers);
        from = m.to;
      }
    });
    chart.version = CURRENT_SCHEMA_VERSION;
    return chart;
  }

  global.OrgChartSchema = {
    CURRENT_SCHEMA_VERSION: CURRENT_SCHEMA_VERSION,
    migrate: migrate,
    detectVersion: detectVersion,
    defaultFill: defaultFill,
    defaultBorder: defaultBorder,
    defaultBackground: defaultBackground
  };
})(window);

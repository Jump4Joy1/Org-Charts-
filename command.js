/**
 * Command pattern over the chart, with the undo/redo stack.
 *
 * Every user-visible change goes through `cmdManager.execute(...)`. A command
 * knows how to apply itself and how to put things back. Composite commands
 * group several into one undo step, which is what a drag that moves a
 * container plus its members needs.
 *
 * State restoration is by chart snapshot rather than per-field inverses.
 * That is deliberate: the chart is a small JSON object, snapshots are exact,
 * and an inverse written by hand is the classic source of undo bugs where
 * the tenth undo leaves the chart subtly wrong. The command layer still
 * gives labelled, inspectable history, which is what the rest of the app
 * needs from it.
 */
(function (global) {
  'use strict';

  var MAX_HISTORY = 100;

  /**
   * @param {string} label  Shown in history and the command palette.
   * @param {function} run  Mutates the chart. Receives the live chart.
   */
  function Command(label, run) {
    this.label = label;
    this.run = run || function () {};
    this.before = null;
    this.after = null;
    this.at = 0;
    /** @type {Command[]|undefined} Set only on composites. */
    this.children = undefined;
  }

  function CompositeCommand(label, commands) {
    var self = new Command(label, function (chart) {
      commands.forEach(function (c) { c.run(chart); });
    });
    self.children = commands;
    return self;
  }

  /**
   * @param {object} deps
   *   getChart()      -> the chart object being edited
   *   setChart(obj)   -> replace it wholesale (used to restore a snapshot)
   *   onChange(cmd, kind) -> called after execute/undo/redo
   */
  function CommandManager(deps) {
    this.deps = deps;
    this.undoStack = [];
    this.redoStack = [];
  }

  CommandManager.prototype._snapshot = function () {
    return JSON.stringify(this.deps.getChart());
  };

  CommandManager.prototype.execute = function (cmd) {
    cmd.before = this._snapshot();
    cmd.run(this.deps.getChart());
    cmd.after = this._snapshot();
    cmd.at = Date.now();
    // A no-op should not consume an undo slot; tapping a control that sets
    // a value to what it already was is common.
    if (cmd.before === cmd.after) return false;
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    if (this.deps.onChange) this.deps.onChange(cmd, 'execute');
    return true;
  };

  /**
   * Records a change that has already been applied. Interactive gestures
   * mutate as the finger moves; they capture a snapshot at the start and
   * commit once on release.
   */
  CommandManager.prototype.commit = function (label, before) {
    var after = this._snapshot();
    if (before === after) return false;
    var cmd = new Command(label, function () {});
    cmd.before = before;
    cmd.after = after;
    cmd.at = Date.now();
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    if (this.deps.onChange) this.deps.onChange(cmd, 'commit');
    return true;
  };

  CommandManager.prototype.canUndo = function () { return this.undoStack.length > 0; };
  CommandManager.prototype.canRedo = function () { return this.redoStack.length > 0; };

  CommandManager.prototype.undo = function () {
    var cmd = this.undoStack.pop();
    if (!cmd) return null;
    this.redoStack.push(cmd);
    this.deps.setChart(JSON.parse(cmd.before));
    if (this.deps.onChange) this.deps.onChange(cmd, 'undo');
    return cmd;
  };

  CommandManager.prototype.redo = function () {
    var cmd = this.redoStack.pop();
    if (!cmd) return null;
    this.undoStack.push(cmd);
    this.deps.setChart(JSON.parse(cmd.after));
    if (this.deps.onChange) this.deps.onChange(cmd, 'redo');
    return cmd;
  };

  CommandManager.prototype.clear = function () {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  };

  /** Newest first. Feeds the command palette and any future history view. */
  CommandManager.prototype.getHistory = function () {
    return this.undoStack.slice().reverse().map(function (c) {
      return { label: c.label, at: c.at };
    });
  };

  // Named constructors, so call sites read as intent rather than as a closure.
  var Commands = {
    addNode: function (id, node) {
      return new Command('Add box', function (chart) { chart.nodes[id] = node; });
    },
    updateNode: function (id, fields) {
      return new Command('Edit box', function (chart) {
        var n = chart.nodes[id];
        if (!n) return;
        Object.keys(fields).forEach(function (k) { n[k] = fields[k]; });
      });
    },
    moveNode: function (id, x, y) {
      return new Command('Move box', function (chart) {
        var n = chart.nodes[id];
        if (n) { n.x = x; n.y = y; }
      });
    },
    deleteNode: function (id) {
      return new Command('Delete box', function (chart) {
        delete chart.nodes[id];
        Object.keys(chart.edges).forEach(function (eid) {
          var e = chart.edges[eid];
          if (e.from === id || e.to === id) delete chart.edges[eid];
        });
        Object.keys(chart.notes).forEach(function (nid) {
          var note = chart.notes[nid];
          if (note.attach && note.attach.type === 'node' && note.attach.id === id) delete chart.notes[nid];
        });
      });
    },
    addEdge: function (id, edge) {
      return new Command('Connect boxes', function (chart) { chart.edges[id] = edge; });
    },
    deleteEdge: function (id) {
      return new Command('Remove connection', function (chart) { delete chart.edges[id]; });
    },
    setChartField: function (label, field, value) {
      return new Command(label, function (chart) { chart[field] = value; });
    }
  };

  global.OrgChartCommands = {
    Command: Command,
    CompositeCommand: CompositeCommand,
    CommandManager: CommandManager,
    Commands: Commands,
    MAX_HISTORY: MAX_HISTORY
  };
})(window);

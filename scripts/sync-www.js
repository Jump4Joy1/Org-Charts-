#!/usr/bin/env node
// Copies the static app files that ship inside the native shells into www/,
// which Capacitor treats as its web asset root. Kept separate from the repo
// root (which is what GitHub Pages serves) so the native build never picks
// up node_modules, android/, ios/, or anything else that isn't the app.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

const FILES = [
  'index.html',
  'app.js',
  'design-tokens.js',
  'schema.js',
  'command.js',
  'manifest.webmanifest',
];
const DIRS = ['icons'];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmrf(WWW);
fs.mkdirSync(WWW, { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(ROOT, f), path.join(WWW, f));
for (const d of DIRS) copyDir(path.join(ROOT, d), path.join(WWW, d));

console.log('www/ synced from ' + FILES.concat(DIRS).join(', '));

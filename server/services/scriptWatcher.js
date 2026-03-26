const chokidar = require('chokidar');
const config = require('../config');
const fs = require('fs');
const path = require('path');

let io = null;

function buildTree(dirPath, relativePath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: rel, isDir: true, children: buildTree(path.join(dirPath, entry.name), rel) });
    } else {
      result.push({ name: entry.name, path: rel, isDir: false });
    }
  }
  return result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function start(ioInstance) {
  io = ioInstance;

  const watcher = chokidar.watch(config.scriptsPath, {
    ignoreInitial: true,
    ignored: /(^|[/\\])\../,
  });

  const notify = () => {
    const tree = buildTree(config.scriptsPath, '');
    io.emit('scripts:changed', { tree });
  };

  watcher.on('add', notify);
  watcher.on('unlink', notify);
  watcher.on('addDir', notify);
  watcher.on('unlinkDir', notify);
}

module.exports = { start };

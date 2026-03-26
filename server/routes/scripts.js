const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');

const router = express.Router();

// Validate that resolved path stays within scripts directory
function safePath(subdir) {
  const resolved = path.resolve(config.scriptsPath, subdir || '');
  if (!resolved.startsWith(path.resolve(config.scriptsPath))) {
    return null; // path traversal attempt
  }
  return resolved;
}

// Multer storage for script uploads with path validation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = safePath(req.body.path);
    if (!dest) {
      return cb(new Error('Invalid path'));
    }
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // Sanitize filename: remove path separators
    const name = path.basename(file.originalname);
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
});

function buildTree(dirPath, relativePath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: rel,
        isDir: true,
        children: buildTree(path.join(dirPath, entry.name), rel),
      });
    } else {
      result.push({ name: entry.name, path: rel, isDir: false });
    }
  }

  return result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

router.get('/', (req, res) => {
  try {
    const tree = buildTree(config.scriptsPath, '');
    res.json(tree);
  } catch (err) {
    res.json([]);
  }
});

router.post('/upload', upload.array('files'), (req, res) => {
  res.json({ ok: true, count: req.files.length });
});

module.exports = router;

const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM bookmarks ORDER BY sort_order, name').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const { name, url, sort_order } = req.body;
  const result = db.prepare('INSERT INTO bookmarks (name, url, sort_order) VALUES (?, ?, ?)')
    .run(name, url, sort_order || 0);
  res.json({ id: result.lastInsertRowid, name, url });
});

router.put('/:id', (req, res) => {
  const { name, url, sort_order } = req.body;
  db.prepare('UPDATE bookmarks SET name=?, url=?, sort_order=? WHERE id=?')
    .run(name, url, sort_order || 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

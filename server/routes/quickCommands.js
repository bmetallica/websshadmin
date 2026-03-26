const express = require('express');
const db = require('../db');

const router = express.Router();

// Categories
router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM quick_categories ORDER BY sort_order, name').all();
  for (const cat of categories) {
    cat.commands = db.prepare('SELECT * FROM quick_commands WHERE category_id = ? ORDER BY sort_order, name').all(cat.id);
  }
  res.json(categories);
});

router.post('/', (req, res) => {
  const { name, sort_order } = req.body;
  const result = db.prepare('INSERT INTO quick_categories (name, sort_order) VALUES (?, ?)').run(name, sort_order || 0);
  res.json({ id: result.lastInsertRowid, name, commands: [] });
});

router.put('/:id', (req, res) => {
  const { name, sort_order } = req.body;
  db.prepare('UPDATE quick_categories SET name=?, sort_order=? WHERE id=?').run(name, sort_order || 0, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM quick_categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Commands
router.post('/:categoryId/commands', (req, res) => {
  const { name, command, sort_order } = req.body;
  const result = db.prepare('INSERT INTO quick_commands (category_id, name, command, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.categoryId, name, command, sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:categoryId/commands/:cmdId', (req, res) => {
  const { name, command, sort_order } = req.body;
  db.prepare('UPDATE quick_commands SET name=?, command=?, sort_order=? WHERE id=?')
    .run(name, command, sort_order || 0, req.params.cmdId);
  res.json({ ok: true });
});

router.delete('/:categoryId/commands/:cmdId', (req, res) => {
  db.prepare('DELETE FROM quick_commands WHERE id = ?').run(req.params.cmdId);
  res.json({ ok: true });
});

module.exports = router;

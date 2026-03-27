const express = require('express');
const db = require('../db');

const router = express.Router();

// GET: personal categories + group categories merged
router.get('/', (req, res) => {
  const userId = req.session.userId;

  // Personal categories
  const personal = db.prepare('SELECT * FROM quick_categories WHERE user_id = ? ORDER BY sort_order, name').all(userId);
  for (const cat of personal) {
    cat.commands = db.prepare('SELECT * FROM quick_commands WHERE category_id = ? ORDER BY sort_order, name').all(cat.id);
    cat.source = 'personal';
  }

  // Group categories from all groups the user belongs to
  let groupCats = db.prepare(`
    SELECT gc.*, g.name AS group_name FROM group_quick_categories gc
    JOIN groups g ON g.id = gc.group_id
    JOIN user_groups ug ON ug.group_id = gc.group_id
    WHERE ug.user_id = ?
    ORDER BY g.name, gc.sort_order, gc.name
  `).all(userId);

  // Admin also sees group categories for all groups
  if (req.session.role === 'admin') {
    const adminCats = db.prepare(`
      SELECT gc.*, g.name AS group_name FROM group_quick_categories gc
      JOIN groups g ON g.id = gc.group_id
      ORDER BY g.name, gc.sort_order, gc.name
    `).all();
    const seenIds = new Set(groupCats.map(c => c.id));
    for (const c of adminCats) {
      if (!seenIds.has(c.id)) {
        groupCats.push(c);
        seenIds.add(c.id);
      }
    }
  }

  for (const cat of groupCats) {
    cat.commands = db.prepare('SELECT * FROM group_quick_commands WHERE category_id = ? ORDER BY sort_order, name').all(cat.id);
    cat.source = 'group';
  }

  res.json({ personal, group: groupCats });
});

// POST: create personal category
router.post('/', (req, res) => {
  const { name, sort_order } = req.body;
  const result = db.prepare('INSERT INTO quick_categories (name, sort_order, user_id) VALUES (?, ?, ?)')
    .run(name, sort_order || 0, req.session.userId);
  res.json({ id: result.lastInsertRowid, name, commands: [] });
});

// PUT: update own category
router.put('/:id', (req, res) => {
  const { name, sort_order } = req.body;
  db.prepare('UPDATE quick_categories SET name=?, sort_order=? WHERE id=? AND user_id=?')
    .run(name, sort_order || 0, req.params.id, req.session.userId);
  res.json({ ok: true });
});

// DELETE: delete own category
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM quick_categories WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// Commands
router.post('/:categoryId/commands', (req, res) => {
  const { name, command, sort_order } = req.body;
  // Verify the category belongs to the user
  const cat = db.prepare('SELECT id FROM quick_categories WHERE id = ? AND user_id = ?').get(req.params.categoryId, req.session.userId);
  if (!cat) return res.status(403).json({ error: 'Nicht erlaubt' });
  const result = db.prepare('INSERT INTO quick_commands (category_id, name, command, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.categoryId, name, command, sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:categoryId/commands/:cmdId', (req, res) => {
  const { name, command, sort_order } = req.body;
  const cat = db.prepare('SELECT id FROM quick_categories WHERE id = ? AND user_id = ?').get(req.params.categoryId, req.session.userId);
  if (!cat) return res.status(403).json({ error: 'Nicht erlaubt' });
  db.prepare('UPDATE quick_commands SET name=?, command=?, sort_order=? WHERE id=?')
    .run(name, command, sort_order || 0, req.params.cmdId);
  res.json({ ok: true });
});

router.delete('/:categoryId/commands/:cmdId', (req, res) => {
  const cat = db.prepare('SELECT id FROM quick_categories WHERE id = ? AND user_id = ?').get(req.params.categoryId, req.session.userId);
  if (!cat) return res.status(403).json({ error: 'Nicht erlaubt' });
  db.prepare('DELETE FROM quick_commands WHERE id = ?').run(req.params.cmdId);
  res.json({ ok: true });
});

module.exports = router;

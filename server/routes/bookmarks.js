const express = require('express');
const db = require('../db');

const router = express.Router();

// GET: personal bookmarks + group bookmarks merged
router.get('/', (req, res) => {
  const userId = req.session.userId;

  // Personal bookmarks
  const personal = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY sort_order, name').all(userId);

  // Group bookmarks from all groups the user belongs to
  const groupBms = db.prepare(`
    SELECT gb.*, g.name AS group_name FROM group_bookmarks gb
    JOIN groups g ON g.id = gb.group_id
    JOIN user_groups ug ON ug.group_id = gb.group_id
    WHERE ug.user_id = ?
    ORDER BY g.name, gb.sort_order, gb.name
  `).all(userId);

  // Admin also sees group bookmarks for groups they manage (even if not member)
  let adminGroupBms = [];
  if (req.session.role === 'admin') {
    adminGroupBms = db.prepare(`
      SELECT gb.*, g.name AS group_name FROM group_bookmarks gb
      JOIN groups g ON g.id = gb.group_id
      ORDER BY g.name, gb.sort_order, gb.name
    `).all();
  }

  // Merge: deduplicate admin group bookmarks with user group bookmarks
  const seenIds = new Set(groupBms.map(b => b.id));
  const allGroupBms = [...groupBms];
  for (const b of adminGroupBms) {
    if (!seenIds.has(b.id)) {
      allGroupBms.push(b);
      seenIds.add(b.id);
    }
  }

  res.json({
    personal: personal.map(b => ({ ...b, source: 'personal' })),
    group: allGroupBms.map(b => ({ ...b, source: 'group' })),
  });
});

// POST: create personal bookmark
router.post('/', (req, res) => {
  const { name, url, sort_order } = req.body;
  const result = db.prepare('INSERT INTO bookmarks (name, url, sort_order, user_id) VALUES (?, ?, ?, ?)')
    .run(name, url, sort_order || 0, req.session.userId);
  res.json({ id: result.lastInsertRowid, name, url });
});

// PUT: update own bookmark
router.put('/:id', (req, res) => {
  const { name, url, sort_order } = req.body;
  db.prepare('UPDATE bookmarks SET name=?, url=?, sort_order=? WHERE id=? AND user_id=?')
    .run(name, url, sort_order || 0, req.params.id, req.session.userId);
  res.json({ ok: true });
});

// DELETE: delete own bookmark
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

module.exports = router;

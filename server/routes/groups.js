const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const { encrypt, decrypt } = require('../services/encryption');

const router = express.Router();

// List groups: admin sees all, users see their own
router.get('/', (req, res) => {
  if (req.session.role === 'admin') {
    res.json(db.prepare('SELECT * FROM groups ORDER BY name').all());
  } else {
    res.json(db.prepare(`
      SELECT g.* FROM groups g
      JOIN user_groups ug ON ug.group_id = g.id
      WHERE ug.user_id = ?
      ORDER BY g.name
    `).all(req.session.userId));
  }
});

// Create group (admin only)
router.post('/', requireRole('admin'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });

  const existing = db.prepare('SELECT id FROM groups WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Gruppenname bereits vergeben' });

  const result = db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)').run(name, description || null);
  res.json({ id: result.lastInsertRowid });
});

// Update group (admin only)
router.put('/:id', requireRole('admin'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });

  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Gruppe nicht gefunden' });

  const dup = db.prepare('SELECT id FROM groups WHERE name = ? AND id != ?').get(name, req.params.id);
  if (dup) return res.status(409).json({ error: 'Gruppenname bereits vergeben' });

  db.prepare('UPDATE groups SET name = ?, description = ? WHERE id = ?').run(name, description || null, req.params.id);
  res.json({ ok: true });
});

// Delete group (admin only)
router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// List members of a group
router.get('/:id/members', requireRole('admin'), (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.username, u.role FROM users u
    JOIN user_groups ug ON ug.user_id = u.id
    WHERE ug.group_id = ?
    ORDER BY u.username
  `).all(req.params.id);
  res.json(members);
});

// Add user to group
router.post('/:id/members', requireRole('admin'), (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId erforderlich' });

  const existing = db.prepare('SELECT 1 FROM user_groups WHERE user_id = ? AND group_id = ?').get(userId, req.params.id);
  if (existing) return res.status(409).json({ error: 'Benutzer bereits in Gruppe' });

  db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)').run(userId, req.params.id);
  res.json({ ok: true });
});

// Remove user from group
router.delete('/:id/members/:userId', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?').run(req.params.userId, req.params.id);
  res.json({ ok: true });
});

// List group connections
router.get('/:id/connections', (req, res) => {
  const conns = db.prepare('SELECT * FROM group_connections WHERE group_id = ? ORDER BY sort_order, name').all(req.params.id);
  // Admin gets secrets for editing, others get sanitized
  if (req.session.role === 'admin') {
    res.json(conns.map(r => ({
      ...r,
      password: decrypt(r.password) || '',
      private_key: decrypt(r.private_key) || '',
      passphrase: decrypt(r.passphrase) || '',
    })));
  } else {
    res.json(conns.map(r => {
      const { password, private_key, passphrase, ...safe } = r;
      return { ...safe, has_password: !!password, has_private_key: !!private_key, has_passphrase: !!passphrase };
    }));
  }
});

// Add group connection (admin only)
router.post('/:id/connections', requireRole('admin'), (req, res) => {
  const { name, host, port, username, auth_method, password, private_key, passphrase,
    tunnel_enabled, tunnel_local_port, tunnel_remote_host, tunnel_remote_port, tunnel_bind_address, sort_order } = req.body;

  if (!name || !host) {
    return res.status(400).json({ error: 'Name und Host erforderlich' });
  }

  const p = parseInt(port, 10);
  const result = db.prepare(`
    INSERT INTO group_connections (group_id, name, host, port, username, auth_method, password, private_key, passphrase,
      tunnel_enabled, tunnel_local_port, tunnel_remote_host, tunnel_remote_port, tunnel_bind_address, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, name, host, p || 22, username || '', auth_method || 'password',
    encrypt(password) || null, encrypt(private_key) || null, encrypt(passphrase) || null,
    tunnel_enabled || 0, tunnel_local_port || null, tunnel_remote_host || null,
    tunnel_remote_port || null, tunnel_bind_address || '127.0.0.1', sort_order || 0);

  res.json({ id: result.lastInsertRowid });
});

// Update group connection (admin only)
router.put('/:id/connections/:connId', requireRole('admin'), (req, res) => {
  const { name, host, port, username, auth_method, password, private_key, passphrase,
    tunnel_enabled, tunnel_local_port, tunnel_remote_host, tunnel_remote_port, tunnel_bind_address, sort_order } = req.body;

  if (!name || !host) {
    return res.status(400).json({ error: 'Name und Host erforderlich' });
  }

  const p = parseInt(port, 10);
  db.prepare(`
    UPDATE group_connections SET name=?, host=?, port=?, username=?, auth_method=?, password=?, private_key=?, passphrase=?,
      tunnel_enabled=?, tunnel_local_port=?, tunnel_remote_host=?, tunnel_remote_port=?, tunnel_bind_address=?,
      sort_order=?, updated_at=datetime('now')
    WHERE id=? AND group_id=?
  `).run(name, host, p || 22, username || '', auth_method || 'password',
    encrypt(password) || null, encrypt(private_key) || null, encrypt(passphrase) || null,
    tunnel_enabled || 0, tunnel_local_port || null, tunnel_remote_host || null,
    tunnel_remote_port || null, tunnel_bind_address || '127.0.0.1', sort_order || 0, req.params.connId, req.params.id);

  res.json({ ok: true });
});

// Delete group connection (admin only)
router.delete('/:id/connections/:connId', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM group_connections WHERE id = ? AND group_id = ?').run(req.params.connId, req.params.id);
  res.json({ ok: true });
});

// ---- Group Bookmarks ----

// List group bookmarks
router.get('/:id/bookmarks', requireRole('admin'), (req, res) => {
  res.json(db.prepare('SELECT * FROM group_bookmarks WHERE group_id = ? ORDER BY sort_order, name').all(req.params.id));
});

// Add group bookmark
router.post('/:id/bookmarks', requireRole('admin'), (req, res) => {
  const { name, url, sort_order } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name und URL erforderlich' });
  const result = db.prepare('INSERT INTO group_bookmarks (group_id, name, url, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.id, name, url, sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

// Update group bookmark
router.put('/:id/bookmarks/:bmId', requireRole('admin'), (req, res) => {
  const { name, url, sort_order } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name und URL erforderlich' });
  db.prepare('UPDATE group_bookmarks SET name=?, url=?, sort_order=? WHERE id=? AND group_id=?')
    .run(name, url, sort_order || 0, req.params.bmId, req.params.id);
  res.json({ ok: true });
});

// Delete group bookmark
router.delete('/:id/bookmarks/:bmId', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM group_bookmarks WHERE id = ? AND group_id = ?').run(req.params.bmId, req.params.id);
  res.json({ ok: true });
});

// ---- Group Quick Categories & Commands ----

// List group quick categories with commands
router.get('/:id/quick-categories', requireRole('admin'), (req, res) => {
  const cats = db.prepare('SELECT * FROM group_quick_categories WHERE group_id = ? ORDER BY sort_order, name').all(req.params.id);
  for (const cat of cats) {
    cat.commands = db.prepare('SELECT * FROM group_quick_commands WHERE category_id = ? ORDER BY sort_order, name').all(cat.id);
  }
  res.json(cats);
});

// Add group quick category
router.post('/:id/quick-categories', requireRole('admin'), (req, res) => {
  const { name, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  const result = db.prepare('INSERT INTO group_quick_categories (group_id, name, sort_order) VALUES (?, ?, ?)')
    .run(req.params.id, name, sort_order || 0);
  res.json({ id: result.lastInsertRowid, name, commands: [] });
});

// Update group quick category
router.put('/:id/quick-categories/:catId', requireRole('admin'), (req, res) => {
  const { name, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name erforderlich' });
  db.prepare('UPDATE group_quick_categories SET name=?, sort_order=? WHERE id=? AND group_id=?')
    .run(name, sort_order || 0, req.params.catId, req.params.id);
  res.json({ ok: true });
});

// Delete group quick category
router.delete('/:id/quick-categories/:catId', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM group_quick_categories WHERE id = ? AND group_id = ?').run(req.params.catId, req.params.id);
  res.json({ ok: true });
});

// Add command to group quick category
router.post('/:id/quick-categories/:catId/commands', requireRole('admin'), (req, res) => {
  const { name, command, sort_order } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'Name und Befehl erforderlich' });
  const result = db.prepare('INSERT INTO group_quick_commands (category_id, name, command, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.catId, name, command, sort_order || 0);
  res.json({ id: result.lastInsertRowid });
});

// Update command in group quick category
router.put('/:id/quick-categories/:catId/commands/:cmdId', requireRole('admin'), (req, res) => {
  const { name, command, sort_order } = req.body;
  if (!name || !command) return res.status(400).json({ error: 'Name und Befehl erforderlich' });
  db.prepare('UPDATE group_quick_commands SET name=?, command=?, sort_order=? WHERE id=? AND category_id=?')
    .run(name, command, sort_order || 0, req.params.cmdId, req.params.catId);
  res.json({ ok: true });
});

// Delete command from group quick category
router.delete('/:id/quick-categories/:catId/commands/:cmdId', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM group_quick_commands WHERE id = ? AND category_id = ?').run(req.params.cmdId, req.params.catId);
  res.json({ ok: true });
});

module.exports = router;

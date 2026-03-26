const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

// All routes require admin role
router.use(requireRole('admin'));

// List all users (without password hashes)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all();
  res.json(rows);
});

// Create user
router.post('/', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username und Passwort erforderlich' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
  }
  const validRoles = ['admin', 'user'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Ungültige Rolle' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Benutzername bereits vergeben' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, role || 'user');

  res.json({ id: result.lastInsertRowid });
});

// Update user
router.put('/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { username, password, role } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  }

  if (username && username !== user.username) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, userId);
    if (existing) {
      return res.status(409).json({ error: 'Benutzername bereits vergeben' });
    }
  }

  const validRoles = ['admin', 'user'];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: 'Ungültige Rolle' });
  }

  // Prevent removing the last admin
  if (role && role !== 'admin' && user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'").get().cnt;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Der letzte Admin kann nicht herabgestuft werden' });
    }
  }

  const newUsername = username || user.username;
  const newRole = role || user.role;

  if (password && password.length > 0) {
    if (password.length < 8) {
      return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
    }
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('UPDATE users SET username = ?, password_hash = ?, role = ? WHERE id = ?')
      .run(newUsername, hash, newRole, userId);
  } else {
    db.prepare('UPDATE users SET username = ?, role = ? WHERE id = ?')
      .run(newUsername, newRole, userId);
  }

  res.json({ ok: true });
});

// Delete user
router.delete('/:id', (req, res) => {
  const userId = parseInt(req.params.id, 10);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) {
    return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  }

  // Prevent deleting the last admin
  if (user.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'").get().cnt;
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Der letzte Admin kann nicht gelöscht werden' });
    }
  }

  // Prevent self-deletion
  if (req.session.userId === userId) {
    return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  res.json({ ok: true });
});

module.exports = router;

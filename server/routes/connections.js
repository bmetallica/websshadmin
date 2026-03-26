const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const { encrypt, decrypt } = require('../services/encryption');

const router = express.Router();

// Strip sensitive fields for list/detail responses
function sanitize(row) {
  if (!row) return row;
  const { password, private_key, passphrase, ...safe } = row;
  return {
    ...safe,
    has_password: !!password,
    has_private_key: !!private_key,
    has_passphrase: !!passphrase,
  };
}

// Return with decrypted secrets (for owner editing their own connections)
function withSecrets(row) {
  if (!row) return row;
  return {
    ...row,
    password: decrypt(row.password) || '',
    private_key: decrypt(row.private_key) || '',
    passphrase: decrypt(row.passphrase) || '',
  };
}

router.get('/', (req, res) => {
  const userId = req.session.userId;

  // User's own connections (with secrets for editing)
  const own = db.prepare('SELECT * FROM connections WHERE user_id = ? ORDER BY sort_order, name').all(userId);
  const ownMapped = own.map(r => ({ ...withSecrets(r), source: 'own' }));

  // Group connections (sanitized - users can't see secrets)
  const groupConns = db.prepare(`
    SELECT gc.*, g.name as group_name
    FROM group_connections gc
    JOIN groups g ON gc.group_id = g.id
    JOIN user_groups ug ON ug.group_id = g.id
    WHERE ug.user_id = ?
    ORDER BY g.name, gc.sort_order, gc.name
  `).all(userId);

  // Check which group connections have user-saved credentials
  const userCreds = db.prepare(`
    SELECT group_connection_id, username, auth_method,
      CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END as has_user_password,
      CASE WHEN private_key IS NOT NULL AND private_key != '' THEN 1 ELSE 0 END as has_user_private_key
    FROM user_group_credentials WHERE user_id = ?
  `).all(userId);
  const credMap = {};
  for (const c of userCreds) credMap[c.group_connection_id] = c;

  const groupMapped = groupConns.map(r => {
    const uc = credMap[r.id];
    return {
      ...sanitize(r),
      source: 'group',
      has_user_credentials: !!uc,
      user_username: uc ? uc.username : '',
      needs_credentials: (!r.username && !uc) || (!r.password && !r.private_key && !uc),
    };
  });

  res.json([...ownMapped, ...groupMapped]);
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(withSecrets(row));
});

router.post('/', (req, res) => {
  const { name, host, port, username, auth_method, password, private_key, passphrase,
    tunnel_enabled, tunnel_local_port, tunnel_remote_host, tunnel_remote_port, tunnel_bind_address, sort_order } = req.body;

  if (!name || !host || !username) {
    return res.status(400).json({ error: 'Name, Host und Username erforderlich' });
  }

  const p = parseInt(port, 10);
  if (p && (p < 1 || p > 65535)) {
    return res.status(400).json({ error: 'Port muss zwischen 1 und 65535 liegen' });
  }

  const result = db.prepare(`
    INSERT INTO connections (name, host, port, username, auth_method, password, private_key, passphrase,
      tunnel_enabled, tunnel_local_port, tunnel_remote_host, tunnel_remote_port, tunnel_bind_address, sort_order, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, host, p || 22, username, auth_method || 'password',
    encrypt(password) || null, encrypt(private_key) || null, encrypt(passphrase) || null,
    tunnel_enabled || 0, tunnel_local_port || null, tunnel_remote_host || null,
    tunnel_remote_port || null, tunnel_bind_address || '127.0.0.1', sort_order || 0, req.session.userId);

  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { name, host, port, username, auth_method, password, private_key, passphrase,
    tunnel_enabled, tunnel_local_port, tunnel_remote_host, tunnel_remote_port, tunnel_bind_address, sort_order } = req.body;

  if (!name || !host || !username) {
    return res.status(400).json({ error: 'Name, Host und Username erforderlich' });
  }

  const p = parseInt(port, 10);
  if (p && (p < 1 || p > 65535)) {
    return res.status(400).json({ error: 'Port muss zwischen 1 und 65535 liegen' });
  }

  // Ownership check
  const existing = db.prepare('SELECT id FROM connections WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare(`
    UPDATE connections SET name=?, host=?, port=?, username=?, auth_method=?, password=?, private_key=?, passphrase=?,
      tunnel_enabled=?, tunnel_local_port=?, tunnel_remote_host=?, tunnel_remote_port=?, tunnel_bind_address=?,
      sort_order=?, updated_at=datetime('now')
    WHERE id=? AND user_id=?
  `).run(name, host, p || 22, username, auth_method || 'password',
    encrypt(password) || null, encrypt(private_key) || null, encrypt(passphrase) || null,
    tunnel_enabled || 0, tunnel_local_port || null, tunnel_remote_host || null,
    tunnel_remote_port || null, tunnel_bind_address || '127.0.0.1', sort_order || 0, req.params.id, req.session.userId);

  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM connections WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare('DELETE FROM connections WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// --- Per-user credentials for group connections ---

// Get user's saved credentials for a group connection
router.get('/group-credentials/:gcId', (req, res) => {
  const userId = req.session.userId;
  const gcId = req.params.gcId;

  // Verify user is member of the group
  const gc = db.prepare(`
    SELECT gc.* FROM group_connections gc
    JOIN user_groups ug ON ug.group_id = gc.group_id
    WHERE gc.id = ? AND ug.user_id = ?
  `).get(gcId, userId);
  if (!gc) return res.status(404).json({ error: 'Not found' });

  const cred = db.prepare('SELECT * FROM user_group_credentials WHERE user_id = ? AND group_connection_id = ?').get(userId, gcId);
  if (!cred) {
    // Return group connection info so user knows what's pre-filled
    return res.json({
      group_username: gc.username || '',
      group_has_password: !!gc.password,
      group_has_key: !!gc.private_key,
      group_auth_method: gc.auth_method,
      username: '',
      auth_method: gc.auth_method || 'password',
      password: '',
      private_key: '',
      passphrase: '',
      saved: false,
    });
  }

  res.json({
    group_username: gc.username || '',
    group_has_password: !!gc.password,
    group_has_key: !!gc.private_key,
    group_auth_method: gc.auth_method,
    username: cred.username || '',
    auth_method: cred.auth_method,
    password: decrypt(cred.password) || '',
    private_key: decrypt(cred.private_key) || '',
    passphrase: decrypt(cred.passphrase) || '',
    saved: true,
  });
});

// Save user's credentials for a group connection
router.put('/group-credentials/:gcId', (req, res) => {
  const userId = req.session.userId;
  const gcId = req.params.gcId;

  // Verify user is member of the group
  const gc = db.prepare(`
    SELECT gc.* FROM group_connections gc
    JOIN user_groups ug ON ug.group_id = gc.group_id
    WHERE gc.id = ? AND ug.user_id = ?
  `).get(gcId, userId);
  if (!gc) return res.status(404).json({ error: 'Not found' });

  const { username, auth_method, password, private_key, passphrase } = req.body;

  const existing = db.prepare('SELECT id FROM user_group_credentials WHERE user_id = ? AND group_connection_id = ?').get(userId, gcId);
  if (existing) {
    db.prepare(`
      UPDATE user_group_credentials SET username=?, auth_method=?, password=?, private_key=?, passphrase=?, updated_at=datetime('now')
      WHERE user_id=? AND group_connection_id=?
    `).run(username || '', auth_method || 'password',
      encrypt(password) || null, encrypt(private_key) || null, encrypt(passphrase) || null,
      userId, gcId);
  } else {
    db.prepare(`
      INSERT INTO user_group_credentials (user_id, group_connection_id, username, auth_method, password, private_key, passphrase)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, gcId, username || '', auth_method || 'password',
      encrypt(password) || null, encrypt(private_key) || null, encrypt(passphrase) || null);
  }
  res.json({ ok: true });
});

// Delete user's saved credentials for a group connection
router.delete('/group-credentials/:gcId', (req, res) => {
  const userId = req.session.userId;
  db.prepare('DELETE FROM user_group_credentials WHERE user_id = ? AND group_connection_id = ?').run(userId, req.params.gcId);
  res.json({ ok: true });
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const sessionManager = require('../services/sessionManager');

const router = express.Router();

// Create share token for a session
router.post('/sessions/:sessionId/share', (req, res) => {
  const { sessionId } = req.params;
  const { role, label } = req.body;

  if (!role || !['viewer', 'coworker'].includes(role)) {
    return res.status(400).json({ error: 'Rolle muss "viewer" oder "coworker" sein' });
  }

  // Verify session exists and user owns it
  if (!sessionManager.isSessionOwner(sessionId, req.session.userId)) {
    return res.status(403).json({ error: 'Nur der Session-Besitzer kann teilen' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const result = db.prepare(`
    INSERT INTO share_tokens (token, session_id, owner_id, role, label)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, sessionId, req.session.userId, role, label || null);

  res.json({ id: result.lastInsertRowid, token, role });
});

// List shares for a session
router.get('/sessions/:sessionId/shares', (req, res) => {
  const { sessionId } = req.params;

  if (!sessionManager.isSessionOwner(sessionId, req.session.userId)) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }

  const shares = db.prepare('SELECT id, token, role, label, created_at FROM share_tokens WHERE session_id = ? AND owner_id = ?')
    .all(sessionId, req.session.userId);
  res.json(shares);
});

// Upgrade viewer to coworker
router.put('/share-tokens/:tokenId', (req, res) => {
  const { tokenId } = req.params;
  const { role } = req.body;

  if (!role || !['viewer', 'coworker'].includes(role)) {
    return res.status(400).json({ error: 'Rolle muss "viewer" oder "coworker" sein' });
  }

  const token = db.prepare('SELECT * FROM share_tokens WHERE id = ? AND owner_id = ?').get(tokenId, req.session.userId);
  if (!token) return res.status(404).json({ error: 'Token nicht gefunden' });

  db.prepare('UPDATE share_tokens SET role = ? WHERE id = ?').run(role, tokenId);

  // Notify connected shared sockets about role change
  sessionManager.updateSharedRole(token.session_id, token.token, role);

  res.json({ ok: true });
});

// Revoke a share token
router.delete('/share-tokens/:tokenId', (req, res) => {
  const token = db.prepare('SELECT * FROM share_tokens WHERE id = ? AND owner_id = ?').get(req.params.tokenId, req.session.userId);
  if (!token) return res.status(404).json({ error: 'Token nicht gefunden' });

  // Disconnect shared sockets using this token
  sessionManager.revokeSharedToken(token.session_id, token.token);

  db.prepare('DELETE FROM share_tokens WHERE id = ?').run(req.params.tokenId);
  res.json({ ok: true });
});

// Validate a share token (for joining)
router.get('/share/:token', (req, res) => {
  const share = db.prepare('SELECT * FROM share_tokens WHERE token = ?').get(req.params.token);
  if (!share) return res.status(404).json({ error: 'Ungültiger Token' });

  // Check if session still exists
  const session = sessionManager.getSession(share.session_id);
  if (!session) return res.status(404).json({ error: 'Session nicht mehr aktiv' });

  res.json({
    sessionId: share.session_id,
    role: share.role,
    connectionName: session.connectionName,
    host: session.host,
  });
});

module.exports = router;

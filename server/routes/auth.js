const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { authenticateAD } = require('../services/adAuth');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;

// Rate limit: max 10 login attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
});

router.get('/check', (req, res) => {
  const base = { adEnabled: config.ad.enabled };
  if (req.session && req.session.authenticated) {
    return res.json({
      ...base,
      authenticated: true,
      userId: req.session.userId,
      username: req.session.username,
      role: req.session.role,
      authSource: req.session.authSource || 'local',
    });
  }
  res.json({ ...base, authenticated: false });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, method } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  }

  // AD authentication path
  if (config.ad.enabled && method === 'ad') {
    try {
      const adResult = await authenticateAD(username, password);
      if (!adResult.success) {
        return res.status(401).json({ error: adResult.error || 'AD-Anmeldung fehlgeschlagen' });
      }

      // Find or create local user record
      let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user) {
        // Auto-create user on first AD login
        const randomHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
        db.prepare('INSERT INTO users (username, password_hash, role, auth_source) VALUES (?, ?, ?, ?)')
          .run(username, randomHash, adResult.role, 'ad');
        user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      } else {
        // Update role and auth_source on each AD login
        db.prepare('UPDATE users SET role = ?, auth_source = ? WHERE id = ?').run(adResult.role, 'ad', user.id);
      }

      // Sync group memberships
      _syncADGroups(user.id, adResult.groups);

      req.session.authenticated = true;
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = adResult.role;
      req.session.authSource = 'ad';
      return res.json({ ok: true, role: adResult.role });
    } catch (err) {
      return res.status(500).json({ error: 'AD-Authentifizierung fehlgeschlagen: ' + err.message });
    }
  }

  // Local authentication (default)
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  // Constant-time comparison: always run bcrypt even if user not found
  const dummyHash = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';
  const hashToCheck = user ? user.password_hash : dummyHash;
  const valid = bcrypt.compareSync(password, hashToCheck);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
  }

  req.session.authenticated = true;
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.authSource = 'local';
  res.json({ ok: true, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.post('/change-password', (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // AD users cannot change password locally
  if (req.session.authSource === 'ad') {
    return res.status(400).json({ error: 'AD-Benutzer aendern ihr Passwort in der Domaene' });
  }

  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Altes und neues Passwort erforderlich' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// Sync AD groups to local groups and user_groups
function _syncADGroups(userId, adAppGroups) {
  if (!adAppGroups || adAppGroups.length === 0) return;

  // Remove all current group memberships for this user (AD-managed)
  db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(userId);

  for (const groupName of adAppGroups) {
    // Create group if it doesn't exist
    let group = db.prepare('SELECT id FROM groups WHERE name = ?').get(groupName);
    if (!group) {
      const result = db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)').run(groupName, 'Automatisch aus AD erstellt');
      group = { id: result.lastInsertRowid };
    }
    // Add user to group
    const existing = db.prepare('SELECT 1 FROM user_groups WHERE user_id = ? AND group_id = ?').get(userId, group.id);
    if (!existing) {
      db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)').run(userId, group.id);
    }
  }
}

module.exports = router;

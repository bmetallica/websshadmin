const express = require('express');
const db = require('../db');
const sessionManager = require('../services/sessionManager');
const scheduler = require('../services/commandScheduler');

const router = express.Router();

function _serialize(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    label: row.label,
    command: row.command,
    sendEnter: !!row.send_enter,
    markTerminal: !!row.mark_terminal,
    scheduleType: row.schedule_type,
    runAt: row.run_at,
    timeOfDay: row.time_of_day,
    timezone: row.timezone,
    enabled: !!row.enabled,
    status: row.status,
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
    nextRunAt: scheduler.nextRunAt(row),
    createdAt: row.created_at,
  };
}

// Nur der Session-Besitzer darf Zeitpläne sehen und anlegen – ein Coworker
// könnte sonst Befehle im Namen des Besitzers terminieren.
function _requireOwner(req, res, sessionId) {
  if (!sessionManager.isSessionOwner(sessionId, req.session.userId)) {
    res.status(403).json({ error: 'Nur der Session-Besitzer kann Zeitpläne verwalten' });
    return false;
  }
  return true;
}

function _loadOwned(req, res, id) {
  const row = db.prepare('SELECT * FROM scheduled_commands WHERE id = ? AND owner_id = ?')
    .get(id, req.session.userId);
  if (!row) {
    res.status(404).json({ error: 'Zeitplan nicht gefunden' });
    return null;
  }
  return row;
}

function _validate(body) {
  const command = typeof body.command === 'string' ? body.command.trim() : '';
  if (!command) return { error: 'Befehl darf nicht leer sein' };
  if (command.length > scheduler.MAX_COMMAND_LENGTH) {
    return { error: `Befehl ist zu lang (max. ${scheduler.MAX_COMMAND_LENGTH} Zeichen)` };
  }

  const scheduleType = body.scheduleType === 'daily' ? 'daily' : 'once';
  const timezone = scheduler.isValidTimezone(body.timezone) ? body.timezone : 'UTC';

  let runAt = null;
  let timeOfDay = null;

  if (scheduleType === 'once') {
    const ts = Date.parse(body.runAt);
    if (Number.isNaN(ts)) return { error: 'Ungültiger Zeitpunkt' };
    if (ts < Date.now() - 60000) return { error: 'Der Zeitpunkt liegt in der Vergangenheit' };
    runAt = new Date(ts).toISOString();
  } else {
    if (!/^\d{1,2}:\d{2}$/.test(String(body.timeOfDay || ''))) {
      return { error: 'Ungültige Uhrzeit (Format HH:MM)' };
    }
    const [h, m] = String(body.timeOfDay).split(':').map(Number);
    if (h > 23 || m > 59) return { error: 'Ungültige Uhrzeit' };
    timeOfDay = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return {
    label: body.label ? String(body.label).slice(0, 100) : null,
    command,
    sendEnter: body.sendEnter === false ? 0 : 1,
    markTerminal: body.markTerminal === false ? 0 : 1,
    scheduleType,
    runAt,
    timeOfDay,
    timezone,
  };
}

// Zeitpläne einer Session
router.get('/sessions/:sessionId/schedules', (req, res) => {
  const { sessionId } = req.params;
  if (!_requireOwner(req, res, sessionId)) return;

  const rows = db.prepare(
    'SELECT * FROM scheduled_commands WHERE session_id = ? AND owner_id = ? ORDER BY id DESC'
  ).all(sessionId, req.session.userId);

  res.json(rows.map(_serialize));
});

// Zeitplan anlegen
router.post('/sessions/:sessionId/schedules', (req, res) => {
  const { sessionId } = req.params;
  if (!_requireOwner(req, res, sessionId)) return;

  const data = _validate(req.body || {});
  if (data.error) return res.status(400).json({ error: data.error });

  const result = db.prepare(`
    INSERT INTO scheduled_commands
      (session_id, owner_id, label, command, send_enter, mark_terminal,
       schedule_type, run_at, time_of_day, timezone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId, req.session.userId, data.label, data.command, data.sendEnter,
    data.markTerminal, data.scheduleType, data.runAt, data.timeOfDay, data.timezone
  );

  const row = db.prepare('SELECT * FROM scheduled_commands WHERE id = ?').get(result.lastInsertRowid);
  res.json(_serialize(row));
});

// Aktivieren / Deaktivieren
router.put('/schedules/:id', (req, res) => {
  const row = _loadOwned(req, res, req.params.id);
  if (!row) return;

  if (typeof req.body.enabled === 'boolean') {
    const enabled = req.body.enabled ? 1 : 0;
    // Reaktivieren setzt einen erledigten Einmal-Termin wieder auf 'pending'
    const status = enabled && row.schedule_type === 'once' ? 'pending' : row.status;
    db.prepare('UPDATE scheduled_commands SET enabled = ?, status = ?, last_error = NULL WHERE id = ?')
      .run(enabled, status, row.id);
  }

  const updated = db.prepare('SELECT * FROM scheduled_commands WHERE id = ?').get(row.id);
  res.json(_serialize(updated));
});

// Sofort ausführen (Test)
router.post('/schedules/:id/run', (req, res) => {
  const row = _loadOwned(req, res, req.params.id);
  if (!row) return;

  if (!sessionManager.getSession(row.session_id)) {
    return res.status(409).json({ error: 'Session nicht mehr aktiv' });
  }

  scheduler.execute(row, { manual: true });
  const updated = db.prepare('SELECT * FROM scheduled_commands WHERE id = ?').get(row.id);
  res.json(_serialize(updated));
});

// Löschen
router.delete('/schedules/:id', (req, res) => {
  const row = _loadOwned(req, res, req.params.id);
  if (!row) return;
  db.prepare('DELETE FROM scheduled_commands WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;

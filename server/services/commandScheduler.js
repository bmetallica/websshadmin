const db = require('../db');
const sessionManager = require('./sessionManager');

// Ein einziger Ticker für alle Zeitpläne: kein Timer-Drift, kein Aufräumen von
// verwaisten setTimeout-Handles, Genauigkeit ±TICK_MS.
const TICK_MS = 5000;
const MAX_COMMAND_LENGTH = 4000;
const LINE_DELAY_MS = 150;

let _timer = null;

// ---------------------------------------------------------------- Zeitzonen
// Der Container läuft auf UTC, der Nutzer nicht. Deshalb wird die IANA-Zone des
// Browsers gespeichert und hier über Intl ausgewertet – inklusive Sommerzeit.

function _tzOffsetMs(utcMs, timezone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // manche ICU-Versionen liefern 24 statt 00
  const asUtc = Date.UTC(
    parseInt(parts.year, 10), parseInt(parts.month, 10) - 1, parseInt(parts.day, 10),
    hour, parseInt(parts.minute, 10), parseInt(parts.second, 10)
  );
  return asUtc - utcMs;
}

function _localDateParts(utcMs, timezone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
  };
}

// Lokale Wanduhrzeit in einer Zone -> absoluter UTC-Zeitstempel
function _zonedToUtc(year, month, day, hour, minute, timezone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = guess - _tzOffsetMs(guess, timezone);
  // Zweiter Durchlauf fängt DST-Wechsel ab
  ts = guess - _tzOffsetMs(ts, timezone);
  return ts;
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function nextDailyRun(timeOfDay, timezone, fromMs) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeOfDay || ''));
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour > 23 || minute > 59) return null;

  const base = fromMs || Date.now();
  // Heute, morgen, übermorgen prüfen (übermorgen nur als DST-Sicherheitsnetz)
  for (let i = 0; i < 3; i++) {
    const { year, month, day } = _localDateParts(base + i * 86400000, timezone);
    const ts = _zonedToUtc(year, month, day, hour, minute, timezone);
    if (ts > base) return ts;
  }
  return null;
}

// Nächster Ausführungszeitpunkt eines Eintrags als Epoch-ms (oder null)
function nextRunAt(row) {
  if (!row.enabled) return null;
  if (row.schedule_type === 'once') {
    if (row.status !== 'pending' || !row.run_at) return null;
    const ts = Date.parse(row.run_at);
    return Number.isNaN(ts) ? null : ts;
  }
  return nextDailyRun(row.time_of_day, row.timezone, Date.now());
}

// ---------------------------------------------------------------- Ausführung

function _finish(row, status, error, manual) {
  // Ein Testlauf ("jetzt ausführen") verbraucht einen Einmal-Termin nicht
  const enabled = manual
    ? row.enabled
    : (row.schedule_type === 'once' || status === 'error' ? 0 : 1);
  const newStatus = manual && status !== 'error' ? row.status : status;

  db.prepare(`
    UPDATE scheduled_commands
       SET status = ?, last_error = ?, last_run_at = ?, enabled = ?
     WHERE id = ?
  `).run(newStatus, error || null, new Date().toISOString(), enabled, row.id);

  sessionManager.emitToSession(row.session_id, 'schedule:executed', {
    id: row.id,
    sessionId: row.session_id,
    label: row.label,
    status: newStatus,
    error: error || null,
    lastRunAt: new Date().toISOString(),
  });
}

function execute(row, opts) {
  const manual = !!(opts && opts.manual);
  const state = sessionManager.getSession(row.session_id);
  if (!state) {
    _finish(row, 'error', 'Session nicht mehr aktiv', manual);
    return;
  }

  const command = String(row.command);

  if (!row.send_enter) {
    // Ohne Enter: Text so wie er ist ins Terminal legen (z.B. als Vorbereitung)
    sessionManager.writeToSession(row.session_id, command);
  } else {
    const lines = command.split(/\r?\n/);
    lines.forEach((line, i) => {
      setTimeout(() => {
        if (!sessionManager.getSession(row.session_id)) return;
        sessionManager.writeToSession(row.session_id, line + '\r');
      }, i * LINE_DELAY_MS);
    });
  }

  if (row.mark_terminal) {
    const name = row.label ? row.label : command.split(/\r?\n/)[0].slice(0, 40);
    const delay = row.send_enter ? command.split(/\r?\n/).length * LINE_DELAY_MS : 0;
    setTimeout(() => {
      sessionManager.writeMarker(
        row.session_id,
        `\r\n\x1b[36m--- geplanter Befehl ausgeführt: ${name} ---\x1b[0m\r\n`
      );
    }, delay);
  }

  console.log(`[Scheduler] Befehl #${row.id} für Session ${row.session_id} ausgeführt${manual ? ' (manuell)' : ''}`);
  _finish(row, row.schedule_type === 'once' ? 'done' : 'ok', null, manual);
}

function _tick() {
  let rows;
  try {
    rows = db.prepare('SELECT * FROM scheduled_commands WHERE enabled = 1').all();
  } catch (err) {
    console.log(`[Scheduler] DB-Fehler: ${err.message}`);
    return;
  }

  const now = Date.now();
  for (const row of rows) {
    try {
      // Doppelfeuern innerhalb derselben Minute verhindern
      if (row.last_run_at && now - Date.parse(row.last_run_at) < 60000) continue;

      const due = nextRunAt(row);
      if (due !== null && due <= now) execute(row);
    } catch (err) {
      console.log(`[Scheduler] Fehler bei Eintrag #${row.id}: ${err.message}`);
      _finish(row, 'error', err.message);
    }
  }
}

function start() {
  if (_timer) return;
  _timer = setInterval(_tick, TICK_MS);
  if (_timer.unref) _timer.unref();
  console.log('[Scheduler] gestartet');
}

function stop() {
  if (_timer) clearInterval(_timer);
  _timer = null;
}

// Zeitpläne verschwinden mit ihrer Session
function cleanupSession(sessionId) {
  try {
    db.prepare('DELETE FROM scheduled_commands WHERE session_id = ?').run(sessionId);
  } catch { /* DB evtl. schon zu (Shutdown) */ }
}

module.exports = {
  start, stop, execute, cleanupSession,
  nextRunAt, nextDailyRun, isValidTimezone,
  MAX_COMMAND_LENGTH,
};

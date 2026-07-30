// Zeitgesteuerte Befehle pro Session – zweiter Reiter im "Session teilen"-Popup
const Schedules = {
  socket: null,
  currentSessionId: null,
  timezone: 'UTC',

  init(socket) {
    this.socket = socket;
    try {
      this.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch { /* Fallback UTC */ }

    const form = document.getElementById('schedForm');
    if (!form) return;

    const tzHint = document.getElementById('schedTzHint');
    if (tzHint) tzHint.textContent = `Zeitzone: ${this.timezone}`;

    document.getElementById('schedType').addEventListener('change', (e) => {
      const daily = e.target.value === 'daily';
      document.getElementById('schedOnceGroup').style.display = daily ? 'none' : '';
      document.getElementById('schedDailyGroup').style.display = daily ? '' : 'none';
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._create();
    });

    socket.on('schedule:executed', (data) => {
      if (data.sessionId === this.currentSessionId) this.load();
    });
  },

  setSession(sessionId) {
    this.currentSessionId = sessionId;
  },

  async load() {
    const list = document.getElementById('schedList');
    if (!list || !this.currentSessionId) return;
    list.innerHTML = '<div style="color:var(--text-muted)">Laden...</div>';

    try {
      const res = await fetch(`/api/schedules/sessions/${this.currentSessionId}/schedules`);
      if (!res.ok) {
        list.innerHTML = '<div style="color:var(--text-muted)">Fehler beim Laden</div>';
        return;
      }
      this._render(await res.json());
    } catch {
      list.innerHTML = '<div style="color:var(--text-muted)">Verbindungsfehler</div>';
    }
  },

  // Vorbelegung: nächste volle Viertelstunde bzw. 5 Minuten in der Zukunft
  resetForm() {
    const now = new Date(Date.now() + 5 * 60000);
    now.setSeconds(0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const runAt = document.getElementById('schedRunAt');
    const timeOfDay = document.getElementById('schedTimeOfDay');
    if (runAt && !runAt.value) runAt.value = local;
    if (timeOfDay && !timeOfDay.value) timeOfDay.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const err = document.getElementById('schedError');
    if (err) err.style.display = 'none';
  },

  async _create() {
    const errorEl = document.getElementById('schedError');
    errorEl.style.display = 'none';

    const scheduleType = document.getElementById('schedType').value;
    const command = document.getElementById('schedCommand').value;
    const body = {
      label: document.getElementById('schedLabel').value.trim() || null,
      command,
      sendEnter: document.getElementById('schedSendEnter').checked,
      markTerminal: document.getElementById('schedMarkTerminal').checked,
      scheduleType,
      timezone: this.timezone,
    };

    if (scheduleType === 'once') {
      const raw = document.getElementById('schedRunAt').value;
      if (!raw) return this._error('Bitte einen Zeitpunkt wählen');
      // datetime-local ist lokale Wanduhrzeit -> hier in absolute Zeit umrechnen,
      // damit der Server (UTC) nichts raten muss
      const ts = new Date(raw);
      if (Number.isNaN(ts.getTime())) return this._error('Ungültiger Zeitpunkt');
      body.runAt = ts.toISOString();
    } else {
      const time = document.getElementById('schedTimeOfDay').value;
      if (!time) return this._error('Bitte eine Uhrzeit wählen');
      body.timeOfDay = time;
    }

    try {
      const res = await fetch(`/api/schedules/sessions/${this.currentSessionId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return this._error(err.error || 'Fehler beim Anlegen');
      }
      document.getElementById('schedLabel').value = '';
      document.getElementById('schedCommand').value = '';
      await this.load();
    } catch {
      this._error('Verbindungsfehler');
    }
  },

  _error(msg) {
    const errorEl = document.getElementById('schedError');
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  },

  _render(items) {
    const list = document.getElementById('schedList');
    list.innerHTML = '';

    if (!items.length) {
      list.innerHTML = '<div style="color:var(--text-muted)">Keine geplanten Befehle</div>';
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'share-row sched-row';

      const top = document.createElement('div');
      top.className = 'share-row-top';

      const label = document.createElement('span');
      label.className = 'share-label';
      label.textContent = item.label || item.command.split('\n')[0].slice(0, 40);

      const status = document.createElement('span');
      status.className = 'sched-status sched-status-' + this._statusClass(item);
      status.textContent = this._statusLabel(item);

      const btnRun = document.createElement('button');
      btnRun.className = 'share-btn';
      btnRun.innerHTML = '&#9654;';
      btnRun.title = 'Jetzt ausführen';
      btnRun.addEventListener('click', () => this._runNow(item.id));

      const btnToggle = document.createElement('button');
      btnToggle.className = 'share-btn';
      btnToggle.innerHTML = item.enabled ? '&#10073;&#10073;' : '&#8635;';
      btnToggle.title = item.enabled ? 'Pausieren' : 'Wieder aktivieren';
      btnToggle.addEventListener('click', () => this._toggle(item.id, !item.enabled));

      const btnDel = document.createElement('button');
      btnDel.className = 'share-btn share-revoke';
      btnDel.innerHTML = '&times;';
      btnDel.title = 'Löschen';
      btnDel.addEventListener('click', () => this._delete(item.id));

      top.appendChild(label);
      top.appendChild(status);
      top.appendChild(btnRun);
      top.appendChild(btnToggle);
      top.appendChild(btnDel);

      const cmd = document.createElement('div');
      cmd.className = 'sched-cmd';
      cmd.textContent = item.command.replace(/\n/g, ' ⏎ ');

      const meta = document.createElement('div');
      meta.className = 'sched-meta';
      meta.textContent = this._describe(item);

      row.appendChild(top);
      row.appendChild(cmd);
      row.appendChild(meta);
      list.appendChild(row);
    }
  },

  _statusClass(item) {
    if (item.status === 'error') return 'error';
    if (!item.enabled) return 'off';
    if (item.status === 'done') return 'done';
    return 'pending';
  },

  _statusLabel(item) {
    if (item.status === 'error') return 'Fehler';
    if (item.status === 'done') return 'erledigt';
    if (!item.enabled) return 'pausiert';
    return item.scheduleType === 'daily' ? 'täglich' : 'geplant';
  },

  _describe(item) {
    const parts = [];
    if (item.nextRunAt) {
      parts.push('nächste Ausführung: ' + this._fmt(item.nextRunAt));
    } else if (item.scheduleType === 'daily') {
      parts.push('täglich um ' + item.timeOfDay);
    }
    if (item.lastRunAt) parts.push('zuletzt: ' + this._fmt(Date.parse(item.lastRunAt)));
    if (item.lastError) parts.push('Fehler: ' + item.lastError);
    if (!item.sendEnter) parts.push('ohne Enter');
    return parts.join(' · ');
  },

  _fmt(ms) {
    const d = new Date(ms);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return sameDay ? `heute ${time}` : `${d.toLocaleDateString('de-DE')} ${time}`;
  },

  async _runNow(id) {
    try {
      const res = await fetch(`/api/schedules/schedules/${id}/run`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this._error(err.error || 'Ausführung fehlgeschlagen');
      }
      await this.load();
    } catch { /* ignore */ }
  },

  async _toggle(id, enabled) {
    try {
      await fetch(`/api/schedules/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      await this.load();
    } catch { /* ignore */ }
  },

  async _delete(id) {
    try {
      await fetch(`/api/schedules/schedules/${id}`, { method: 'DELETE' });
      await this.load();
    } catch { /* ignore */ }
  },
};

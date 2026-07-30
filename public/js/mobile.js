// Mobile Oberfläche – eigenständige App auf denselben Socket-Events wie die Desktop-UI.
// Wichtig: der globale Name "Terminal" gehört xterm.js, deshalb heißen die
// Terminal-Instanzen hier bewusst anders.
const MobileApp = (() => {
  const params = new URLSearchParams(location.search);
  const shareToken = params.get('share');
  const shareMode = !!shareToken;

  const socketOpts = { path: '/socket.io' };
  if (shareToken) socketOpts.auth = { shareToken };
  const socket = io(socketOpts);

  const terms = new Map();       // sessionId -> { term, fitAddon, container, readOnly }
  const sessions = new Map();    // sessionId -> { name, host }
  const statsCache = {};
  const chatMessages = new Map();

  let activeId = null;
  let fontSize = parseInt(localStorage.getItem('mFontSize') || '13', 10);
  let chatName = localStorage.getItem('chatDisplayName') || null;
  let unreadChat = 0;
  let username = null;

  // ------------------------------------------------------------------ Helpers
  const $ = (id) => document.getElementById(id);

  function toast(msg, ms) {
    const el = $('mToast');
    el.textContent = msg;
    el.style.display = '';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, ms || 2500);
  }

  function openOverlay(id) { $(id).style.display = ''; }
  function closeOverlay(id) { $(id).style.display = 'none'; }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // --------------------------------------------------------------- Viewport
  // Die Bildschirmtastatur verkleinert nur das visuelle Viewport, nicht das Layout-
  // Viewport. Ohne diese Korrektur verschwindet die Eingabezeile unter der Tastatur.
  function syncViewport() {
    const vv = window.visualViewport;
    const app = $('mApp');
    if (!vv) return;
    app.style.height = vv.height + 'px';
    app.style.transform = `translateY(${vv.offsetTop}px)`;
    fitActive();
  }

  // ------------------------------------------------------------- Terminals
  function createTerminal(sessionId) {
    const div = document.createElement('div');
    div.className = 'm-terminal-container';
    div.id = 'mterm-' + sessionId;
    $('mTerminals').appendChild(div);

    const term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize,
      fontFamily: "'JetBrains Mono', monospace",
      lineHeight: 1.15,
      scrollback: 5000,
      theme: Theme.getXtermTheme(),
    });

    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    try {
      term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
    } catch { /* optional */ }

    term.open(div);

    // Android-Tastaturen: Autokorrektur/Großschreibung würden die Eingabe verfälschen
    const helper = div.querySelector('.xterm-helper-textarea');
    if (helper) {
      helper.setAttribute('autocapitalize', 'off');
      helper.setAttribute('autocorrect', 'off');
      helper.setAttribute('autocomplete', 'off');
      helper.setAttribute('spellcheck', 'false');
    }

    // Modifier werden hier angewandt, NICHT in attachCustomKeyEventHandler:
    // Android-Tastaturen liefern für normale Zeichen kein auswertbares keydown
    // (key = "Unidentified", keyCode 229) – der Text kommt erst über das
    // input-Event des Textfeldes und damit in onData an.
    term.onData((data) => {
      const entry = terms.get(sessionId);
      if (entry && entry.readOnly) return;
      socket.emit('terminal:data', { sessionId, data: applyPendingMods(data) });
    });
    term.onResize(({ cols, rows }) => {
      socket.emit('terminal:resize', { sessionId, cols, rows });
    });

    term.attachCustomKeyEventHandler(() => {
      const entry = terms.get(sessionId);
      return !(entry && entry.readOnly);
    });

    terms.set(sessionId, { term, fitAddon, container: div, readOnly: false });
    setTimeout(() => fit(sessionId), 60);
    return term;
  }

  // Wendet ein wartendes Strg/Alt aus der Tastenleiste auf getippten Text an.
  // Nur Einzelzeichen: Escape-Sequenzen (Pfeile o.ä.) bleiben unangetastet.
  function applyPendingMods(data) {
    if (!MobileKeys.hasMods() || data.length !== 1) return data;
    const out = MobileKeys.applyMods(data);
    MobileKeys.consume();
    return out;
  }

  function focusTerminal() {
    if (!activeId) return;
    const entry = terms.get(activeId);
    if (entry) entry.term.focus();
  }

  function fit(sessionId) {
    const entry = terms.get(sessionId);
    if (!entry) return;
    try { entry.fitAddon.fit(); } catch { /* ignore */ }
  }

  function fitActive() {
    if (activeId) setTimeout(() => fit(activeId), 30);
  }

  function setFontSize(size) {
    fontSize = Math.max(8, Math.min(22, size));
    localStorage.setItem('mFontSize', String(fontSize));
    for (const [, entry] of terms) entry.term.options.fontSize = fontSize;
    fitActive();
    toast(`Schriftgröße ${fontSize}`);
  }

  function activate(sessionId) {
    activeId = sessionId;
    for (const [id, entry] of terms) {
      entry.container.classList.toggle('active', id === sessionId);
    }
    const info = sessions.get(sessionId);
    $('mTitleText').textContent = info ? (info.name || info.host) : 'Keine Session';
    $('mNoSession').style.display = sessionId ? 'none' : '';
    $('mKeys').style.display = sessionId ? '' : 'none';
    renderStats(statsCache[sessionId]);
    if (sessionId) {
      fitActive();
      terms.get(sessionId).term.focus();
    }
  }

  function addSession(sessionId, name, host) {
    sessions.set(sessionId, { name, host });
    activate(sessionId);
  }

  function removeSession(sessionId) {
    const entry = terms.get(sessionId);
    if (entry) {
      entry.term.dispose();
      entry.container.remove();
      terms.delete(sessionId);
    }
    sessions.delete(sessionId);
    delete statsCache[sessionId];
    if (activeId === sessionId) {
      const remaining = Array.from(sessions.keys());
      activate(remaining.length ? remaining[remaining.length - 1] : null);
    }
  }

  function sendData(data) {
    if (!activeId) return;
    const entry = terms.get(activeId);
    if (entry && entry.readOnly) { toast('Nur-Lese-Zugriff'); return; }
    socket.emit('terminal:data', { sessionId: activeId, data });
  }

  // ------------------------------------------------------------------ Stats
  function renderStats(data) {
    const info = activeId ? sessions.get(activeId) : null;
    $('mStatHost').textContent = info ? info.host : '';
    if (!data) {
      $('mStatCpu').textContent = 'CPU --';
      $('mStatRam').textContent = 'RAM --';
      $('mStatDisk').textContent = 'DISK --';
      return;
    }
    $('mStatCpu').textContent = `CPU ${data.cpu}%`;
    $('mStatRam').textContent = `RAM ${data.ram.percent}%`;
    $('mStatDisk').textContent = `DISK ${data.disk.percent}%`;
    const color = (p) => (p > 80 ? 'var(--accent-pink)' : p > 50 ? '#ffcc00' : 'var(--accent)');
    $('mStatCpu').style.color = color(data.cpu);
    $('mStatRam').style.color = color(data.ram.percent);
    $('mStatDisk').style.color = color(data.disk.percent);
  }

  // ------------------------------------------------------------ Verbindungen
  let connections = [];

  async function loadConnections() {
    try {
      const res = await fetch('/api/connections');
      connections = await res.json();
      renderConnections();
    } catch {
      connections = [];
    }
  }

  function renderConnections() {
    const list = $('mConnList');
    const filter = ($('mConnSearch').value || '').toLowerCase();
    list.innerHTML = '';

    const matches = connections.filter(c =>
      !filter ||
      c.name.toLowerCase().includes(filter) ||
      c.host.toLowerCase().includes(filter)
    );

    const own = matches.filter(c => c.source !== 'group');
    const groups = {};
    for (const c of matches.filter(c => c.source === 'group')) {
      const key = c.group_name || 'Gruppe';
      (groups[key] = groups[key] || []).push(c);
    }

    const section = (title) => {
      const el = document.createElement('div');
      el.className = 'm-section';
      el.textContent = title;
      list.appendChild(el);
    };

    if (own.length) {
      if (Object.keys(groups).length) section('Eigene Verbindungen');
      own.forEach(c => list.appendChild(connItem(c)));
    }
    for (const [name, conns] of Object.entries(groups)) {
      section(name);
      conns.forEach(c => list.appendChild(connItem(c)));
    }
    if (!matches.length) {
      list.innerHTML = '<div class="m-hint" style="padding:12px">Keine Verbindungen gefunden</div>';
    }
  }

  function connItem(conn) {
    const btn = document.createElement('button');
    btn.className = 'm-item';
    btn.innerHTML = `
      <span>${conn.source === 'group' ? '\u{1F465}' : '\u{1F5A5}'}</span>
      <span class="m-item-main">
        <span class="m-item-name">${esc(conn.name)}</span>
        <span class="m-item-sub">${esc(conn.username || '')}@${esc(conn.host)}:${esc(conn.port)}</span>
      </span>`;
    btn.addEventListener('click', () => {
      closeOverlay('mDrawerOverlay');
      connect(conn);
    });
    return btn;
  }

  function connect(conn) {
    toast(`Verbinde mit ${conn.name}…`);
    if (conn.source === 'group') {
      if (conn.needs_credentials && !conn.has_user_credentials) {
        showCredPrompt({
          connectionId: conn.id,
          connectionName: conn.name,
          host: conn.host,
          port: conn.port,
          needsUsername: !conn.username && !conn.user_username,
        });
        return;
      }
      socket.emit('session:create', { connectionId: conn.id, source: 'group' });
    } else {
      socket.emit('session:create', { connectionId: conn.id, source: conn.source || 'own' });
    }
  }

  function showCredPrompt(data) {
    $('mCredConnId').value = data.connectionId;
    $('mCredInfo').textContent = `${data.connectionName} (${data.host}:${data.port})`;
    $('mCredUsername').value = '';
    $('mCredPassword').value = '';
    $('mCredPrivateKey').value = '';
    $('mCredPassphrase').value = '';
    $('mCredAuthMethod').value = 'password';
    $('mCredUsername').style.display = data.needsUsername === false ? 'none' : '';
    $('mCredError').style.display = 'none';
    updateCredFields();
    openOverlay('mCredOverlay');
  }

  function updateCredFields() {
    const isKey = $('mCredAuthMethod').value === 'key';
    $('mCredPassword').style.display = isKey ? 'none' : '';
    $('mCredPrivateKey').style.display = isKey ? '' : 'none';
    $('mCredPassphrase').style.display = isKey ? '' : 'none';
  }

  // --------------------------------------------------------------- Sessions
  function renderTabs() {
    const list = $('mTabsList');
    list.innerHTML = '';

    if (!sessions.size) {
      list.innerHTML = '<div class="m-hint" style="padding:12px">Keine aktiven Sessions</div>';
      return;
    }

    for (const [id, info] of sessions) {
      const row = document.createElement('div');
      row.className = 'm-item' + (id === activeId ? ' active' : '');

      const main = document.createElement('button');
      main.className = 'm-item-main';
      main.style.cssText = 'background:none;border:none;text-align:left';
      main.innerHTML = `
        <span class="m-item-name">${esc(info.name || info.host)}</span>
        <span class="m-item-sub">${esc(info.host)}</span>`;
      main.addEventListener('click', () => {
        activate(id);
        closeOverlay('mTabsOverlay');
      });

      const kill = document.createElement('button');
      kill.className = 'm-item-btn danger';
      kill.innerHTML = '&times;';
      kill.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Session trennen?')) socket.emit('session:kill', { sessionId: id });
      });

      row.appendChild(main);
      if (!shareMode) row.appendChild(kill);
      list.appendChild(row);
    }
  }

  // ------------------------------------------------------- Teilen & Zeitpläne
  async function loadShares() {
    const list = $('mShareList');
    if (!activeId) { list.innerHTML = '<div class="m-hint" style="padding:12px">Keine Session</div>'; return; }
    list.innerHTML = '<div class="m-hint" style="padding:12px">Laden…</div>';

    try {
      const res = await fetch(`/api/sharing/sessions/${activeId}/shares`);
      if (!res.ok) { list.innerHTML = '<div class="m-hint" style="padding:12px">Fehler beim Laden</div>'; return; }
      const shares = await res.json();
      list.innerHTML = '';

      if (!shares.length) {
        list.innerHTML = '<div class="m-hint" style="padding:12px">Keine aktiven Freigaben</div>';
        return;
      }

      for (const share of shares) {
        const row = document.createElement('div');
        row.className = 'm-item m-row-col';
        const url = `${location.origin}/app?share=${share.token}`;

        const line = document.createElement('div');
        line.className = 'm-row-line';
        line.innerHTML = `
          <span class="m-item-name" style="flex:1">${esc(share.label || 'Freigabe')}</span>
          <span class="m-chip m-chip-${share.role}">${esc(share.role)}</span>`;

        const copy = document.createElement('button');
        copy.className = 'm-item-btn';
        copy.innerHTML = '&#128203;';
        copy.title = 'Link kopieren';
        copy.addEventListener('click', () => copyText(url));

        const del = document.createElement('button');
        del.className = 'm-item-btn danger';
        del.innerHTML = '&times;';
        del.addEventListener('click', async () => {
          await fetch(`/api/sharing/share-tokens/${share.id}`, { method: 'DELETE' });
          loadShares();
        });

        line.appendChild(copy);
        line.appendChild(del);

        const urlField = document.createElement('input');
        urlField.className = 'm-url';
        urlField.value = url;
        urlField.readOnly = true;
        urlField.addEventListener('click', () => urlField.select());

        row.appendChild(line);
        row.appendChild(urlField);
        list.appendChild(row);
      }
    } catch {
      list.innerHTML = '<div class="m-hint" style="padding:12px">Verbindungsfehler</div>';
    }
  }

  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => toast('Link kopiert'),
        () => toast('Kopieren nicht möglich')
      );
    } else {
      toast('Kopieren nicht möglich');
    }
  }

  const timezone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  })();

  async function loadSchedules() {
    const list = $('mSchedList');
    if (!activeId) { list.innerHTML = '<div class="m-hint" style="padding:12px">Keine Session</div>'; return; }
    list.innerHTML = '<div class="m-hint" style="padding:12px">Laden…</div>';

    try {
      const res = await fetch(`/api/schedules/sessions/${activeId}/schedules`);
      if (!res.ok) { list.innerHTML = '<div class="m-hint" style="padding:12px">Fehler beim Laden</div>'; return; }
      const items = await res.json();
      list.innerHTML = '';

      if (!items.length) {
        list.innerHTML = '<div class="m-hint" style="padding:12px">Keine geplanten Befehle</div>';
        return;
      }

      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'm-item m-row-col';

        const line = document.createElement('div');
        line.className = 'm-row-line';
        const chip = item.status === 'error' ? 'error'
          : !item.enabled ? 'off'
          : item.status === 'done' ? 'done' : 'pending';
        line.innerHTML = `
          <span class="m-item-name" style="flex:1">${esc(item.label || item.command.split('\n')[0].slice(0, 30))}</span>
          <span class="m-chip m-chip-${chip}">${esc(scheduleLabel(item))}</span>`;

        const run = document.createElement('button');
        run.className = 'm-item-btn';
        run.innerHTML = '&#9654;';
        run.addEventListener('click', async () => {
          await fetch(`/api/schedules/schedules/${item.id}/run`, { method: 'POST' });
          loadSchedules();
        });

        const toggle = document.createElement('button');
        toggle.className = 'm-item-btn';
        toggle.innerHTML = item.enabled ? '&#10073;&#10073;' : '&#8635;';
        toggle.addEventListener('click', async () => {
          await fetch(`/api/schedules/schedules/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !item.enabled }),
          });
          loadSchedules();
        });

        const del = document.createElement('button');
        del.className = 'm-item-btn danger';
        del.innerHTML = '&times;';
        del.addEventListener('click', async () => {
          await fetch(`/api/schedules/schedules/${item.id}`, { method: 'DELETE' });
          loadSchedules();
        });

        line.appendChild(run);
        line.appendChild(toggle);
        line.appendChild(del);

        const cmd = document.createElement('div');
        cmd.className = 'm-sub';
        cmd.textContent = item.command.replace(/\n/g, ' ⏎ ');

        const meta = document.createElement('div');
        meta.className = 'm-sub';
        meta.textContent = scheduleMeta(item);

        row.appendChild(line);
        row.appendChild(cmd);
        row.appendChild(meta);
        list.appendChild(row);
      }
    } catch {
      list.innerHTML = '<div class="m-hint" style="padding:12px">Verbindungsfehler</div>';
    }
  }

  function scheduleLabel(item) {
    if (item.status === 'error') return 'Fehler';
    if (item.status === 'done') return 'erledigt';
    if (!item.enabled) return 'pausiert';
    return item.scheduleType === 'daily' ? 'täglich' : 'geplant';
  }

  function scheduleMeta(item) {
    const parts = [];
    if (item.nextRunAt) {
      const d = new Date(item.nextRunAt);
      const same = d.toDateString() === new Date().toDateString();
      const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      parts.push('nächste: ' + (same ? `heute ${time}` : `${d.toLocaleDateString('de-DE')} ${time}`));
    }
    if (item.lastError) parts.push('Fehler: ' + item.lastError);
    return parts.join(' · ');
  }

  async function createSchedule(e) {
    e.preventDefault();
    const errorEl = $('mSchedError');
    errorEl.style.display = 'none';

    const type = $('mSchedType').value;
    const body = {
      label: $('mSchedLabel').value.trim() || null,
      command: $('mSchedCommand').value,
      sendEnter: $('mSchedSendEnter').checked,
      markTerminal: $('mSchedMark').checked,
      scheduleType: type,
      timezone,
    };

    if (type === 'once') {
      const raw = $('mSchedRunAt').value;
      if (!raw) { errorEl.textContent = 'Bitte Zeitpunkt wählen'; errorEl.style.display = ''; return; }
      body.runAt = new Date(raw).toISOString();
    } else {
      const time = $('mSchedTimeOfDay').value;
      if (!time) { errorEl.textContent = 'Bitte Uhrzeit wählen'; errorEl.style.display = ''; return; }
      body.timeOfDay = time;
    }

    try {
      const res = await fetch(`/api/schedules/sessions/${activeId}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        errorEl.textContent = err.error || 'Fehler beim Anlegen';
        errorEl.style.display = '';
        return;
      }
      $('mSchedLabel').value = '';
      $('mSchedCommand').value = '';
      toast('Zeitplan angelegt');
      loadSchedules();
    } catch {
      errorEl.textContent = 'Verbindungsfehler';
      errorEl.style.display = '';
    }
  }

  function prefillSchedule() {
    const now = new Date(Date.now() + 5 * 60000);
    now.setSeconds(0, 0);
    const pad = (n) => String(n).padStart(2, '0');
    if (!$('mSchedRunAt').value) {
      $('mSchedRunAt').value =
        `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
    if (!$('mSchedTimeOfDay').value) {
      $('mSchedTimeOfDay').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
  }

  // ------------------------------------------------------------------- Chat
  function renderChat() {
    const box = $('mChatMessages');
    box.innerHTML = '';
    const msgs = chatMessages.get(activeId) || [];
    for (const msg of msgs) appendChat(msg, false);
    box.scrollTop = box.scrollHeight;
  }

  function appendChat(msg, scroll) {
    const box = $('mChatMessages');
    const own = msg.from === (chatName || username);
    const el = document.createElement('div');
    el.className = 'm-chat-msg' + (own ? ' own' : '');
    const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
    el.innerHTML = `<span class="m-chat-meta">${esc(msg.from)} · ${esc(time)}</span>`;
    const body = document.createElement('div');
    body.textContent = msg.message;
    el.appendChild(body);
    box.appendChild(el);
    if (scroll !== false) box.scrollTop = box.scrollHeight;
  }

  function sendChat() {
    const input = $('mChatInput');
    const text = input.value.trim();
    if (!text || !activeId) return;
    if (!chatName) {
      const name = prompt('Dein Name im Chat:', username || '');
      if (!name) return;
      chatName = name.trim();
      localStorage.setItem('chatDisplayName', chatName);
    }
    socket.emit('chat:message', { sessionId: activeId, from: chatName || username || 'Anonym', message: text });
    input.value = '';
  }

  function setChatBadge() {
    const badge = $('mChatBadge');
    badge.textContent = unreadChat;
    badge.style.display = unreadChat > 0 ? '' : 'none';
  }

  // --------------------------------------------------------------- Socket IO
  socket.on('session:created', ({ sessionId, connectionName, host }) => {
    createTerminal(sessionId);
    addSession(sessionId, connectionName, host);
    socket.emit('session:attach', { sessionId });
  });

  socket.on('session:list', (list) => {
    for (const s of list) {
      if (!sessions.has(s.id)) {
        createTerminal(s.id);
        addSession(s.id, s.connectionName, s.host);
        socket.emit('session:attach', { sessionId: s.id });
      }
    }
  });

  socket.on('session:joined-shared', ({ sessionId, role, connectionName, host, scrollback }) => {
    createTerminal(sessionId);
    addSession(sessionId, connectionName + ' [' + role + ']', host);
    if (role === 'viewer') terms.get(sessionId).readOnly = true;
    if (scrollback) setTimeout(() => terms.get(sessionId).term.write(scrollback), 100);
  });

  socket.on('share:role-updated', ({ sessionId, role }) => {
    const entry = terms.get(sessionId);
    if (entry) entry.readOnly = role !== 'coworker';
    toast(`Rolle geändert: ${role}`);
  });

  socket.on('share:revoked', ({ sessionId }) => {
    removeSession(sessionId);
    toast('Freigabe widerrufen');
  });

  socket.on('terminal:data', ({ sessionId, data }) => {
    const entry = terms.get(sessionId);
    if (entry) entry.term.write(data);
  });

  socket.on('terminal:replay', ({ sessionId, data }) => {
    const entry = terms.get(sessionId);
    if (entry) entry.term.write(data);
  });

  socket.on('session:ended', ({ sessionId }) => {
    removeSession(sessionId);
    toast('Session beendet');
  });

  socket.on('session:error', ({ error }) => toast('Fehler: ' + error, 4000));

  socket.on('session:needs-credentials', (data) => showCredPrompt(data));

  socket.on('session:reconnecting', ({ sessionId, attempt, maxAttempts }) => {
    toast(`Verbindung verloren – Versuch ${attempt}/${maxAttempts}`, 4000);
  });
  socket.on('session:reconnected', () => toast('Verbindung wiederhergestellt'));

  socket.on('stats:update', (data) => {
    statsCache[data.sessionId] = data;
    if (data.sessionId === activeId) renderStats(data);
  });

  socket.on('schedule:executed', ({ sessionId, label, status, error }) => {
    if (sessionId !== activeId) return;
    toast(status === 'error'
      ? `Zeitplan fehlgeschlagen: ${error}`
      : `Zeitplan ausgeführt: ${label || ''}`);
    if ($('mShareOverlay').style.display !== 'none') loadSchedules();
  });

  socket.on('chat:message', (msg) => {
    const sid = msg.sessionId || activeId;
    if (!chatMessages.has(sid)) chatMessages.set(sid, []);
    chatMessages.get(sid).push(msg);
    if ($('mChatOverlay').style.display !== 'none' && sid === activeId) {
      appendChat(msg);
    } else {
      unreadChat++;
      setChatBadge();
    }
  });

  socket.on('chat:history', ({ messages }) => {
    if (!activeId) return;
    chatMessages.set(activeId, messages || []);
    if ($('mChatOverlay').style.display !== 'none') renderChat();
  });

  socket.on('connect', () => {
    if (shareMode) {
      socket.emit('session:join-shared', { token: shareToken });
    } else {
      socket.emit('session:list');
      if (params.get('share')) {
        socket.emit('session:join-shared', { token: params.get('share') });
        history.replaceState({}, '', '/m');
      }
    }
  });

  socket.on('disconnect', () => toast('Verbindung zum Server verloren'));

  // ------------------------------------------------------------------- Init
  function init() {
    Theme.init();
    MobileKeys.init(sendData, focusTerminal);
    MobileSftp.init(socket);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
    }
    window.addEventListener('orientationchange', () => setTimeout(syncViewport, 250));
    syncViewport();

    // Kopfzeile
    $('mBtnMenu').addEventListener('click', () => {
      if (shareMode) { toast('Im Freigabe-Modus nicht verfügbar'); return; }
      openOverlay('mDrawerOverlay');
      loadConnections();
    });
    $('mTitle').addEventListener('click', () => { renderTabs(); openOverlay('mTabsOverlay'); });
    $('mBtnKeyboard').addEventListener('click', focusTerminal);
    $('mBtnMore').addEventListener('click', () => openOverlay('mMenuOverlay'));

    // Overlays schließen
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
    });
    document.querySelectorAll('.m-overlay').forEach(ov => {
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.style.display = 'none'; });
    });

    $('mConnSearch').addEventListener('input', renderConnections);

    // Menü
    $('mMenuSftp').addEventListener('click', () => {
      if (!activeId) { toast('Keine aktive Session'); return; }
      closeOverlay('mMenuOverlay');
      openOverlay('mSftpOverlay');
      MobileSftp.open(activeId);
    });

    $('mMenuShare').addEventListener('click', () => {
      if (!activeId) { toast('Keine aktive Session'); return; }
      if (shareMode) { toast('Nur der Session-Besitzer kann teilen'); return; }
      closeOverlay('mMenuOverlay');
      openOverlay('mShareOverlay');
      prefillSchedule();
      loadShares();
      loadSchedules();
    });

    $('mMenuChat').addEventListener('click', () => {
      if (!activeId) { toast('Keine aktive Session'); return; }
      closeOverlay('mMenuOverlay');
      openOverlay('mChatOverlay');
      unreadChat = 0;
      setChatBadge();
      renderChat();
    });

    $('mMenuFontMinus').addEventListener('click', () => setFontSize(fontSize - 1));
    $('mMenuFontPlus').addEventListener('click', () => setFontSize(fontSize + 1));

    $('mMenuTheme').addEventListener('click', () => {
      const ids = Object.keys(Theme.themes);
      const next = ids[(ids.indexOf(Theme.current) + 1) % ids.length];
      Theme.apply(next);
      for (const [, entry] of terms) entry.term.options.theme = Theme.getXtermTheme();
      toast('Theme: ' + (Theme.themes[next].label || next));
    });

    $('mMenuDisconnect').addEventListener('click', () => {
      if (!activeId) { toast('Keine aktive Session'); return; }
      if (confirm('Session wirklich trennen?')) {
        socket.emit('session:kill', { sessionId: activeId });
        closeOverlay('mMenuOverlay');
      }
    });

    $('mMenuDesktop').addEventListener('click', () => {
      document.cookie = 'viewMode=desktop;path=/;max-age=' + 60 * 60 * 24 * 365 + ';samesite=lax';
      location.href = '/app';
    });

    $('mMenuLogout').addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* egal */ }
      location.href = '/';
    });

    // Teilen & Zeitpläne
    document.querySelectorAll('.m-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.m-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.m-pane').forEach(p => {
          p.style.display = p.id === tab.dataset.pane ? '' : 'none';
        });
      });
    });
    $('mBtnCreateShare').addEventListener('click', async () => {
      try {
        await fetch(`/api/sharing/sessions/${activeId}/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: $('mShareRole').value,
            label: $('mShareLabel').value.trim() || null,
          }),
        });
        $('mShareLabel').value = '';
        loadShares();
      } catch { toast('Fehler beim Erstellen'); }
    });
    $('mSchedType').addEventListener('change', (e) => {
      const daily = e.target.value === 'daily';
      $('mSchedRunAt').style.display = daily ? 'none' : '';
      $('mSchedTimeOfDay').style.display = daily ? '' : 'none';
    });
    $('mSchedForm').addEventListener('submit', createSchedule);

    // Chat
    $('mChatSend').addEventListener('click', sendChat);
    $('mChatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
    });

    // Login-Daten
    $('mCredAuthMethod').addEventListener('change', updateCredFields);
    $('mCredForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = $('mCredError');
      errorEl.style.display = 'none';

      const connId = parseInt($('mCredConnId').value, 10);
      const authMethod = $('mCredAuthMethod').value;
      const credentials = { username: $('mCredUsername').value.trim(), auth_method: authMethod };

      if (!credentials.username) {
        errorEl.textContent = 'Username erforderlich';
        errorEl.style.display = '';
        return;
      }
      if (authMethod === 'password') {
        credentials.password = $('mCredPassword').value;
        if (!credentials.password) {
          errorEl.textContent = 'Passwort erforderlich';
          errorEl.style.display = '';
          return;
        }
      } else {
        credentials.private_key = $('mCredPrivateKey').value;
        credentials.passphrase = $('mCredPassphrase').value;
        if (!credentials.private_key) {
          errorEl.textContent = 'Private Key erforderlich';
          errorEl.style.display = '';
          return;
        }
      }

      if ($('mCredSave').checked) {
        try {
          await fetch(`/api/connections/group-credentials/${connId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
          });
        } catch { /* trotzdem verbinden */ }
      }

      closeOverlay('mCredOverlay');
      socket.emit('session:create', { connectionId: connId, source: 'group', credentials });
    });

    // Benutzerinfo + Verbindungen laden
    if (!shareMode) {
      fetch('/api/auth/check')
        .then(r => r.json())
        .then(info => {
          if (info.authenticated) {
            username = info.username;
            if (!chatName) chatName = info.username;
          }
        })
        .catch(() => {});
      loadConnections();
    } else {
      $('mMenuShare').style.display = 'none';
      $('mMenuDesktop').style.display = 'none';
      $('mMenuLogout').style.display = 'none';
      $('mMenuDisconnect').style.display = 'none';
    }

    // Service Worker nur für die Installierbarkeit (kein Offline-Cache)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* egal */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { fitActive, sendData, toast, applyPendingMods, focusTerminal };
})();

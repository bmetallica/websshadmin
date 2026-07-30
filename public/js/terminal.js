const Terminal = {
  terminals: new Map(), // sessionId -> { term, fitAddon, container, readOnly }
  socket: null,

  // Alt+<Buchstabe> als Ersatz für Strg+<Buchstabe> (siehe _altToControl)
  altAsCtrl: localStorage.getItem('altAsCtrl') !== '0',

  init(socket) {
    this.socket = socket;
    this.container = document.getElementById('terminals');

    // Strg+W, Strg+T, Strg+N sind in ALLEN gängigen Browsern reserviert:
    // Sie erreichen die Seite entweder nicht oder preventDefault() bleibt wirkungslos.
    // Deshalb drei browserunabhängige Maßnahmen:
    //   1. beforeunload-Schutz, damit ein versehentliches Strg+W die Session nicht killt
    //   2. Button "Strg+W", der \x17 ans Terminal schickt
    //   3. Alt+<Buchstabe> als frei verfügbares Ersatzkürzel (Alt+W => Strg+W)
    window.addEventListener('beforeunload', (e) => {
      if (this._intentionalNavigation) return;
      if (this.terminals.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    const ctrlWBtn = document.createElement('button');
    ctrlWBtn.id = 'btnSendCtrlW';
    ctrlWBtn.textContent = 'Strg+W';
    ctrlWBtn.dataset.tooltip = 'Ctrl+W ans Terminal senden (oder Alt+W)';
    ctrlWBtn.addEventListener('click', () => this.sendCtrlKey('w'));
    this.container.appendChild(ctrlWBtn);

    // Kürzel, die sich tatsächlich abfangen lassen, im Terminal blockieren.
    // w/t/n stehen bewusst nicht in der Liste – dort ist nichts zu holen.
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
      const meta = e.metaKey && !e.ctrlKey && !e.altKey;
      const ctrlBlocked = ['r', 'l', 's', 'p', 'f', 'd', 'g', 'u', 'i'];
      const metaBlocked = ['r'];
      const needsCheck = (ctrl && ctrlBlocked.includes(e.key.toLowerCase()))
                      || (meta && metaBlocked.includes(e.key.toLowerCase()));
      if (!needsCheck) return;
      const path = e.composedPath ? e.composedPath() : [];
      const inTerminal = path.some(el => el === this.container || (el.id && el.id.startsWith('term-')));
      if (inTerminal) e.preventDefault();
    }, { capture: true });

    window.addEventListener('resize', () => {
      const active = Tabs.getActiveSessionId();
      if (active && this.terminals.has(active)) {
        this._fit(active);
      }
    });
  },

  // Schickt Strg+<Buchstabe> als Control-Code an die aktive Session
  sendCtrlKey(letter) {
    const sessionId = Tabs.getActiveSessionId();
    if (!sessionId || !this.socket) return;
    const code = this._letterToControl(letter);
    if (code) this.socket.emit('terminal:data', { sessionId, data: code });
  },

  setAltAsCtrl(enabled) {
    this.altAsCtrl = !!enabled;
    localStorage.setItem('altAsCtrl', enabled ? '1' : '0');
  },

  _letterToControl(letter) {
    const upper = String(letter).toUpperCase();
    if (!/^[A-Z]$/.test(upper)) return null;
    return String.fromCharCode(upper.charCodeAt(0) - 64);
  },

  // Ein einziger Key-Handler pro Terminal: berücksichtigt Read-only UND Alt-Ersatzkürzel.
  // (Früher überschrieb setReadOnlySession() den Handler und hätte das Alt-Mapping gekillt.)
  _makeKeyHandler(sessionId) {
    return (e) => {
      const entry = this.terminals.get(sessionId);
      if (this._readOnly || (entry && entry.readOnly)) return false;

      // AltGr ist Strg+Alt – das muss durchgereicht werden, sonst gehen @ | ~ verloren
      if (this.altAsCtrl && e.type === 'keydown' && e.altKey && !e.ctrlKey && !e.metaKey) {
        const match = /^Key([A-Z])$/.exec(e.code || '');
        if (match) {
          const code = this._letterToControl(match[1]);
          if (code) {
            e.preventDefault();
            this.socket.emit('terminal:data', { sessionId, data: code });
            return false;
          }
        }
      }
      return true;
    };
  },

  createTerminal(sessionId) {
    const div = document.createElement('div');
    div.className = 'terminal-container';
    div.id = 'term-' + sessionId;
    this.container.appendChild(div);

    const term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: Theme.getXtermTheme(),
    });

    const fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    try {
      const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
      term.loadAddon(webLinksAddon);
    } catch (e) { /* optional */ }

    term.open(div);

    term.onData((data) => {
      this.socket.emit('terminal:data', { sessionId, data });
    });

    term.onResize(({ cols, rows }) => {
      this.socket.emit('terminal:resize', { sessionId, cols, rows });
    });

    this.terminals.set(sessionId, { term, fitAddon, container: div, readOnly: !!this._readOnly });
    term.attachCustomKeyEventHandler(this._makeKeyHandler(sessionId));

    // Fit after a small delay to ensure DOM is ready
    setTimeout(() => this._fit(sessionId), 50);

    return term;
  },

  destroyTerminal(sessionId) {
    const entry = this.terminals.get(sessionId);
    if (entry) {
      entry.term.dispose();
      entry.container.remove();
      this.terminals.delete(sessionId);
    }
  },

  writeToTerminal(sessionId, data) {
    const entry = this.terminals.get(sessionId);
    if (entry) entry.term.write(data);
  },

  showSession(sessionId) {
    for (const [id, entry] of this.terminals) {
      entry.container.classList.toggle('active', id === sessionId);
    }
    if (sessionId) {
      setTimeout(() => this._fit(sessionId), 50);
    }
  },

  _fit(sessionId) {
    const entry = this.terminals.get(sessionId);
    if (entry) {
      try {
        entry.fitAddon.fit();
      } catch (e) { /* ignore */ }
    }
  },

  // Viewer mode: disable keyboard input on all terminals (auch künftige)
  setReadOnly(readOnly) {
    this._readOnly = readOnly;
    for (const [, entry] of this.terminals) {
      entry.readOnly = readOnly;
    }
  },

  // Per-session read-only (for shared viewer sessions)
  setReadOnlySession(sessionId, readOnly) {
    const entry = this.terminals.get(sessionId);
    if (!entry) return;
    entry.readOnly = readOnly;
  }
};

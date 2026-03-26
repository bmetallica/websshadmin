const Terminal = {
  terminals: new Map(), // sessionId -> { term, fitAddon, container }
  socket: null,

  init(socket) {
    this.socket = socket;
    this.container = document.getElementById('terminals');

    window.addEventListener('resize', () => {
      const active = Tabs.getActiveSessionId();
      if (active && this.terminals.has(active)) {
        this._fit(active);
      }
    });
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

    this.terminals.set(sessionId, { term, fitAddon, container: div });

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

  // Viewer mode: disable keyboard input on all terminals
  setReadOnly(readOnly) {
    this._readOnly = readOnly;
    if (readOnly) {
      // Patch onData for future terminals
      const origCreate = this.createTerminal.bind(this);
      this.createTerminal = (sessionId) => {
        const term = origCreate(sessionId);
        term.attachCustomKeyEventHandler(() => false);
        return term;
      };
      // Disable existing terminals
      for (const [, entry] of this.terminals) {
        entry.term.attachCustomKeyEventHandler(() => false);
      }
    }
  },

  // Per-session read-only (for shared viewer sessions)
  setReadOnlySession(sessionId, readOnly) {
    const entry = this.terminals.get(sessionId);
    if (!entry) return;
    if (readOnly) {
      entry.term.attachCustomKeyEventHandler(() => false);
    } else {
      entry.term.attachCustomKeyEventHandler(() => true);
    }
  }
};

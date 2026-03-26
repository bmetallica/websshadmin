const Tabs = {
  sessions: new Map(), // sessionId -> { name, host }
  activeSessionId: null,
  _draggedId: null,

  init(socket) {
    this.socket = socket;
    this.tabBar = document.getElementById('tabBar');
  },

  addTab(sessionId, name, host) {
    this.sessions.set(sessionId, { name, host });
    this.render();
    this.activate(sessionId);
  },

  removeTab(sessionId) {
    this.sessions.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      // Activate another tab or show no-session
      const keys = Array.from(this.sessions.keys());
      this.activeSessionId = keys.length > 0 ? keys[keys.length - 1] : null;
    }
    this.render();
    Terminal.showSession(this.activeSessionId);
    Stats.setSession(this.activeSessionId);
    this._toggleNoSession();
  },

  activate(sessionId) {
    this.activeSessionId = sessionId;
    this.render();
    Terminal.showSession(sessionId);
    Stats.setSession(sessionId);
    if (typeof SftpBrowser !== 'undefined') SftpBrowser.onTabChange(sessionId);
    this._toggleNoSession();
  },

  _toggleNoSession() {
    const el = document.getElementById('noSession');
    el.style.display = this.activeSessionId ? 'none' : 'block';
  },

  render() {
    this.tabBar.innerHTML = '';
    for (const [id, info] of this.sessions) {
      const tab = document.createElement('div');
      tab.className = 'tab' + (id === this.activeSessionId ? ' active' : '') + (info.reconnecting ? ' reconnecting' : '');
      tab.dataset.sessionId = id;

      // Drag & Drop
      tab.draggable = true;
      tab.addEventListener('dragstart', (e) => {
        this._draggedId = id;
        tab.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      tab.addEventListener('dragend', () => {
        this._draggedId = null;
        tab.classList.remove('dragging');
        this.tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over-left', 'drag-over-right'));
      });
      tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this._draggedId === id) return;
        const rect = tab.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        tab.classList.toggle('drag-over-left', e.clientX < mid);
        tab.classList.toggle('drag-over-right', e.clientX >= mid);
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('drag-over-left', 'drag-over-right');
      });
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        tab.classList.remove('drag-over-left', 'drag-over-right');
        if (!this._draggedId || this._draggedId === id) return;
        const rect = tab.getBoundingClientRect();
        const insertBefore = e.clientX < rect.left + rect.width / 2;
        const entries = Array.from(this.sessions.entries());
        const fromIdx = entries.findIndex(([sid]) => sid === this._draggedId);
        const [moved] = entries.splice(fromIdx, 1);
        let toIdx = entries.findIndex(([sid]) => sid === id);
        if (!insertBefore) toIdx++;
        entries.splice(toIdx, 0, moved);
        this.sessions = new Map(entries);
        this._draggedId = null;
        this.render();
      });

      const label = document.createElement('span');
      if (info.reconnecting) {
        label.textContent = `⟳ ${info.customName || info.name || info.host} (${info.reconnectAttempt}/${info.reconnectMax})`;
      } else {
        label.textContent = info.customName || info.name || info.host;
      }
      label.addEventListener('click', () => {
        if (this.activeSessionId !== id) this.activate(id);
      });
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._startRename(id, tab, label);
      });

      // Share button
      if (typeof Sharing !== 'undefined' && !info.shared) {
        const share = document.createElement('span');
        share.className = 'tab-share';
        share.textContent = '\u21C4';
        share.title = 'Session teilen';
        share.addEventListener('click', (e) => {
          e.stopPropagation();
          Sharing.open(id);
        });
        tab.appendChild(share);
      }

      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '\u00D7';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this.socket.emit('session:kill', { sessionId: id });
      });

      tab.appendChild(label);
      tab.appendChild(close);
      this.tabBar.appendChild(tab);
    }
  },

  getActiveSessionId() {
    return this.activeSessionId;
  },

  _startRename(sessionId, tab, label) {
    const info = this.sessions.get(sessionId);
    if (!info) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = info.customName || info.name || info.host;
    input.size = Math.max(input.value.length, 5);

    const finish = (save) => {
      if (save && input.value.trim()) {
        info.customName = input.value.trim();
      }
      this.render();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));

    label.replaceWith(input);
    input.focus();
    input.select();
  },

  setReconnecting(sessionId, isReconnecting, attempt, maxAttempts) {
    const info = this.sessions.get(sessionId);
    if (!info) return;
    info.reconnecting = isReconnecting;
    info.reconnectAttempt = attempt;
    info.reconnectMax = maxAttempts;
    this.render();
  }
};

const Stats = {
  currentSessionId: null,
  cache: {}, // sessionId -> last stats data

  init(socket) {
    socket.on('stats:update', (data) => {
      // Always cache the latest stats for every session
      this.cache[data.sessionId] = data;

      // Only update the display if this is the active tab
      if (data.sessionId !== this.currentSessionId) return;
      this._render(data);
    });
  },

  _render(data) {
    const cpuEl = document.getElementById('statCpu');
    const ramEl = document.getElementById('statRam');
    const diskEl = document.getElementById('statDisk');

    cpuEl.textContent = `CPU ${data.cpu}%`;
    ramEl.textContent = `RAM ${data.ram.used}/${data.ram.total}MB (${data.ram.percent}%)`;
    diskEl.textContent = `DISK ${data.disk.used}/${data.disk.total} (${data.disk.percent}%)`;

    cpuEl.classList.add('has-data');
    ramEl.classList.add('has-data');
    diskEl.classList.add('has-data');

    cpuEl.style.color = data.cpu > 80 ? '#ff3c78' : data.cpu > 50 ? '#ffcc00' : '#00eaff';
    ramEl.style.color = data.ram.percent > 80 ? '#ff3c78' : data.ram.percent > 50 ? '#ffcc00' : '#00eaff';
    diskEl.style.color = data.disk.percent > 80 ? '#ff3c78' : data.disk.percent > 50 ? '#ffcc00' : '#00eaff';
  },

  _clear() {
    const cpuEl = document.getElementById('statCpu');
    const ramEl = document.getElementById('statRam');
    const diskEl = document.getElementById('statDisk');
    const hostEl = document.getElementById('statHost');

    cpuEl.textContent = 'CPU --';
    ramEl.textContent = 'RAM --';
    diskEl.textContent = 'DISK --';
    hostEl.textContent = 'Keine Verbindung';

    cpuEl.classList.remove('has-data');
    ramEl.classList.remove('has-data');
    diskEl.classList.remove('has-data');
    hostEl.classList.remove('has-data');

    cpuEl.style.color = '';
    ramEl.style.color = '';
    diskEl.style.color = '';
  },

  _updateHost(sessionId) {
    const hostEl = document.getElementById('statHost');
    if (!sessionId || typeof Tabs === 'undefined') {
      hostEl.textContent = 'Keine Verbindung';
      hostEl.classList.remove('has-data');
      return;
    }
    const info = Tabs.sessions.get(sessionId);
    if (info) {
      hostEl.textContent = `Verbindung: ${info.host}`;
      hostEl.classList.add('has-data');
    }
  },

  setSession(sessionId) {
    this.currentSessionId = sessionId;
    this._updateHost(sessionId);
    if (!sessionId) {
      this._clear();
      return;
    }
    const cached = this.cache[sessionId];
    if (cached) {
      this._render(cached);
    } else {
      this._clear();
      this._updateHost(sessionId);
    }
  },

  removeSession(sessionId) {
    delete this.cache[sessionId];
    if (this.currentSessionId === sessionId) {
      this._clear();
    }
  }
};

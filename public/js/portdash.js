const PortDash = {
  isOpen: false,
  ports: [],
  filterText: '',
  refreshInterval: null,

  init() {
    this.panel = document.getElementById('portsPanel');
    this.list = document.getElementById('portsList');
    this.statusEl = document.getElementById('portsStatus');

    document.getElementById('btnPorts').addEventListener('click', () => this.toggle());
    document.getElementById('btnPortsClose').addEventListener('click', () => this.close());
    document.getElementById('btnPortsRefresh').addEventListener('click', () => this.load());

    document.getElementById('portsSearch').addEventListener('input', (e) => {
      this.filterText = e.target.value.toLowerCase();
      this.render();
    });
  },

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  },

  open() {
    this.isOpen = true;
    this.panel.classList.add('open');
    this.load();
    this.refreshInterval = setInterval(() => this.load(), 10000);
  },

  close() {
    this.isOpen = false;
    this.panel.classList.remove('open');
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  },

  async load() {
    this.statusEl.textContent = 'Lade...';
    try {
      const res = await fetch('/api/ports');
      this.ports = await res.json();
      this.render();
      this.statusEl.textContent = `${this.ports.length} Ports · Aktualisiert ${new Date().toLocaleTimeString('de-DE')}`;
    } catch (err) {
      this.statusEl.textContent = 'Fehler beim Laden';
      this.statusEl.style.color = 'var(--accent-pink)';
    }
  },

  render() {
    this.list.innerHTML = '';

    let filtered = this.ports;
    if (this.filterText) {
      filtered = this.ports.filter(p =>
        String(p.port).includes(this.filterText) ||
        (p.process && p.process.toLowerCase().includes(this.filterText)) ||
        (p.container && p.container.toLowerCase().includes(this.filterText)) ||
        (p.image && p.image.toLowerCase().includes(this.filterText)) ||
        (p.bind && p.bind.includes(this.filterText))
      );
    }

    if (filtered.length === 0) {
      this.list.innerHTML = '<div class="ports-empty">Keine Ports gefunden</div>';
      return;
    }

    for (const p of filtered) {
      const row = document.createElement('div');
      row.className = 'ports-row';

      const portClass = p.port < 1024 ? 'ports-port-system' : '';
      const containerInfo = p.container
        ? `<span class="ports-container-name">${this._esc(p.container)}</span><span class="ports-image">${this._esc(p.image || '')}</span>`
        : '<span class="ports-no-container">—</span>';

      row.innerHTML = `
        <span class="ports-col-port ${portClass}">${p.port}</span>
        <span class="ports-col-bind">${this._esc(p.bind)}</span>
        <span class="ports-col-proto">${p.protocol}</span>
        <span class="ports-col-process">${this._esc(p.process)}</span>
        <span class="ports-col-container">${containerInfo}</span>
      `;
      this.list.appendChild(row);
    }
  },

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

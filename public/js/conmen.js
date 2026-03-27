const ConMen = {
  connections: [],
  socket: null,

  filterText: '',

  init(socket) {
    this.socket = socket;

    // Search filter
    document.getElementById('connectionSearch').addEventListener('input', (e) => {
      this.filterText = e.target.value.toLowerCase();
      this.render();
    });

    // Sidebar toggle
    const sidebarLeft = document.getElementById('sidebarLeft');
    const btnExpandLeft = document.getElementById('btnExpandLeft');

    document.getElementById('btnToggleLeft').addEventListener('click', () => {
      sidebarLeft.classList.add('collapsed');
      btnExpandLeft.style.display = '';
      setTimeout(() => {
        const active = Tabs.getActiveSessionId();
        if (active) Terminal._fit(active);
      }, 250);
    });

    btnExpandLeft.addEventListener('click', () => {
      sidebarLeft.classList.remove('collapsed');
      btnExpandLeft.style.display = 'none';
      setTimeout(() => {
        const active = Tabs.getActiveSessionId();
        if (active) Terminal._fit(active);
      }, 250);
    });

    // Add connection button
    document.getElementById('btnAddConnection').addEventListener('click', () => this.openEditor());

    // Auth method toggle
    document.getElementById('connAuthMethod').addEventListener('change', (e) => {
      document.getElementById('connPasswordGroup').style.display = e.target.value === 'password' ? '' : 'none';
      document.getElementById('connKeyGroup').style.display = e.target.value === 'key' ? '' : 'none';
    });

    // Tunnel toggle
    document.getElementById('connTunnelEnabled').addEventListener('change', (e) => {
      document.getElementById('tunnelConfig').style.display = e.target.checked ? '' : 'none';
    });

    // Cancel
    document.getElementById('btnCancelConn').addEventListener('click', () => {
      document.getElementById('connModalOverlay').style.display = 'none';
    });

    // Delete
    document.getElementById('btnDeleteConn').addEventListener('click', async () => {
      const id = document.getElementById('connId').value;
      if (id && confirm('Verbindung wirklich löschen?')) {
        await fetch(`/api/connections/${id}`, { method: 'DELETE' });
        document.getElementById('connModalOverlay').style.display = 'none';
        this.load();
      }
    });

    // Save
    document.getElementById('connForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('connId').value;
      const data = {
        name: document.getElementById('connName').value,
        host: document.getElementById('connHost').value,
        port: parseInt(document.getElementById('connPort').value, 10) || 22,
        username: document.getElementById('connUsername').value,
        auth_method: document.getElementById('connAuthMethod').value,
        password: document.getElementById('connPassword').value || null,
        private_key: document.getElementById('connPrivateKey').value || null,
        passphrase: document.getElementById('connPassphrase').value || null,
        tunnel_enabled: document.getElementById('connTunnelEnabled').checked ? 1 : 0,
        tunnel_local_port: parseInt(document.getElementById('connTunnelLocalPort').value, 10) || null,
        tunnel_remote_host: document.getElementById('connTunnelRemoteHost').value || '127.0.0.1',
        tunnel_remote_port: parseInt(document.getElementById('connTunnelRemotePort').value, 10) || null,
      };

      const url = id ? `/api/connections/${id}` : '/api/connections';
      const method = id ? 'PUT' : 'POST';

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          document.getElementById('connModalOverlay').style.display = 'none';
          this.load();
        } else {
          const err = await res.json();
          document.getElementById('connError').textContent = err.error || 'Fehler';
          document.getElementById('connError').style.display = 'block';
        }
      } catch {
        document.getElementById('connError').textContent = 'Verbindungsfehler';
        document.getElementById('connError').style.display = 'block';
      }
    });

    // --- Group credential prompt ---
    this._initCredentialPrompt();

    // Listen for server asking for credentials
    socket.on('session:needs-credentials', (data) => {
      this._showCredentialPrompt(data);
    });

    this.load();
  },

  _initCredentialPrompt() {
    document.getElementById('btnCancelGcCred').addEventListener('click', () => {
      document.getElementById('gcCredModalOverlay').style.display = 'none';
    });

    document.getElementById('gcCredAuthMethod').addEventListener('change', (e) => {
      document.getElementById('gcCredPasswordGroup').style.display = e.target.value === 'password' ? '' : 'none';
      document.getElementById('gcCredKeyGroup').style.display = e.target.value === 'key' ? '' : 'none';
    });

    document.getElementById('gcCredForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('gcCredError');
      errorEl.style.display = 'none';

      const connId = parseInt(document.getElementById('gcCredConnId').value, 10);
      const username = document.getElementById('gcCredUsername').value.trim();
      const authMethod = document.getElementById('gcCredAuthMethod').value;
      const password = document.getElementById('gcCredPassword').value;
      const privateKey = document.getElementById('gcCredPrivateKey').value;
      const passphrase = document.getElementById('gcCredPassphrase').value;
      const save = document.getElementById('gcCredSave').checked;

      if (!username) {
        errorEl.textContent = 'Username erforderlich';
        errorEl.style.display = 'block';
        return;
      }

      if (authMethod === 'password' && !password) {
        errorEl.textContent = 'Passwort erforderlich';
        errorEl.style.display = 'block';
        return;
      }

      if (authMethod === 'key' && !privateKey) {
        errorEl.textContent = 'Private Key erforderlich';
        errorEl.style.display = 'block';
        return;
      }

      const credentials = { username, auth_method: authMethod };
      if (authMethod === 'password') {
        credentials.password = password;
      } else {
        credentials.private_key = privateKey;
        credentials.passphrase = passphrase;
      }

      // Save credentials if requested
      if (save) {
        try {
          await fetch(`/api/connections/group-credentials/${connId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
          });
          this.load(); // Refresh to update has_user_credentials flags
        } catch { /* ignore save error, still try to connect */ }
      }

      // Connect with provided credentials
      document.getElementById('gcCredModalOverlay').style.display = 'none';
      this.socket.emit('session:create', {
        connectionId: connId,
        source: 'group',
        credentials,
      });
    });
  },

  _showCredentialPrompt(data) {
    const overlay = document.getElementById('gcCredModalOverlay');
    document.getElementById('gcCredConnId').value = data.connectionId;
    document.getElementById('gcCredInfo').textContent = `${data.connectionName} (${data.host}:${data.port})`;
    document.getElementById('gcCredError').style.display = 'none';

    // Reset fields
    document.getElementById('gcCredUsername').value = '';
    document.getElementById('gcCredAuthMethod').value = 'password';
    document.getElementById('gcCredPassword').value = '';
    document.getElementById('gcCredPrivateKey').value = '';
    document.getElementById('gcCredPassphrase').value = '';
    document.getElementById('gcCredSave').checked = true;
    document.getElementById('gcCredPasswordGroup').style.display = '';
    document.getElementById('gcCredKeyGroup').style.display = 'none';

    // Show/hide username field based on what's needed
    document.getElementById('gcCredUsernameGroup').style.display = data.needsUsername ? '' : 'none';

    overlay.style.display = 'flex';
    if (data.needsUsername) {
      document.getElementById('gcCredUsername').focus();
    } else {
      document.getElementById('gcCredPassword').focus();
    }
  },

  // Pre-check before connecting: show prompt if credentials are needed
  _connectGroupConn(conn) {
    if (conn.needs_credentials && !conn.has_user_credentials) {
      // Show credential prompt
      this._showCredentialPrompt({
        connectionId: conn.id,
        connectionName: conn.name,
        host: conn.host,
        port: conn.port,
        needsUsername: !conn.username && !conn.user_username,
        needsAuth: !conn.has_password && !conn.has_private_key,
      });
    } else {
      this.socket.emit('session:create', { connectionId: conn.id, source: 'group' });
    }
  },

  async load() {
    try {
      const res = await fetch('/api/connections');
      this.connections = await res.json();
      this.render();
    } catch {
      this.connections = [];
    }
  },

  render() {
    const list = document.getElementById('connectionList');
    list.innerHTML = '';

    const filtered = this.filterText
      ? this.connections.filter(c =>
          c.name.toLowerCase().includes(this.filterText) ||
          c.host.toLowerCase().includes(this.filterText) ||
          (c.username && c.username.toLowerCase().includes(this.filterText)))
      : this.connections;

    // Split into own and group connections
    const own = filtered.filter(c => c.source !== 'group');
    const groups = {};
    for (const c of filtered.filter(c => c.source === 'group')) {
      const gn = c.group_name || 'Gruppe';
      if (!groups[gn]) groups[gn] = [];
      groups[gn].push(c);
    }

    // Render own connections
    if (own.length > 0 || Object.keys(groups).length > 0) {
      if (Object.keys(groups).length > 0) {
        const header = document.createElement('div');
        header.className = 'conn-section-header';
        header.textContent = 'Eigene Verbindungen';
        list.appendChild(header);
      }
      for (const conn of own) {
        list.appendChild(this._createConnItem(conn, true));
      }
    }

    // Render group connections
    for (const [groupName, conns] of Object.entries(groups)) {
      const header = document.createElement('div');
      header.className = 'conn-section-header';
      header.textContent = groupName;
      list.appendChild(header);
      for (const conn of conns) {
        list.appendChild(this._createConnItem(conn, false));
      }
    }
  },

  _createConnItem(conn, editable) {
    const item = document.createElement('div');
    item.className = 'conn-item' + (conn.source === 'group' ? ' conn-group' : '');

    const name = document.createElement('span');
    name.className = 'conn-name';
    name.textContent = conn.name;

    const host = document.createElement('span');
    host.className = 'conn-host';
    host.textContent = conn.host;

    item.appendChild(name);
    item.appendChild(host);

    if (editable) {
      const edit = document.createElement('button');
      edit.className = 'conn-edit';
      edit.textContent = '\u270E';
      edit.title = 'Verbindung bearbeiten';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openEditor(conn);
      });
      item.appendChild(edit);
    }

    // Show credential edit button for group connections that need/have user credentials
    if (conn.source === 'group' && (conn.needs_credentials || conn.has_user_credentials)) {
      const credBtn = document.createElement('button');
      credBtn.className = 'conn-edit';
      credBtn.textContent = conn.has_user_credentials ? '\uD83D\uDD13' : '\uD83D\uDD12';
      credBtn.title = conn.has_user_credentials ? 'Eigene Login-Daten bearbeiten' : 'Login-Daten eingeben';
      credBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._editGroupCredentials(conn);
      });
      item.appendChild(credBtn);
    }

    item.title = `Verbinden mit ${conn.host}`;
    item.addEventListener('click', () => {
      if (conn.source === 'group') {
        this._connectGroupConn(conn);
      } else {
        this.socket.emit('session:create', { connectionId: conn.id, source: conn.source || 'own' });
      }
    });

    return item;
  },

  async _editGroupCredentials(conn) {
    try {
      const res = await fetch(`/api/connections/group-credentials/${conn.id}`);
      const data = await res.json();

      document.getElementById('gcCredConnId').value = conn.id;
      document.getElementById('gcCredInfo').textContent = `${conn.name} (${conn.host}:${conn.port})`;
      document.getElementById('gcCredError').style.display = 'none';

      document.getElementById('gcCredUsername').value = data.username || data.group_username || '';
      document.getElementById('gcCredAuthMethod').value = data.auth_method || 'password';
      document.getElementById('gcCredPassword').value = data.password || '';
      document.getElementById('gcCredPrivateKey').value = data.private_key || '';
      document.getElementById('gcCredPassphrase').value = data.passphrase || '';
      document.getElementById('gcCredSave').checked = true;

      const authMethod = data.auth_method || 'password';
      document.getElementById('gcCredPasswordGroup').style.display = authMethod === 'password' ? '' : 'none';
      document.getElementById('gcCredKeyGroup').style.display = authMethod === 'key' ? '' : 'none';

      // Show username field if group doesn't have one
      document.getElementById('gcCredUsernameGroup').style.display = !data.group_username ? '' : 'none';

      document.getElementById('gcCredModalOverlay').style.display = 'flex';
      document.getElementById('gcCredUsername').focus();
    } catch {
      // Fallback to simple prompt
      this._showCredentialPrompt({
        connectionId: conn.id,
        connectionName: conn.name,
        host: conn.host,
        port: conn.port,
        needsUsername: !conn.username,
        needsAuth: true,
      });
    }
  },

  openEditor(conn) {
    const isEdit = !!conn;
    document.getElementById('connModalTitle').textContent = isEdit ? 'Verbindung bearbeiten' : 'Neue Verbindung';
    document.getElementById('btnDeleteConn').style.display = isEdit ? '' : 'none';
    document.getElementById('connError').style.display = 'none';

    document.getElementById('connId').value = isEdit ? conn.id : '';
    document.getElementById('connName').value = isEdit ? conn.name : '';
    document.getElementById('connHost').value = isEdit ? conn.host : '';
    document.getElementById('connPort').value = isEdit ? conn.port : 22;
    document.getElementById('connUsername').value = isEdit ? conn.username : '';
    document.getElementById('connAuthMethod').value = isEdit ? conn.auth_method : 'password';
    document.getElementById('connPassword').value = isEdit ? (conn.password || '') : '';
    document.getElementById('connPrivateKey').value = isEdit ? (conn.private_key || '') : '';
    document.getElementById('connPassphrase').value = isEdit ? (conn.passphrase || '') : '';
    document.getElementById('connTunnelEnabled').checked = isEdit ? !!conn.tunnel_enabled : false;
    document.getElementById('connTunnelLocalPort').value = isEdit ? (conn.tunnel_local_port || '') : '';
    document.getElementById('connTunnelRemoteHost').value = isEdit ? (conn.tunnel_remote_host || '127.0.0.1') : '127.0.0.1';
    document.getElementById('connTunnelRemotePort').value = isEdit ? (conn.tunnel_remote_port || '') : '';

    // Toggle visibility
    const authMethod = isEdit ? conn.auth_method : 'password';
    document.getElementById('connPasswordGroup').style.display = authMethod === 'password' ? '' : 'none';
    document.getElementById('connKeyGroup').style.display = authMethod === 'key' ? '' : 'none';
    document.getElementById('tunnelConfig').style.display = (isEdit && conn.tunnel_enabled) ? '' : 'none';

    document.getElementById('connModalOverlay').style.display = 'flex';
    document.getElementById('connName').focus();
  },
};

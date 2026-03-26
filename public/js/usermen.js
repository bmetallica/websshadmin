const UserMen = {
  users: [],
  isOpen: false,

  init() {
    // Only wire up if admin (checked later via role)
    this.overlay = document.getElementById('userModalOverlay');
    if (!this.overlay) return;

    this.list = document.getElementById('userList');
    this.form = document.getElementById('userForm');
    this.errorEl = document.getElementById('userError');

    document.getElementById('settingsUserManagement').addEventListener('click', () => {
      if (document.getElementById('settingsUserManagement').classList.contains('disabled')) return;
      document.getElementById('settingsDropdown').classList.remove('open');
      this.open();
    });

    document.getElementById('btnCancelUser').addEventListener('click', () => this._closeEditor());
    document.getElementById('btnAddUser').addEventListener('click', () => this._openEditor());
    document.getElementById('btnCloseUserModal').addEventListener('click', () => this.close());

    document.getElementById('btnDeleteUser').addEventListener('click', () => this._deleteUser());

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveUser();
    });
  },

  enableForAdmin() {
    const el = document.getElementById('settingsUserManagement');
    if (el) el.classList.remove('disabled');
  },

  open() {
    this.isOpen = true;
    this.overlay.style.display = 'flex';
    this._closeEditor();
    this.load();
  },

  close() {
    this.isOpen = false;
    this.overlay.style.display = 'none';
  },

  async load() {
    try {
      const res = await fetch('/api/users');
      if (!res.ok) return;
      this.users = await res.json();
      this._renderList();
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  },

  _renderList() {
    this.list.innerHTML = '';
    for (const u of this.users) {
      const row = document.createElement('div');
      row.className = 'user-row';

      const roleClass = u.role === 'admin' ? 'user-role-admin' : 'user-role-user';

      row.innerHTML = `
        <span class="user-row-name">${this._esc(u.username)}</span>
        <span class="user-row-role ${roleClass}">${u.role}</span>
        <button class="user-row-edit" data-id="${u.id}">&#9998;</button>
      `;

      row.querySelector('.user-row-edit').addEventListener('click', () => this._openEditor(u));
      this.list.appendChild(row);
    }
  },

  _openEditor(user) {
    document.getElementById('userEditorPanel').style.display = 'block';
    document.getElementById('userEditorTitle').textContent = user ? 'Benutzer bearbeiten' : 'Neuer Benutzer';
    document.getElementById('userEditId').value = user ? user.id : '';
    document.getElementById('userEditName').value = user ? user.username : '';
    document.getElementById('userEditPassword').value = '';
    document.getElementById('userEditRole').value = user ? user.role : 'user';
    document.getElementById('btnDeleteUser').style.display = user ? 'inline-block' : 'none';
    document.getElementById('userPasswordHint').textContent = user ? 'Leer lassen = unverändert' : '';
    this.errorEl.style.display = 'none';
    document.getElementById('userEditName').focus();
  },

  _closeEditor() {
    document.getElementById('userEditorPanel').style.display = 'none';
  },

  async _saveUser() {
    this.errorEl.style.display = 'none';
    const id = document.getElementById('userEditId').value;
    const username = document.getElementById('userEditName').value.trim();
    const password = document.getElementById('userEditPassword').value;
    const role = document.getElementById('userEditRole').value;

    if (!username) {
      this.errorEl.textContent = 'Benutzername erforderlich';
      this.errorEl.style.display = 'block';
      return;
    }

    const body = { username, role };
    if (password) body.password = password;

    try {
      const url = id ? `/api/users/${id}` : '/api/users';
      const method = id ? 'PUT' : 'POST';

      if (!id && !password) {
        this.errorEl.textContent = 'Passwort erforderlich';
        this.errorEl.style.display = 'block';
        return;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        this.errorEl.textContent = data.error || 'Fehler';
        this.errorEl.style.display = 'block';
        return;
      }

      this._closeEditor();
      this.load();
    } catch (err) {
      this.errorEl.textContent = 'Verbindungsfehler';
      this.errorEl.style.display = 'block';
    }
  },

  async _deleteUser() {
    const id = document.getElementById('userEditId').value;
    if (!id) return;

    const username = document.getElementById('userEditName').value;
    if (!confirm(`Benutzer "${username}" wirklich löschen?`)) return;

    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        this.errorEl.textContent = data.error || 'Fehler';
        this.errorEl.style.display = 'block';
        return;
      }
      this._closeEditor();
      this.load();
    } catch (err) {
      this.errorEl.textContent = 'Verbindungsfehler';
      this.errorEl.style.display = 'block';
    }
  },

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

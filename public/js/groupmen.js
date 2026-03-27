const GroupMen = {
  groups: [],
  allUsers: [],
  isOpen: false,

  init() {
    this.overlay = document.getElementById('groupModalOverlay');
    if (!this.overlay) return;

    this.list = document.getElementById('groupList');
    this.editorPanel = document.getElementById('groupEditorPanel');

    document.getElementById('settingsGroupManagement').addEventListener('click', () => {
      if (document.getElementById('settingsGroupManagement').classList.contains('disabled')) return;
      document.getElementById('settingsDropdown').classList.remove('open');
      this.open();
    });

    document.getElementById('btnCloseGroupModal').addEventListener('click', () => this.close());
    document.getElementById('btnAddGroup').addEventListener('click', () => this._openEditor());
    document.getElementById('btnCancelGroup').addEventListener('click', () => this._closeEditor());
    document.getElementById('btnDeleteGroup').addEventListener('click', () => this._deleteGroup());

    document.getElementById('groupForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveGroup();
    });

    // Member management
    document.getElementById('btnAddMember').addEventListener('click', () => this._addMember());

    // Group connection management
    document.getElementById('btnAddGroupConn').addEventListener('click', () => this._openGroupConnEditor());
    document.getElementById('btnCancelGroupConn').addEventListener('click', () => {
      document.getElementById('groupConnEditorPanel').style.display = 'none';
    });
    document.getElementById('groupConnForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveGroupConn();
    });
    document.getElementById('groupConnAuthMethod').addEventListener('change', (e) => {
      document.getElementById('groupConnPasswordGroup').style.display = e.target.value === 'password' ? '' : 'none';
      document.getElementById('groupConnKeyGroup').style.display = e.target.value === 'key' ? '' : 'none';
    });

    // Group bookmark management
    document.getElementById('btnAddGroupBm').addEventListener('click', () => this._openGroupBmEditor());
    document.getElementById('btnCancelGroupBm').addEventListener('click', () => {
      document.getElementById('groupBmEditorPanel').style.display = 'none';
    });
    document.getElementById('groupBmForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveGroupBm();
    });

    // Group quick category management
    document.getElementById('btnAddGroupQuickCat').addEventListener('click', () => this._openGroupQuickCatEditor());
    document.getElementById('btnCancelGroupQuickCat').addEventListener('click', () => {
      document.getElementById('groupQuickCatEditorPanel').style.display = 'none';
    });
    document.getElementById('groupQuickCatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveGroupQuickCat();
    });

    // Group quick command management
    document.getElementById('btnCancelGroupQuickCmd').addEventListener('click', () => {
      document.getElementById('groupQuickCmdEditorPanel').style.display = 'none';
    });
    document.getElementById('groupQuickCmdForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this._saveGroupQuickCmd();
    });
  },

  enableForAdmin() {
    const el = document.getElementById('settingsGroupManagement');
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
      const [gRes, uRes] = await Promise.all([
        fetch('/api/groups'),
        fetch('/api/users'),
      ]);
      this.groups = await gRes.json();
      this.allUsers = (uRes.ok) ? await uRes.json() : [];
      this._renderList();
    } catch { /* ignore */ }
  },

  _renderList() {
    this.list.innerHTML = '';
    for (const g of this.groups) {
      const row = document.createElement('div');
      row.className = 'user-row';
      row.innerHTML = `
        <span class="user-row-name">${this._esc(g.name)}</span>
        <span class="user-row-role user-role-user">${g.description || ''}</span>
        <button class="user-row-edit" data-id="${g.id}">&#9998;</button>
      `;
      row.querySelector('.user-row-edit').addEventListener('click', () => this._openEditor(g));
      this.list.appendChild(row);
    }
  },

  async _openEditor(group) {
    this.editorPanel.style.display = 'block';
    document.getElementById('groupEditorTitle').textContent = group ? 'Gruppe bearbeiten' : 'Neue Gruppe';
    document.getElementById('groupEditId').value = group ? group.id : '';
    document.getElementById('groupEditName').value = group ? group.name : '';
    document.getElementById('groupEditDescription').value = group ? (group.description || '') : '';
    document.getElementById('btnDeleteGroup').style.display = group ? 'inline-block' : 'none';
    document.getElementById('groupError').style.display = 'none';
    document.getElementById('groupConnEditorPanel').style.display = 'none';
    document.getElementById('groupBmEditorPanel').style.display = 'none';
    document.getElementById('groupQuickCatEditorPanel').style.display = 'none';
    document.getElementById('groupQuickCmdEditorPanel').style.display = 'none';

    // Show/hide sections for existing groups
    const memberSection = document.getElementById('groupMemberSection');
    const connSection = document.getElementById('groupConnSection');
    const bmSection = document.getElementById('groupBookmarkSection');
    const quickSection = document.getElementById('groupQuickSection');
    if (group) {
      memberSection.style.display = 'block';
      connSection.style.display = 'block';
      bmSection.style.display = 'block';
      quickSection.style.display = 'block';
      this._loadMembers(group.id);
      this._loadGroupConns(group.id);
      this._loadGroupBms(group.id);
      this._loadGroupQuickCats(group.id);
    } else {
      memberSection.style.display = 'none';
      connSection.style.display = 'none';
      bmSection.style.display = 'none';
      quickSection.style.display = 'none';
    }

    document.getElementById('groupEditName').focus();
  },

  _closeEditor() {
    this.editorPanel.style.display = 'none';
    document.getElementById('groupConnEditorPanel').style.display = 'none';
    document.getElementById('groupBmEditorPanel').style.display = 'none';
    document.getElementById('groupQuickCatEditorPanel').style.display = 'none';
    document.getElementById('groupQuickCmdEditorPanel').style.display = 'none';
  },

  async _saveGroup() {
    const errorEl = document.getElementById('groupError');
    errorEl.style.display = 'none';
    const id = document.getElementById('groupEditId').value;
    const name = document.getElementById('groupEditName').value.trim();
    const description = document.getElementById('groupEditDescription').value.trim();

    if (!name) {
      errorEl.textContent = 'Name erforderlich';
      errorEl.style.display = 'block';
      return;
    }

    try {
      const url = id ? `/api/groups/${id}` : '/api/groups';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        const data = await res.json();
        errorEl.textContent = data.error || 'Fehler';
        errorEl.style.display = 'block';
        return;
      }
      // If new group, get id and reopen editor for member/conn management
      if (!id) {
        const data = await res.json();
        this._closeEditor();
        await this.load();
        const newGroup = this.groups.find(g => g.id === data.id);
        if (newGroup) this._openEditor(newGroup);
      } else {
        this._closeEditor();
        this.load();
      }
    } catch {
      errorEl.textContent = 'Verbindungsfehler';
      errorEl.style.display = 'block';
    }
  },

  async _deleteGroup() {
    const id = document.getElementById('groupEditId').value;
    if (!id) return;
    if (!confirm('Gruppe wirklich löschen?')) return;
    await fetch(`/api/groups/${id}`, { method: 'DELETE' });
    this._closeEditor();
    this.load();
  },

  // --- Members ---
  async _loadMembers(groupId) {
    const list = document.getElementById('groupMemberList');
    list.innerHTML = '';
    try {
      const res = await fetch(`/api/groups/${groupId}/members`);
      const members = await res.json();

      for (const m of members) {
        const row = document.createElement('div');
        row.className = 'share-row';
        row.innerHTML = `
          <span>${this._esc(m.username)}</span>
          <span class="share-role">${m.role}</span>
          <button class="share-btn share-revoke" title="Entfernen">&times;</button>
        `;
        row.querySelector('.share-revoke').addEventListener('click', async () => {
          await fetch(`/api/groups/${groupId}/members/${m.id}`, { method: 'DELETE' });
          this._loadMembers(groupId);
        });
        list.appendChild(row);
      }

      // Populate add-member dropdown with users not in group
      const select = document.getElementById('addMemberSelect');
      select.innerHTML = '<option value="">-- Benutzer wählen --</option>';
      const memberIds = members.map(m => m.id);
      for (const u of this.allUsers) {
        if (!memberIds.includes(u.id)) {
          select.innerHTML += `<option value="${u.id}">${this._esc(u.username)}</option>`;
        }
      }
    } catch { /* ignore */ }
  },

  async _addMember() {
    const groupId = document.getElementById('groupEditId').value;
    const userId = document.getElementById('addMemberSelect').value;
    if (!userId || !groupId) return;

    await fetch(`/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: parseInt(userId, 10) }),
    });
    this._loadMembers(groupId);
  },

  // --- Group Connections ---
  async _loadGroupConns(groupId) {
    const list = document.getElementById('groupConnList');
    list.innerHTML = '';
    try {
      const res = await fetch(`/api/groups/${groupId}/connections`);
      const conns = await res.json();

      for (const c of conns) {
        const row = document.createElement('div');
        row.className = 'share-row';
        row.innerHTML = `
          <span>${this._esc(c.name)}</span>
          <span class="share-role">${c.host}:${c.port}</span>
          <button class="share-btn share-copy" title="Bearbeiten">&#9998;</button>
          <button class="share-btn share-revoke" title="Löschen">&times;</button>
        `;
        row.querySelector('.share-copy').addEventListener('click', () => this._openGroupConnEditor(c));
        row.querySelector('.share-revoke').addEventListener('click', async () => {
          await fetch(`/api/groups/${groupId}/connections/${c.id}`, { method: 'DELETE' });
          this._loadGroupConns(groupId);
        });
        list.appendChild(row);
      }
    } catch { /* ignore */ }
  },

  _openGroupConnEditor(conn) {
    const panel = document.getElementById('groupConnEditorPanel');
    panel.style.display = 'block';
    const isEdit = !!conn;

    document.getElementById('groupConnEditId').value = isEdit ? conn.id : '';
    document.getElementById('groupConnName').value = isEdit ? conn.name : '';
    document.getElementById('groupConnHost').value = isEdit ? conn.host : '';
    document.getElementById('groupConnPort').value = isEdit ? conn.port : 22;
    document.getElementById('groupConnUsername').value = isEdit ? conn.username : '';
    document.getElementById('groupConnAuthMethod').value = isEdit ? conn.auth_method : 'password';
    document.getElementById('groupConnPassword').value = isEdit ? (conn.password || '') : '';
    document.getElementById('groupConnPrivateKey').value = isEdit ? (conn.private_key || '') : '';
    document.getElementById('groupConnPassphrase').value = isEdit ? (conn.passphrase || '') : '';

    const authMethod = isEdit ? conn.auth_method : 'password';
    document.getElementById('groupConnPasswordGroup').style.display = authMethod === 'password' ? '' : 'none';
    document.getElementById('groupConnKeyGroup').style.display = authMethod === 'key' ? '' : 'none';
  },

  async _saveGroupConn() {
    const groupId = document.getElementById('groupEditId').value;
    const connId = document.getElementById('groupConnEditId').value;
    const data = {
      name: document.getElementById('groupConnName').value,
      host: document.getElementById('groupConnHost').value,
      port: parseInt(document.getElementById('groupConnPort').value, 10) || 22,
      username: document.getElementById('groupConnUsername').value,
      auth_method: document.getElementById('groupConnAuthMethod').value,
      password: document.getElementById('groupConnPassword').value || null,
      private_key: document.getElementById('groupConnPrivateKey').value || null,
      passphrase: document.getElementById('groupConnPassphrase').value || null,
    };

    if (!data.name || !data.host) return;

    const url = connId ? `/api/groups/${groupId}/connections/${connId}` : `/api/groups/${groupId}/connections`;
    const method = connId ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    document.getElementById('groupConnEditorPanel').style.display = 'none';
    this._loadGroupConns(groupId);
  },

  // --- Group Bookmarks ---
  async _loadGroupBms(groupId) {
    const list = document.getElementById('groupBookmarkList');
    list.innerHTML = '';
    try {
      const res = await fetch(`/api/groups/${groupId}/bookmarks`);
      const bms = await res.json();

      for (const bm of bms) {
        const row = document.createElement('div');
        row.className = 'share-row';
        row.innerHTML = `
          <span>${this._esc(bm.name)}</span>
          <span class="share-role">${this._esc(bm.url)}</span>
          <button class="share-btn share-copy" title="Bearbeiten">&#9998;</button>
          <button class="share-btn share-revoke" title="Löschen">&times;</button>
        `;
        row.querySelector('.share-copy').addEventListener('click', () => this._openGroupBmEditor(bm));
        row.querySelector('.share-revoke').addEventListener('click', async () => {
          await fetch(`/api/groups/${groupId}/bookmarks/${bm.id}`, { method: 'DELETE' });
          this._loadGroupBms(groupId);
        });
        list.appendChild(row);
      }
    } catch { /* ignore */ }
  },

  _openGroupBmEditor(bm) {
    const panel = document.getElementById('groupBmEditorPanel');
    panel.style.display = 'block';
    const isEdit = !!bm;
    document.getElementById('groupBmEditId').value = isEdit ? bm.id : '';
    document.getElementById('groupBmName').value = isEdit ? bm.name : '';
    document.getElementById('groupBmUrl').value = isEdit ? bm.url : '';
  },

  async _saveGroupBm() {
    const groupId = document.getElementById('groupEditId').value;
    const bmId = document.getElementById('groupBmEditId').value;
    const data = {
      name: document.getElementById('groupBmName').value.trim(),
      url: document.getElementById('groupBmUrl').value.trim(),
    };

    if (!data.name || !data.url) return;

    const url = bmId ? `/api/groups/${groupId}/bookmarks/${bmId}` : `/api/groups/${groupId}/bookmarks`;
    const method = bmId ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    document.getElementById('groupBmEditorPanel').style.display = 'none';
    this._loadGroupBms(groupId);
  },

  // --- Group Quick Categories & Commands ---
  async _loadGroupQuickCats(groupId) {
    const list = document.getElementById('groupQuickCatList');
    list.innerHTML = '';
    try {
      const res = await fetch(`/api/groups/${groupId}/quick-categories`);
      const cats = await res.json();

      for (const cat of cats) {
        const catBlock = document.createElement('div');
        catBlock.style.cssText = 'margin-bottom:8px';

        const catRow = document.createElement('div');
        catRow.className = 'share-row';
        catRow.innerHTML = `
          <span><strong>${this._esc(cat.name)}</strong></span>
          <button class="share-btn share-copy" title="Bearbeiten">&#9998;</button>
          <button class="share-btn" title="Befehl hinzufügen" style="color:var(--accent)">+</button>
          <button class="share-btn share-revoke" title="Löschen">&times;</button>
        `;
        const btns = catRow.querySelectorAll('.share-btn');
        btns[0].addEventListener('click', () => this._openGroupQuickCatEditor(cat));
        btns[1].addEventListener('click', () => this._openGroupQuickCmdEditor(cat.id));
        btns[2].addEventListener('click', async () => {
          await fetch(`/api/groups/${groupId}/quick-categories/${cat.id}`, { method: 'DELETE' });
          this._loadGroupQuickCats(groupId);
        });
        catBlock.appendChild(catRow);

        // Commands
        if (cat.commands && cat.commands.length) {
          for (const cmd of cat.commands) {
            const cmdRow = document.createElement('div');
            cmdRow.className = 'share-row';
            cmdRow.style.cssText = 'padding-left:20px;font-size:0.9em';
            cmdRow.innerHTML = `
              <span>${this._esc(cmd.name)}</span>
              <span class="share-role" style="font-family:monospace;font-size:0.85em">${this._esc(cmd.command)}</span>
              <button class="share-btn share-copy" title="Bearbeiten">&#9998;</button>
              <button class="share-btn share-revoke" title="Löschen">&times;</button>
            `;
            cmdRow.querySelector('.share-copy').addEventListener('click', () => this._openGroupQuickCmdEditor(cat.id, cmd));
            cmdRow.querySelector('.share-revoke').addEventListener('click', async () => {
              await fetch(`/api/groups/${groupId}/quick-categories/${cat.id}/commands/${cmd.id}`, { method: 'DELETE' });
              this._loadGroupQuickCats(groupId);
            });
            catBlock.appendChild(cmdRow);
          }
        }

        list.appendChild(catBlock);
      }
    } catch { /* ignore */ }
  },

  _openGroupQuickCatEditor(cat) {
    const panel = document.getElementById('groupQuickCatEditorPanel');
    panel.style.display = 'block';
    document.getElementById('groupQuickCmdEditorPanel').style.display = 'none';
    const isEdit = !!cat;
    document.getElementById('groupQuickCatEditId').value = isEdit ? cat.id : '';
    document.getElementById('groupQuickCatName').value = isEdit ? cat.name : '';
  },

  async _saveGroupQuickCat() {
    const groupId = document.getElementById('groupEditId').value;
    const catId = document.getElementById('groupQuickCatEditId').value;
    const name = document.getElementById('groupQuickCatName').value.trim();

    if (!name) return;

    const url = catId ? `/api/groups/${groupId}/quick-categories/${catId}` : `/api/groups/${groupId}/quick-categories`;
    const method = catId ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    document.getElementById('groupQuickCatEditorPanel').style.display = 'none';
    this._loadGroupQuickCats(groupId);
  },

  _openGroupQuickCmdEditor(catId, cmd) {
    const panel = document.getElementById('groupQuickCmdEditorPanel');
    panel.style.display = 'block';
    document.getElementById('groupQuickCatEditorPanel').style.display = 'none';
    const isEdit = !!cmd;
    document.getElementById('groupQuickCmdEditId').value = isEdit ? cmd.id : '';
    document.getElementById('groupQuickCmdCatId').value = catId;
    document.getElementById('groupQuickCmdName').value = isEdit ? cmd.name : '';
    document.getElementById('groupQuickCmdCommand').value = isEdit ? cmd.command : '';
  },

  async _saveGroupQuickCmd() {
    const groupId = document.getElementById('groupEditId').value;
    const catId = document.getElementById('groupQuickCmdCatId').value;
    const cmdId = document.getElementById('groupQuickCmdEditId').value;
    const data = {
      name: document.getElementById('groupQuickCmdName').value.trim(),
      command: document.getElementById('groupQuickCmdCommand').value.trim(),
    };

    if (!data.name || !data.command) return;

    const url = cmdId
      ? `/api/groups/${groupId}/quick-categories/${catId}/commands/${cmdId}`
      : `/api/groups/${groupId}/quick-categories/${catId}/commands`;
    const method = cmdId ? 'PUT' : 'POST';

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    document.getElementById('groupQuickCmdEditorPanel').style.display = 'none';
    this._loadGroupQuickCats(groupId);
  },

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

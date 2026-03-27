const QuickCon = {
  personalCats: [],
  groupCats: [],
  socket: null,
  openDropdownId: null,

  init(socket) {
    this.socket = socket;

    document.getElementById('btnAddCategory').addEventListener('click', () => {
      this.openCategoryModal();
    });

    // Category modal
    document.getElementById('btnCancelCat').addEventListener('click', () => {
      document.getElementById('catModalOverlay').style.display = 'none';
    });

    document.getElementById('catForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('catId').value;
      const name = document.getElementById('catName').value;

      if (id) {
        await fetch(`/api/quick-categories/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
      } else {
        await fetch('/api/quick-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
      }

      document.getElementById('catModalOverlay').style.display = 'none';
      this.load();
    });

    // Command modal
    document.getElementById('btnCancelCmd').addEventListener('click', () => {
      document.getElementById('cmdModalOverlay').style.display = 'none';
    });

    document.getElementById('cmdForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cmdId = document.getElementById('cmdId').value;
      const categoryId = document.getElementById('cmdCategoryId').value;
      const name = document.getElementById('cmdName').value;
      const command = document.getElementById('cmdCommand').value;

      if (cmdId) {
        await fetch(`/api/quick-categories/${categoryId}/commands/${cmdId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, command }),
        });
      } else {
        await fetch(`/api/quick-categories/${categoryId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, command }),
        });
      }

      document.getElementById('cmdModalOverlay').style.display = 'none';
      this.load();
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.quick-category')) {
        this._closeAllDropdowns();
      }
    });

    this.load();
  },

  async load() {
    try {
      const res = await fetch('/api/quick-categories');
      const data = await res.json();
      // Support both old format (array) and new format ({personal, group})
      if (Array.isArray(data)) {
        this.personalCats = data;
        this.groupCats = [];
      } else {
        this.personalCats = data.personal || [];
        this.groupCats = data.group || [];
      }
      this.render();
    } catch {
      this.personalCats = [];
      this.groupCats = [];
    }
  },

  render() {
    const container = document.getElementById('quickCategories');
    container.innerHTML = '';

    // Group categories (read-only, prefixed with group name)
    for (const cat of this.groupCats) {
      // Use "g-{id}" as dropdown ID to avoid collision with personal IDs
      container.appendChild(this._buildCatEl(cat, false, `g-${cat.id}`));
    }

    // Personal categories (editable)
    for (const cat of this.personalCats) {
      container.appendChild(this._buildCatEl(cat, true, `p-${cat.id}`));
    }
  },

  _buildCatEl(cat, editable, ddId) {
    const catEl = document.createElement('div');
    catEl.className = 'quick-category';

    const btn = document.createElement('button');
    btn.className = 'quick-cat-btn';
    // Group categories get a subtle prefix indicator
    btn.textContent = cat.name;
    if (!editable && cat.group_name) {
      btn.title = `Gruppe: ${cat.group_name}`;
      btn.style.cssText = 'border-left: 2px solid var(--accent); padding-left: 8px;';
    }
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleDropdown(ddId);
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'quick-dropdown';
    dropdown.id = `quick-dd-${ddId}`;

    // Dropdown header
    const header = document.createElement('div');
    header.className = 'quick-dropdown-header';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = cat.name;
    if (!editable && cat.group_name) {
      const groupLabel = document.createElement('small');
      groupLabel.style.cssText = 'color:var(--accent);margin-left:6px;font-weight:400;';
      groupLabel.textContent = cat.group_name;
      titleSpan.appendChild(groupLabel);
    }
    header.appendChild(titleSpan);

    if (editable) {
      const headerActions = document.createElement('div');
      headerActions.style.cssText = 'display:flex;gap:4px;';

      const addCmdBtn = document.createElement('button');
      addCmdBtn.className = 'btn-icon';
      addCmdBtn.textContent = '+';
      addCmdBtn.title = 'Neuen Befehl hinzufügen';
      addCmdBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCommandModal(cat.id);
      });

      const editCatBtn = document.createElement('button');
      editCatBtn.className = 'btn-icon';
      editCatBtn.textContent = '\u270E';
      editCatBtn.title = 'Kategorie bearbeiten';
      editCatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCategoryModal(cat);
      });

      const delCatBtn = document.createElement('button');
      delCatBtn.className = 'btn-icon';
      delCatBtn.textContent = '\u2716';
      delCatBtn.title = 'Kategorie löschen';
      delCatBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch(`/api/quick-categories/${cat.id}`, { method: 'DELETE' });
        this.load();
      });

      headerActions.appendChild(addCmdBtn);
      headerActions.appendChild(editCatBtn);
      headerActions.appendChild(delCatBtn);
      header.appendChild(headerActions);
    }

    dropdown.appendChild(header);

    // Commands
    if (cat.commands && cat.commands.length) {
      for (const cmd of cat.commands) {
        const cmdEl = document.createElement('div');
        cmdEl.className = 'quick-cmd-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'quick-cmd-name';
        nameSpan.textContent = cmd.name;
        nameSpan.title = `Ausführen: ${cmd.command}`;
        nameSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          this._executeCommand(cmd.command);
          this._closeAllDropdowns();
        });

        cmdEl.appendChild(nameSpan);

        if (editable) {
          const actions = document.createElement('div');
          actions.className = 'quick-cmd-actions';

          const editBtn = document.createElement('button');
          editBtn.textContent = '\u270E';
          editBtn.title = 'Befehl bearbeiten';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openCommandModal(cat.id, cmd);
          });

          const delBtn = document.createElement('button');
          delBtn.textContent = '\u2716';
          delBtn.title = 'Befehl löschen';
          delBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await fetch(`/api/quick-categories/${cat.id}/commands/${cmd.id}`, { method: 'DELETE' });
            this.load();
          });

          actions.appendChild(editBtn);
          actions.appendChild(delBtn);
          cmdEl.appendChild(actions);
        }

        dropdown.appendChild(cmdEl);
      }
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:8px 10px;font-size:11px;color:#666;';
      empty.textContent = 'Keine Befehle';
      dropdown.appendChild(empty);
    }

    catEl.appendChild(btn);
    catEl.appendChild(dropdown);
    return catEl;
  },

  _toggleDropdown(ddId) {
    const dd = document.getElementById(`quick-dd-${ddId}`);
    if (!dd) return;

    const isOpen = dd.classList.contains('open');
    this._closeAllDropdowns();
    if (!isOpen) {
      dd.classList.add('open');
      this.openDropdownId = ddId;
    }
  },

  _closeAllDropdowns() {
    document.querySelectorAll('.quick-dropdown.open').forEach(el => el.classList.remove('open'));
    this.openDropdownId = null;
  },

  _executeCommand(command) {
    const sessionId = Tabs.getActiveSessionId();
    if (!sessionId) return;
    this.socket.emit('terminal:data', { sessionId, data: command + '\n' });
  },

  openCategoryModal(cat) {
    const isEdit = !!cat;
    document.getElementById('catModalTitle').textContent = isEdit ? 'Kategorie bearbeiten' : 'Neue Kategorie';
    document.getElementById('catId').value = isEdit ? cat.id : '';
    document.getElementById('catName').value = isEdit ? cat.name : '';
    document.getElementById('catModalOverlay').style.display = 'flex';
    document.getElementById('catName').focus();
  },

  openCommandModal(categoryId, cmd) {
    const isEdit = !!cmd;
    document.getElementById('cmdModalTitle').textContent = isEdit ? 'Befehl bearbeiten' : 'Neuer Befehl';
    document.getElementById('cmdId').value = isEdit ? cmd.id : '';
    document.getElementById('cmdCategoryId').value = categoryId;
    document.getElementById('cmdName').value = isEdit ? cmd.name : '';
    document.getElementById('cmdCommand').value = isEdit ? cmd.command : '';
    document.getElementById('cmdModalOverlay').style.display = 'flex';
    document.getElementById('cmdName').focus();
  },

  _escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

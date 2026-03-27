const Bookmarks = {
  personalItems: [],
  groupItems: [],

  init() {
    // Toggle dropdown
    document.getElementById('btnBookmarks').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('bookmarkDropdown').classList.toggle('open');
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.bookmark-wrapper')) {
        document.getElementById('bookmarkDropdown').classList.remove('open');
      }
    });

    // Add bookmark
    document.getElementById('btnAddBookmark').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditor();
    });

    // Modal cancel
    document.getElementById('btnCancelBm').addEventListener('click', () => {
      document.getElementById('bmModalOverlay').style.display = 'none';
    });

    // Modal delete
    document.getElementById('btnDeleteBm').addEventListener('click', async () => {
      const id = document.getElementById('bmId').value;
      if (id) {
        await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
        document.getElementById('bmModalOverlay').style.display = 'none';
        this.load();
      }
    });

    // Modal save
    document.getElementById('bmForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('bmId').value;
      const data = {
        name: document.getElementById('bmName').value,
        url: document.getElementById('bmUrl').value,
      };

      const url = id ? `/api/bookmarks/${id}` : '/api/bookmarks';
      const method = id ? 'PUT' : 'POST';

      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      document.getElementById('bmModalOverlay').style.display = 'none';
      this.load();
    });

    this.load();
  },

  async load() {
    try {
      const res = await fetch('/api/bookmarks');
      const data = await res.json();
      // Support both old format (array) and new format ({personal, group})
      if (Array.isArray(data)) {
        this.personalItems = data;
        this.groupItems = [];
      } else {
        this.personalItems = data.personal || [];
        this.groupItems = data.group || [];
      }
      this.render();
    } catch {
      this.personalItems = [];
      this.groupItems = [];
    }
  },

  render() {
    const list = document.getElementById('bookmarkList');
    list.innerHTML = '';

    const allEmpty = this.personalItems.length === 0 && this.groupItems.length === 0;
    if (allEmpty) {
      list.innerHTML = '<div class="bookmark-empty">Keine Bookmarks</div>';
      return;
    }

    // Group bookmarks (grouped by group_name, read-only)
    const byGroup = {};
    for (const bm of this.groupItems) {
      const gn = bm.group_name || 'Gruppe';
      if (!byGroup[gn]) byGroup[gn] = [];
      byGroup[gn].push(bm);
    }

    for (const [groupName, bms] of Object.entries(byGroup)) {
      const header = document.createElement('div');
      header.className = 'bookmark-group-header';
      header.textContent = groupName;
      list.appendChild(header);

      for (const bm of bms) {
        list.appendChild(this._createRow(bm, false));
      }
    }

    // Personal bookmarks
    if (this.personalItems.length > 0) {
      if (this.groupItems.length > 0) {
        const header = document.createElement('div');
        header.className = 'bookmark-group-header';
        header.textContent = 'Eigene';
        list.appendChild(header);
      }
      for (const bm of this.personalItems) {
        list.appendChild(this._createRow(bm, true));
      }
    }
  },

  _createRow(bm, editable) {
    const row = document.createElement('div');
    row.className = 'bookmark-item';

    const link = document.createElement('a');
    link.className = 'bookmark-link';
    link.href = bm.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = bm.name;
    link.title = bm.url;

    row.appendChild(link);

    if (editable) {
      const editBtn = document.createElement('button');
      editBtn.className = 'bookmark-edit';
      editBtn.textContent = '\u270E';
      editBtn.title = 'Bearbeiten';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.openEditor(bm);
      });
      row.appendChild(editBtn);
    }

    return row;
  },

  openEditor(bm) {
    const isEdit = !!bm;
    document.getElementById('bmModalTitle').textContent = isEdit ? 'Bookmark bearbeiten' : 'Neuer Bookmark';
    document.getElementById('btnDeleteBm').style.display = isEdit ? '' : 'none';
    document.getElementById('bmId').value = isEdit ? bm.id : '';
    document.getElementById('bmName').value = isEdit ? bm.name : '';
    document.getElementById('bmUrl').value = isEdit ? bm.url : '';
    document.getElementById('bmModalOverlay').style.display = 'flex';
    document.getElementById('bmName').focus();
  }
};

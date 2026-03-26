const Bookmarks = {
  items: [],

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
      this.items = await res.json();
      this.render();
    } catch {
      this.items = [];
    }
  },

  render() {
    const list = document.getElementById('bookmarkList');
    list.innerHTML = '';

    if (this.items.length === 0) {
      list.innerHTML = '<div class="bookmark-empty">Keine Bookmarks</div>';
      return;
    }

    for (const bm of this.items) {
      const row = document.createElement('div');
      row.className = 'bookmark-item';

      const link = document.createElement('a');
      link.className = 'bookmark-link';
      link.href = bm.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = bm.name;
      link.title = bm.url;

      const editBtn = document.createElement('button');
      editBtn.className = 'bookmark-edit';
      editBtn.textContent = '\u270E';
      editBtn.title = 'Bearbeiten';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.openEditor(bm);
      });

      row.appendChild(link);
      row.appendChild(editBtn);
      list.appendChild(row);
    }
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

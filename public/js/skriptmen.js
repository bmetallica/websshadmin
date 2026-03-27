const SkriptMen = {
  socket: null,
  tree: [],

  init(socket) {
    this.socket = socket;

    // Sidebar toggle
    const sidebarRight = document.getElementById('sidebarRight');
    const btnExpandRight = document.getElementById('btnExpandRight');

    document.getElementById('btnToggleRight').addEventListener('click', () => {
      sidebarRight.classList.add('collapsed');
      btnExpandRight.style.display = '';
      setTimeout(() => {
        const active = Tabs.getActiveSessionId();
        if (active) Terminal._fit(active);
      }, 250);
    });

    btnExpandRight.addEventListener('click', () => {
      sidebarRight.classList.remove('collapsed');
      btnExpandRight.style.display = 'none';
      setTimeout(() => {
        const active = Tabs.getActiveSessionId();
        if (active) Terminal._fit(active);
      }, 250);
    });

    // Drag & Drop
    const dropZone = document.getElementById('scriptDropZone');
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (!files.length) return;

      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      try {
        await fetch('/api/scripts/upload', { method: 'POST', body: formData });
        this.load();
      } catch (err) {
        console.error('Upload error:', err);
      }
    });

    // Listen for live updates from scriptWatcher
    socket.on('scripts:changed', (data) => {
      this.tree = data.tree;
      this.render();
    });

    this.load();
  },

  async load() {
    try {
      const res = await fetch('/api/scripts');
      this.tree = await res.json();
      this.render();
    } catch {
      this.tree = [];
    }
  },

  render() {
    const container = document.getElementById('scriptTree');
    container.innerHTML = '';
    this._renderNodes(this.tree, container);
  },

  _renderNodes(nodes, parent) {
    for (const node of nodes) {
      if (node.isDir) {
        const dirEl = document.createElement('div');
        dirEl.className = 'script-item is-dir';
        dirEl.innerHTML = `<span>&#128193;</span><span>${this._escHtml(node.name)}</span>`;

        const childContainer = document.createElement('div');
        childContainer.className = 'script-children';
        childContainer.style.display = 'none';

        dirEl.addEventListener('click', (e) => {
          e.stopPropagation();
          childContainer.style.display = childContainer.style.display === 'none' ? '' : 'none';
        });

        parent.appendChild(dirEl);
        parent.appendChild(childContainer);

        if (node.children && node.children.length) {
          this._renderNodes(node.children, childContainer);
        }
      } else {
        const fileEl = document.createElement('div');
        fileEl.className = 'script-item';
        const icon = node.name.endsWith('.sh') ? '&#128220;' : node.name.endsWith('.py') ? '&#128013;' : '&#128196;';
        fileEl.innerHTML = `<span>${icon}</span><span>${this._escHtml(node.name)}</span>`;

        fileEl.title = `Skript ausführen: ${node.path}`;
        fileEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const sessionId = Tabs.getActiveSessionId();
          if (!sessionId) {
            return;
          }
          this.socket.emit('script:execute', { sessionId, scriptPath: node.path });
        });

        parent.appendChild(fileEl);
      }
    }
  },

  _escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

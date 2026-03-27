const SftpBrowser = {
  socket: null,
  isOpen: false,
  currentSessionId: null,
  currentPath: '/',
  history: [],
  historyIndex: -1,
  _downloads: {}, // active chunked downloads keyed by filePath

  init(socket) {
    this.socket = socket;
    this.panel = document.getElementById('sftpPanel');
    this.pathInput = document.getElementById('sftpPath');
    this.fileList = document.getElementById('sftpFileList');
    this.statusEl = document.getElementById('sftpStatus');

    // Toggle button
    document.getElementById('btnSftp').addEventListener('click', () => this.toggle());

    // Close button
    document.getElementById('btnSftpClose').addEventListener('click', () => this.close());

    // Navigation
    document.getElementById('btnSftpUp').addEventListener('click', () => this.navigateUp());
    document.getElementById('btnSftpBack').addEventListener('click', () => this.navigateBack());
    document.getElementById('btnSftpRefresh').addEventListener('click', () => this.refresh());
    document.getElementById('btnSftpHome').addEventListener('click', () => this.goHome());

    // Path input enter
    this.pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.navigate(this.pathInput.value.trim());
      }
    });

    // New file button
    document.getElementById('btnSftpNewFile').addEventListener('click', () => this.promptNewFile());

    // Mkdir button
    document.getElementById('btnSftpMkdir').addEventListener('click', () => this.promptMkdir());

    // Upload button
    document.getElementById('btnSftpUpload').addEventListener('click', () => {
      document.getElementById('sftpUploadInput').click();
    });
    document.getElementById('sftpUploadInput').addEventListener('change', (e) => {
      this.uploadFiles(e.target.files);
      e.target.value = '';
    });

    // Drag & drop on file list
    this.fileList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.fileList.classList.add('sftp-dragover');
    });
    this.fileList.addEventListener('dragleave', () => {
      this.fileList.classList.remove('sftp-dragover');
    });
    this.fileList.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.fileList.classList.remove('sftp-dragover');
      if (e.dataTransfer.files.length > 0) {
        this.uploadFiles(e.dataTransfer.files);
      }
    });

    // Socket events
    socket.on('sftp:list', ({ sessionId, dirPath, items }) => {
      if (sessionId !== this.currentSessionId) return;
      this.currentPath = dirPath;
      this.pathInput.value = dirPath;
      this.renderFileList(items);
      this.setStatus(`${items.length} Einträge`);
    });

    socket.on('sftp:home', ({ sessionId, home }) => {
      if (sessionId !== this.currentSessionId) return;
      this.navigate(home);
    });

    socket.on('sftp:download:start', ({ sessionId, filePath, fileName, totalSize }) => {
      if (sessionId !== this.currentSessionId) return;
      this._downloads[filePath] = { fileName, totalSize, chunks: [] };
      const sizeStr = this.formatSize(totalSize);
      this.setStatus(`Download: ${fileName} (${sizeStr})…`);
    });

    socket.on('sftp:download:chunk', ({ sessionId, filePath, data, transferred, totalSize }) => {
      if (sessionId !== this.currentSessionId) return;
      const dl = this._downloads[filePath];
      if (!dl) return;
      dl.chunks.push(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
      if (totalSize > 0) {
        const pct = Math.round((transferred / totalSize) * 100);
        this.setStatus(`Download: ${dl.fileName} — ${pct}% (${this.formatSize(transferred)} / ${this.formatSize(totalSize)})`);
      }
    });

    socket.on('sftp:download:end', ({ sessionId, filePath, fileName }) => {
      if (sessionId !== this.currentSessionId) return;
      const dl = this._downloads[filePath];
      if (!dl) return;
      delete this._downloads[filePath];

      // Merge all chunks into a single Blob and trigger browser download
      const blob = new Blob(dl.chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.setStatus(`Download abgeschlossen: ${fileName}`);
    });

    socket.on('sftp:uploaded', ({ sessionId, dirPath, fileName }) => {
      if (sessionId !== this.currentSessionId) return;
      this.setStatus(`Hochgeladen: ${fileName}`);
      this.refresh();
    });

    socket.on('sftp:deleted', ({ sessionId, filePath }) => {
      if (sessionId !== this.currentSessionId) return;
      this.setStatus(`Gelöscht: ${filePath.split('/').pop()}`);
      this.refresh();
    });

    socket.on('sftp:mkdir', ({ sessionId, dirPath }) => {
      if (sessionId !== this.currentSessionId) return;
      this.setStatus(`Ordner erstellt`);
      this.refresh();
    });

    socket.on('sftp:renamed', ({ sessionId }) => {
      if (sessionId !== this.currentSessionId) return;
      this.setStatus(`Umbenannt`);
      this.refresh();
    });

    socket.on('sftp:fileContent', ({ sessionId, filePath, content }) => {
      if (sessionId !== this.currentSessionId) return;
      this._openEditor(filePath, content, false);
    });

    socket.on('sftp:fileSaved', ({ sessionId, filePath }) => {
      if (sessionId !== this.currentSessionId) return;
      this.setStatus(`Gespeichert: ${filePath.split('/').pop()}`);
      document.getElementById('editorModalOverlay').style.display = 'none';
      this.refresh();
    });

    socket.on('sftp:error', ({ sessionId, error }) => {
      if (sessionId !== this.currentSessionId) return;
      this.setStatus(`Fehler: ${error}`, true);
    });

    // Initialize Ace editor
    this._aceEditor = ace.edit('editorContent');
    this._aceEditor.setTheme('ace/theme/tomorrow_night');
    this._aceEditor.setOptions({
      fontSize: '13px',
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      wrap: false,
      hScrollBarAlwaysVisible: true,
    });

    // Ctrl+S to save
    this._aceEditor.commands.addCommand({
      name: 'save',
      bindKey: { win: 'Ctrl-S', mac: 'Cmd-S' },
      exec: () => this._saveEditor(),
    });

    // Populate mode selector
    this._modes = [
      { name: 'Text', mode: 'text' },
      { name: 'Shell/Bash', mode: 'sh' },
      { name: 'Python', mode: 'python' },
      { name: 'JavaScript', mode: 'javascript' },
      { name: 'JSON', mode: 'json' },
      { name: 'YAML', mode: 'yaml' },
      { name: 'XML', mode: 'xml' },
      { name: 'HTML', mode: 'html' },
      { name: 'CSS', mode: 'css' },
      { name: 'Markdown', mode: 'markdown' },
      { name: 'Dockerfile', mode: 'dockerfile' },
      { name: 'INI/Conf', mode: 'ini' },
      { name: 'SQL', mode: 'sql' },
      { name: 'Lua', mode: 'lua' },
      { name: 'Ruby', mode: 'ruby' },
      { name: 'Go', mode: 'golang' },
      { name: 'Rust', mode: 'rust' },
      { name: 'C/C++', mode: 'c_cpp' },
      { name: 'Java', mode: 'java' },
      { name: 'PHP', mode: 'php' },
      { name: 'Perl', mode: 'perl' },
      { name: 'TOML', mode: 'toml' },
      { name: 'Nginx', mode: 'nginx' },
      { name: 'Apache', mode: 'apache_conf' },
      { name: 'Diff', mode: 'diff' },
    ];

    const modeSelect = document.getElementById('editorMode');
    for (const m of this._modes) {
      const opt = document.createElement('option');
      opt.value = m.mode;
      opt.textContent = m.name;
      modeSelect.appendChild(opt);
    }
    modeSelect.addEventListener('change', () => {
      this._aceEditor.session.setMode('ace/mode/' + modeSelect.value);
    });

    // Editor modal buttons
    document.getElementById('btnEditorCancel').addEventListener('click', () => {
      document.getElementById('editorModalOverlay').style.display = 'none';
    });

    document.getElementById('btnEditorSave').addEventListener('click', () => {
      this._saveEditor();
    });
  },

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  },

  open() {
    const sid = Tabs.getActiveSessionId();
    if (!sid) {
      return;
    }
    this.currentSessionId = sid;
    this.isOpen = true;
    this.panel.classList.add('open');
    // Shrink main layout to make room
    document.getElementById('mainLayout').style.height =
      'calc(100vh - var(--header-height) - var(--stats-height) - var(--footer-height) - 45vh)';
    this.history = [];
    this.historyIndex = -1;
    this.socket.emit('sftp:home', { sessionId: sid });
    this.setStatus('Verbinde...');
    // Refit terminal
    setTimeout(() => {
      const active = Tabs.getActiveSessionId();
      if (active) Terminal._fit(active);
    }, 350);
  },

  close() {
    this.isOpen = false;
    this.panel.classList.remove('open');
    // Restore main layout
    document.getElementById('mainLayout').style.height = '';
    // Refit terminal after closing panel
    setTimeout(() => {
      const active = Tabs.getActiveSessionId();
      if (active) Terminal._fit(active);
    }, 350);
  },

  navigate(dirPath) {
    if (!this.currentSessionId || !dirPath) return;
    // Manage history
    if (this.currentPath !== dirPath) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(this.currentPath);
      this.historyIndex = this.history.length - 1;
    }
    this.setStatus('Lade...');
    this.socket.emit('sftp:list', { sessionId: this.currentSessionId, dirPath });
  },

  navigateUp() {
    if (this.currentPath === '/') return;
    const parent = this.currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    this.navigate(parent);
  },

  navigateBack() {
    if (this.historyIndex < 0) return;
    const prev = this.history[this.historyIndex];
    this.historyIndex--;
    this.setStatus('Lade...');
    this.socket.emit('sftp:list', { sessionId: this.currentSessionId, dirPath: prev });
  },

  refresh() {
    this.socket.emit('sftp:list', { sessionId: this.currentSessionId, dirPath: this.currentPath });
  },

  goHome() {
    this.socket.emit('sftp:home', { sessionId: this.currentSessionId });
  },

  promptMkdir() {
    const name = prompt('Ordnername:');
    if (!name) return;
    const newDir = this.currentPath.replace(/\/$/, '') + '/' + name;
    this.socket.emit('sftp:mkdir', { sessionId: this.currentSessionId, dirPath: newDir });
  },

  uploadFiles(files) {
    if (!this.currentSessionId) return;
    // Upload sequentially to avoid overloading the socket
    const queue = Array.from(files);
    const uploadNext = () => {
      if (queue.length === 0) return;
      this._uploadFile(queue.shift(), uploadNext);
    };
    uploadNext();
  },

  _uploadFile(file, onDone) {
    const CHUNK_SIZE = 256 * 1024; // 256 KB
    const sessionId = this.currentSessionId;
    const dirPath = this.currentPath;
    const totalSize = file.size;

    // Start the upload
    this.socket.emit('sftp:upload:start', { sessionId, dirPath, fileName: file.name, totalSize });
    this.setStatus(`Upload: ${file.name} (${this.formatSize(totalSize)})…`);

    const onReady = ({ sessionId: sid, remotePath }) => {
      if (sid !== sessionId) return;
      this.socket.off('sftp:upload:ready', onReady);

      // Read entire file as ArrayBuffer, then send chunks on ack
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = new Uint8Array(reader.result);
        let offset = 0;

        const sendNextChunk = () => {
          if (offset >= buffer.length) {
            this.socket.emit('sftp:upload:end', { sessionId, remotePath });
            this.socket.off('sftp:upload:ack', onAck);
            this.socket.off('sftp:error', onError);
            return;
          }
          const slice = buffer.slice(offset, offset + CHUNK_SIZE);
          offset += slice.length;
          // Convert to base64
          let binary = '';
          for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
          const data = btoa(binary);
          this.socket.emit('sftp:upload:chunk', { sessionId, remotePath, data, transferred: offset });
        };

        const onAck = ({ sessionId: sid, remotePath: rp, transferred }) => {
          if (sid !== sessionId || rp !== remotePath) return;
          const pct = totalSize > 0 ? Math.round((transferred / totalSize) * 100) : 0;
          this.setStatus(`Upload: ${file.name} — ${pct}% (${this.formatSize(transferred)} / ${this.formatSize(totalSize)})`);
          sendNextChunk();
        };

        const onError = ({ sessionId: sid, error }) => {
          if (sid !== sessionId) return;
          this.socket.off('sftp:upload:ack', onAck);
          this.socket.off('sftp:error', onError);
          this.setStatus(`Fehler: ${error}`, true);
          if (onDone) onDone();
        };

        this.socket.on('sftp:upload:ack', onAck);
        this.socket.on('sftp:error', onError);

        // Send first chunk
        sendNextChunk();
      };
      reader.readAsArrayBuffer(file);
    };

    const onUploaded = ({ sessionId: sid, fileName }) => {
      if (sid !== sessionId || fileName !== file.name) return;
      this.socket.off('sftp:uploaded', onUploaded);
      this.setStatus(`Upload abgeschlossen: ${file.name}`);
      this.refresh();
      if (onDone) onDone();
    };

    this.socket.once('sftp:upload:ready', onReady);
    this.socket.once('sftp:uploaded', onUploaded);
  },

  formatSize(bytes) {
    if (bytes === undefined || bytes === null) return '?';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  },

  formatDate(mtime) {
    if (!mtime) return '';
    const d = new Date(mtime * 1000);
    return d.toLocaleDateString('de-DE') + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  },

  formatMode(mode) {
    if (!mode) return '';
    const octal = (mode & 0o777).toString(8);
    return octal;
  },

  renderFileList(items) {
    this.fileList.innerHTML = '';

    if (items.length === 0) {
      this.fileList.innerHTML = '<div class="sftp-empty">Verzeichnis ist leer</div>';
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'sftp-row' + (item.isDir ? ' is-dir' : '');

      const icon = item.isDir ? '📁' : this._fileIcon(item.name);
      
      row.innerHTML = `
        <span class="sftp-icon">${icon}</span>
        <span class="sftp-name" title="${item.path}">${item.name}</span>
        <span class="sftp-size">${item.isDir ? '--' : this.formatSize(item.size)}</span>
        <span class="sftp-date">${this.formatDate(item.mtime)}</span>
        <span class="sftp-mode">${this.formatMode(item.mode)}</span>
        <span class="sftp-actions">
          ${!item.isDir ? '<button class="sftp-btn-edit" title="Bearbeiten">📝</button>' : ''}
          ${!item.isDir ? '<button class="sftp-btn-dl" title="Download">⬇</button>' : ''}
          <button class="sftp-btn-rename" title="Umbenennen">✏️</button>
          <button class="sftp-btn-del" title="Löschen">🗑</button>
        </span>
      `;

      // Click on name = navigate (dir) or download (file)
      row.querySelector('.sftp-name').addEventListener('click', () => {
        if (item.isDir) {
          this.navigate(item.path);
        }
      });

      // Edit button
      const editBtn = row.querySelector('.sftp-btn-edit');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.editFile(item.path);
        });
      }

      // Download button
      const dlBtn = row.querySelector('.sftp-btn-dl');
      if (dlBtn) {
        dlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setStatus(`Download: ${item.name}...`);
          this.socket.emit('sftp:download', { sessionId: this.currentSessionId, filePath: item.path });
        });
      }

      // Rename button
      row.querySelector('.sftp-btn-rename').addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt('Neuer Name:', item.name);
        if (newName && newName !== item.name) {
          const newPath = this.currentPath.replace(/\/$/, '') + '/' + newName;
          this.socket.emit('sftp:rename', { sessionId: this.currentSessionId, oldPath: item.path, newPath });
        }
      });

      // Delete button
      row.querySelector('.sftp-btn-del').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`"${item.name}" wirklich löschen?`)) {
          this.socket.emit('sftp:delete', { sessionId: this.currentSessionId, filePath: item.path, isDir: item.isDir });
        }
      });

      this.fileList.appendChild(row);
    }
  },

  _fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
      sh: '🔧', bash: '🔧', py: '🐍', js: '📜', json: '📋', yaml: '📋', yml: '📋',
      conf: '⚙️', cfg: '⚙️', ini: '⚙️', env: '⚙️',
      log: '📄', txt: '📄', md: '📄', csv: '📄',
      tar: '📦', gz: '📦', zip: '📦', bz2: '📦', xz: '📦', deb: '📦', rpm: '📦',
      key: '🔑', pem: '🔑', crt: '🔐', cert: '🔐',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
      sql: '🗃️', db: '🗃️', sqlite: '🗃️',
    };
    return icons[ext] || '📄';
  },

  setStatus(msg, isError) {
    this.statusEl.textContent = msg;
    this.statusEl.style.color = isError ? 'var(--accent-pink)' : 'var(--text-muted)';
  },

  promptNewFile() {
    const name = prompt('Dateiname:');
    if (!name) return;
    const filePath = this.currentPath.replace(/\/$/, '') + '/' + name;
    this._openEditor(filePath, '', true);
  },

  editFile(filePath) {
    if (!this.currentSessionId) return;
    this.setStatus(`Lade: ${filePath.split('/').pop()}...`);
    this.socket.emit('sftp:readFile', { sessionId: this.currentSessionId, filePath });
  },

  _openEditor(filePath, content, isNew) {
    this._editorFilePath = filePath;
    this._editorIsNew = isNew;
    document.getElementById('editorTitle').textContent = isNew ? 'Neue Datei' : 'Datei bearbeiten';
    document.getElementById('editorFilePath').textContent = filePath;
    document.getElementById('editorError').style.display = 'none';
    document.getElementById('editorModalOverlay').style.display = 'flex';

    // Detect mode from file extension
    const detectedMode = this._detectMode(filePath);
    const modeSelect = document.getElementById('editorMode');
    modeSelect.value = detectedMode;
    this._aceEditor.session.setMode('ace/mode/' + detectedMode);

    // Set content and focus
    this._aceEditor.setValue(content, -1);
    this._aceEditor.focus();
    this._aceEditor.resize();
  },

  _saveEditor() {
    const content = this._aceEditor.getValue();
    const filePath = this._editorFilePath;
    if (!filePath || !this.currentSessionId) return;
    this.socket.emit('sftp:writeFile', {
      sessionId: this.currentSessionId,
      filePath,
      content,
    });
    this.setStatus(`Speichere: ${filePath.split('/').pop()}...`);
  },

  _detectMode(filePath) {
    const name = filePath.split('/').pop().toLowerCase();
    const ext = name.split('.').pop();

    // Exact filename matches
    const nameMap = {
      'dockerfile': 'dockerfile',
      'makefile': 'makefile',
      'gemfile': 'ruby',
      'rakefile': 'ruby',
      'vagrantfile': 'ruby',
      '.bashrc': 'sh', '.bash_profile': 'sh', '.profile': 'sh',
      '.zshrc': 'sh', '.zprofile': 'sh',
      '.gitignore': 'text', '.dockerignore': 'text',
      'nginx.conf': 'nginx',
      'httpd.conf': 'apache_conf',
      'docker-compose.yml': 'yaml', 'docker-compose.yaml': 'yaml',
    };
    if (nameMap[name]) return nameMap[name];

    // Extension map
    const extMap = {
      sh: 'sh', bash: 'sh', zsh: 'sh', fish: 'sh', ksh: 'sh',
      py: 'python', pyw: 'python',
      js: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', tsx: 'typescript',
      json: 'json', jsonc: 'json',
      yaml: 'yaml', yml: 'yaml',
      xml: 'xml', xsl: 'xml', xsd: 'xml', svg: 'xml',
      html: 'html', htm: 'html',
      css: 'css', scss: 'scss', less: 'less',
      md: 'markdown', markdown: 'markdown',
      sql: 'sql',
      lua: 'lua',
      rb: 'ruby',
      go: 'golang',
      rs: 'rust',
      c: 'c_cpp', cpp: 'c_cpp', cc: 'c_cpp', h: 'c_cpp', hpp: 'c_cpp',
      java: 'java',
      php: 'php',
      pl: 'perl', pm: 'perl',
      toml: 'toml',
      ini: 'ini', cfg: 'ini', conf: 'ini',
      diff: 'diff', patch: 'diff',
      dockerfile: 'dockerfile',
      env: 'sh',
      nginx: 'nginx',
      service: 'ini', timer: 'ini', socket: 'ini', mount: 'ini',
    };
    return extMap[ext] || 'text';
  },

  // Called when active tab changes
  onTabChange(sessionId) {
    if (this.isOpen && sessionId && sessionId !== this.currentSessionId) {
      this.currentSessionId = sessionId;
      this.history = [];
      this.historyIndex = -1;
      this.socket.emit('sftp:home', { sessionId });
    }
  }
};

// Mobiler SFTP-Browser – nutzt exakt dieselben sftp:*-Socket-Events wie die Desktop-UI,
// nur mit einer touch-tauglichen Oberfläche (kein eingebauter Datei-Editor).
const MobileSftp = {
  socket: null,
  sessionId: null,
  currentPath: '/',
  history: [],
  _downloads: {},

  init(socket) {
    this.socket = socket;

    document.getElementById('mSftpUp').addEventListener('click', () => this.up());
    document.getElementById('mSftpHome').addEventListener('click', () => {
      if (this.sessionId) this.socket.emit('sftp:home', { sessionId: this.sessionId });
    });
    document.getElementById('mSftpRefresh').addEventListener('click', () => this.list(this.currentPath));

    const pathInput = document.getElementById('mSftpPath');
    pathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        pathInput.blur();
        this.list(pathInput.value.trim() || '/');
      }
    });

    document.getElementById('mSftpUpload').addEventListener('click', () => {
      document.getElementById('mSftpUploadInput').click();
    });
    document.getElementById('mSftpUploadInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      this._uploadQueue(files);
    });

    socket.on('sftp:list', ({ sessionId, dirPath, items }) => {
      if (sessionId !== this.sessionId) return;
      this.currentPath = dirPath || '/';
      pathInput.value = this.currentPath;
      this._render(items);
      this.setStatus(`${items.length} Einträge`);
    });

    socket.on('sftp:home', ({ sessionId, home }) => {
      if (sessionId !== this.sessionId) return;
      this.list(home || '/');
    });

    socket.on('sftp:error', ({ sessionId, error }) => {
      if (sessionId !== this.sessionId) return;
      this.setStatus('Fehler: ' + error);
    });

    socket.on('sftp:deleted', ({ sessionId }) => {
      if (sessionId !== this.sessionId) return;
      this.setStatus('Gelöscht');
      this.list(this.currentPath);
    });

    socket.on('sftp:renamed', ({ sessionId }) => {
      if (sessionId !== this.sessionId) return;
      this.list(this.currentPath);
    });

    socket.on('sftp:mkdir', ({ sessionId }) => {
      if (sessionId !== this.sessionId) return;
      this.list(this.currentPath);
    });

    // Download: Chunks sammeln und am Ende als Blob speichern
    socket.on('sftp:download:start', ({ sessionId, filePath, fileName, totalSize }) => {
      if (sessionId !== this.sessionId) return;
      this._downloads[filePath] = { chunks: [], fileName, totalSize };
      this.setStatus(`Download: ${fileName}…`);
    });

    socket.on('sftp:download:chunk', ({ sessionId, filePath, data, transferred, totalSize }) => {
      if (sessionId !== this.sessionId) return;
      const dl = this._downloads[filePath];
      if (!dl) return;
      dl.chunks.push(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
      const pct = totalSize > 0 ? Math.round((transferred / totalSize) * 100) : 0;
      this.setStatus(`Download: ${dl.fileName} — ${pct}%`);
    });

    socket.on('sftp:download:end', ({ sessionId, filePath, fileName }) => {
      if (sessionId !== this.sessionId) return;
      const dl = this._downloads[filePath];
      if (!dl) return;
      delete this._downloads[filePath];

      const blob = new Blob(dl.chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.setStatus(`Fertig: ${fileName}`);
    });
  },

  open(sessionId) {
    this.sessionId = sessionId;
    this.history = [];
    this.setStatus('Lade…');
    this.socket.emit('sftp:home', { sessionId });
  },

  list(dirPath) {
    if (!this.sessionId) return;
    if (dirPath !== this.currentPath) this.history.push(this.currentPath);
    this.setStatus('Lade…');
    this.socket.emit('sftp:list', { sessionId: this.sessionId, dirPath });
  },

  up() {
    if (this.currentPath === '/') return;
    const parent = this.currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    this.list(parent);
  },

  setStatus(text) {
    const el = document.getElementById('mSftpStatus');
    if (el) el.textContent = text;
  },

  _render(items) {
    const list = document.getElementById('mSftpList');
    list.innerHTML = '';

    if (this.currentPath !== '/') {
      const up = document.createElement('button');
      up.className = 'm-item';
      up.innerHTML = '<span>&#9650;</span><span class="m-item-main"><span class="m-item-name">..</span></span>';
      up.addEventListener('click', () => this.up());
      list.appendChild(up);
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'm-item';

      const icon = document.createElement('span');
      icon.textContent = item.isDir ? '\u{1F4C1}' : item.isSymlink ? '\u{1F517}' : '\u{1F4C4}';

      const main = document.createElement('button');
      main.className = 'm-item-main';
      main.style.background = 'none';
      main.style.border = 'none';
      main.style.textAlign = 'left';
      main.innerHTML = '';

      const name = document.createElement('span');
      name.className = 'm-item-name';
      name.textContent = item.name;

      const sub = document.createElement('span');
      sub.className = 'm-item-sub';
      sub.textContent = `${item.isDir ? 'Ordner' : this.formatSize(item.size)} · ${this.formatMode(item.mode)}`;

      main.appendChild(name);
      main.appendChild(sub);
      main.addEventListener('click', () => {
        if (item.isDir) this.list(item.path);
        else this._download(item);
      });

      const menu = document.createElement('button');
      menu.className = 'm-item-btn';
      menu.innerHTML = '&#8942;';
      menu.addEventListener('click', (e) => {
        e.stopPropagation();
        this._actions(item);
      });

      row.appendChild(icon);
      row.appendChild(main);
      row.appendChild(menu);
      list.appendChild(row);
    }
  },

  _download(item) {
    this.socket.emit('sftp:download', { sessionId: this.sessionId, filePath: item.path });
  },

  _actions(item) {
    const action = prompt(
      `${item.name}\n\n1 = Herunterladen\n2 = Umbenennen\n3 = Löschen\n\nAuswahl:`,
      '1'
    );
    if (action === '1') {
      if (item.isDir) this.setStatus('Ordner können nicht heruntergeladen werden');
      else this._download(item);
    } else if (action === '2') {
      const newName = prompt('Neuer Name:', item.name);
      if (newName && newName !== item.name) {
        const newPath = this.currentPath.replace(/\/$/, '') + '/' + newName;
        this.socket.emit('sftp:rename', { sessionId: this.sessionId, oldPath: item.path, newPath });
      }
    } else if (action === '3') {
      if (confirm(`${item.name} wirklich löschen?`)) {
        this.socket.emit('sftp:delete', { sessionId: this.sessionId, filePath: item.path, isDir: item.isDir });
      }
    }
  },

  _uploadQueue(files) {
    if (!files.length || !this.sessionId) return;
    const next = () => {
      if (!files.length) return;
      this._uploadFile(files.shift(), next);
    };
    next();
  },

  _uploadFile(file, onDone) {
    const CHUNK_SIZE = 256 * 1024;
    const sessionId = this.sessionId;
    const dirPath = this.currentPath;
    const totalSize = file.size;

    this.socket.emit('sftp:upload:start', { sessionId, dirPath, fileName: file.name, totalSize });
    this.setStatus(`Upload: ${file.name}…`);

    const onReady = ({ sessionId: sid, remotePath }) => {
      if (sid !== sessionId) return;
      this.socket.off('sftp:upload:ready', onReady);

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
          let binary = '';
          for (let i = 0; i < slice.length; i++) binary += String.fromCharCode(slice[i]);
          this.socket.emit('sftp:upload:chunk', {
            sessionId, remotePath, data: btoa(binary), transferred: offset,
          });
        };

        const onAck = ({ sessionId: sid2, remotePath: rp, transferred }) => {
          if (sid2 !== sessionId || rp !== remotePath) return;
          const pct = totalSize > 0 ? Math.round((transferred / totalSize) * 100) : 0;
          this.setStatus(`Upload: ${file.name} — ${pct}%`);
          sendNextChunk();
        };

        const onError = ({ sessionId: sid2, error }) => {
          if (sid2 !== sessionId) return;
          this.socket.off('sftp:upload:ack', onAck);
          this.socket.off('sftp:error', onError);
          this.setStatus('Fehler: ' + error);
          if (onDone) onDone();
        };

        this.socket.on('sftp:upload:ack', onAck);
        this.socket.on('sftp:error', onError);
        sendNextChunk();
      };
      reader.readAsArrayBuffer(file);
    };

    const onUploaded = ({ sessionId: sid, fileName }) => {
      if (sid !== sessionId || fileName !== file.name) return;
      this.socket.off('sftp:uploaded', onUploaded);
      this.setStatus(`Upload fertig: ${file.name}`);
      this.list(this.currentPath);
      if (onDone) onDone();
    };

    this.socket.once('sftp:upload:ready', onReady);
    this.socket.once('sftp:uploaded', onUploaded);
  },

  formatSize(bytes) {
    if (bytes === undefined || bytes === null) return '?';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  },

  formatMode(mode) {
    if (mode === undefined || mode === null) return '';
    return '0' + (mode & 0o777).toString(8);
  },
};

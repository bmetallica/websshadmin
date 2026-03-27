/**
 * multiview.js – Standalone multiview page logic.
 *
 * URL format: /multiview?sessions=id1,id2,...&layout=2col&order=id1,id2,...
 *
 * Connects to the existing socket backend, attaches to running sessions,
 * and renders them in a CSS-grid layout with resizable handles.
 */
(function () {
  'use strict';

  // ── Layout definitions ───────────────────────────────────────────────────
  function _s(c, r) { return { colSpan: c || 1, rowSpan: r || 1 }; }

  const LAYOUT_DEFS = {
    '2col':      { cols: 2, rows: 1, slots: [_s(), _s()] },
    '2row':      { cols: 1, rows: 2, slots: [_s(), _s()] },
    '3col':      { cols: 3, rows: 1, slots: [_s(), _s(), _s()] },
    '3row':      { cols: 1, rows: 3, slots: [_s(), _s(), _s()] },
    '2top-1bot': { cols: 2, rows: 2, slots: [_s(), _s(), _s(2)] },
    '1top-2bot': { cols: 2, rows: 2, slots: [_s(2), _s(), _s()] },
    '2x2':       { cols: 2, rows: 2, slots: [_s(), _s(), _s(), _s()] },
    '4col':      { cols: 4, rows: 1, slots: [_s(), _s(), _s(), _s()] },
    '4row':      { cols: 1, rows: 4, slots: [_s(), _s(), _s(), _s()] },
    '3top-1bot': { cols: 3, rows: 2, slots: [_s(), _s(), _s(), _s(3)] },
    '1top-3bot': { cols: 3, rows: 2, slots: [_s(3), _s(), _s(), _s()] },
    '2x2+1bot':  { cols: 2, rows: 3, slots: [_s(), _s(), _s(), _s(), _s(2)] },
    '1top+2x2':  { cols: 2, rows: 3, slots: [_s(2), _s(), _s(), _s(), _s()] },
    '2x3':       { cols: 2, rows: 3, slots: [_s(), _s(), _s(), _s(), _s(), _s()] },
    '3x2':       { cols: 3, rows: 2, slots: [_s(), _s(), _s(), _s(), _s(), _s()] },
    '6col':      { cols: 6, rows: 1, slots: [_s(), _s(), _s(), _s(), _s(), _s()] },
    '6row':      { cols: 1, rows: 6, slots: [_s(), _s(), _s(), _s(), _s(), _s()] },
  };

  // ── Parse URL params ─────────────────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const sessionIds = (params.get('sessions') || '').split(',').filter(Boolean);
  const layoutId   = params.get('layout') || '2col';
  const orderParam = (params.get('order') || '').split(',').filter(Boolean);
  const sessionOrder =
    orderParam.length === sessionIds.length ? orderParam : [...sessionIds];

  if (sessionIds.length < 2) {
    _showError('Ungültige URL: Mindestens 2 Sessions erforderlich.');
    return;
  }

  const def = _resolveDef(layoutId, sessionIds.length);
  if (!def) {
    _showError('Unbekanntes Layout: ' + layoutId);
    return;
  }

  function _resolveDef(id, n) {
    if (id && id.startsWith('grid:')) {
      const parts = id.slice(5).split('x');
      const c = parseInt(parts[0], 10);
      const r = parseInt(parts[1], 10);
      if (!c || !r) return null;
      return { cols: c, rows: r, slots: Array.from({ length: n }, () => ({ colSpan: 1, rowSpan: 1 })) };
    }
    return LAYOUT_DEFS[id] || null;
  }

  // ── State ────────────────────────────────────────────────────────────────
  const termMap     = new Map(); // sessionId → { term, fitAddon, cell }
  const sessionInfo = new Map(); // sessionId → { connectionName, host }
  let focusedId     = null;
  let _resizeTimer  = null;

  // ── Apply theme ──────────────────────────────────────────────────────────
  if (window.Theme) Theme.init();

  // ── Socket connection ────────────────────────────────────────────────────
  const socket = io({ path: '/socket.io' });

  socket.on('connect', () => {
    _setStatus('Verbunden', 'connected');
    // Request session list to get names/hosts, then attach
    socket.emit('session:list');
  });

  socket.on('disconnect', () => {
    _setStatus('Getrennt', 'disconnected');
  });

  socket.on('session:list', (sessions) => {
    // Store names/hosts for title bars
    for (const s of sessions) {
      sessionInfo.set(s.id, { connectionName: s.connectionName, host: s.host });
    }
    // Update headers for already-rendered cells
    for (const sessionId of sessionOrder) {
      const info = sessionInfo.get(sessionId);
      if (info) _updateHeader(sessionId, info);
    }
    // Attach to each session (idempotent: server handles duplicates gracefully)
    for (const sessionId of sessionIds) {
      socket.emit('session:attach', { sessionId });
    }
  });

  socket.on('terminal:data', ({ sessionId, data }) => {
    _write(sessionId, data);
  });

  socket.on('terminal:replay', ({ sessionId, data }) => {
    // Small delay so xterm is fully open before writing the replay buffer
    setTimeout(() => _write(sessionId, data), 80);
  });

  socket.on('session:ended', ({ sessionId }) => _markEnded(sessionId));
  socket.on('session:error',  ({ error }) => console.warn('[multiview]', error));

  socket.on('session:reconnecting', ({ sessionId, attempt, maxAttempts }) => {
    const nameEl = document.getElementById(`mv-name-${sessionId}`);
    if (nameEl) nameEl.textContent = `⟳ Reconnect ${attempt}/${maxAttempts}…`;
  });

  socket.on('session:reconnected', ({ sessionId }) => {
    const info = sessionInfo.get(sessionId);
    if (info) _updateHeader(sessionId, info);
  });

  // ── Build grid ───────────────────────────────────────────────────────────
  _buildGrid();

  // ── Window resize handling ───────────────────────────────────────────────
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      // Reset to equal fr tracks on window resize, then re-setup handles
      const grid = document.getElementById('mvGrid');
      grid.style.gridTemplateColumns = `repeat(${def.cols}, 1fr)`;
      grid.style.gridTemplateRows    = `repeat(${def.rows}, 1fr)`;
      _fitAll();
      // Defer handle rebuild so grid has time to reflow
      setTimeout(() => _setupResizeHandles(def), 120);
    }, 100);
  });

  // Protect against accidental window close
  window.addEventListener('beforeunload', (e) => {
    if (termMap.size > 0) { e.preventDefault(); e.returnValue = ''; }
  });

  // ── Functions ────────────────────────────────────────────────────────────

  function _buildGrid() {
    const grid = document.getElementById('mvGrid');

    const countEl = document.getElementById('mvSessionCount');
    if (countEl) countEl.textContent = `${sessionIds.length} Terminals`;

    grid.style.gridTemplateColumns = `repeat(${def.cols}, 1fr)`;
    grid.style.gridTemplateRows    = `repeat(${def.rows}, 1fr)`;

    for (let i = 0; i < sessionOrder.length; i++) {
      const sessionId = sessionOrder[i];
      const slotInfo  = def.slots[i] || _s();

      // Cell wrapper
      const cell = document.createElement('div');
      cell.className = 'mv-cell';
      cell.dataset.sessionId = sessionId;
      if (slotInfo.colSpan > 1) cell.style.gridColumn = `span ${slotInfo.colSpan}`;
      if (slotInfo.rowSpan  > 1) cell.style.gridRow    = `span ${slotInfo.rowSpan}`;

      // Title bar
      const header = document.createElement('div');
      header.className = 'mv-cell-header';
      header.innerHTML =
        `<span class="mv-cell-name" id="mv-name-${sessionId}">Verbinde…</span>` +
        `<span class="mv-cell-host" id="mv-host-${sessionId}"></span>` +
        `<span class="mv-cell-dot"  id="mv-dot-${sessionId}">●</span>`;
      cell.appendChild(header);

      // Terminal area
      const termDiv = document.createElement('div');
      termDiv.className = 'mv-cell-terminal';
      termDiv.id = `mv-term-${sessionId}`;
      cell.appendChild(termDiv);

      // Focus on click
      cell.addEventListener('click', () => _setFocus(sessionId));

      grid.appendChild(cell);
      _createTerminal(sessionId, termDiv);
    }

    // Initial fit + handle setup after layout settles
    setTimeout(() => {
      _fitAll();
      _setupResizeHandles(def);
    }, 150);
  }

  function _createTerminal(sessionId, container) {
    const term = new window.Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      lineHeight: 1.2,
      theme: window.Theme ? Theme.getXtermTheme() : undefined,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch (_) { /* optional */ }

    term.open(container);

    term.onData((data) => {
      // Only send input from the focused terminal
      if (focusedId === sessionId) {
        socket.emit('terminal:data', { sessionId, data });
      }
    });

    term.onResize(({ cols, rows }) => {
      socket.emit('terminal:resize', { sessionId, cols, rows });
    });

    termMap.set(sessionId, { term, fitAddon, container });
    setTimeout(() => { try { fitAddon.fit(); } catch (_) { /* ignore */ } }, 100);
  }

  function _setFocus(sessionId) {
    focusedId = sessionId;
    document.querySelectorAll('.mv-cell').forEach(c => {
      c.classList.toggle('focused', c.dataset.sessionId === sessionId);
    });
    const entry = termMap.get(sessionId);
    if (entry) entry.term.focus();
  }

  function _write(sessionId, data) {
    const entry = termMap.get(sessionId);
    if (entry) entry.term.write(data);
  }

  function _markEnded(sessionId) {
    const dot = document.getElementById(`mv-dot-${sessionId}`);
    if (dot) dot.style.color = 'var(--accent-pink)';
    const cell = document.querySelector(`.mv-cell[data-session-id="${sessionId}"]`);
    if (cell) cell.classList.add('ended');
    _write(sessionId, '\r\n\x1b[31m[Session beendet]\x1b[0m\r\n');
  }

  function _updateHeader(sessionId, info) {
    const nameEl = document.getElementById(`mv-name-${sessionId}`);
    const hostEl = document.getElementById(`mv-host-${sessionId}`);
    if (nameEl) nameEl.textContent = info.connectionName || sessionId;
    if (hostEl) hostEl.textContent = info.host || '';
  }

  function _fitAll() {
    for (const [, entry] of termMap) {
      try { entry.fitAddon.fit(); } catch (_) { /* ignore */ }
    }
  }

  function _setStatus(text, cls) {
    const el = document.getElementById('mvConnStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'mv-conn-status' + (cls ? ' ' + cls : '');
  }

  function _showError(msg) {
    document.getElementById('mvGrid').style.display = 'none';
    const err = document.getElementById('mvError');
    if (err) err.style.display = 'flex';
    const t = document.getElementById('mvErrorText');
    if (t) t.textContent = msg;
  }

  // ── Resize handles ───────────────────────────────────────────────────────

  function _setupResizeHandles(layoutDef) {
    const grid = document.getElementById('mvGrid');

    // Remove any existing handles
    grid.querySelectorAll('.mv-resize-handle').forEach(h => h.remove());

    if (layoutDef.cols <= 1 && layoutDef.rows <= 1) return;

    const gridRect = grid.getBoundingClientRect();

    // Collect unique column/row boundaries from rendered cell positions
    const colBoundSet = new Set();
    const rowBoundSet = new Set();

    grid.querySelectorAll('.mv-cell').forEach(cell => {
      const r = cell.getBoundingClientRect();
      const relLeft = Math.round(r.left - gridRect.left);
      const relTop  = Math.round(r.top  - gridRect.top);
      if (relLeft > 4) colBoundSet.add(relLeft);
      if (relTop  > 4) rowBoundSet.add(relTop);
    });

    const colBounds = Array.from(colBoundSet).sort((a, b) => a - b); // x positions
    const rowBounds = Array.from(rowBoundSet).sort((a, b) => a - b); // y positions

    // Build arrays of track sizes in px
    // colEdges = [0, b0, b1, ..., gridWidth]
    const gW = Math.round(gridRect.width);
    const gH = Math.round(gridRect.height);
    const colEdges = [0, ...colBounds, gW];
    const rowEdges = [0, ...rowBounds, gH];
    let colSizes = colEdges.slice(1).map((e, i) => e - colEdges[i]);
    let rowSizes = rowEdges.slice(1).map((e, i) => e - rowEdges[i]);

    const vHandles = []; // { el, trackIdx }
    const hHandles = []; // { el, trackIdx }

    function applyGridTemplate() {
      grid.style.gridTemplateColumns = colSizes.map(s => s + 'px').join(' ');
      grid.style.gridTemplateRows    = rowSizes.map(s => s + 'px').join(' ');
    }

    function updateHandlePositions() {
      let cumX = 0;
      for (const { el, trackIdx } of vHandles) {
        cumX = colSizes.slice(0, trackIdx + 1).reduce((a, b) => a + b, 0);
        el.style.left = (cumX - 3) + 'px';
      }
      let cumY = 0;
      for (const { el, trackIdx } of hHandles) {
        cumY = rowSizes.slice(0, trackIdx + 1).reduce((a, b) => a + b, 0);
        el.style.top = (cumY - 3) + 'px';
      }
    }

    // Create vertical handles (one per column boundary)
    colBounds.forEach((xPos, i) => {
      const el = document.createElement('div');
      el.className = 'mv-resize-handle mv-resize-v';
      el.style.left   = (xPos - 3) + 'px';
      el.style.top    = '0';
      el.style.height = '100%';

      const trackIdx = i; // handle sits between colSizes[i] and colSizes[i+1]

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        el.classList.add('dragging');
        document.body.style.cursor = 'ew-resize';

        const startX    = e.clientX;
        const startLeft = colSizes[trackIdx];
        const startRight = colSizes[trackIdx + 1];

        const onMove = (e2) => {
          const dx       = e2.clientX - startX;
          const newLeft  = Math.max(60, startLeft  + dx);
          const newRight = Math.max(60, startRight - dx);
          // Only apply if both constraints are satisfied
          if (newLeft  >= 60 && newRight >= 60) {
            colSizes[trackIdx]     = newLeft;
            colSizes[trackIdx + 1] = newRight;
            applyGridTemplate();
            updateHandlePositions();
            _fitAll();
          }
        };

        const onUp = () => {
          el.classList.remove('dragging');
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          _fitAll();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });

      grid.appendChild(el);
      vHandles.push({ el, trackIdx });
    });

    // Create horizontal handles (one per row boundary)
    rowBounds.forEach((yPos, i) => {
      const el = document.createElement('div');
      el.className = 'mv-resize-handle mv-resize-h';
      el.style.top   = (yPos - 3) + 'px';
      el.style.left  = '0';
      el.style.width = '100%';

      const trackIdx = i; // handle sits between rowSizes[i] and rowSizes[i+1]

      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        el.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';

        const startY   = e.clientY;
        const startTop = rowSizes[trackIdx];
        const startBot = rowSizes[trackIdx + 1];

        const onMove = (e2) => {
          const dy     = e2.clientY - startY;
          const newTop = Math.max(60, startTop + dy);
          const newBot = Math.max(60, startBot - dy);
          if (newTop >= 60 && newBot >= 60) {
            rowSizes[trackIdx]     = newTop;
            rowSizes[trackIdx + 1] = newBot;
            applyGridTemplate();
            updateHandlePositions();
            _fitAll();
          }
        };

        const onUp = () => {
          el.classList.remove('dragging');
          document.body.style.cursor = '';
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          _fitAll();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });

      grid.appendChild(el);
      hHandles.push({ el, trackIdx });
    });
  }

})();

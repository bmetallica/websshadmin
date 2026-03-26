// Main application initialization
(function () {
  // Check for share token - used for unauthenticated shared sessions
  const _params = new URLSearchParams(window.location.search);
  const _shareToken = _params.get('share');
  window._shareMode = !!_shareToken;

  const socketOpts = { path: '/socket.io' };
  if (_shareToken) {
    socketOpts.auth = { shareToken: _shareToken };
  }
  const socket = io(socketOpts);

  // Initialize all modules
  Theme.init();
  Tabs.init(socket);
  Terminal.init(socket);
  Stats.init(socket);

  if (!window._shareMode) {
    Auth.init();
    ConMen.init(socket);
    SkriptMen.init(socket);
    QuickCon.init(socket);
    SftpBrowser.init(socket);
    Bookmarks.init();
    PortDash.init();
    UserMen.init();
    if (typeof GroupMen !== 'undefined') GroupMen.init();
    if (typeof Sharing !== 'undefined') Sharing.init(socket);
  }

  // Fetch user role and apply restrictions (skip in share mode)
  if (!window._shareMode) {
    fetch('/api/auth/check')
      .then(r => r.json())
      .then(info => {
        if (!info.authenticated) return;
        window._userRole = info.role;
        window._username = info.username;
        window._authSource = info.authSource;
        _applyRoleRestrictions(info.role, info.authSource);
      })
      .catch(() => {});
  }

  function _applyRoleRestrictions(role, authSource) {
    if (role === 'admin') {
      UserMen.enableForAdmin();
      if (typeof GroupMen !== 'undefined') GroupMen.enableForAdmin();
    }

    // Hide password change for AD users (they change password in AD)
    if (authSource === 'ad') {
      const el = document.getElementById('settingsChangePassword');
      if (el) el.style.display = 'none';
    }
  }

  // Fullscreen toggle
  const btnFullscreen = document.getElementById('btnFullscreen');
  function toggleFullscreen() {
    document.body.classList.toggle('fullscreen');
    setTimeout(() => {
      const active = Tabs.getActiveSessionId();
      if (active) Terminal._fit(active);
    }, 300);
  }
  if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) {
      toggleFullscreen();
    }
  });

  // Convert title attributes to data-tip for custom tooltips (no native delay)
  function convertTitles(root) {
    root.querySelectorAll('[title]').forEach(el => {
      if (!el.dataset.tip) {
        el.dataset.tip = el.getAttribute('title');
        el.removeAttribute('title');
      }
    });
  }
  // Initial conversion
  convertTitles(document.body);
  // Watch for dynamically added elements
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1) convertTitles(node.parentElement || node);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Socket event handlers

  // Session created - new tab + terminal
  socket.on('session:created', ({ sessionId, connectionName, host }) => {
    Terminal.createTerminal(sessionId);
    Tabs.addTab(sessionId, connectionName, host);
    socket.emit('session:attach', { sessionId });
  });

  // Joined shared session
  socket.on('session:joined-shared', ({ sessionId, role, connectionName, host, scrollback }) => {
    Terminal.createTerminal(sessionId);
    Tabs.addTab(sessionId, connectionName + ' [' + role + ']', host);
    if (role === 'viewer') {
      Terminal.setReadOnlySession(sessionId, true);
    }
    // Write scrollback after terminal is created
    if (scrollback) {
      setTimeout(() => Terminal.writeToTerminal(sessionId, scrollback), 100);
    }
    // If in share-only mode, enter minimal UI
    if (window._shareMode) {
      document.body.classList.add('share-mode');
    }
  });

  // Share role updated
  socket.on('share:role-updated', ({ sessionId, role }) => {
    if (role === 'coworker') {
      Terminal.setReadOnlySession(sessionId, false);
    } else {
      Terminal.setReadOnlySession(sessionId, true);
    }
    const info = Tabs.sessions.get(sessionId);
    if (info) {
      // Update tab label
      const baseName = (info.customName || info.name || info.host).replace(/ \[.*\]$/, '');
      info.name = baseName + ' [' + role + ']';
      Tabs.render();
    }
  });

  // Share revoked
  socket.on('share:revoked', ({ sessionId }) => {
    Terminal.destroyTerminal(sessionId);
    Stats.removeSession(sessionId);
    Tabs.removeTab(sessionId);
  });

  // Terminal data from backend
  socket.on('terminal:data', ({ sessionId, data }) => {
    Terminal.writeToTerminal(sessionId, data);
  });

  // Replay scrollback buffer on reconnect
  socket.on('terminal:replay', ({ sessionId, data }) => {
    Terminal.writeToTerminal(sessionId, data);
  });

  // Session ended (closed or killed)
  socket.on('session:ended', ({ sessionId, reason }) => {
    Terminal.destroyTerminal(sessionId);
    Stats.removeSession(sessionId);
    Tabs.removeTab(sessionId);
  });

  // Session error
  socket.on('session:error', ({ error }) => {
    console.error('Session error:', error);
  });

  // SSH auto-reconnect events
  socket.on('session:reconnecting', ({ sessionId, attempt, maxAttempts }) => {
    console.log(`Session ${sessionId} reconnecting: attempt ${attempt}/${maxAttempts}`);
    Tabs.setReconnecting(sessionId, true, attempt, maxAttempts);
  });

  socket.on('session:reconnected', ({ sessionId }) => {
    console.log(`Session ${sessionId} reconnected`);
    Tabs.setReconnecting(sessionId, false);
  });

  // Session list (for reconnect after page reload)
  socket.on('session:list', (sessions) => {
    for (const s of sessions) {
      if (!Tabs.sessions.has(s.id)) {
        Terminal.createTerminal(s.id);
        Tabs.addTab(s.id, s.connectionName, s.host);
        socket.emit('session:attach', { sessionId: s.id });
      }
    }
  });

  // Script execution feedback
  socket.on('script:output', ({ sessionId, message }) => {
    console.log(`Script [${sessionId}]: ${message}`);
  });

  // On connect / reconnect, request existing sessions
  socket.on('connect', () => {
    if (window._shareMode) {
      // In share mode, join the shared session (token passed via handshake auth)
      socket.emit('session:join-shared', { token: _shareToken });
    } else {
      socket.emit('session:list');

      // Check for share token in URL (logged-in user following a share link)
      const params = new URLSearchParams(window.location.search);
      const shareToken = params.get('share');
      if (shareToken) {
        socket.emit('session:join-shared', { token: shareToken });
        window.history.replaceState({}, '', '/app');
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Socket disconnected, attempting reconnect...');
  });
})();

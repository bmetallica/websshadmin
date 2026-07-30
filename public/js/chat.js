const Chat = (() => {
  let _socket = null;
  let _activeSessionId = null;
  let _currentName = null;

  // Per-session message cache: Map<sessionId, Message[]>
  const _sessionMessages = new Map();

  // DOM refs (set on first use)
  let _panel, _namePrompt, _nameInput, _btnSetName, _messages, _inputArea, _input, _btnSend;

  function _dom() {
    if (_panel) return;
    _panel       = document.getElementById('chatPanel');
    _namePrompt  = document.getElementById('chatNamePrompt');
    _nameInput   = document.getElementById('chatNameInput');
    _btnSetName  = document.getElementById('btnChatSetName');
    _messages    = document.getElementById('chatMessages');
    _inputArea   = document.getElementById('chatInputArea');
    _input       = document.getElementById('chatInput');
    _btnSend     = document.getElementById('btnChatSend');
  }

  // ------------------------------------------------------------------ init
  function init(socket) {
    _socket = socket;

    socket.on('chat:message', (msg) => {
      _storeMessage(msg.sessionId || _activeSessionId, msg);
      if (msg.sessionId === _activeSessionId || !msg.sessionId) {
        _dom();
        _appendMessage(msg);
      }
    });

    socket.on('chat:history', ({ messages }) => {
      if (!_activeSessionId) return;
      _sessionMessages.set(_activeSessionId, messages || []);
      _dom();
      _renderHistory(messages || []);
    });

    // Share-mode: show full sidebar as chat immediately
    if (window._shareMode) {
      _dom();
      // Right sidebar: show it + mark as share-mode-chat
      const sidebar = document.getElementById('sidebarRight');
      if (sidebar) {
        sidebar.classList.remove('collapsed');
        sidebar.classList.add('chat-active', 'share-mode-chat');
      }
      const expandBtn = document.getElementById('btnExpandRight');
      if (expandBtn) expandBtn.style.display = 'none';

      // Name setup
      _setupNamePrompt();
    }
  }

  // ------------------------------------------------- name prompt (viewers)
  function _setupNamePrompt() {
    _dom();
    const stored = localStorage.getItem('chatDisplayName');
    if (stored && stored.trim()) {
      _currentName = stored.trim();
      _showInputArea();
    } else {
      _namePrompt.style.display = 'flex';
      _messages.style.display = 'none';
      _inputArea.style.display = 'none';

      _btnSetName.addEventListener('click', _confirmName);
      _nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') _confirmName();
      });
      setTimeout(() => _nameInput.focus(), 100);
    }
  }

  function _confirmName() {
    _dom();
    const val = _nameInput.value.trim();
    if (!val) {
      _nameInput.classList.add('input-error');
      setTimeout(() => _nameInput.classList.remove('input-error'), 800);
      return;
    }
    _currentName = val;
    localStorage.setItem('chatDisplayName', val);
    _namePrompt.style.display = 'none';
    _showInputArea();
  }

  function _showInputArea() {
    _dom();
    _messages.style.display = '';
    _inputArea.style.display = '';

    if (!_btnSend._chatBound) {
      _btnSend._chatBound = true;
      _btnSend.addEventListener('click', _send);
      _input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
      });
    }
    _input.focus();
  }

  // ---------------------------------------------------------- send message
  function _send() {
    _dom();
    const text = _input.value.trim();
    if (!text || !_activeSessionId) return;

    const name = _currentName || window._username || 'Anonym';
    _socket.emit('chat:message', { sessionId: _activeSessionId, from: name, message: text });
    _input.value = '';
    _input.focus();
  }

  // ------------------------------------------------------ render messages
  function _renderHistory(messages) {
    _messages.innerHTML = '';
    for (const msg of messages) _appendMessage(msg);
  }

  function _appendMessage(msg) {
    _dom();
    const myName = _currentName || window._username || '';
    const isOwn  = msg.from === myName;

    const wrap = document.createElement('div');
    wrap.className = 'chat-message' + (isOwn ? ' own' : '');

    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-from';
    nameSpan.textContent = msg.from;
    const roleSpan = document.createElement('span');
    roleSpan.className = 'chat-role chat-role-' + (msg.role || 'viewer');
    roleSpan.textContent = _roleLabel(msg.role);
    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-time';
    timeSpan.textContent = _fmtTime(msg.ts);
    meta.appendChild(nameSpan);
    meta.appendChild(roleSpan);
    meta.appendChild(timeSpan);

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = msg.message; // textContent – no XSS

    wrap.appendChild(meta);
    wrap.appendChild(bubble);
    _messages.appendChild(wrap);
    _messages.scrollTop = _messages.scrollHeight;
  }

  function _roleLabel(role) {
    if (role === 'owner')    return 'Host';
    if (role === 'coworker') return 'Coworker';
    if (role === 'viewer')   return 'Viewer';
    return '';
  }

  function _fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function _storeMessage(sessionId, msg) {
    if (!sessionId) return;
    if (!_sessionMessages.has(sessionId)) _sessionMessages.set(sessionId, []);
    _sessionMessages.get(sessionId).push(msg);
  }

  // --------------------------------- activate / deactivate (host-side)
  function activate(sessionId) {
    _dom();
    _activeSessionId = sessionId;

    const sidebar = document.getElementById('sidebarRight');
    if (!sidebar) return;
    sidebar.classList.add('chat-active');

    // Expand if collapsed
    if (sidebar.classList.contains('collapsed')) {
      sidebar.classList.remove('collapsed');
      const expandBtn = document.getElementById('btnExpandRight');
      if (expandBtn) expandBtn.style.display = 'none';
    }

    // Set host name
    _currentName = window._username || null;
    _inputArea.style.display = '';
    _messages.style.display  = '';
    _namePrompt.style.display = 'none';

    // Wire up send (idempotent: only once)
    if (!_btnSend._chatBound) {
      _btnSend._chatBound = true;
      _btnSend.addEventListener('click', _send);
      _input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
      });
    }

    // Render cached messages for this session
    const cached = _sessionMessages.get(sessionId) || [];
    _renderHistory(cached);
  }

  function deactivate() {
    _dom();
    _activeSessionId = null;
    const sidebar = document.getElementById('sidebarRight');
    if (sidebar) sidebar.classList.remove('chat-active');
    if (_messages) _messages.innerHTML = '';
  }

  // Called when active tab switches (host switching sessions)
  // Also called by app.js for viewers/coworkers after session:joined-shared
  function switchSession(sessionId) {
    if (!sessionId) { deactivate(); return; }
    _activeSessionId = sessionId;
    _dom();

    // For viewers/coworkers: ensure the input area is visible after name was confirmed
    if (window._shareMode) {
      // If name is already set (from localStorage or earlier confirmation), show input
      if (_currentName) {
        _inputArea.style.display = '';
        _messages.style.display  = '';
        _namePrompt.style.display = 'none';
      }
      // Otherwise _setupNamePrompt already showed the prompt; _confirmName will call _showInputArea
      // which works fine now that _activeSessionId is set.
    }

    const cached = _sessionMessages.get(sessionId) || [];
    _renderHistory(cached);
  }

  return { init, activate, deactivate, switchSession };
})();

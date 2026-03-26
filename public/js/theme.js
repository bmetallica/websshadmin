const Theme = {
  current: 'neon-dark',

  themes: {
    'neon-dark': {
      label: 'Neon Dark',
      css: {
        '--bg-dark': '#0a0e1a',
        '--bg-panel': 'rgba(13, 18, 36, 0.85)',
        '--bg-panel-solid': '#0d1224',
        '--bg-input': 'rgba(15, 25, 50, 0.9)',
        '--bg-hover': 'rgba(0, 234, 255, 0.06)',
        '--border': 'rgba(0, 234, 255, 0.12)',
        '--border-bright': 'rgba(0, 234, 255, 0.3)',
        '--accent': '#00eaff',
        '--accent-secondary': '#7b61ff',
        '--accent-pink': '#ff3c78',
        '--accent-green': '#00ff9d',
        '--glow-accent': '0 0 20px rgba(0, 234, 255, 0.15)',
        '--glow-strong': '0 0 30px rgba(0, 234, 255, 0.25)',
        '--text': '#e4e8f1',
        '--text-dim': 'rgba(180, 190, 210, 0.7)',
        '--text-muted': 'rgba(130, 145, 170, 0.5)',
        '--grid-color': 'rgba(0, 234, 255, 0.03)',
      },
      xterm: {
        background: '#050810',
        foreground: '#e4e8f1',
        cursor: '#00eaff',
        cursorAccent: '#050810',
        selectionBackground: 'rgba(0, 234, 255, 0.2)',
        selectionForeground: '#ffffff',
        black: '#0a0e1a',
        red: '#ff3c78',
        green: '#00ff9d',
        yellow: '#ffcc00',
        blue: '#00aaff',
        magenta: '#7b61ff',
        cyan: '#00eaff',
        white: '#e4e8f1',
        brightBlack: '#3a4260',
        brightRed: '#ff6b9d',
        brightGreen: '#50ffba',
        brightYellow: '#ffe066',
        brightBlue: '#50ccff',
        brightMagenta: '#a88bff',
        brightCyan: '#50f0ff',
        brightWhite: '#ffffff',
      },
      ace: 'ace/theme/tomorrow_night',
    },

    'midnight-blue': {
      label: 'Midnight Blue',
      css: {
        '--bg-dark': '#0b1628',
        '--bg-panel': 'rgba(14, 26, 50, 0.9)',
        '--bg-panel-solid': '#0e1a32',
        '--bg-input': 'rgba(16, 32, 64, 0.9)',
        '--bg-hover': 'rgba(66, 153, 255, 0.08)',
        '--border': 'rgba(66, 153, 255, 0.15)',
        '--border-bright': 'rgba(66, 153, 255, 0.35)',
        '--accent': '#4299ff',
        '--accent-secondary': '#a78bfa',
        '--accent-pink': '#f472b6',
        '--accent-green': '#34d399',
        '--glow-accent': '0 0 20px rgba(66, 153, 255, 0.15)',
        '--glow-strong': '0 0 30px rgba(66, 153, 255, 0.25)',
        '--text': '#e2e8f0',
        '--text-dim': 'rgba(160, 180, 210, 0.7)',
        '--text-muted': 'rgba(120, 140, 170, 0.5)',
        '--grid-color': 'rgba(66, 153, 255, 0.03)',
      },
      xterm: {
        background: '#080f1e',
        foreground: '#e2e8f0',
        cursor: '#4299ff',
        cursorAccent: '#080f1e',
        selectionBackground: 'rgba(66, 153, 255, 0.25)',
        selectionForeground: '#ffffff',
        black: '#0b1628',
        red: '#f472b6',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#4299ff',
        magenta: '#a78bfa',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#334155',
        brightRed: '#fb7da8',
        brightGreen: '#6ee7b7',
        brightYellow: '#fcd34d',
        brightBlue: '#7ab8ff',
        brightMagenta: '#c4b5fd',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      ace: 'ace/theme/tomorrow_night_blue',
    },

    'emerald': {
      label: 'Emerald',
      css: {
        '--bg-dark': '#0a1510',
        '--bg-panel': 'rgba(12, 24, 18, 0.9)',
        '--bg-panel-solid': '#0c1812',
        '--bg-input': 'rgba(14, 30, 22, 0.9)',
        '--bg-hover': 'rgba(16, 185, 129, 0.08)',
        '--border': 'rgba(16, 185, 129, 0.15)',
        '--border-bright': 'rgba(16, 185, 129, 0.35)',
        '--accent': '#10b981',
        '--accent-secondary': '#06b6d4',
        '--accent-pink': '#f43f5e',
        '--accent-green': '#34d399',
        '--glow-accent': '0 0 20px rgba(16, 185, 129, 0.15)',
        '--glow-strong': '0 0 30px rgba(16, 185, 129, 0.25)',
        '--text': '#e2e8f0',
        '--text-dim': 'rgba(160, 200, 180, 0.7)',
        '--text-muted': 'rgba(120, 160, 140, 0.5)',
        '--grid-color': 'rgba(16, 185, 129, 0.03)',
      },
      xterm: {
        background: '#060e0a',
        foreground: '#e2e8f0',
        cursor: '#10b981',
        cursorAccent: '#060e0a',
        selectionBackground: 'rgba(16, 185, 129, 0.25)',
        selectionForeground: '#ffffff',
        black: '#0a1510',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#06b6d4',
        magenta: '#8b5cf6',
        cyan: '#14b8a6',
        white: '#e2e8f0',
        brightBlack: '#2d4a3e',
        brightRed: '#fb7185',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#22d3ee',
        brightMagenta: '#a78bfa',
        brightCyan: '#2dd4bf',
        brightWhite: '#f8fafc',
      },
      ace: 'ace/theme/monokai',
    },

    'light': {
      label: 'Light',
      css: {
        '--bg-dark': '#f0f2f5',
        '--bg-panel': 'rgba(255, 255, 255, 0.92)',
        '--bg-panel-solid': '#ffffff',
        '--bg-input': 'rgba(240, 242, 245, 0.95)',
        '--bg-hover': 'rgba(59, 130, 246, 0.06)',
        '--border': 'rgba(0, 0, 0, 0.1)',
        '--border-bright': 'rgba(59, 130, 246, 0.3)',
        '--accent': '#2563eb',
        '--accent-secondary': '#7c3aed',
        '--accent-pink': '#e11d48',
        '--accent-green': '#059669',
        '--glow-accent': '0 0 12px rgba(59, 130, 246, 0.1)',
        '--glow-strong': '0 0 20px rgba(59, 130, 246, 0.15)',
        '--text': '#1e293b',
        '--text-dim': 'rgba(51, 65, 85, 0.8)',
        '--text-muted': 'rgba(100, 116, 139, 0.6)',
        '--grid-color': 'rgba(0, 0, 0, 0.03)',
      },
      xterm: {
        background: '#ffffff',
        foreground: '#1e293b',
        cursor: '#2563eb',
        cursorAccent: '#ffffff',
        selectionBackground: 'rgba(59, 130, 246, 0.2)',
        selectionForeground: '#1e293b',
        black: '#1e293b',
        red: '#e11d48',
        green: '#059669',
        yellow: '#d97706',
        blue: '#2563eb',
        magenta: '#7c3aed',
        cyan: '#0891b2',
        white: '#f1f5f9',
        brightBlack: '#64748b',
        brightRed: '#f43f5e',
        brightGreen: '#10b981',
        brightYellow: '#f59e0b',
        brightBlue: '#3b82f6',
        brightMagenta: '#8b5cf6',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff',
      },
      ace: 'ace/theme/chrome',
    },
  },

  init() {
    // Load saved theme
    const saved = localStorage.getItem('websshadmin-theme');
    if (saved && this.themes[saved]) {
      this.current = saved;
    }
    this.apply(this.current);

    // Build theme selector
    this._buildSelector();
  },

  apply(themeId) {
    const theme = this.themes[themeId];
    if (!theme) return;
    this.current = themeId;

    // Apply CSS variables
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(theme.css)) {
      root.style.setProperty(prop, value);
    }

    // Update grid background
    document.body.style.setProperty('--grid-color', theme.css['--grid-color']);

    // Update xterm terminals
    if (typeof Terminal !== 'undefined' && Terminal.terminals) {
      for (const [, entry] of Terminal.terminals) {
        entry.term.options.theme = theme.xterm;
      }
    }

    // Update ace editor
    if (typeof SftpBrowser !== 'undefined' && SftpBrowser._aceEditor) {
      SftpBrowser._aceEditor.setTheme(theme.ace);
    }

    // Save
    localStorage.setItem('websshadmin-theme', themeId);

    // Update selector active state
    document.querySelectorAll('.theme-option').forEach(el => {
      el.classList.toggle('active', el.dataset.theme === themeId);
    });
  },

  _buildSelector() {
    const list = document.getElementById('settingsThemeList');
    if (!list) return;

    for (const [id, theme] of Object.entries(this.themes)) {
      const opt = document.createElement('div');
      opt.className = 'theme-option' + (id === this.current ? ' active' : '');
      opt.dataset.theme = id;

      const swatch = document.createElement('span');
      swatch.className = 'theme-swatch';
      swatch.style.background = `linear-gradient(135deg, ${theme.css['--accent']}, ${theme.css['--accent-secondary']})`;

      const label = document.createElement('span');
      label.textContent = theme.label;

      opt.appendChild(swatch);
      opt.appendChild(label);
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        this.apply(id);
      });
      list.appendChild(opt);
    }

    // Settings dropdown toggle
    const dropdown = document.getElementById('settingsDropdown');
    document.getElementById('btnSettings').addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.settings-wrapper')) {
        dropdown.classList.remove('open');
      }
    });

    // Password change from settings
    document.getElementById('settingsChangePassword').addEventListener('click', () => {
      dropdown.classList.remove('open');
      document.getElementById('modalOverlay').style.display = 'flex';
      document.getElementById('oldPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('passwordError').style.display = 'none';
      document.getElementById('oldPassword').focus();
    });
  },

  getXtermTheme() {
    return this.themes[this.current].xterm;
  }
};

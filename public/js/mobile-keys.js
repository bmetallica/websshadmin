// Sondertasten-Leiste für die mobile Oberfläche.
// Android-/iOS-Tastaturen bieten weder Esc/Tab/Pfeile noch Strg – das holt diese Leiste nach.
const MobileKeys = {
  ctrl: false,
  alt: false,
  ctrlLocked: false,
  altLocked: false,
  _send: null,

  // \x1b = ESC, CSI-Sequenzen wie sie xterm auch schickt
  ROW1: [
    { label: 'Esc', data: '\x1b' },
    { label: 'Tab', data: '\t' },
    { label: 'Strg', mod: 'ctrl', wide: true },
    { label: 'Alt', mod: 'alt', wide: true },
    { label: '←', data: '\x1b[D', arrow: 'D' },
    { label: '↑', data: '\x1b[A', arrow: 'A' },
    { label: '↓', data: '\x1b[B', arrow: 'B' },
    { label: '→', data: '\x1b[C', arrow: 'C' },
    { label: 'Entf', data: '\x1b[3~' },
    { label: 'Pos1', data: '\x1b[H' },
    { label: 'Ende', data: '\x1b[F' },
    { label: 'Bild↑', data: '\x1b[5~' },
    { label: 'Bild↓', data: '\x1b[6~' },
    { label: '…', toggleRow2: true },
  ],

  ROW2: [
    { label: '^C', data: '\x03' },
    { label: '^D', data: '\x04' },
    { label: '^W', data: '\x17' },   // nano: Suchen – im Browser nicht per Tastatur erreichbar
    { label: '^Z', data: '\x1a' },
    { label: '^R', data: '\x12' },
    { label: '^L', data: '\x0c' },
    { label: '^X', data: '\x18' },
    { label: '^O', data: '\x0f' },
    { label: '|', data: '|' },
    { label: '~', data: '~' },
    { label: '/', data: '/' },
    { label: '\\', data: '\\' },
    { label: '-', data: '-' },
    { label: '_', data: '_' },
    { label: '*', data: '*' },
    { label: '$', data: '$' },
    { label: 'F1', data: '\x1bOP' },
    { label: 'F2', data: '\x1bOQ' },
    { label: 'F3', data: '\x1bOR' },
    { label: 'F4', data: '\x1bOS' },
    { label: 'F5', data: '\x1b[15~' },
    { label: 'F6', data: '\x1b[17~' },
    { label: 'F7', data: '\x1b[18~' },
    { label: 'F8', data: '\x1b[19~' },
    { label: 'F9', data: '\x1b[20~' },
    { label: 'F10', data: '\x1b[21~' },
    { label: 'F11', data: '\x1b[23~' },
    { label: 'F12', data: '\x1b[24~' },
  ],

  init(sendFn, refocusFn) {
    this._send = sendFn;
    this._refocus = refocusFn;
    this._row1 = document.getElementById('mKeysRow1');
    this._row2 = document.getElementById('mKeysRow2');
    this._build(this._row1, this.ROW1);
    this._build(this._row2, this.ROW2);
  },

  _build(container, keys) {
    for (const key of keys) {
      const btn = document.createElement('button');
      btn.className = 'm-key' + (key.mod ? ' m-key-mod' : '') + (key.wide ? ' m-key-wide' : '');
      btn.textContent = key.label;
      btn.dataset.mod = key.mod || '';
      // Der Button darf den Fokus nicht bekommen, sonst schließt Android die Tastatur
      btn.tabIndex = -1;

      this._bind(btn, key);
      container.appendChild(btn);
    }
  },

  // Pointer-Events statt touch+mouse: Ein Fingertipp löst sonst erst die Touch-
  // und danach die synthetischen Maus-Events aus – ein Modifier würde dadurch
  // zweimal umgeschaltet und wäre sofort wieder aus.
  _bind(btn, key) {
    const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
    let longPress = null;

    const down = (e) => {
      // Verhindert Fokuswechsel (Tastatur bliebe sonst nicht offen) und
      // die Erzeugung zusätzlicher Maus-Events
      if (e && e.cancelable) e.preventDefault();
      if (!key.mod) return;
      longPress = setTimeout(() => {
        longPress = null;
        this._lockMod(key.mod);
      }, 450);
    };

    const up = (e) => {
      if (e && e.cancelable) e.preventDefault();

      if (key.mod) {
        if (longPress) {
          clearTimeout(longPress);
          longPress = null;
          this._vibrate();
          this._toggleMod(key.mod);
        }
      } else if (key.toggleRow2) {
        const hidden = this._row2.style.display === 'none';
        this._row2.style.display = hidden ? '' : 'none';
        btn.classList.toggle('active', hidden);
        if (typeof MobileApp !== 'undefined') MobileApp.fitActive();
      } else {
        this.press(key);
      }

      // Fokus zurück ans Terminal, damit die Bildschirmtastatur offen bleibt
      if (this._refocus) this._refocus();
    };

    const cancel = () => {
      if (longPress) { clearTimeout(longPress); longPress = null; }
    };

    if (hasPointer) {
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', cancel);
      btn.addEventListener('pointerleave', cancel);
    } else {
      btn.addEventListener('mousedown', down);
      btn.addEventListener('mouseup', up);
    }
  },

  press(key) {
    this._vibrate();
    let data = key.data;

    if (key.arrow && (this.ctrl || this.alt)) {
      // CSI 1;<mod><Buchstabe> – 5 = Strg, 3 = Alt, 7 = beides
      const mod = this.ctrl && this.alt ? 7 : this.ctrl ? 5 : 3;
      data = `\x1b[1;${mod}${key.arrow}`;
    } else {
      data = this.applyMods(data);
    }

    if (this._send) this._send(data);
    this._consumeMods();
  },

  // Wendet aktive Modifier auf einen Zeichen-String an
  applyMods(data) {
    if (!data) return data;
    if (this.ctrl && data.length === 1) {
      const code = this._toControl(data);
      if (code !== null) data = code;
    }
    if (this.alt && data.length >= 1 && !data.startsWith('\x1b')) {
      data = '\x1b' + data;
    }
    return data;
  },

  _toControl(ch) {
    const upper = ch.toUpperCase();
    if (upper >= 'A' && upper <= 'Z') return String.fromCharCode(upper.charCodeAt(0) - 64);
    const specials = { '[': '\x1b', '\\': '\x1c', ']': '\x1d', '^': '\x1e', '_': '\x1f', ' ': '\x00' };
    return specials[ch] !== undefined ? specials[ch] : null;
  },

  hasMods() {
    return this.ctrl || this.alt;
  },

  _toggleMod(mod) {
    if (mod === 'ctrl') { this.ctrl = !this.ctrl; this.ctrlLocked = false; }
    else { this.alt = !this.alt; this.altLocked = false; }
    this._render();
  },

  _lockMod(mod) {
    if (mod === 'ctrl') { this.ctrlLocked = !this.ctrlLocked; this.ctrl = this.ctrlLocked; }
    else { this.altLocked = !this.altLocked; this.alt = this.altLocked; }
    this._vibrate(25);
    this._render();
  },

  // Nach einem Tastendruck fallen nicht festgestellte Modifier zurück
  _consumeMods() {
    if (!this.ctrlLocked) this.ctrl = false;
    if (!this.altLocked) this.alt = false;
    this._render();
  },

  // Wird auch von mobile.js aufgerufen, wenn über die Bildschirmtastatur getippt wurde
  consume() {
    this._consumeMods();
  },

  _render() {
    document.querySelectorAll('.m-key-mod').forEach(btn => {
      const mod = btn.dataset.mod;
      const active = mod === 'ctrl' ? this.ctrl : this.alt;
      const locked = mod === 'ctrl' ? this.ctrlLocked : this.altLocked;
      btn.classList.toggle('active', active && !locked);
      btn.classList.toggle('locked', locked);
    });
  },

  _vibrate(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms || 10); } catch { /* egal */ }
    }
  },
};

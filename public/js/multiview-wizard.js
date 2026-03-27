/**
 * MultiviewWizard – 2-step wizard for opening a multiview window.
 * Step 1: Choose active sessions (min 2, max 6)
 * Step 2: Choose layout + drag-and-drop slot arrangement
 * Opens /multiview?sessions=…&layout=…&order=… in a new tab.
 */
const MultiviewWizard = {
  _selected: [],  // sessionIds in selection order
  _layout: null,  // chosen layout id
  _order: [],     // sessionIds in slot order

  init() {
    document.getElementById('btnMultiview').addEventListener('click', () => this.open());
    document.getElementById('btnMvWizardClose').addEventListener('click', () => this.close());
    document.getElementById('btnMvNext').addEventListener('click', () => this._goNext());
    document.getElementById('btnMvBack').addEventListener('click', () => this._goBack());
    document.getElementById('btnMvOpen').addEventListener('click', () => this._openMultiview());
    document.getElementById('mvWizardOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'mvWizardOverlay') this.close();
    });
  },

  open() {
    this._selected = [];
    this._layout = null;
    this._order = [];
    this._renderStep1();
    document.getElementById('mvWizardOverlay').style.display = 'flex';
  },

  close() {
    document.getElementById('mvWizardOverlay').style.display = 'none';
  },

  // ── Step 1 ─────────────────────────────────────────────────────────────────

  _renderStep1() {
    document.getElementById('mvStep1').style.display = 'block';
    document.getElementById('mvStep2').style.display = 'none';
    document.getElementById('btnMvBack').style.display = 'none';
    document.getElementById('btnMvNext').style.display = 'inline-block';
    document.getElementById('btnMvOpen').style.display = 'none';
    document.getElementById('mvWizardTitle').textContent =
      'Multiview – Schritt 1: Sessions wählen';

    const list = document.getElementById('mvSessionList');
    list.innerHTML = '';

    if (typeof Tabs === 'undefined' || Tabs.sessions.size === 0) {
      list.innerHTML =
        '<p class="mv-empty">Keine aktiven Sessions vorhanden.<br>Stelle zuerst SSH-Verbindungen her.</p>';
      document.getElementById('btnMvNext').disabled = true;
      return;
    }

    for (const [sessionId, info] of Tabs.sessions) {
      const card = document.createElement('div');
      card.className = 'mv-session-card';
      card.dataset.sessionId = sessionId;
      const alreadySel = this._selected.includes(sessionId);
      if (alreadySel) card.classList.add('selected');
      card.innerHTML = `
        <div class="mv-card-check"></div>
        <div class="mv-card-info">
          <span class="mv-card-name">${this._esc(info.customName || info.name || sessionId)}</span>
          <span class="mv-card-host">${this._esc(info.host || '')}</span>
        </div>`;
      card.addEventListener('click', () => this._toggleSession(sessionId, card));
      list.appendChild(card);
    }
    this._updateNextBtn();
  },

  _toggleSession(sessionId, card) {
    const idx = this._selected.indexOf(sessionId);
    if (idx >= 0) {
      this._selected.splice(idx, 1);
      card.classList.remove('selected');
    } else {
      if (this._selected.length >= 6) return; // max 6
      this._selected.push(sessionId);
      card.classList.add('selected');
    }
    this._updateNextBtn();
  },

  _updateNextBtn() {
    const btn = document.getElementById('btnMvNext');
    btn.disabled = this._selected.length < 2;
    const hint = document.getElementById('mvStep1Hint');
    const n = this._selected.length;
    if (n === 0) hint.textContent = 'Mindestens 2 aktive Sessions auswählen (max. 6).';
    else if (n === 1) hint.textContent = '1 Session gewählt — noch 1 weitere auswählen.';
    else hint.textContent = `${n} Sessions gewählt. Bereit für Schritt 2.`;
  },

  _goNext() {
    if (this._selected.length < 2) return;
    this._order = [...this._selected];
    this._layout = null;
    this._renderStep2();
  },

  // ── Step 2 ─────────────────────────────────────────────────────────────────

  _goBack() {
    this._renderStep1();
  },

  _renderStep2() {
    document.getElementById('mvStep1').style.display = 'none';
    document.getElementById('mvStep2').style.display = 'block';
    document.getElementById('btnMvBack').style.display = 'inline-block';
    document.getElementById('btnMvNext').style.display = 'none';
    document.getElementById('btnMvOpen').style.display = 'inline-block';
    document.getElementById('btnMvOpen').disabled = true;
    document.getElementById('mvWizardTitle').textContent =
      'Multiview – Schritt 2: Layout & Anordnung';

    this._renderLayoutPicker(this._selected.length);
    this._renderSlots();
  },

  _renderLayoutPicker(n) {
    const picker = document.getElementById('mvLayoutPicker');
    picker.innerHTML = '';
    for (const layout of this._getLayouts(n)) {
      const card = document.createElement('div');
      card.className = 'mv-layout-card';
      card.dataset.layout = layout.id;
      card.innerHTML =
        `<div class="mv-layout-preview">${layout.svg}</div>` +
        `<span class="mv-layout-label">${layout.label}</span>`;
      card.addEventListener('click', () => {
        picker.querySelectorAll('.mv-layout-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        this._layout = layout.id;
        document.getElementById('btnMvOpen').disabled = false;
        this._renderSlots();
      });
      picker.appendChild(card);
    }
  },

  _renderSlots() {
    const container = document.getElementById('mvSlotArrangement');
    container.innerHTML = '';

    if (!this._layout) {
      container.innerHTML = '<p class="mv-empty">Wähle zuerst ein Layout.</p>';
      return;
    }

    const def = this._getLayoutDef(this._layout, this._selected.length);
    if (!def) return;

    const hint = document.createElement('p');
    hint.className = 'mv-slot-hint';
    hint.textContent = 'Reihenfolge per Drag-and-Drop anpassen:';
    container.appendChild(hint);

    const grid = document.createElement('div');
    grid.className = 'mv-slot-grid';
    grid.style.gridTemplateColumns = `repeat(${def.cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${def.rows}, 1fr)`;

    for (let i = 0; i < this._selected.length; i++) {
      const slotInfo = def.slots[i];
      const slot = document.createElement('div');
      slot.className = 'mv-slot';
      slot.dataset.slotIdx = i;
      if (slotInfo.colSpan > 1) slot.style.gridColumn = `span ${slotInfo.colSpan}`;
      if (slotInfo.rowSpan > 1) slot.style.gridRow = `span ${slotInfo.rowSpan}`;

      const sessionId = this._order[i];
      const info = sessionId ? Tabs.sessions.get(sessionId) : null;
      slot.textContent = info
        ? (info.customName || info.name || info.host || sessionId)
        : '?';

      // Drag-and-drop to reorder slots
      slot.draggable = true;
      slot.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
        setTimeout(() => slot.classList.add('dragging'), 0);
      });
      slot.addEventListener('dragend', () => slot.classList.remove('dragging'));
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag-over');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const toIdx = i;
        if (fromIdx === toIdx) return;
        [this._order[fromIdx], this._order[toIdx]] =
          [this._order[toIdx], this._order[fromIdx]];
        this._renderSlots();
        // Restore selected layout card highlight
        const picker = document.getElementById('mvLayoutPicker');
        picker.querySelectorAll('.mv-layout-card').forEach(c => {
          c.classList.toggle('selected', c.dataset.layout === this._layout);
        });
      });

      grid.appendChild(slot);
    }
    container.appendChild(grid);
  },

  // ── Open multiview ─────────────────────────────────────────────────────────

  _openMultiview() {
    if (!this._layout || this._selected.length < 2) return;
    const url =
      `/multiview?sessions=${encodeURIComponent(this._selected.join(','))}` +
      `&layout=${encodeURIComponent(this._layout)}` +
      `&order=${encodeURIComponent(this._order.join(','))}`;
    window.open(url, '_blank');
    this.close();
  },

  // ── Layout data ────────────────────────────────────────────────────────────

  _getLayouts(n) {
    // Helper shorthands for SVG generation
    const W = 42, H = 28;
    const hdr = `<svg viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
    const ft = '</svg>';
    const R = (x, y, w, h) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>`;

    const G = (x, y, w, h, vW, vH) =>
      `<svg viewBox="0 0 ${vW} ${vH}" fill="none" xmlns="http://www.w3.org/2000/svg" width="${vW}" height="${vH}">`;

    const layouts = {
      2: [
        {
          id: '2col', label: 'Nebeneinander',
          svg: `${hdr}${R(1,1,19,26)}${R(22,1,19,26)}${ft}`,
        },
        {
          id: '2row', label: 'Übereinander',
          svg: `${hdr}${R(1,1,40,12)}${R(1,15,40,12)}${ft}`,
        },
      ],
      3: [
        {
          id: '3col', label: '3 Spalten',
          svg: `${hdr}${R(1,1,12,26)}${R(15,1,12,26)}${R(29,1,12,26)}${ft}`,
        },
        {
          id: '3row', label: '3 Zeilen',
          svg: `${hdr}${R(1,1,40,7)}${R(1,10,40,8)}${R(1,20,40,7)}${ft}`,
        },
        {
          id: '2top-1bot', label: '2 oben / 1 unten',
          svg: `${hdr}${R(1,1,19,12)}${R(22,1,19,12)}${R(1,15,40,12)}${ft}`,
        },
        {
          id: '1top-2bot', label: '1 oben / 2 unten',
          svg: `${hdr}${R(1,1,40,12)}${R(1,15,19,12)}${R(22,15,19,12)}${ft}`,
        },
      ],
      4: [
        {
          id: '2x2', label: '2×2 Raster',
          svg: `${hdr}${R(1,1,19,12)}${R(22,1,19,12)}${R(1,15,19,12)}${R(22,15,19,12)}${ft}`,
        },
        {
          id: '4col', label: '4 Spalten',
          svg: `${hdr}${R(1,1,9,26)}${R(11,1,9,26)}${R(22,1,9,26)}${R(32,1,9,26)}${ft}`,
        },
        {
          id: '4row', label: '4 Zeilen',
          svg: `${hdr}${R(1,1,40,5)}${R(1,8,40,5)}${R(1,15,40,5)}${R(1,22,40,5)}${ft}`,
        },
        {
          id: '3top-1bot', label: '3 oben / 1 unten',
          svg: `${hdr}${R(1,1,12,12)}${R(15,1,12,12)}${R(29,1,12,12)}${R(1,15,40,12)}${ft}`,
        },
        {
          id: '1top-3bot', label: '1 oben / 3 unten',
          svg: `${hdr}${R(1,1,40,12)}${R(1,15,12,12)}${R(15,15,12,12)}${R(29,15,12,12)}${ft}`,
        },
      ],
      5: [
        {
          id: '2x2+1bot', label: '2×2 + 1 unten',
          svg: `<svg viewBox="0 0 42 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="42" height="40">` +
               `${R(1,1,19,11)}${R(22,1,19,11)}${R(1,14,19,11)}${R(22,14,19,11)}${R(1,27,40,12)}</svg>`,
        },
        {
          id: '1top+2x2', label: '1 oben + 2×2',
          svg: `<svg viewBox="0 0 42 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="42" height="40">` +
               `${R(1,1,40,12)}${R(1,15,19,11)}${R(22,15,19,11)}${R(1,28,19,11)}${R(22,28,19,11)}</svg>`,
        },
      ],
      6: [
        {
          id: '2x3', label: '2×3 Raster',
          svg: `<svg viewBox="0 0 42 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="42" height="40">` +
               `${R(1,1,19,11)}${R(22,1,19,11)}${R(1,14,19,11)}${R(22,14,19,11)}${R(1,27,19,12)}${R(22,27,19,12)}</svg>`,
        },
        {
          id: '3x2', label: '3×2 Raster',
          svg: `${hdr}${R(1,1,12,12)}${R(15,1,12,12)}${R(29,1,12,12)}${R(1,15,12,12)}${R(15,15,12,12)}${R(29,15,12,12)}${ft}`,
        },
        {
          id: '6col', label: '6 Spalten',
          svg: `<svg viewBox="0 0 52 28" fill="none" xmlns="http://www.w3.org/2000/svg" width="52" height="28">` +
               `${R(1,1,7,26)}${R(9.5,1,7,26)}${R(18,1,7,26)}${R(26.5,1,7,26)}${R(35,1,7,26)}${R(43.5,1,7.5,26)}</svg>`,
        },
        {
          id: '6row', label: '6 Zeilen',
          svg: `${hdr}${R(1,1,40,3)}${R(1,5,40,3)}${R(1,9,40,3)}${R(1,13,40,3)}${R(1,17,40,3)}${R(1,21,40,5)}${ft}`,
        },
      ],
    };
    return layouts[n] || [];
  },

  _getLayoutDef(layoutId, n) {
    const s = (c = 1, r = 1) => ({ colSpan: c, rowSpan: r });
    const defs = {
      '2col':      { cols: 2, rows: 1, slots: [s(), s()] },
      '2row':      { cols: 1, rows: 2, slots: [s(), s()] },
      '3col':      { cols: 3, rows: 1, slots: [s(), s(), s()] },
      '3row':      { cols: 1, rows: 3, slots: [s(), s(), s()] },
      '2top-1bot': { cols: 2, rows: 2, slots: [s(), s(), s(2)] },
      '1top-2bot': { cols: 2, rows: 2, slots: [s(2), s(), s()] },
      '2x2':       { cols: 2, rows: 2, slots: [s(), s(), s(), s()] },
      '4col':      { cols: 4, rows: 1, slots: [s(), s(), s(), s()] },
      '4row':      { cols: 1, rows: 4, slots: [s(), s(), s(), s()] },
      '3top-1bot': { cols: 3, rows: 2, slots: [s(), s(), s(), s(3)] },
      '1top-3bot': { cols: 3, rows: 2, slots: [s(3), s(), s(), s()] },
      '2x2+1bot':  { cols: 2, rows: 3, slots: [s(), s(), s(), s(), s(2)] },
      '1top+2x2':  { cols: 2, rows: 3, slots: [s(2), s(), s(), s(), s()] },
      '2x3':       { cols: 2, rows: 3, slots: [s(), s(), s(), s(), s(), s()] },
      '3x2':       { cols: 3, rows: 2, slots: [s(), s(), s(), s(), s(), s()] },
      '6col':      { cols: 6, rows: 1, slots: [s(), s(), s(), s(), s(), s()] },
      '6row':      { cols: 1, rows: 6, slots: [s(), s(), s(), s(), s(), s()] },
    };
    return defs[layoutId] || null;
  },

  // ── Utilities ──────────────────────────────────────────────────────────────

  _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

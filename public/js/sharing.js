const Sharing = {
  socket: null,

  init(socket) {
    this.socket = socket;
    this.overlay = document.getElementById('shareModalOverlay');
    if (!this.overlay) return;

    document.getElementById('btnCloseShareModal').addEventListener('click', () => this.close());
    document.getElementById('btnCreateShare').addEventListener('click', () => this._createShare());

    // Reiter: Freigaben / Zeitgesteuerte Befehle
    this.overlay.querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => this._showPane(tab.dataset.pane));
    });
  },

  _showPane(paneId) {
    this.overlay.querySelectorAll('.modal-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.pane === paneId);
    });
    this.overlay.querySelectorAll('.modal-pane').forEach(p => {
      p.style.display = p.id === paneId ? '' : 'none';
    });
    if (paneId === 'sharePaneSchedules' && typeof Schedules !== 'undefined') {
      Schedules.resetForm();
      Schedules.load();
    }
  },

  open(sessionId) {
    this.currentSessionId = sessionId;
    this.overlay.style.display = 'flex';
    if (typeof Schedules !== 'undefined') Schedules.setSession(sessionId);
    this._showPane('sharePaneShares');
    this._loadShares();
  },

  close() {
    this.overlay.style.display = 'none';
  },

  async _loadShares() {
    const list = document.getElementById('shareList');
    list.innerHTML = '<div style="color:var(--text-muted)">Laden...</div>';

    try {
      const res = await fetch(`/api/sharing/sessions/${this.currentSessionId}/shares`);
      if (!res.ok) {
        list.innerHTML = '<div style="color:var(--text-muted)">Fehler beim Laden</div>';
        return;
      }
      const shares = await res.json();
      this._renderShares(shares);
    } catch {
      list.innerHTML = '<div style="color:var(--text-muted)">Verbindungsfehler</div>';
    }
  },

  _renderShares(shares) {
    const list = document.getElementById('shareList');
    list.innerHTML = '';

    // Update chat state based on current share count
    if (typeof Chat !== 'undefined') {
      if (shares.length > 0) {
        Chat.activate(this.currentSessionId);
      } else {
        Chat.deactivate();
      }
    }

    if (shares.length === 0) {
      list.innerHTML = '<div style="color:var(--text-muted)">Keine aktiven Freigaben</div>';
      return;
    }

    for (const share of shares) {
      const row = document.createElement('div');
      row.className = 'share-row';

      const roleClass = share.role === 'coworker' ? 'share-role-coworker' : 'share-role-viewer';
      const shareUrl = `${location.origin}/app?share=${share.token}`;

      const top = document.createElement('div');
      top.className = 'share-row-top';
      top.innerHTML = `
        <span class="share-label">${this._esc(share.label || 'Freigabe')}</span>
        <span class="share-role ${roleClass}">${share.role}</span>
        ${share.role === 'viewer' ? '<button class="share-btn share-upgrade" title="Zum Coworker hochstufen">&#8679;</button>' : ''}
        <button class="share-btn share-revoke" title="Widerrufen">&times;</button>
      `;

      const urlField = document.createElement('input');
      urlField.type = 'text';
      urlField.className = 'share-url-field';
      urlField.value = shareUrl;
      urlField.readOnly = true;
      urlField.addEventListener('focus', () => urlField.select());
      urlField.addEventListener('click', () => urlField.select());

      const upgradeBtn = top.querySelector('.share-upgrade');
      if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => this._upgradeShare(share.id));
      }
      top.querySelector('.share-revoke').addEventListener('click', () => this._revokeShare(share.id));

      row.appendChild(top);
      row.appendChild(urlField);
      list.appendChild(row);
    }
  },

  async _createShare() {
    const role = document.getElementById('shareRole').value;
    const label = document.getElementById('shareLabel').value.trim() || null;

    try {
      const res = await fetch(`/api/sharing/sessions/${this.currentSessionId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, label }),
      });

      if (res.ok) {
        document.getElementById('shareLabel').value = '';
        await this._loadShares();
        // Chat.activate is called inside _renderShares after reload
      }
    } catch { /* ignore */ }
  },

  async _upgradeShare(tokenId) {
    try {
      await fetch(`/api/sharing/share-tokens/${tokenId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'coworker' }),
      });
      await this._loadShares();
    } catch { /* ignore */ }
  },

  async _revokeShare(tokenId) {
    try {
      await fetch(`/api/sharing/share-tokens/${tokenId}`, { method: 'DELETE' });
      await this._loadShares();
    } catch { /* ignore */ }
  },

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

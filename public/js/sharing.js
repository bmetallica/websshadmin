const Sharing = {
  socket: null,

  init(socket) {
    this.socket = socket;
    this.overlay = document.getElementById('shareModalOverlay');
    if (!this.overlay) return;

    document.getElementById('btnCloseShareModal').addEventListener('click', () => this.close());
    document.getElementById('btnCreateShare').addEventListener('click', () => this._createShare());
  },

  open(sessionId) {
    this.currentSessionId = sessionId;
    this.overlay.style.display = 'flex';
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

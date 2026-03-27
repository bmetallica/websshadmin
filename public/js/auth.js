const Auth = {
  init() {
    document.getElementById('btnCancelPassword').addEventListener('click', () => {
      document.getElementById('modalOverlay').style.display = 'none';
    });

    document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('passwordError');
      errEl.style.display = 'none';

      const oldPassword = document.getElementById('oldPassword').value;
      const newPassword = document.getElementById('newPassword').value;

      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPassword, newPassword }),
        });
        if (res.ok) {
          document.getElementById('modalOverlay').style.display = 'none';
          alert('Passwort geändert!');
        } else {
          const data = await res.json();
          errEl.textContent = data.error;
          errEl.style.display = 'block';
        }
      } catch {
        errEl.textContent = 'Fehler';
        errEl.style.display = 'block';
      }
    });

    document.getElementById('btnLogout').addEventListener('click', async () => {
      Terminal._intentionalNavigation = true;
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }
};

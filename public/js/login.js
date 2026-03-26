// Save share token from URL immediately (before any redirects)
const _urlParams = new URLSearchParams(window.location.search);
if (_urlParams.get('share')) {
  sessionStorage.setItem('shareToken', _urlParams.get('share'));
}

// Check if AD is enabled and show toggle
fetch('/api/auth/check')
  .then(r => r.json())
  .then(info => {
    if (info.authenticated) {
      const shareToken = sessionStorage.getItem('shareToken');
      if (shareToken) {
        sessionStorage.removeItem('shareToken');
        window.location.href = '/app?share=' + encodeURIComponent(shareToken);
      } else {
        window.location.href = '/app';
      }
      return;
    }
    if (info.adEnabled) {
      const toggle = document.getElementById('loginMethodToggle');
      toggle.classList.add('visible');

      document.getElementById('btnMethodLocal').addEventListener('click', () => {
        document.getElementById('loginMethod').value = 'local';
        document.getElementById('btnMethodLocal').classList.add('active');
        document.getElementById('btnMethodAD').classList.remove('active');
      });
      document.getElementById('btnMethodAD').addEventListener('click', () => {
        document.getElementById('loginMethod').value = 'ad';
        document.getElementById('btnMethodAD').classList.add('active');
        document.getElementById('btnMethodLocal').classList.remove('active');
      });
    }

  })
  .catch(() => {});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('error');
  errEl.style.display = 'none';

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const method = document.getElementById('loginMethod').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, method }),
    });
    if (res.ok) {
      const shareToken = sessionStorage.getItem('shareToken');
      if (shareToken) {
        sessionStorage.removeItem('shareToken');
        window.location.href = '/app?share=' + encodeURIComponent(shareToken);
      } else {
        window.location.href = '/app';
      }
    } else {
      const data = await res.json();
      errEl.textContent = data.error || 'Login fehlgeschlagen';
      errEl.style.display = 'block';
    }
  } catch (err) {
    errEl.textContent = 'Verbindungsfehler';
    errEl.style.display = 'block';
  }
});

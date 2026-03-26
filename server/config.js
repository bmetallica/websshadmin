const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Auto-generate a persistent session secret if not provided via env
function getSessionSecret() {
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }

  // Persist generated secret so it survives restarts
  const secretPath = path.join(process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(__dirname, '..', 'data'), '.session-secret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (e) { /* file doesn't exist yet */ }

  const secret = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    console.log('[Security] Generated new session secret');
  } catch (e) {
    console.warn('[Security] Could not persist session secret:', e.message);
  }
  return secret;
}

// AD/LDAP configuration (optional)
const ad = {
  enabled: process.env.AD_ENABLED === 'true',
  url: process.env.AD_URL || '',
  baseDN: process.env.AD_BASE_DN || '',
  bindDN: process.env.AD_BIND_DN || '',
  bindPassword: process.env.AD_BIND_PASSWORD || '',
  userFilter: process.env.AD_USER_FILTER || '(sAMAccountName={{username}})',
  groupFilter: process.env.AD_GROUP_FILTER || '(member={{dn}})',
  groupMap: (() => {
    try { return JSON.parse(process.env.AD_GROUP_MAP || '{}'); }
    catch { return {}; }
  })(),
  defaultRole: process.env.AD_DEFAULT_ROLE || 'user',
  adminGroups: (process.env.AD_ADMIN_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean),
};

module.exports = {
  port: parseInt(process.env.PORT, 10) || 2222,
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'database.sqlite'),
  scriptsPath: process.env.SCRIPTS_PATH || path.join(__dirname, '..', 'scripts'),
  sessionSecret: getSessionSecret(),
  ad,
};

const crypto = require('crypto');
const config = require('../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'websshadmin-encryption-salt';

// Derive a 256-bit key from the session secret
let _key = null;
function _getKey() {
  if (!_key) {
    _key = crypto.scryptSync(config.sessionSecret, SALT, 32);
  }
  return _key;
}

/**
 * Encrypt a plaintext string. Returns base64-encoded string with format:
 * iv(16) + authTag(16) + ciphertext
 */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = _getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: iv + tag + ciphertext
  const packed = Buffer.concat([iv, tag, encrypted]);
  return 'enc:' + packed.toString('base64');
}

/**
 * Decrypt a string previously encrypted with encrypt().
 * Returns null if input is null/empty.
 * If input doesn't start with 'enc:', returns it as-is (plaintext migration).
 */
function decrypt(encryptedStr) {
  if (!encryptedStr) return null;

  // Not encrypted yet (plaintext from before migration)
  if (!encryptedStr.startsWith('enc:')) {
    return encryptedStr;
  }

  const key = _getKey();
  const packed = Buffer.from(encryptedStr.slice(4), 'base64');
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Migrate existing plaintext credentials to encrypted form.
 * Called once at startup.
 */
function migrateConnections(db) {
  const rows = db.prepare('SELECT id, password, private_key, passphrase FROM connections').all();
  const update = db.prepare('UPDATE connections SET password = ?, private_key = ?, passphrase = ? WHERE id = ?');

  let migrated = 0;
  for (const row of rows) {
    let changed = false;
    let pw = row.password;
    let pk = row.private_key;
    let pp = row.passphrase;

    if (pw && !pw.startsWith('enc:')) { pw = encrypt(pw); changed = true; }
    if (pk && !pk.startsWith('enc:')) { pk = encrypt(pk); changed = true; }
    if (pp && !pp.startsWith('enc:')) { pp = encrypt(pp); changed = true; }

    if (changed) {
      update.run(pw, pk, pp, row.id);
      migrated++;
    }
  }
  if (migrated > 0) {
    console.log(`[Security] Migrated ${migrated} connection(s) to encrypted credentials`);
  }
}

module.exports = { encrypt, decrypt, migrateConnections };

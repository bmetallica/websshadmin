const { Client } = require('ssh2');
const { decrypt } = require('./encryption');

function createSSHConnection(profile, callback) {
  const conn = new Client();

  const config = {
    host: profile.host,
    port: profile.port || 22,
    username: profile.username,
    readyTimeout: 10000,
    algorithms: {
      serverHostKey: ['ssh-rsa', 'rsa-sha2-256', 'rsa-sha2-512', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-ed25519'],
      kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'],
    },
  };

  if (profile.auth_method === 'key' && profile.private_key) {
    config.privateKey = decrypt(profile.private_key);
    const pp = decrypt(profile.passphrase);
    if (pp) config.passphrase = pp;
  } else {
    const pw = decrypt(profile.password);
    if (pw) {
      config.password = pw;
      config.tryKeyboard = true;
    }
  }

  conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
    const pw = profile.auth_method !== 'key' ? decrypt(profile.password) : '';
    finish(prompts.map(() => pw || ''));
  });

  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
      if (err) return callback(err);
      callback(null, conn, stream);
    });
  });

  conn.on('error', (err) => {
    callback(err);
  });

  conn.connect(config);
}

module.exports = { createSSHConnection };

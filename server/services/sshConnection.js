const { Client } = require('ssh2');
const { decrypt } = require('./encryption');

function createSSHConnection(profile, callback) {
  const conn = new Client();

  const config = {
    host: profile.host,
    port: profile.port || 22,
    username: profile.username,
    readyTimeout: 10000,
  };

  if (profile.auth_method === 'key' && profile.private_key) {
    config.privateKey = decrypt(profile.private_key);
    const pp = decrypt(profile.passphrase);
    if (pp) config.passphrase = pp;
  } else {
    const pw = decrypt(profile.password);
    if (pw) config.password = pw;
  }

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

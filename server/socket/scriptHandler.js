const fs = require('fs');
const path = require('path');
const config = require('../config');
const sessionManager = require('../services/sessionManager');

module.exports = function (io, socket) {
  socket.on('script:execute', ({ sessionId, scriptPath }) => {
    const role = sessionManager.getSessionRole(sessionId, socket.id);
    if (!role || role === 'viewer') {
      socket.emit('script:output', { sessionId, message: 'Keine Berechtigung fuer Skriptausfuehrung' });
      return;
    }
    const state = sessionManager.getSession(sessionId);
    if (!state) {
      socket.emit('script:output', { sessionId, message: 'Session not found' });
      return;
    }

    // Path traversal protection
    const localPath = path.resolve(config.scriptsPath, scriptPath);
    if (!localPath.startsWith(path.resolve(config.scriptsPath))) {
      socket.emit('script:output', { sessionId, message: 'Invalid script path' });
      return;
    }
    const filename = path.basename(scriptPath);

    if (!fs.existsSync(localPath)) {
      socket.emit('script:output', { sessionId, message: `File not found: ${scriptPath}` });
      return;
    }

    const fileContent = fs.readFileSync(localPath);

    // Use SFTP to upload, then execute
    state.sshClient.sftp((err, sftp) => {
      if (err) {
        socket.emit('script:output', { sessionId, message: `SFTP error: ${err.message}` });
        return;
      }

      const remotePath = `/tmp/${filename}`;
      const writeStream = sftp.createWriteStream(remotePath);

      writeStream.on('error', (err) => {
        socket.emit('script:output', { sessionId, message: `Upload error: ${err.message}` });
        sftp.end();
      });

      writeStream.on('close', () => {
        sftp.end();
        // chmod +x and execute in the shell
        state.sshClient.exec(`chmod +x ${remotePath}`, (err, stream) => {
          if (err) {
            socket.emit('script:output', { sessionId, message: `chmod error: ${err.message}` });
            return;
          }
          stream.on('close', () => {
            // Write execute command to the shell
            sessionManager.writeToSession(sessionId, `${remotePath}\n`);
            socket.emit('script:output', { sessionId, message: `Executing ${remotePath}` });
          });
          stream.resume();
        });
      });

      writeStream.end(fileContent);
    });
  });
};

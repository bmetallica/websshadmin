const sessionManager = require('../services/sessionManager');
const path = require('path');

module.exports = function (io, socket) {
  // Get SFTP subsystem from existing SSH connection (only owner/coworker)
  function getSftp(sessionId, cb) {
    const role = sessionManager.getSessionRole(sessionId, socket.id);
    if (!role || role === 'viewer') {
      return cb(new Error('Keine SFTP-Berechtigung'));
    }
    const state = sessionManager.getSession(sessionId);
    if (!state || !state.sshClient) {
      return cb(new Error('Session not found or not connected'));
    }
    state.sshClient.sftp((err, sftp) => {
      if (err) return cb(err);
      cb(null, sftp, state);
    });
  }

  // List directory contents
  socket.on('sftp:list', ({ sessionId, dirPath }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      sftp.readdir(dirPath || '/', (err, list) => {
        if (err) {
          socket.emit('sftp:error', { sessionId, error: `Cannot read ${dirPath}: ${err.message}` });
          return;
        }
        const items = list.map(item => ({
          name: item.filename,
          path: path.posix.join(dirPath || '/', item.filename),
          isDir: item.attrs.isDirectory(),
          isSymlink: item.attrs.isSymbolicLink(),
          size: item.attrs.size,
          mode: item.attrs.mode,
          mtime: item.attrs.mtime,
          uid: item.attrs.uid,
          gid: item.attrs.gid,
        })).sort((a, b) => {
          // Directories first, then by name
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
        socket.emit('sftp:list', { sessionId, dirPath, items });
      });
    });
  });

  // Get home directory
  socket.on('sftp:home', ({ sessionId }) => {
    const state = sessionManager.getSession(sessionId);
    if (!state || !state.sshClient) {
      socket.emit('sftp:error', { sessionId, error: 'Session not found' });
      return;
    }
    // Use exec to get home dir
    state.sshClient.exec('echo $HOME', (err, stream) => {
      if (err) {
        socket.emit('sftp:home', { sessionId, home: '/' });
        return;
      }
      let output = '';
      stream.on('data', (data) => { output += data.toString(); });
      stream.on('close', () => {
        const home = output.trim() || '/';
        socket.emit('sftp:home', { sessionId, home });
      });
    });
  });

  // Read file (for download - send file content as base64 chunks)
  socket.on('sftp:download', ({ sessionId, filePath }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      sftp.stat(filePath, (err, stats) => {
        if (err) {
          socket.emit('sftp:error', { sessionId, error: `Cannot stat ${filePath}: ${err.message}` });
          return;
        }
        // Limit to 50MB for browser transfer
        if (stats.size > 50 * 1024 * 1024) {
          socket.emit('sftp:error', { sessionId, error: 'File too large (max 50MB)' });
          return;
        }
        const chunks = [];
        const readStream = sftp.createReadStream(filePath);
        readStream.on('data', (chunk) => { chunks.push(chunk); });
        readStream.on('end', () => {
          const buf = Buffer.concat(chunks);
          socket.emit('sftp:download', {
            sessionId,
            filePath,
            fileName: path.posix.basename(filePath),
            data: buf.toString('base64'),
            size: stats.size,
          });
        });
        readStream.on('error', (err) => {
          socket.emit('sftp:error', { sessionId, error: `Download error: ${err.message}` });
        });
      });
    });
  });

  // Upload file (receive base64 data)
  socket.on('sftp:upload', ({ sessionId, dirPath, fileName, data }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      const remotePath = path.posix.join(dirPath, fileName);
      const buf = Buffer.from(data, 'base64');
      const writeStream = sftp.createWriteStream(remotePath);
      writeStream.on('close', () => {
        socket.emit('sftp:uploaded', { sessionId, dirPath, fileName, remotePath });
      });
      writeStream.on('error', (err) => {
        socket.emit('sftp:error', { sessionId, error: `Upload error: ${err.message}` });
      });
      writeStream.end(buf);
    });
  });

  // Delete file
  socket.on('sftp:delete', ({ sessionId, filePath, isDir }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      const cb = (err) => {
        if (err) {
          socket.emit('sftp:error', { sessionId, error: `Delete error: ${err.message}` });
          return;
        }
        socket.emit('sftp:deleted', { sessionId, filePath });
      };
      if (isDir) {
        sftp.rmdir(filePath, cb);
      } else {
        sftp.unlink(filePath, cb);
      }
    });
  });

  // Create directory
  socket.on('sftp:mkdir', ({ sessionId, dirPath }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      sftp.mkdir(dirPath, (err) => {
        if (err) {
          socket.emit('sftp:error', { sessionId, error: `Mkdir error: ${err.message}` });
          return;
        }
        socket.emit('sftp:mkdir', { sessionId, dirPath });
      });
    });
  });

  // Read file content as text (for editing)
  socket.on('sftp:readFile', ({ sessionId, filePath }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      sftp.stat(filePath, (err, stats) => {
        if (err) {
          socket.emit('sftp:error', { sessionId, error: `Cannot stat ${filePath}: ${err.message}` });
          return;
        }
        // Limit editable files to 5MB
        if (stats.size > 5 * 1024 * 1024) {
          socket.emit('sftp:error', { sessionId, error: 'Datei zu gross zum Bearbeiten (max 5MB)' });
          return;
        }
        const chunks = [];
        const readStream = sftp.createReadStream(filePath);
        readStream.on('data', (chunk) => { chunks.push(chunk); });
        readStream.on('end', () => {
          const buf = Buffer.concat(chunks);
          socket.emit('sftp:fileContent', {
            sessionId,
            filePath,
            content: buf.toString('utf-8'),
          });
        });
        readStream.on('error', (err) => {
          socket.emit('sftp:error', { sessionId, error: `Lesefehler: ${err.message}` });
        });
      });
    });
  });

  // Write file content (save edited or new file)
  socket.on('sftp:writeFile', ({ sessionId, filePath, content }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      const buf = Buffer.from(content, 'utf-8');
      const writeStream = sftp.createWriteStream(filePath);
      writeStream.on('close', () => {
        socket.emit('sftp:fileSaved', { sessionId, filePath });
      });
      writeStream.on('error', (err) => {
        socket.emit('sftp:error', { sessionId, error: `Schreibfehler: ${err.message}` });
      });
      writeStream.end(buf);
    });
  });

  // Rename/move
  socket.on('sftp:rename', ({ sessionId, oldPath, newPath }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          socket.emit('sftp:error', { sessionId, error: `Rename error: ${err.message}` });
          return;
        }
        socket.emit('sftp:renamed', { sessionId, oldPath, newPath });
      });
    });
  });
};

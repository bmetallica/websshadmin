const sessionManager = require('../services/sessionManager');
const path = require('path');

module.exports = function (io, socket) {
  // Get (or reuse) a single cached SFTP channel per SSH session
  function getSftp(sessionId, cb) {
    const role = sessionManager.getSessionRole(sessionId, socket.id);
    if (!role || role === 'viewer') {
      return cb(new Error('Keine SFTP-Berechtigung'));
    }
    const state = sessionManager.getSession(sessionId);
    if (!state || !state.sshClient) {
      return cb(new Error('Session not found or not connected'));
    }

    // Reuse cached SFTP channel if still open
    if (state.sftpChannel) {
      return cb(null, state.sftpChannel, state);
    }

    // Open a new SFTP channel and cache it
    state.sshClient.sftp((err, sftp) => {
      if (err) return cb(err);

      // Clear cache when channel closes or errors
      sftp.on('close', () => { state.sftpChannel = null; });
      sftp.on('error', () => { state.sftpChannel = null; });

      state.sftpChannel = sftp;
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

  // Download file as base64 chunks (no size limit)
  const CHUNK_SIZE = 256 * 1024; // 256 KB per chunk

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
        const fileName = path.posix.basename(filePath);
        const totalSize = stats.size;

        // Announce start
        socket.emit('sftp:download:start', { sessionId, filePath, fileName, totalSize });

        let transferred = 0;
        const readStream = sftp.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });

        readStream.on('data', (chunk) => {
          transferred += chunk.length;
          socket.emit('sftp:download:chunk', {
            sessionId,
            filePath,
            data: chunk.toString('base64'),
            transferred,
            totalSize,
          });
        });

        readStream.on('end', () => {
          socket.emit('sftp:download:end', { sessionId, filePath, fileName, totalSize });
        });

        readStream.on('error', (err) => {
          socket.emit('sftp:error', { sessionId, error: `Download error: ${err.message}` });
        });
      });
    });
  });

  // Chunked upload — active streams keyed by remotePath
  const activeUploads = {};

  socket.on('sftp:upload:start', ({ sessionId, dirPath, fileName, totalSize }) => {
    getSftp(sessionId, (err, sftp) => {
      if (err) {
        socket.emit('sftp:error', { sessionId, error: err.message });
        return;
      }
      const remotePath = path.posix.join(dirPath, fileName);
      const writeStream = sftp.createWriteStream(remotePath);

      writeStream.on('error', (err) => {
        delete activeUploads[remotePath];
        socket.emit('sftp:error', { sessionId, error: `Upload error: ${err.message}` });
      });

      writeStream.on('close', () => {
        delete activeUploads[remotePath];
        socket.emit('sftp:uploaded', { sessionId, dirPath, fileName, remotePath });
      });

      activeUploads[remotePath] = { writeStream, dirPath, fileName, totalSize, transferred: 0 };
      socket.emit('sftp:upload:ready', { sessionId, remotePath });
    });
  });

  socket.on('sftp:upload:chunk', ({ sessionId, remotePath, data, transferred }) => {
    const upload = activeUploads[remotePath];
    if (!upload) {
      socket.emit('sftp:error', { sessionId, error: `Kein aktiver Upload fuer ${remotePath}` });
      return;
    }
    upload.transferred = transferred;
    const buf = Buffer.from(data, 'base64');
    const canContinue = upload.writeStream.write(buf);
    if (canContinue) {
      socket.emit('sftp:upload:ack', { sessionId, remotePath, transferred });
    } else {
      // Drain before acknowledging to apply back-pressure
      upload.writeStream.once('drain', () => {
        socket.emit('sftp:upload:ack', { sessionId, remotePath, transferred });
      });
    }
  });

  socket.on('sftp:upload:end', ({ sessionId, remotePath }) => {
    const upload = activeUploads[remotePath];
    if (!upload) return;
    upload.writeStream.end();
  });

  // Cleanup open streams on disconnect
  socket.on('disconnect', () => {
    for (const { writeStream } of Object.values(activeUploads)) {
      try { writeStream.destroy(); } catch { /* ignore */ }
    }
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

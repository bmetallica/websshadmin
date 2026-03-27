const { v4: uuidv4 } = require('uuid');
const { createSSHConnection } = require('./sshConnection');
const { startPolling, stopPolling } = require('./statsPoller');
const db = require('../db');

const MAX_BUFFER = 100000; // chars
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_BASE = 2000; // ms, doubles each attempt

// Map<sessionId, SessionState>
const sessions = new Map();

function createSession(connectionProfile, ownerId) {
  return new Promise((resolve, reject) => {
    const sessionId = uuidv4();

    createSSHConnection(connectionProfile, (err, sshClient, shellStream) => {
      if (err) return reject(err);

      const state = {
        id: sessionId,
        connectionId: connectionProfile.id,
        connectionSource: connectionProfile._source || 'own',
        connectionName: connectionProfile.name,
        host: connectionProfile.host,
        ownerId: ownerId,
        sshClient,
        shellStream,
        scrollbackBuffer: '',
        cols: 80,
        rows: 24,
        attachedSockets: new Set(),
        sharedSockets: new Map(), // socketId -> { role, token }
        tunnelServer: null,
        reconnecting: false,
        reconnectAttempts: 0,
      };

      _setupStreamHandlers(state, sessionId);
      _setupClientErrorHandlers(state, sessionId);

      sessions.set(sessionId, state);

      // Start SSH tunnel if configured
      if (connectionProfile.tunnel_enabled) {
        _setupTunnel(state, connectionProfile, sshClient);
      }

      resolve(state);
    });
  });
}

function _setupStreamHandlers(state, sessionId) {
  const { shellStream } = state;

  shellStream.on('data', (data) => {
    const str = data.toString('utf-8');
    state.scrollbackBuffer += str;
    if (state.scrollbackBuffer.length > MAX_BUFFER) {
      state.scrollbackBuffer = state.scrollbackBuffer.slice(-MAX_BUFFER / 2);
    }
    _emitToAttached(sessionId, 'terminal:data', { sessionId, data: str });
  });

  shellStream.on('close', () => {
    // If we're already reconnecting, don't trigger again
    if (state.reconnecting) return;

    // Try to auto-reconnect
    _attemptReconnect(sessionId);
  });
}

function _setupClientErrorHandlers(state, sessionId) {
  state.sshClient.on('error', (err) => {
    console.log(`[SSH] Client error for session ${sessionId}: ${err.message}`);
    if (!state.reconnecting && sessions.has(sessionId)) {
      _attemptReconnect(sessionId);
    }
  });

  state.sshClient.on('end', () => {
    console.log(`[SSH] Client ended for session ${sessionId}`);
    if (!state.reconnecting && sessions.has(sessionId)) {
      _attemptReconnect(sessionId);
    }
  });
}

function _attemptReconnect(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return;

  // Don't reconnect if already in progress or exceeded max attempts
  if (state.reconnecting) return;
  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(`[SSH] Max reconnect attempts reached for session ${sessionId}, ending session`);
    _endSession(sessionId, 'reconnect_failed');
    return;
  }

  state.reconnecting = true;
  state.reconnectAttempts++;
  stopPolling(sessionId);

  const delay = RECONNECT_DELAY_BASE * Math.pow(2, state.reconnectAttempts - 1);
  console.log(`[SSH] Auto-reconnect attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} for ${sessionId} in ${delay}ms`);

  // Notify attached clients
  _emitToAttached(sessionId, 'session:reconnecting', {
    sessionId,
    attempt: state.reconnectAttempts,
    maxAttempts: MAX_RECONNECT_ATTEMPTS,
  });

  // Load connection profile from DB (own or group connection)
  let profile;
  if (state.connectionSource === 'group') {
    profile = db.prepare('SELECT * FROM group_connections WHERE id = ?').get(state.connectionId);
  } else {
    profile = db.prepare('SELECT * FROM connections WHERE id = ?').get(state.connectionId);
  }
  if (!profile) {
    console.log(`[SSH] Cannot reconnect ${sessionId}: connection profile ${state.connectionId} not found`);
    _endSession(sessionId, 'profile_not_found');
    return;
  }

  setTimeout(() => {
    if (!sessions.has(sessionId)) return; // Session was killed during wait

    createSSHConnection(profile, (err, newClient, newShell) => {
      if (!sessions.has(sessionId)) return; // Killed while reconnecting

      if (err) {
        console.log(`[SSH] Reconnect failed for ${sessionId}: ${err.message}`);
        state.reconnecting = false;
        // Try again
        _attemptReconnect(sessionId);
        return;
      }

      console.log(`[SSH] Reconnected session ${sessionId} successfully`);

      // Clean up old client and cached SFTP channel
      try { state.sshClient.end(); } catch (e) {}

      // Replace client and stream, clear SFTP cache
      state.sshClient = newClient;
      state.shellStream = newShell;
      state.sftpChannel = null;
      state.reconnecting = false;
      state.reconnectAttempts = 0;

      // Re-setup handlers
      _setupStreamHandlers(state, sessionId);
      _setupClientErrorHandlers(state, sessionId);

      // Resize to current dimensions
      try { newShell.setWindow(state.rows, state.cols, 0, 0); } catch (e) {}

      // Restart stats polling
      startPolling(sessionId);

      // Re-setup tunnel if needed
      if (profile.tunnel_enabled) {
        if (state.tunnelServer) {
          try { state.tunnelServer.close(); } catch (e) {}
          state.tunnelServer = null;
        }
        _setupTunnel(state, profile, newClient);
      }

      // Notify clients
      _emitToAttached(sessionId, 'session:reconnected', { sessionId });

      // Send a visual marker to the terminal
      const marker = '\r\n\x1b[33m--- Verbindung wiederhergestellt ---\x1b[0m\r\n';
      state.scrollbackBuffer += marker;
      _emitToAttached(sessionId, 'terminal:data', { sessionId, data: marker });
    });
  }, delay);
}

function _endSession(sessionId, reason) {
  const state = sessions.get(sessionId);
  if (!state) return;
  stopPolling(sessionId);
  sessions.delete(sessionId);
  for (const socketId of state.attachedSockets) {
    const socket = _io && _io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('session:ended', { sessionId, reason });
    }
  }
  for (const [socketId] of state.sharedSockets) {
    const socket = _io && _io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit('session:ended', { sessionId, reason });
    }
  }
  if (state.tunnelServer) {
    try { state.tunnelServer.close(); } catch (e) {}
  }
  try { state.sshClient.end(); } catch (e) {}
}

function _emitToAttached(sessionId, event, data) {
  const state = sessions.get(sessionId);
  if (!state || !_io) return;
  for (const socketId of state.attachedSockets) {
    const socket = _io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, data);
    }
  }
  // Also emit to shared sockets
  for (const [socketId] of state.sharedSockets) {
    const socket = _io.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, data);
    }
  }
}

function _setupTunnel(state, connectionProfile, sshClient) {
  const net = require('net');
  const tunnelServer = net.createServer((localSocket) => {
    sshClient.forwardOut(
      '127.0.0.1', connectionProfile.tunnel_local_port,
      connectionProfile.tunnel_remote_host, connectionProfile.tunnel_remote_port,
      (err, channel) => {
        if (err) { localSocket.destroy(); return; }
        localSocket.pipe(channel).pipe(localSocket);
      }
    );
  });
  tunnelServer.listen(
    connectionProfile.tunnel_local_port,
    connectionProfile.tunnel_bind_address || '0.0.0.0'
  );
  state.tunnelServer = tunnelServer;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function getAllSessions() {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    connectionId: s.connectionId,
    connectionName: s.connectionName,
    host: s.host,
    ownerId: s.ownerId,
  }));
}

function getSessionsForUser(userId) {
  return Array.from(sessions.values())
    .filter(s => s.ownerId === userId)
    .map(s => ({
      id: s.id,
      connectionId: s.connectionId,
      connectionName: s.connectionName,
      host: s.host,
    }));
}

function isSessionOwner(sessionId, userId) {
  const state = sessions.get(sessionId);
  return state && state.ownerId === userId;
}

function getSessionRole(sessionId, socketId) {
  const state = sessions.get(sessionId);
  if (!state) return null;
  if (state.attachedSockets.has(socketId)) return 'owner';
  const shared = state.sharedSockets.get(socketId);
  if (shared) return shared.role;
  return null;
}

function attachSharedSocket(sessionId, socketId, role, token) {
  const state = sessions.get(sessionId);
  if (!state) return null;
  state.sharedSockets.set(socketId, { role, token });
  return state;
}

function detachSharedSocket(socketId) {
  for (const state of sessions.values()) {
    state.sharedSockets.delete(socketId);
  }
}

function updateSharedRole(sessionId, token, newRole) {
  const state = sessions.get(sessionId);
  if (!state) return;
  for (const [sid, info] of state.sharedSockets) {
    if (info.token === token) {
      info.role = newRole;
      const socket = _io && _io.sockets.sockets.get(sid);
      if (socket) {
        socket.emit('share:role-updated', { sessionId, role: newRole });
      }
    }
  }
}

function revokeSharedToken(sessionId, token) {
  const state = sessions.get(sessionId);
  if (!state) return;
  for (const [sid, info] of state.sharedSockets) {
    if (info.token === token) {
      const socket = _io && _io.sockets.sockets.get(sid);
      if (socket) {
        socket.emit('share:revoked', { sessionId });
      }
      state.sharedSockets.delete(sid);
    }
  }
}

function attachSocket(sessionId, socketId) {
  const state = sessions.get(sessionId);
  if (!state) return null;
  state.attachedSockets.add(socketId);
  return state;
}

function detachSocket(socketId) {
  for (const state of sessions.values()) {
    state.attachedSockets.delete(socketId);
    state.sharedSockets.delete(socketId);
  }
}

function killSession(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return;
  stopPolling(sessionId);
  if (state.tunnelServer) state.tunnelServer.close();
  state.shellStream.close();
  state.sshClient.end();
  sessions.delete(sessionId);
}

function writeToSession(sessionId, data) {
  const state = sessions.get(sessionId);
  if (state && state.shellStream && state.shellStream.writable) {
    state.shellStream.write(data);
  }
}

function resizeSession(sessionId, cols, rows) {
  const state = sessions.get(sessionId);
  if (state && state.shellStream) {
    state.cols = cols;
    state.rows = rows;
    state.shellStream.setWindow(rows, cols, 0, 0);
  }
}

// Store io reference for emitting events
let _io = null;
function setIO(io) { _io = io; }
function getIO() { return _io; }

module.exports = {
  createSession, getSession, getAllSessions, getSessionsForUser,
  attachSocket, detachSocket, killSession,
  writeToSession, resizeSession,
  isSessionOwner, getSessionRole,
  attachSharedSocket, detachSharedSocket, updateSharedRole, revokeSharedToken,
  setIO, getIO,
};

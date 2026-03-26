const sessionManager = require('../services/sessionManager');
const { startPolling } = require('../services/statsPoller');
const db = require('../db');

module.exports = function (io, socket) {
  // Store io reference for session manager
  sessionManager.setIO(io);

  socket.on('session:create', async ({ connectionId, source, credentials }) => {
    try {
      let profile;
      if (source === 'group') {
        // Group connection: verify user is member of the group
        profile = db.prepare(`
          SELECT gc.* FROM group_connections gc
          JOIN user_groups ug ON ug.group_id = gc.group_id
          WHERE gc.id = ? AND ug.user_id = ?
        `).get(connectionId, socket.userId);
        if (profile) {
          profile._source = 'group';

          // Merge user-specific credentials if group connection lacks them
          const needsUsername = !profile.username;
          const needsAuth = !profile.password && !profile.private_key;

          if (needsUsername || needsAuth) {
            // Check for saved per-user credentials
            const userCred = db.prepare(
              'SELECT * FROM user_group_credentials WHERE user_id = ? AND group_connection_id = ?'
            ).get(socket.userId, connectionId);

            if (userCred) {
              if (needsUsername && userCred.username) profile.username = userCred.username;
              if (needsAuth) {
                profile.auth_method = userCred.auth_method;
                profile.password = userCred.password;
                profile.private_key = userCred.private_key;
                profile.passphrase = userCred.passphrase;
              }
            }

            // Override with one-time credentials from frontend (takes priority)
            if (credentials) {
              if (credentials.username) profile.username = credentials.username;
              if (credentials.password) {
                const { encrypt } = require('../services/encryption');
                profile.auth_method = 'password';
                profile.password = encrypt(credentials.password);
              }
              if (credentials.private_key) {
                const { encrypt } = require('../services/encryption');
                profile.auth_method = 'key';
                profile.private_key = encrypt(credentials.private_key);
                if (credentials.passphrase) profile.passphrase = encrypt(credentials.passphrase);
              }
            }

            // Final check: if still no username or auth, tell frontend to prompt
            if (!profile.username || (!profile.password && !profile.private_key)) {
              socket.emit('session:needs-credentials', {
                connectionId: connectionId,
                connectionName: profile.name,
                host: profile.host,
                port: profile.port,
                needsUsername: !profile.username,
                needsAuth: !profile.password && !profile.private_key,
              });
              return;
            }
          }
        }
      } else {
        // Own connection: verify ownership
        profile = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(connectionId, socket.userId);
        if (profile) profile._source = 'own';
      }

      if (!profile) {
        socket.emit('session:error', { error: 'Verbindung nicht gefunden oder keine Berechtigung' });
        return;
      }

      const state = await sessionManager.createSession(profile, socket.userId);
      sessionManager.attachSocket(state.id, socket.id);
      startPolling(state.id);

      socket.emit('session:created', {
        sessionId: state.id,
        connectionName: state.connectionName,
        host: state.host,
      });
    } catch (err) {
      socket.emit('session:error', { error: err.message });
    }
  });

  socket.on('session:attach', ({ sessionId }) => {
    // Only allow attaching to own sessions
    if (!sessionManager.isSessionOwner(sessionId, socket.userId)) {
      socket.emit('session:error', { error: 'Keine Berechtigung' });
      return;
    }
    const state = sessionManager.attachSocket(sessionId, socket.id);
    if (!state) {
      socket.emit('session:error', { error: 'Session not found' });
      return;
    }
    // Send scrollback buffer
    if (state.scrollbackBuffer) {
      socket.emit('terminal:replay', { sessionId, data: state.scrollbackBuffer });
    }
  });

  socket.on('session:detach', ({ sessionId }) => {
    const state = sessionManager.getSession(sessionId);
    if (state) {
      state.attachedSockets.delete(socket.id);
      state.sharedSockets.delete(socket.id);
    }
  });

  socket.on('session:kill', ({ sessionId }) => {
    // Only owner can kill
    if (!sessionManager.isSessionOwner(sessionId, socket.userId)) return;
    sessionManager.killSession(sessionId);
    io.emit('session:ended', { sessionId, reason: 'killed' });
  });

  socket.on('session:list', () => {
    // Only return user's own sessions
    socket.emit('session:list', sessionManager.getSessionsForUser(socket.userId));
  });

  socket.on('terminal:data', ({ sessionId, data }) => {
    const role = sessionManager.getSessionRole(sessionId, socket.id);
    // Only owner and coworker can type
    if (role === 'owner' || role === 'coworker') {
      sessionManager.writeToSession(sessionId, data);
    }
  });

  socket.on('terminal:resize', ({ sessionId, cols, rows }) => {
    // Only owner can resize
    if (sessionManager.isSessionOwner(sessionId, socket.userId)) {
      sessionManager.resizeSession(sessionId, cols, rows);
    }
  });

  // Join a shared session via token
  socket.on('session:join-shared', ({ token }) => {
    const shareRow = db.prepare('SELECT * FROM share_tokens WHERE token = ?').get(token);
    if (!shareRow) {
      socket.emit('session:error', { error: 'Ungültiger Share-Token' });
      return;
    }

    const state = sessionManager.getSession(shareRow.session_id);
    if (!state) {
      socket.emit('session:error', { error: 'Session nicht mehr aktiv' });
      return;
    }

    sessionManager.attachSharedSocket(shareRow.session_id, socket.id, shareRow.role, shareRow.token);

    // Send joined event WITH scrollback so client creates terminal first, then writes data
    socket.emit('session:joined-shared', {
      sessionId: shareRow.session_id,
      role: shareRow.role,
      connectionName: state.connectionName,
      host: state.host,
      scrollback: state.scrollbackBuffer || '',
    });
  });
};

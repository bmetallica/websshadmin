const sessionManager = require('../services/sessionManager');

// In-memory chat history per session
// Map<sessionId, Array<{ from, role, message, ts }>>
const chatHistories = new Map();

const MAX_HISTORY = 200;
const MAX_NAME_LEN = 100;
const MAX_MSG_LEN = 2000;

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getHistory(sessionId) {
  return chatHistories.get(sessionId) || [];
}

function clearHistory(sessionId) {
  chatHistories.delete(sessionId);
}

function handler(io, socket) {
  socket.on('chat:message', ({ sessionId, from, message }) => {
    if (!sessionId || !from || !message) return;

    // Check if socket is authorized for this session (owner or shared)
    const role = sessionManager.getSessionRole(sessionId, socket.id);
    if (!role) return; // not attached to this session

    // Sanitize
    const safeName = _esc(String(from).trim().slice(0, MAX_NAME_LEN));
    const safeMsg  = _esc(String(message).trim().slice(0, MAX_MSG_LEN));
    if (!safeName || !safeMsg) return;

    const entry = { from: safeName, role, message: safeMsg, ts: Date.now() };

    // Push to history
    if (!chatHistories.has(sessionId)) chatHistories.set(sessionId, []);
    const history = chatHistories.get(sessionId);
    history.push(entry);
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

    // Broadcast to all sockets in this session
    _broadcastToSession(io, sessionId, 'chat:message', entry);
  });

  // Clean up history when a session ends
  socket.on('session:ended', ({ sessionId }) => {
    clearHistory(sessionId);
  });
}

function _broadcastToSession(io, sessionId, event, data) {
  const state = sessionManager.getSession(sessionId);
  if (!state) return;

  for (const socketId of state.attachedSockets) {
    const s = io.sockets.sockets.get(socketId);
    if (s) s.emit(event, data);
  }
  for (const [socketId] of state.sharedSockets) {
    const s = io.sockets.sockets.get(socketId);
    if (s) s.emit(event, data);
  }
}

module.exports = { handler, getHistory, clearHistory };

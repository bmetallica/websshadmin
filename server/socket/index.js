const terminalHandler = require('./terminalHandler');
const statsHandler = require('./statsHandler');
const scriptHandler = require('./scriptHandler');
const sftpHandler = require('./sftpHandler');

module.exports = function (io) {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    terminalHandler(io, socket);
    statsHandler(io, socket);
    scriptHandler(io, socket);
    sftpHandler(io, socket);

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      // Detach all sessions this socket was viewing
      const sessionManager = require('../services/sessionManager');
      sessionManager.detachSocket(socket.id);
    });
  });
};

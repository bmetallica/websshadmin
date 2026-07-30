const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const { requireAuth } = require('./auth');

// Initialize database (runs schema + seed + encryption migration)
const db = require('./db');

const app = express();
const server = http.createServer(app);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      // Alle Assets (Ace-Editor, Schriften) liegen lokal unter /vendor –
      // der webSSHadmin läuft damit vollständig ohne Internetzugang.
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "blob:"], // ace startet seine Syntax-Worker über Blob-URLs
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'", "blob:"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: false, // HSTS only when behind HTTPS reverse proxy
}));

// Disable X-Powered-By
app.disable('x-powered-by');

// JSON body parser with size limit
app.use(express.json({ limit: '1mb' }));

// Session config with hardened cookie
const sessionMiddleware = session({
  secret: config.sessionSecret,
  name: 'sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
    secure: false, // set to true if behind HTTPS reverse proxy
  },
});

app.use(sessionMiddleware);

// Trust first proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// --- Mobile-Erkennung ---------------------------------------------------
// Smartphones bekommen /m ausgeliefert, alles andere die unveränderte Desktop-UI.
// Cookie viewMode=desktop|mobile übersteuert die Erkennung dauerhaft.
const MOBILE_UA = /Android|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i;

function _viewMode(req) {
  const cookie = req.headers.cookie || '';
  const match = /(?:^|;\s*)viewMode=(desktop|mobile)/.exec(cookie);
  return match ? match[1] : null;
}

function wantsMobile(req) {
  const mode = _viewMode(req);
  if (mode) return mode === 'mobile';
  return MOBILE_UA.test(req.headers['user-agent'] || '');
}

function _query(req) {
  return req.originalUrl.includes('?') ? req.originalUrl.substring(req.originalUrl.indexOf('?')) : '';
}

// Public routes (login page)
app.get('/', (req, res) => {
  const qs = _query(req);
  if (req.session && req.session.authenticated) {
    return res.redirect((wantsMobile(req) ? '/m' : '/app') + qs);
  }
  // If share token present, redirect directly to the app (no login needed)
  if (req.query.share) {
    return res.redirect((wantsMobile(req) ? '/m' : '/app') + qs);
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Favicon
app.get('/favicon.svg', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'favicon.svg'));
});

// Auth API (no auth required for login/check)
app.use('/api/auth', require('./routes/auth'));

// App page - allow access with share token (no auth needed) or with auth
app.get('/app', (req, res) => {
  // Smartphone ohne ausdrücklichen Desktop-Wunsch -> mobile Oberfläche
  if (wantsMobile(req)) {
    return res.redirect('/m' + _query(req));
  }
  // Allow if authenticated
  if (req.session && req.session.authenticated) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'app.html'));
  }
  // Allow if valid share token in query
  if (req.query.share) {
    const shareRow = db.prepare('SELECT 1 FROM share_tokens WHERE token = ?').get(req.query.share);
    if (shareRow) {
      return res.sendFile(path.join(__dirname, '..', 'public', 'app.html'));
    }
  }
  // Otherwise redirect to login preserving query params
  return res.redirect('/' + _query(req));
});

// Mobile app page – gleiche Zugriffsregeln wie /app
app.get('/m', (req, res) => {
  if (_viewMode(req) === 'desktop') {
    return res.redirect('/app' + _query(req));
  }
  if (req.session && req.session.authenticated) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'mobile.html'));
  }
  if (req.query.share) {
    const shareRow = db.prepare('SELECT 1 FROM share_tokens WHERE token = ?').get(req.query.share);
    if (shareRow) {
      return res.sendFile(path.join(__dirname, '..', 'public', 'mobile.html'));
    }
  }
  return res.redirect('/' + _query(req));
});

// PWA: Manifest + Service Worker müssen im Root-Scope liegen
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'manifest.json'));
});
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'sw.js'));
});

// Multiview page – authenticated users only
app.get('/multiview', (req, res) => {
  if (!(req.session && req.session.authenticated)) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'multiview.html'));
});

// Protected API routes
app.use('/api/connections', requireAuth, require('./routes/connections'));
app.use('/api/quick-categories', requireAuth, require('./routes/quickCommands'));
app.use('/api/scripts', requireAuth, require('./routes/scripts'));
app.use('/api/bookmarks', requireAuth, require('./routes/bookmarks'));
app.use('/api/ports', requireAuth, require('./routes/ports'));
app.use('/api/users', requireAuth, require('./routes/users'));
app.use('/api/sharing', requireAuth, require('./routes/sharing'));
app.use('/api/groups', requireAuth, require('./routes/groups'));
app.use('/api/schedules', requireAuth, require('./routes/schedules'));

// Static files (only authenticated access for js/css is not needed since login page uses them too)
app.use('/css', express.static(path.join(__dirname, '..', 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'public', 'js')));
app.use('/vendor', express.static(path.join(__dirname, '..', 'public', 'vendor')));
app.use('/icons', express.static(path.join(__dirname, '..', 'public', 'icons')));

// Socket.io with session sharing
const io = new Server(server, {
  maxHttpBufferSize: 1e6, // 1MB per socket message (chunked uploads use 256KB chunks)
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.use((socket, next) => {
  const sess = socket.request.session;
  if (sess && sess.authenticated) {
    socket.userRole = sess.role;
    socket.userId = sess.userId;
    socket.userName = sess.username;
    return next();
  }

  // Allow unauthenticated connections with a valid share token
  const shareToken = socket.handshake.auth && socket.handshake.auth.shareToken;
  if (shareToken) {
    const shareRow = db.prepare('SELECT * FROM share_tokens WHERE token = ?').get(shareToken);
    if (shareRow) {
      socket.userRole = 'shared-' + shareRow.role;
      socket.userId = null;
      socket.userName = 'Gast';
      socket.shareToken = shareToken;
      return next();
    }
  }

  next(new Error('Authentication required'));
});

// Register socket handlers
require('./socket/index')(io);

// Start script watcher for live file updates
const scriptWatcher = require('./services/scriptWatcher');
scriptWatcher.start(io);

// Start scheduler for time-triggered commands
require('./services/commandScheduler').start();

server.listen(config.port, '0.0.0.0', () => {
  console.log(`webSSHadmin running on http://0.0.0.0:${config.port}`);
});

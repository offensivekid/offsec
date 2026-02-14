import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Trust proxy for Railway/production
app.set('trust proxy', 1);

const SQLiteStore = connectSqlite3(session);
const db = new Database(process.env.DB_PATH || './database.sqlite');
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

console.log('🔧 Initializing offensive-forum (SECURE MODE)...');

// ============= DATABASE INITIALIZATION =============

function initDB() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const tableNames = tables.map(t => t.name);
  
  if (!tableNames.includes('users')) {
    console.log('📦 Creating database tables...');
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT 0,
        is_banned BOOLEAN DEFAULT 0,
        has_private_access BOOLEAN DEFAULT 0,
        email_verified BOOLEAN DEFAULT 0,
        verification_token TEXT,
        failed_login_attempts INTEGER DEFAULT 0,
        last_failed_login INTEGER,
        created_at INTEGER NOT NULL,
        last_login INTEGER,
        created_by INTEGER,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      
      CREATE TABLE IF NOT EXISTS threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author_id INTEGER NOT NULL,
        is_private BOOLEAN DEFAULT 0,
        is_deleted BOOLEAN DEFAULT 0,
        views INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        author_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        is_deleted BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS access_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_code TEXT UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_by INTEGER NOT NULL,
        used_by INTEGER,
        created_at INTEGER NOT NULL,
        used_at INTEGER,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );
      
      CREATE TABLE IF NOT EXISTS siem_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        user_id INTEGER,
        username TEXT,
        ip_address TEXT,
        user_agent TEXT,
        endpoint TEXT,
        details TEXT,
        created_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS ip_bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_address TEXT UNIQUE NOT NULL,
        reason TEXT,
        banned_by INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        FOREIGN KEY (banned_by) REFERENCES users(id)
      );
      
      CREATE INDEX idx_threads_created ON threads(created_at DESC);
      CREATE INDEX idx_replies_thread ON replies(thread_id);
      CREATE INDEX idx_access_keys_code ON access_keys(key_code);
      CREATE INDEX idx_siem_created ON siem_events(created_at DESC);
      CREATE INDEX idx_siem_severity ON siem_events(severity);
      CREATE INDEX idx_users_banned ON users(is_banned);
    `);
    
    console.log('✅ Tables created');
    
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@offensive-forum.local';
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64');
    
    const hash = bcrypt.hashSync(adminPassword, 12);
    const adminResult = db.prepare(`
      INSERT INTO users (username, email, password_hash, is_admin, has_private_access, created_at)
      VALUES (?, ?, ?, 1, 1, ?)
    `).run(adminUsername, adminEmail, hash, Date.now());
    
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔐 ADMIN CREDENTIALS (SAVE THESE!)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Username: ${adminUsername}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚠️  CHANGE PASSWORD IMMEDIATELY!');
    console.log('');
    
    db.prepare(`
      INSERT INTO siem_events (event_type, severity, user_id, username, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('admin_created', 'high', adminResult.lastInsertRowid, adminUsername, 
           JSON.stringify({ action: 'initial_setup' }), Date.now());
    
    const key = generateAccessKey();
    db.prepare(`
      INSERT INTO access_keys (key_code, created_by, created_at)
      VALUES (?, ?, ?)
    `).run(key, adminResult.lastInsertRowid, Date.now());
    
    console.log(`🔑 Sample access key: ${key}`);
    console.log('');
  }
}

initDB();

// ============= SECURITY MIDDLEWARE =============

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type']
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: '.'
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  name: 'sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24,
    sameSite: 'strict'
  }
}));

// ============= RATE LIMITING =============

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSIEM('rate_limit_exceeded', 'medium', req, { limit: 'global' });
    res.status(429).json({ error: 'Too many requests' });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    logSIEM('auth_rate_limit', 'high', req, { endpoint: req.path });
    res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }
});

app.use(globalLimiter);

// ============= IP BAN CHECK =============

function checkIPBan(req, res, next) {
  const ip = req.ip;
  const ban = db.prepare(`
    SELECT * FROM ip_bans 
    WHERE ip_address = ? AND (expires_at IS NULL OR expires_at > ?)
  `).get(ip, Date.now());
  
  if (ban) {
    logSIEM('banned_ip_attempt', 'critical', req, { reason: ban.reason });
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

app.use(checkIPBan);

// ============= UTILITY FUNCTIONS =============

function generateAccessKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return segments.join('-');
}

function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim();
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validateUsername(username) {
  const re = /^[a-zA-Z0-9_-]{3,50}$/;
  return re.test(username);
}

function logSIEM(type, severity, req, details = {}) {
  try {
    const username = req.session?.username || null;
    const userId = req.session?.userId || null;
    
    db.prepare(`
      INSERT INTO siem_events (event_type, severity, user_id, username, ip_address, user_agent, endpoint, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      type, 
      severity, 
      userId,
      username,
      req.ip, 
      req.get('user-agent') || 'unknown',
      req.path,
      JSON.stringify(details), 
      Date.now()
    );
  } catch (e) {
    console.error('SIEM logging error:', e);
  }
}

// ============= AUTH MIDDLEWARE =============

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    logSIEM('unauthorized_access', 'medium', req, { endpoint: req.path });
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const user = db.prepare('SELECT is_banned FROM users WHERE id = ?').get(req.session.userId);
  if (user && user.is_banned) {
    logSIEM('banned_user_attempt', 'high', req, { user_id: req.session.userId });
    req.session.destroy();
    return res.status(403).json({ error: 'Account banned' });
  }
  
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    logSIEM('admin_access_denied', 'high', req, { 
      user_id: req.session.userId,
      endpoint: req.path 
    });
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ============= PUBLIC ROUTES =============

app.use(express.static('public', {
  index: 'index.html',
  dotfiles: 'deny'
}));

// ============= AUTH ENDPOINTS =============

app.post('/api/register', authLimiter, (req, res) => {
  try {
    const { username, email, password, registrationKey } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    
    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }
    
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    const requiresKey = process.env.REQUIRE_REG_KEY === 'true';
    
    if (requiresKey && !registrationKey) {
      return res.status(400).json({ error: 'Registration key required' });
    }
    
    if (registrationKey) {
      const key = db.prepare('SELECT * FROM access_keys WHERE key_code = ? AND is_active = 1 AND used_by IS NULL')
        .get(registrationKey);
      
      if (!key) {
        logSIEM('registration_failed', 'medium', req, { reason: 'invalid_key' });
        return res.status(400).json({ error: 'Invalid registration key' });
      }
    }
    
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?')
      .get(username, email);
    
    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    
    const hash = bcrypt.hashSync(password, 12);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    
    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, has_private_access, email_verified, verification_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sanitize(username), sanitize(email), hash, registrationKey ? 1 : 0, 0, verificationToken, Date.now());
    
    if (registrationKey) {
      db.prepare('UPDATE access_keys SET used_by = ?, used_at = ?, is_active = 0 WHERE key_code = ?')
        .run(result.lastInsertRowid, Date.now(), registrationKey);
    }
    
    logSIEM('user_registered', 'low', req, { 
      user_id: result.lastInsertRowid,
      username: sanitize(username)
    });
    
    // В реальном проекте здесь отправка email
    console.log(`📧 Verification link: http://localhost:${PORT}/api/verify-email?token=${verificationToken}`);
    
    res.json({ 
      success: true,
      message: 'Registration successful. Check console for verification link (in production this would be sent via email)'
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/api/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).send('<h1>Invalid verification link</h1>');
    }
    
    const user = db.prepare('SELECT id, username, email_verified FROM users WHERE verification_token = ?').get(token);
    
    if (!user) {
      logSIEM('email_verification_failed', 'medium', req, { reason: 'invalid_token' });
      return res.status(400).send('<h1>Invalid or expired verification link</h1>');
    }
    
    if (user.email_verified) {
      return res.send('<h1>Email already verified! You can now login.</h1>');
    }
    
    db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
    
    logSIEM('email_verified', 'low', req, { user_id: user.id });
    
    res.send(`
      <html>
        <head>
          <style>
            body { font-family: 'JetBrains Mono', monospace; background: #0a0a0a; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .box { background: #0f0f0f; border: 1px solid #1a1a1a; padding: 40px; border-radius: 8px; text-align: center; }
            h1 { color: #fff; margin-bottom: 20px; }
            a { color: #fff; background: #fff; color: #000; padding: 12px 24px; border-radius: 4px; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>✅ Email Verified!</h1>
            <p>Your email has been successfully verified.</p>
            <br>
            <a href="/">Go to Forum</a>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Email verification error:', err);
    res.status(500).send('<h1>Verification failed</h1>');
  }
});

app.post('/api/login', authLimiter, (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(sanitize(username));
    
    if (!user) {
      logSIEM('login_failed', 'medium', req, { username: sanitize(username) });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (user.is_banned) {
      logSIEM('banned_login_attempt', 'high', req, { user_id: user.id });
      return res.status(403).json({ error: 'Account banned' });
    }
    
    if (user.failed_login_attempts >= 5 && user.last_failed_login > Date.now() - 15 * 60 * 1000) {
      logSIEM('account_locked', 'high', req, { user_id: user.id });
      return res.status(429).json({ error: 'Account locked. Try again in 15 minutes.' });
    }
    
    const validPassword = bcrypt.compareSync(password, user.password_hash);
    
    if (!validPassword) {
      db.prepare('UPDATE users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login = ? WHERE id = ?')
        .run(Date.now(), user.id);
      
      logSIEM('login_failed', 'medium', req, { user_id: user.id });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    db.prepare('UPDATE users SET last_login = ?, failed_login_attempts = 0 WHERE id = ?')
      .run(Date.now(), user.id);
    
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.isAdmin = Boolean(user.is_admin);
    req.session.hasPrivateAccess = Boolean(user.has_private_access);
    
    logSIEM('login_success', 'low', req, { user_id: user.id });
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        isAdmin: Boolean(user.is_admin),
        hasPrivateAccess: Boolean(user.has_private_access)
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  if (req.session.userId) {
    logSIEM('logout', 'low', req, { user_id: req.session.userId });
  }
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ success: true });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, is_admin, has_private_access, email, email_verified FROM users WHERE id = ?')
    .get(req.session.userId);
  
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    isAdmin: Boolean(user.is_admin),
    hasPrivateAccess: Boolean(user.has_private_access)
  });
});

// ============= THREAD ENDPOINTS =============

app.get('/api/threads', (req, res) => {
  try {
    const userId = req.session?.userId;
    const user = userId ? db.prepare('SELECT has_private_access, is_admin FROM users WHERE id = ?').get(userId) : null;
    
    const isPublic = req.query.private !== 'true';
    
    if (!isPublic && (!user || (!user.is_admin && !user.has_private_access))) {
      return res.status(403).json({ error: 'Private access required' });
    }
    
    const threads = db.prepare(`
      SELECT t.*, u.username as author
      FROM threads t
      JOIN users u ON t.author_id = u.id
      WHERE t.is_private = ? AND t.is_deleted = 0
      ORDER BY t.created_at DESC
    `).all(isPublic ? 0 : 1);
    
    res.json(threads);
  } catch (err) {
    console.error('Error fetching threads:', err);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

app.get('/api/threads/:id', (req, res) => {
  try {
    const thread = db.prepare(`
      SELECT t.*, u.username as author
      FROM threads t
      JOIN users u ON t.author_id = u.id
      WHERE t.id = ? AND t.is_deleted = 0
    `).get(req.params.id);
    
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    
    const userId = req.session?.userId;
    const user = userId ? db.prepare('SELECT has_private_access, is_admin FROM users WHERE id = ?').get(userId) : null;
    
    if (thread.is_private && (!user || (!user.is_admin && !user.has_private_access))) {
      return res.status(403).json({ error: 'Private access required' });
    }
    
    db.prepare('UPDATE threads SET views = views + 1 WHERE id = ?').run(req.params.id);
    
    const replies = db.prepare(`
      SELECT r.*, u.username as author
      FROM replies r
      JOIN users u ON r.author_id = u.id
      WHERE r.thread_id = ? AND r.is_deleted = 0
      ORDER BY r.created_at ASC
    `).all(req.params.id);
    
    res.json({ ...thread, replies });
  } catch (err) {
    console.error('Error fetching thread:', err);
    res.status(500).json({ error: 'Failed to fetch thread' });
  }
});

app.post('/api/threads', requireAuth, (req, res) => {
  try {
    const { title, body, isPrivate } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({ error: 'Title and body required' });
    }
    
    if (title.length < 5 || title.length > 200) {
      return res.status(400).json({ error: 'Title must be 5-200 characters' });
    }
    
    if (body.length < 10 || body.length > 50000) {
      return res.status(400).json({ error: 'Body must be 10-50000 characters' });
    }
    
    if (isPrivate && !req.session.isAdmin) {
      return res.status(403).json({ error: 'Admin required for private threads' });
    }
    
    const result = db.prepare(`
      INSERT INTO threads (title, body, author_id, is_private, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sanitize(title), sanitize(body), req.session.userId, isPrivate ? 1 : 0, Date.now());
    
    logSIEM('thread_created', 'low', req, { thread_id: result.lastInsertRowid });
    
    res.json({ success: true, threadId: result.lastInsertRowid });
  } catch (err) {
    console.error('Error creating thread:', err);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

app.post('/api/threads/:id/reply', requireAuth, (req, res) => {
  try {
    const { text } = req.body;
    const threadId = req.params.id;
    
    if (!text || text.length < 1 || text.length > 10000) {
      return res.status(400).json({ error: 'Reply must be 1-10000 characters' });
    }
    
    const thread = db.prepare('SELECT is_private FROM threads WHERE id = ? AND is_deleted = 0').get(threadId);
    
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }
    
    if (thread.is_private) {
      const user = db.prepare('SELECT has_private_access, is_admin FROM users WHERE id = ?')
        .get(req.session.userId);
      
      if (!user.is_admin && !user.has_private_access) {
        return res.status(403).json({ error: 'Private access required' });
      }
    }
    
    const result = db.prepare(`
      INSERT INTO replies (thread_id, author_id, text, created_at)
      VALUES (?, ?, ?, ?)
    `).run(threadId, req.session.userId, sanitize(text), Date.now());
    
    logSIEM('reply_created', 'low', req, { thread_id: threadId, reply_id: result.lastInsertRowid });
    
    res.json({ success: true, replyId: result.lastInsertRowid });
  } catch (err) {
    console.error('Error creating reply:', err);
    res.status(500).json({ error: 'Failed to create reply' });
  }
});

// ============= ADMIN PANEL =============

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

app.use('/admin', requireAdmin, express.static(path.join(__dirname, 'admin')));

// ============= ADMIN API - USER MANAGEMENT =============

app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT 
        id, username, email, is_admin, is_banned, has_private_access,
        created_at, last_login, failed_login_attempts,
        (SELECT COUNT(*) FROM threads WHERE author_id = users.id AND is_deleted = 0) as thread_count,
        (SELECT COUNT(*) FROM replies WHERE author_id = users.id AND is_deleted = 0) as reply_count
      FROM users
      ORDER BY created_at DESC
    `).all();
    
    res.json(users);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const { username, email, password, isAdmin, hasPrivateAccess } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    
    if (!validateUsername(username)) {
      return res.status(400).json({ error: 'Invalid username' });
    }
    
    if (!validateEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be 8+ characters' });
    }
    
    const hash = bcrypt.hashSync(password, 12);
    
    const result = db.prepare(`
      INSERT INTO users (username, email, password_hash, is_admin, has_private_access, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sanitize(username), 
      sanitize(email), 
      hash, 
      isAdmin ? 1 : 0,
      hasPrivateAccess ? 1 : 0,
      Date.now(),
      req.session.userId
    );
    
    logSIEM('user_created_by_admin', 'medium', req, { created_user_id: result.lastInsertRowid });
    
    res.json({ success: true, userId: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username or email exists' });
    }
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/admin/users/:id/ban', requireAdmin, (req, res) => {
  try {
    const userId = req.params.id;
    const { isBanned } = req.body;
    
    if (userId == req.session.userId) {
      return res.status(400).json({ error: 'Cannot ban yourself' });
    }
    
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(isBanned ? 1 : 0, userId);
    
    logSIEM('user_ban_changed', 'high', req, { target_user_id: userId, is_banned: !!isBanned });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error banning user:', err);
    res.status(500).json({ error: 'Failed to update ban status' });
  }
});

app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
  try {
    const userId = req.params.id;
    const { isAdmin, hasPrivateAccess } = req.body;
    
    db.prepare('UPDATE users SET is_admin = ?, has_private_access = ? WHERE id = ?')
      .run(isAdmin ? 1 : 0, hasPrivateAccess ? 1 : 0, userId);
    
    logSIEM('user_role_changed', 'high', req, { target_user_id: userId });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating role:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const userId = req.params.id;
    
    if (userId == req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }
    
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    
    logSIEM('user_deleted', 'high', req, { target_user_id: userId });
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ============= ADMIN API - CONTENT MOD =============

app.get('/api/admin/threads', requireAdmin, (req, res) => {
  try {
    const threads = db.prepare(`
      SELECT 
        t.*,
        u.username as author,
        (SELECT COUNT(*) FROM replies WHERE thread_id = t.id AND is_deleted = 0) as reply_count
      FROM threads t
      JOIN users u ON t.author_id = u.id
      ORDER BY t.created_at DESC
      LIMIT 100
    `).all();
    
    res.json(threads);
  } catch (err) {
    console.error('Error fetching threads:', err);
    res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

app.delete('/api/admin/threads/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE threads SET is_deleted = 1 WHERE id = ?').run(req.params.id);
    logSIEM('thread_deleted', 'medium', req, { thread_id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting thread:', err);
    res.status(500).json({ error: 'Failed to delete thread' });
  }
});

app.delete('/api/admin/replies/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE replies SET is_deleted = 1 WHERE id = ?').run(req.params.id);
    logSIEM('reply_deleted', 'medium', req, { reply_id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting reply:', err);
    res.status(500).json({ error: 'Failed to delete reply' });
  }
});

// ============= ADMIN API - ACCESS KEYS =============

app.post('/api/admin/keys/generate', requireAdmin, (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 1, 50);
    const keys = [];
    
    for (let i = 0; i < count; i++) {
      const key = generateAccessKey();
      db.prepare(`
        INSERT INTO access_keys (key_code, created_by, created_at)
        VALUES (?, ?, ?)
      `).run(key, req.session.userId, Date.now());
      keys.push(key);
    }
    
    logSIEM('keys_generated', 'medium', req, { count });
    
    res.json({ success: true, keys });
  } catch (err) {
    console.error('Error generating keys:', err);
    res.status(500).json({ error: 'Failed to generate keys' });
  }
});

app.get('/api/admin/keys', requireAdmin, (req, res) => {
  try {
    const keys = db.prepare(`
      SELECT 
        ak.*,
        u1.username as created_by_username,
        u2.username as used_by_username
      FROM access_keys ak
      LEFT JOIN users u1 ON ak.created_by = u1.id
      LEFT JOIN users u2 ON ak.used_by = u2.id
      ORDER BY ak.created_at DESC
    `).all();
    
    res.json(keys);
  } catch (err) {
    console.error('Error fetching keys:', err);
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
});

app.delete('/api/admin/keys/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM access_keys WHERE id = ?').run(req.params.id);
    logSIEM('key_deleted', 'low', req, { key_id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting key:', err);
    res.status(500).json({ error: 'Failed to delete key' });
  }
});

// ============= ADMIN API - STATS =============

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  try {
    const stats = {
      users: {
        total: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
        admins: db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 1').get().count,
        banned: db.prepare('SELECT COUNT(*) as count FROM users WHERE is_banned = 1').get().count,
        withPrivateAccess: db.prepare('SELECT COUNT(*) as count FROM users WHERE has_private_access = 1').get().count
      },
      threads: {
        total: db.prepare('SELECT COUNT(*) as count FROM threads WHERE is_deleted = 0').get().count,
        public: db.prepare('SELECT COUNT(*) as count FROM threads WHERE is_private = 0 AND is_deleted = 0').get().count,
        private: db.prepare('SELECT COUNT(*) as count FROM threads WHERE is_private = 1 AND is_deleted = 0').get().count
      },
      replies: {
        total: db.prepare('SELECT COUNT(*) as count FROM replies WHERE is_deleted = 0').get().count
      },
      keys: {
        total: db.prepare('SELECT COUNT(*) as count FROM access_keys').get().count,
        active: db.prepare('SELECT COUNT(*) as count FROM access_keys WHERE is_active = 1').get().count,
        used: db.prepare('SELECT COUNT(*) as count FROM access_keys WHERE used_by IS NOT NULL').get().count
      },
      siem: {
        total: db.prepare('SELECT COUNT(*) as count FROM siem_events').get().count,
        critical: db.prepare('SELECT COUNT(*) as count FROM siem_events WHERE severity = "critical"').get().count,
        high: db.prepare('SELECT COUNT(*) as count FROM siem_events WHERE severity = "high"').get().count,
        medium: db.prepare('SELECT COUNT(*) as count FROM siem_events WHERE severity = "medium"').get().count,
        low: db.prepare('SELECT COUNT(*) as count FROM siem_events WHERE severity = "low"').get().count
      }
    };
    
    res.json(stats);
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ============= ADMIN API - SIEM =============

app.get('/api/admin/siem', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const offset = parseInt(req.query.offset) || 0;
    const severity = req.query.severity;
    const eventType = req.query.eventType;
    
    let query = 'SELECT * FROM siem_events WHERE 1=1';
    const params = [];
    
    if (severity) {
      query += ' AND severity = ?';
      params.push(severity);
    }
    
    if (eventType) {
      query += ' AND event_type = ?';
      params.push(eventType);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const events = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM siem_events').get().count;
    
    res.json({ events, total });
  } catch (err) {
    console.error('Error fetching SIEM logs:', err);
    res.status(500).json({ error: 'Failed to fetch SIEM logs' });
  }
});

app.delete('/api/admin/siem', requireAdmin, (req, res) => {
  try {
    const olderThan = parseInt(req.query.olderThan) || 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - olderThan;
    
    const result = db.prepare('DELETE FROM siem_events WHERE created_at < ?').run(cutoff);
    
    logSIEM('siem_purged', 'medium', req, { deleted: result.changes });
    
    res.json({ success: true, deleted: result.changes });
  } catch (err) {
    console.error('Error purging SIEM:', err);
    res.status(500).json({ error: 'Failed to purge SIEM' });
  }
});

// ============= ADMIN API - IP BANS =============

app.get('/api/admin/ipbans', requireAdmin, (req, res) => {
  try {
    const bans = db.prepare(`
      SELECT 
        ib.*,
        u.username as banned_by_username
      FROM ip_bans ib
      LEFT JOIN users u ON ib.banned_by = u.id
      ORDER BY ib.created_at DESC
    `).all();
    
    res.json(bans);
  } catch (err) {
    console.error('Error fetching IP bans:', err);
    res.status(500).json({ error: 'Failed to fetch IP bans' });
  }
});

app.post('/api/admin/ipbans', requireAdmin, (req, res) => {
  try {
    const { ipAddress, reason, duration } = req.body;
    
    if (!ipAddress) {
      return res.status(400).json({ error: 'IP address required' });
    }
    
    const expiresAt = duration ? Date.now() + duration : null;
    
    const result = db.prepare(`
      INSERT INTO ip_bans (ip_address, reason, banned_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(ipAddress, reason || 'No reason', req.session.userId, Date.now(), expiresAt);
    
    logSIEM('ip_banned', 'high', req, { ip_address: ipAddress });
    
    res.json({ success: true, banId: result.lastInsertRowid });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'IP already banned' });
    }
    console.error('Error creating IP ban:', err);
    res.status(500).json({ error: 'Failed to create IP ban' });
  }
});

app.delete('/api/admin/ipbans/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM ip_bans WHERE id = ?').run(req.params.id);
    logSIEM('ip_unbanned', 'medium', req, { ban_id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting IP ban:', err);
    res.status(500).json({ error: 'Failed to delete IP ban' });
  }
});

// ============= ADMIN API - PASSWORD CHANGE =============

app.post('/api/admin/change-password', requireAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords required' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be 8+ characters' });
    }
    
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.session.userId);
    
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      logSIEM('password_change_failed', 'medium', req, {});
      return res.status(401).json({ error: 'Current password incorrect' });
    }
    
    const newHash = bcrypt.hashSync(newPassword, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);
    
    logSIEM('password_changed', 'medium', req, {});
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============= ERROR HANDLER =============

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  logSIEM('server_error', 'high', req, { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// ============= START SERVER =============

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀 offensive-forum running on http://localhost:${PORT}`);
  console.log(`📊 Database: ${process.env.DB_PATH || './database.sqlite'}`);
  console.log(`🔐 Admin panel: http://localhost:${PORT}/admin`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  db.close();
  process.exit(0);
});

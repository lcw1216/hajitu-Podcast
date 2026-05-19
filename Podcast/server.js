const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

process.on('uncaughtException', function(err) {
  console.error('UNCAUGHT EXCEPTION:', err.message, err.stack);
});

process.on('unhandledRejection', function(reason) {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const db = new Database(path.join(__dirname, 'acm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS contests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    creator_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_finished INTEGER DEFAULT 0,
    FOREIGN KEY (creator_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    contest_id INTEGER NOT NULL,
    problem TEXT NOT NULL,
    code TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, contest_id, problem),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (contest_id) REFERENCES contests(id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contest_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    problem TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contest_id) REFERENCES contests(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    expired_at DATETIME NOT NULL
  );
`);

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

var SqliteSessionStore = function(options) {
  this.db = options.db;
  this.ttl = options.ttl || 86400;
  this._getStmt = this.db.prepare('SELECT session FROM sessions WHERE sid = ? AND expired_at > datetime(\'now\')');
  this._setStmt = this.db.prepare('INSERT OR REPLACE INTO sessions (sid, session, expired_at) VALUES (?, ?, datetime(\'now\', ?))');
  this._delStmt = this.db.prepare('DELETE FROM sessions WHERE sid = ?');
  this._pruneStmt = this.db.prepare('DELETE FROM sessions WHERE expired_at <= datetime(\'now\')');
};

SqliteSessionStore.prototype.get = function(sid, cb) {
  try {
    var row = this._getStmt.get(sid);
    cb(null, row ? JSON.parse(row.session) : null);
  } catch (err) {
    cb(err);
  }
};

SqliteSessionStore.prototype.set = function(sid, session, cb) {
  try {
    var maxAge = session.cookie && session.cookie.maxAge ? Math.floor(session.cookie.maxAge / 1000) : this.ttl;
    this._setStmt.run(sid, JSON.stringify(session), '+' + maxAge + ' seconds');
    cb(null);
  } catch (err) {
    cb(err);
  }
};

SqliteSessionStore.prototype.destroy = function(sid, cb) {
  try {
    this._delStmt.run(sid);
    if (cb) cb(null);
  } catch (err) {
    if (cb) cb(err);
  }
};

SqliteSessionStore.prototype.prune = function() {
  try {
    var result = this._pruneStmt.run();
    if (result.changes > 0) {
      console.log('Session cleanup: removed ' + result.changes + ' expired sessions');
    }
  } catch (err) {
    console.error('Session prune error:', err.message);
  }
};

var sessionStore = new SqliteSessionStore({ db: db, ttl: 7 * 24 * 3600 });

app.use(function(req, res, next) {
  var origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'acm-groupwork-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.use(express.static(__dirname));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

app.get('/api/me', function(req, res) {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  try {
    var user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.session.userId);
    res.json({ user: user || null });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/register', function(req, res) {
  try {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (username.length < 2) {
      return res.status(400).json({ error: '用户名至少2个字符' });
    }
    if (password.length < 3) {
      return res.status(400).json({ error: '密码至少3个字符' });
    }

    var existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    var salt = crypto.randomBytes(16).toString('hex');
    var password_hash = hashPassword(password, salt);

    var result = db.prepare('INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)').run(username, password_hash, salt);
    req.session.userId = result.lastInsertRowid;
    req.session.save(function() {});
    res.json({ success: true, user: { id: result.lastInsertRowid, username: username } });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/login', function(req, res) {
  try {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    var user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(400).json({ error: '用户名或密码错误' });
    }

    var hash = hashPassword(password, user.password_salt);
    if (hash !== user.password_hash) {
      return res.status(400).json({ error: '用户名或密码错误' });
    }

    req.session.userId = user.id;
    req.session.save(function() {});
    res.json({ success: true, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/logout', function(req, res) {
  req.session.destroy(function() {
    res.json({ success: true });
  });
});

app.get('/api/contests', function(req, res) {
  try {
    var contests = db.prepare(`
      SELECT c.id, c.name, c.creator_id, c.created_at, c.is_finished, u.username as creator_name
      FROM contests c JOIN users u ON c.creator_id = u.id
      ORDER BY c.created_at DESC
    `).all();
    res.json({ contests: contests || [] });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.post('/api/contests', requireAuth, function(req, res) {
  try {
    var name = (req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: '比赛名不能为空' });
    }

    var result = db.prepare('INSERT INTO contests (name, creator_id) VALUES (?, ?)').run(name, req.session.userId);
    var contest = db.prepare('SELECT * FROM contests WHERE id = ?').get(result.lastInsertRowid);
    res.json({ success: true, contest: contest });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/contests/:id', function(req, res) {
  try {
    var contest = db.prepare(`
      SELECT c.*, u.username as creator_name
      FROM contests c JOIN users u ON c.creator_id = u.id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!contest) {
      return res.status(404).json({ error: '比赛不存在' });
    }
    res.json({ contest: contest });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/contests/:id/submissions', function(req, res) {
  try {
    var problem = req.query.problem;
    var contestId = req.params.id;

    var submissions;
    if (problem) {
      submissions = db.prepare(`
        SELECT s.id, s.user_id, u.username, s.contest_id, s.problem, s.code, s.updated_at
        FROM submissions s JOIN users u ON s.user_id = u.id
        WHERE s.contest_id = ? AND s.problem = ?
        ORDER BY u.username
      `).all(contestId, problem.toUpperCase());
    } else {
      submissions = db.prepare(`
        SELECT s.id, s.user_id, u.username, s.contest_id, s.problem, s.code, s.updated_at
        FROM submissions s JOIN users u ON s.user_id = u.id
        WHERE s.contest_id = ?
        ORDER BY s.problem, u.username
      `).all(contestId);
    }

    res.json({ submissions: submissions || [] });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.put('/api/contests/:id/submissions/:problem', requireAuth, function(req, res) {
  try {
    var contestId = req.params.id;
    var problem = req.params.problem.toUpperCase();
    var userId = req.session.userId;
    var code = req.body.code || '';

    if (!/^[A-L]$/.test(problem)) {
      return res.status(400).json({ error: '题目必须是 A-L' });
    }

    var existing = db.prepare(
      'SELECT id FROM submissions WHERE user_id = ? AND contest_id = ? AND problem = ?'
    ).get(userId, contestId, problem);

    if (existing) {
      db.prepare(
        'UPDATE submissions SET code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(code, existing.id);
    } else {
      db.prepare(
        'INSERT INTO submissions (user_id, contest_id, problem, code) VALUES (?, ?, ?, ?)'
      ).run(userId, contestId, problem, code);
    }

    db.prepare(
      'INSERT INTO activities (contest_id, user_id, problem, action) VALUES (?, ?, ?, ?)'
    ).run(contestId, userId, problem, 'update');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.delete('/api/contests/:id/submissions/:problem', requireAuth, function(req, res) {
  try {
    var contestId = req.params.id;
    var problem = req.params.problem.toUpperCase();
    var userId = req.session.userId;

    if (!/^[A-L]$/.test(problem)) {
      return res.status(400).json({ error: '题目必须是 A-L' });
    }

    db.prepare(
      'DELETE FROM submissions WHERE user_id = ? AND contest_id = ? AND problem = ?'
    ).run(userId, contestId, problem);

    db.prepare(
      'INSERT INTO activities (contest_id, user_id, problem, action) VALUES (?, ?, ?, ?)'
    ).run(contestId, userId, problem, 'delete');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/contests/:id/activities', function(req, res) {
  try {
    var contestId = req.params.id;
    var limit = parseInt(req.query.limit) || 20;

    var activities = db.prepare(`
      SELECT a.id, a.contest_id, a.user_id, u.username, a.problem, a.action, a.created_at
      FROM activities a JOIN users u ON a.user_id = u.id
      WHERE a.contest_id = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(contestId, limit);

    res.json({ activities: activities || [] });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

app.get('/api/users', function(req, res) {
  try {
    var users = db.prepare('SELECT id, username FROM users ORDER BY username').all();
    res.json({ users: users || [] });
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

var server = app.listen(PORT, function() {
  console.log('ACM GroupWork server running at http://localhost:' + PORT);
});

var maintenanceTimer = setInterval(function() {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    console.log('WAL checkpoint completed');
  } catch (err) {
    console.error('WAL checkpoint error:', err.message);
  }

  try {
    var result = db.prepare(
      'DELETE FROM activities WHERE created_at < datetime(\'now\', \'-30 days\')'
    ).run();
    if (result.changes > 0) {
      console.log('Activities cleanup: removed ' + result.changes + ' old records');
    }
  } catch (err) {
    console.error('Activities cleanup error:', err.message);
  }
}, 3600000);

var sessionPruneTimer = setInterval(function() {
  sessionStore.prune();
}, 1800000);

process.on('SIGTERM', function() {
  console.log('SIGTERM received, shutting down gracefully...');
  clearInterval(maintenanceTimer);
  clearInterval(sessionPruneTimer);

  server.close(function() {
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch(e) {}
    db.close();
    console.log('Server shut down');
    process.exit(0);
  });

  setTimeout(function() {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

app.set('trust proxy', 1);

const db = new Database(path.join(__dirname, 'acm.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    ip TEXT DEFAULT '',
    detail TEXT DEFAULT '',
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
`);

(function migrateUserTable() {
  try {
    db.exec("ALTER TABLE users ADD COLUMN login_attempts INTEGER DEFAULT 0");
  } catch(e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN locked_until DATETIME");
  } catch(e) {}
  try {
    db.exec("ALTER TABLE users ADD COLUMN last_login_at DATETIME");
  } catch(e) {}
})();

function authLog(userId, username, action, detail) {
  try {
    var ip = '';
    db.prepare('INSERT INTO auth_logs (user_id, username, action, ip, detail) VALUES (?, ?, ?, ?, ?)').run(userId || null, username || '', action, ip, detail || '');
  } catch(e) {}
}

function isBcryptHash(hash) {
  return hash && (hash.substring(0, 4) === '$2a$' || hash.substring(0, 4) === '$2b$');
}

function verifyPassword(password, hash, salt) {
  if (isBcryptHash(hash)) {
    return bcrypt.compareSync(password, hash);
  }
  var oldHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return oldHash === hash;
}

function hashPasswordBcrypt(password) {
  var salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

function upgradeToBcrypt(userId, password) {
  try {
    var newHash = hashPasswordBcrypt(password);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(newHash, '', userId);
  } catch(e) {}
}

app.use(express.json({ limit: '10mb' }));
app.use(session({
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

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  try {
    var user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.session.userId);
    res.json({ user: user || null });
  } catch(e) {
    res.json({ user: null });
  }
});

app.post('/api/register', (req, res) => {
  try {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (username.length < 2) {
      return res.status(400).json({ error: '用户名至少2个字符' });
    }
    if (username.length > 20) {
      return res.status(400).json({ error: '用户名不能超过20个字符' });
    }
    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(username)) {
      return res.status(400).json({ error: '用户名只能包含字母、数字、下划线和中文' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6个字符' });
    }
    if (password.length > 100) {
      return res.status(400).json({ error: '密码不能超过100个字符' });
    }
    if (!/[a-zA-Z]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含至少一个字母' });
    }
    if (!/[0-9]/.test(password)) {
      return res.status(400).json({ error: '密码必须包含至少一个数字' });
    }

    var existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      authLog(null, username, 'register_fail', '用户名已存在');
      return res.status(400).json({ error: '用户名已存在' });
    }

    var password_hash = hashPasswordBcrypt(password);
    var result = db.prepare('INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)').run(username, password_hash, '');
    req.session.userId = result.lastInsertRowid;
    authLog(result.lastInsertRowid, username, 'register_ok', '注册成功');
    res.json({ success: true, user: { id: result.lastInsertRowid, username: username } });
  } catch(e) {
    res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
});

app.post('/api/login', (req, res) => {
  try {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    var user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      authLog(null, username, 'login_fail', '用户不存在');
      return res.status(400).json({ error: '用户名或密码错误' });
    }

    if (user.locked_until) {
      var lockedUntil = new Date(user.locked_until + 'Z');
      if (!isNaN(lockedUntil.getTime()) && lockedUntil > new Date()) {
        var remainMin = Math.ceil((lockedUntil - new Date()) / 60000);
        authLog(user.id, username, 'login_lock', '账号被锁定');
        return res.status(400).json({ error: '账号已被锁定，请' + remainMin + '分钟后重试' });
      }
      db.prepare('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id);
    }

    var valid = verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) {
      var attempts = (user.login_attempts || 0) + 1;
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        var lockUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        db.prepare('UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?').run(attempts, lockUntil, user.id);
        authLog(user.id, username, 'login_lock', '连续' + attempts + '次失败，已锁定' + LOCKOUT_MINUTES + '分钟');
        return res.status(400).json({ error: '密码错误次数过多，账号已锁定' + LOCKOUT_MINUTES + '分钟' });
      }
      db.prepare('UPDATE users SET login_attempts = ? WHERE id = ?').run(attempts, user.id);
      authLog(user.id, username, 'login_fail', '密码错误，第' + attempts + '次');
      return res.status(400).json({ error: '用户名或密码错误' });
    }

    if (isBcryptHash(user.password_hash) === false) {
      upgradeToBcrypt(user.id, password);
    }

    db.prepare('UPDATE users SET login_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    req.session.userId = user.id;
    authLog(user.id, username, 'login_ok', '登录成功');
    res.json({ success: true, user: { id: user.id, username: user.username } });
  } catch(e) {
    res.status(500).json({ error: '服务器错误，请稍后重试' });
  }
});

app.post('/api/logout', (req, res) => {
  var uid = req.session.userId;
  req.session.destroy(() => {
    if (uid) authLog(uid, '', 'logout', '退出登录');
    res.json({ success: true });
  });
});

app.get('/api/contests', (req, res) => {
  const contests = db.prepare(`
    SELECT c.id, c.name, c.creator_id, c.created_at, c.is_finished, u.username as creator_name
    FROM contests c JOIN users u ON c.creator_id = u.id
    ORDER BY c.created_at DESC
  `).all();
  res.json({ contests });
});

app.post('/api/contests', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '比赛名不能为空' });
  }

  const result = db.prepare('INSERT INTO contests (name, creator_id) VALUES (?, ?)').run(name.trim(), req.session.userId);
  const contest = db.prepare('SELECT * FROM contests WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, contest });
});

app.delete('/api/contests/:id', requireAuth, (req, res) => {
  const contestId = req.params.id;
  const userId = req.session.userId;

  const contest = db.prepare('SELECT * FROM contests WHERE id = ?').get(contestId);
  if (!contest) {
    return res.status(404).json({ error: '比赛不存在' });
  }
  if (contest.creator_id !== userId) {
    return res.status(403).json({ error: '只有创建者可以删除比赛' });
  }

  db.prepare('DELETE FROM activities WHERE contest_id = ?').run(contestId);
  db.prepare('DELETE FROM submissions WHERE contest_id = ?').run(contestId);
  db.prepare('DELETE FROM contests WHERE id = ?').run(contestId);

  res.json({ success: true });
});

app.get('/api/contests/:id', (req, res) => {
  const contest = db.prepare(`
    SELECT c.*, u.username as creator_name
    FROM contests c JOIN users u ON c.creator_id = u.id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!contest) {
    return res.status(404).json({ error: '比赛不存在' });
  }
  res.json({ contest });
});

app.get('/api/contests/:id/submissions', (req, res) => {
  const { problem } = req.query;
  const contestId = req.params.id;

  let submissions;
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

  res.json({ submissions });
});

app.put('/api/contests/:id/submissions/:problem', requireAuth, (req, res) => {
  const contestId = req.params.id;
  const problem = req.params.problem.toUpperCase();
  const userId = req.session.userId;
  const { code } = req.body;

  if (!/^[A-L]$/.test(problem)) {
    return res.status(400).json({ error: '题目必须是 A-L' });
  }

  const existing = db.prepare(
    'SELECT id FROM submissions WHERE user_id = ? AND contest_id = ? AND problem = ?'
  ).get(userId, contestId, problem);

  if (existing) {
    db.prepare(
      'UPDATE submissions SET code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(code || '', existing.id);
  } else {
    db.prepare(
      'INSERT INTO submissions (user_id, contest_id, problem, code) VALUES (?, ?, ?, ?)'
    ).run(userId, contestId, problem, code || '');
  }

  db.prepare(
    'INSERT INTO activities (contest_id, user_id, problem, action) VALUES (?, ?, ?, ?)'
  ).run(contestId, userId, problem, 'update');

  res.json({ success: true });
});

app.delete('/api/contests/:id/submissions/:problem', requireAuth, (req, res) => {
  const contestId = req.params.id;
  const problem = req.params.problem.toUpperCase();
  const userId = req.session.userId;

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
});

app.get('/api/contests/:id/activities', (req, res) => {
  const contestId = req.params.id;
  const limit = parseInt(req.query.limit) || 20;

  const activities = db.prepare(`
    SELECT a.id, a.contest_id, a.user_id, u.username, a.problem, a.action, a.created_at
    FROM activities a JOIN users u ON a.user_id = u.id
    WHERE a.contest_id = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `).all(contestId, limit);

  res.json({ activities });
});

app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, username FROM users ORDER BY username').all();
  res.json({ users });
});

app.listen(PORT, () => {
  console.log(`ACM GroupWork server running at http://localhost:${PORT}`);
});

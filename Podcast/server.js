const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

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
`);

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
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
  const user = db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user });
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.trim().length < 2) {
    return res.status(400).json({ error: '用户名至少2个字符' });
  }
  if (password.length < 3) {
    return res.status(400).json({ error: '密码至少3个字符' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const password_hash = hashPassword(password, salt);

  const result = db.prepare('INSERT INTO users (username, password_hash, password_salt) VALUES (?, ?, ?)').run(username.trim(), password_hash, salt);
  req.session.userId = result.lastInsertRowid;
  res.json({ success: true, user: { id: result.lastInsertRowid, username: username.trim() } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }

  const hash = hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }

  req.session.userId = user.id;
  res.json({ success: true, user: { id: user.id, username: user.username } });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
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

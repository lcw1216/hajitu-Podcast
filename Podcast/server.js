const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// ===== 加载 .env（API key 等敏感配置，已被 gitignore 忽略） =====
(function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
})();

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

  CREATE TABLE IF NOT EXISTS cf_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    problem_key TEXT,
    title TEXT,
    rating INTEGER,
    tags TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS cf_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES cf_sessions(id)
  );

  CREATE TABLE IF NOT EXISTS cf_accounts (
    user_id INTEGER PRIMARY KEY,
    cf_username TEXT NOT NULL,
    cf_encrypted_password TEXT NOT NULL,
    cookie_session TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS cf_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    problem_key TEXT NOT NULL,
    language TEXT NOT NULL,
    code TEXT NOT NULL,
    cf_submission_id TEXT,
    verdict TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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

// ============================================================
// CF AI Trainer 路由
// ============================================================
const cf = require('./cf-ai.js');

function getCfSession(userId, sessionId) {
  if (sessionId) {
    return db.prepare('SELECT * FROM cf_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  }
  return db.prepare('SELECT * FROM cf_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
}

function getSessionMessages(sessionId) {
  return db.prepare('SELECT role, content FROM cf_messages WHERE session_id = ? ORDER BY id').all(sessionId);
}

function saveMessage(sessionId, role, content) {
  db.prepare('INSERT INTO cf_messages (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, role, content);
}

// 抽题（难度/Tag/去重）
app.get('/api/cf/random', requireAuth, async (req, res) => {
  try {
    const minRating = req.query.min ? parseInt(req.query.min) : null;
    const maxRating = req.query.max ? parseInt(req.query.max) : null;
    const tags = req.query.tags ? req.query.tags.split(',') : [];
    const exclude = new Set(
      db.prepare('SELECT problem_key FROM cf_sessions WHERE user_id = ?').all(req.session.userId).map(r => r.problem_key).filter(Boolean)
    );
    const problems = await cf.fetchProblemList();
    const picked = cf.pickRandomProblem(problems, { minRating, maxRating, tags }, exclude);
    if (!picked) return res.status(404).json({ error: '没有符合条件的题目（可能都刷过了，尝试放宽难度/标签）' });
    res.json({ problem: picked });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 题面（英文原文 + AI 中文翻译，翻译缓存 7 天）
const statementCache = new Map();
app.get('/api/cf/problem/:contestId/:index', requireAuth, async (req, res) => {
  try {
    const key = `${req.params.contestId}${req.params.index}`;
    const cacheKey = 'stmt:' + key;
    const cached = statementCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 7 * 24 * 3600 * 1000) {
      return res.json({ key, statement: cached.en, translation: cached.cn });
    }
    const en = await cf.fetchProblemStatement(req.params.contestId, req.params.index);
    let cn = '';
    if (cf.CF_AI_APIKEY) {
      cn = await cf.aiChat([
        { role: 'system', content: '你是算法竞赛题面翻译专家。把用户给的英文题面完整翻译成中文，保持术语准确（输入/输出格式、约束、样例），用 Markdown 格式输出。' },
        { role: 'user', content: en.slice(0, 8000) }
      ]);
    }
    statementCache.set(cacheKey, { at: Date.now(), en, cn });
    res.json({ key, statement: en, translation: cn });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 对话（SSE 流式）
app.post('/api/cf/chat', requireAuth, async (req, res) => {
  if (!cf.CF_AI_APIKEY) return res.status(503).json({ error: '服务端未配置 AI API key' });
  if (!cf.rateLimit(cf.chatLimiter, String(req.session.userId), 10, 60)) {
    return res.status(429).json({ error: '对话频率过快，请稍候（限 10 次/分钟）' });
  }
  const { sessionId, message, problemKey, problemTitle, problemStatement, translation } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: '消息不能为空' });

  let sid = sessionId;
  let session = sid ? getCfSession(req.session.userId, sid) : getCfSession(req.session.userId);
  if (!session) {
    const r = db.prepare('INSERT INTO cf_sessions (user_id, problem_key, title) VALUES (?, ?, ?)')
      .run(req.session.userId, problemKey || null, problemTitle || null);
    sid = r.lastInsertRowid;
    session = getCfSession(req.session.userId, sid);
  }

  saveMessage(sid, 'user', message);

  const history = getSessionMessages(sid).slice(-10);
  const systemPrompt = [
    { role: 'system', content: '你是竞赛算法教练（Codeforces 刷题助手）。你使用中文交流。' +
      '你的职责：\n1. 引导用户思考解题思路（苏格拉底式提问），不要直接给完整代码；\n' +
      '2. 当用户明确说"提示"/"hint"时，给思路方向、关键性质或常用算法，但仍不给完整代码；\n' +
      '3. 当用户明确说"生成代码"/"代码"时，给出完整的、可直接提交的代码（默认 C++17），并简要解释；\n' +
      '4. 用户在讨论思路时，指出错误并纠正。\n' +
      (problemKey ? `\n当前题目: ${problemKey} ${problemTitle || ''}` : '') +
      (problemStatement ? `\n英文题面:\n${problemStatement.slice(0, 6000)}` : '') +
      (translation ? `\n中文题面:\n${translation.slice(0, 6000)}` : '')
    }
  ];
  const messages = systemPrompt.concat(history);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    let full = '';
    await cf.aiStream(messages, (delta) => {
      full += delta;
      res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });
    saveMessage(sid, 'assistant', full);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// 用户粘贴题面 → AI 翻译（CF 题面被 Cloudflare 拦截时的替代方案）
app.post('/api/cf/translate', requireAuth, async (req, res) => {
  if (!cf.CF_AI_APIKEY) return res.status(503).json({ error: '服务端未配置 AI API key' });
  const { statement } = req.body;
  if (!statement || !statement.trim()) return res.status(400).json({ error: '题面不能为空' });
  try {
    const cn = await cf.aiChat([
      { role: 'system', content: '你是算法竞赛题面翻译专家。把用户给的英文题面完整翻译成中文，保持术语准确（输入/输出格式、约束、样例），用 Markdown 格式输出。只输出翻译结果。' },
      { role: 'user', content: statement.slice(0, 8000) }
    ]);
    res.json({ translation: cn });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 历史会话列表 + 消息
app.get('/api/cf/history', requireAuth, (req, res) => {
  const sessions = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM cf_messages m WHERE m.session_id = s.id) AS msg_count
    FROM cf_sessions s WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50
  `).all(req.session.userId);
  res.json({ sessions });
});

app.get('/api/cf/session/:id/messages', requireAuth, (req, res) => {
  const session = getCfSession(req.session.userId, req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  res.json({ messages: getSessionMessages(session.id) });
});

app.delete('/api/cf/session/:id', requireAuth, (req, res) => {
  const session = getCfSession(req.session.userId, req.params.id);
  if (!session) return res.status(404).json({ error: '会话不存在' });
  db.prepare('DELETE FROM cf_messages WHERE session_id = ?').run(session.id);
  db.prepare('DELETE FROM cf_sessions WHERE id = ?').run(session.id);
  res.json({ success: true });
});

// CF 账号绑定（AES 加密存储）
app.post('/api/cf/account', requireAuth, (req, res) => {
  const { cfUsername, cfPassword } = req.body;
  if (!cfUsername || !cfPassword) return res.status(400).json({ error: '请输入 CF 用户名和密码' });
  const enc = cf.aesEncrypt(cfPassword, cf.CF_ENC_KEY);
  db.prepare(`
    INSERT INTO cf_accounts (user_id, cf_username, cf_encrypted_password, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET cf_username=excluded.cf_username, cf_encrypted_password=excluded.cf_encrypted_password, updated_at=CURRENT_TIMESTAMP
  `).run(req.session.userId, cfUsername.trim(), enc);
  res.json({ success: true });
});

app.get('/api/cf/account', requireAuth, (req, res) => {
  const acc = db.prepare('SELECT cf_username FROM cf_accounts WHERE user_id = ?').get(req.session.userId);
  res.json({ bound: !!acc, cfUsername: acc ? acc.cf_username : null });
});

app.delete('/api/cf/account', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cf_accounts WHERE user_id = ?').run(req.session.userId);
  res.json({ success: true });
});

// 提交代码到 CF
app.post('/api/cf/submit', requireAuth, async (req, res) => {
  if (!cf.rateLimit(cf.submitLimiter, String(req.session.userId), 5, 60)) {
    return res.status(429).json({ error: '提交频率过快（限 5 次/分钟）' });
  }
  const { contestId, index, code, language } = req.body;
  if (!contestId || !index || !code) return res.status(400).json({ error: '参数不完整' });

  const acc = db.prepare('SELECT * FROM cf_accounts WHERE user_id = ?').get(req.session.userId);
  if (!acc) return res.status(400).json({ error: '请先绑定 CF 账号' });
  const password = cf.aesDecrypt(acc.cf_encrypted_password, cf.CF_ENC_KEY);
  if (!password) return res.status(500).json({ error: 'CF 密码解密失败' });

  const langMap = { 'cpp17': 54, 'cpp20': 89, 'python3': 31 };
  const programTypeId = langMap[language] || 89;

  try {
    const login = await cf.cfLogin(acc.cf_username, password);
    const submit = await cf.cfSubmit(login.cookie, login.csrf, contestId, index, code, programTypeId);
    const problemKey = `${contestId}${index}`;
    const r = db.prepare(`
      INSERT INTO cf_submissions (user_id, problem_key, language, code, cf_submission_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.session.userId, problemKey, language || 'cpp20', code, submit.submissionId || '');
    res.json({ success: true, submissionId: submit.submissionId, localId: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 提交历史
app.get('/api/cf/submissions', requireAuth, (req, res) => {
  const subs = db.prepare(`
    SELECT * FROM cf_submissions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.session.userId);
  res.json({ submissions: subs });
});

// 查询某次提交的测评结果（轮询）
app.get('/api/cf/submission/:localId', requireAuth, async (req, res) => {
  try {
    const sub = db.prepare('SELECT * FROM cf_submissions WHERE id = ? AND user_id = ?').get(req.params.localId, req.session.userId);
    if (!sub) return res.status(404).json({ error: '提交记录不存在' });
    if (!sub.cf_submission_id) return res.json({ verdict: 'PENDING', note: '尚未获取 CF 提交号' });
    const acc = db.prepare('SELECT cf_username FROM cf_accounts WHERE user_id = ?').get(req.session.userId);
    const verdict = await cf.cfVerdict(acc ? acc.cf_username : '', sub.cf_submission_id);
    if (verdict.verdict !== 'PENDING') {
      db.prepare('UPDATE cf_submissions SET verdict = ? WHERE id = ?').run(verdict.verdict, sub.id);
    }
    res.json(verdict);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`ACM GroupWork server running at http://localhost:${PORT}`);
});

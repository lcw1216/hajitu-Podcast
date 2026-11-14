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

  CREATE TABLE IF NOT EXISTS submission_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contest_id INTEGER NOT NULL,
    problem TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    code TEXT DEFAULT '',
    name TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contest_id) REFERENCES contests(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS machine_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
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

  CREATE TABLE IF NOT EXISTS contest_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contest_id INTEGER NOT NULL,
    problem TEXT NOT NULL,
    status TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contest_id) REFERENCES contests(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_contest_records
    ON contest_records(contest_id, problem, id);
`);

// 机器占用状态只有一行
db.prepare('INSERT OR IGNORE INTO machine_status (id, user_id) VALUES (1, NULL)').run();

// ===== ACM 赛制判题记录与罚时计算 =====
const PROBLEM_SET = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
const RECORD_STATUSES = ['AC', 'WA', 'TLE', 'RE', 'CE', 'PE'];
// 除 CE 外的非 AC 结果，每次计 20 分钟罚时
const PENALTY_STATUSES = ['WA', 'TLE', 'RE', 'PE'];
const PENALTY_MINUTES = 20;
// 比赛时长：5 小时
const CONTEST_DURATION_MINUTES = 300;

// SQLite 的 CURRENT_TIMESTAMP 为 UTC，且不带 Z，统一按 UTC 解析
function parseUtcTime(value) {
  if (!value) return null;
  const str = String(value);
  if (/Z$|[+-]\d{2}:\d{2}$/.test(str)) return new Date(str);
  return new Date(str.replace(' ', 'T') + 'Z');
}

function computeScoreboard(contestId) {
  const contest = db.prepare('SELECT id, created_at, started_at FROM contests WHERE id = ?').get(contestId);
  if (!contest) return null;

  const records = db.prepare(`
    SELECT r.id, r.problem, r.status, r.created_at, r.created_by, u.username AS creator_name
    FROM contest_records r LEFT JOIN users u ON u.id = r.created_by
    WHERE r.contest_id = ?
    ORDER BY r.created_at ASC, r.id ASC
  `).all(contestId);

  const startTime = parseUtcTime(contest.started_at);
  const endTime = startTime
    ? new Date(startTime.getTime() + CONTEST_DURATION_MINUTES * 60000)
    : null;
  const now = Date.now();

  let phase = 'not_started';
  let remainingSeconds = 0;
  if (startTime) {
    if (now >= endTime.getTime()) {
      phase = 'ended';
    } else {
      phase = 'running';
      remainingSeconds = Math.max(0, Math.floor((endTime.getTime() - now) / 1000));
    }
  }
  const problems = [];
  const recordViews = [];
  let solvedCount = 0;
  let totalPenalty = 0;

  for (const problem of PROBLEM_SET) {
    const list = records.filter(r => r.problem === problem);
    const firstAcIndex = list.findIndex(r => r.status === 'AC');
    const countedBeforeAc = firstAcIndex < 0
      ? 0
      : list.slice(0, firstAcIndex).filter(r => PENALTY_STATUSES.indexOf(r.status) >= 0).length;

    let penalty = 0;
    let acMinutes = 0;

    const enriched = list.map((r, idx) => {
      let counted = false;
      let note;
      if (firstAcIndex < 0) {
        note = r.status === 'CE' ? 'CE 不计罚' : '未通过，暂不计罚';
      } else if (idx < firstAcIndex) {
        counted = PENALTY_STATUSES.indexOf(r.status) >= 0;
        note = counted ? '计罚 +' + PENALTY_MINUTES + ' 分钟' : 'CE 不计罚';
      } else if (idx === firstAcIndex) {
        counted = true;
        note = '计分';
      } else {
        note = 'AC 后提交，不计罚';
      }
      return {
        id: r.id,
        problem: r.problem,
        status: r.status,
        created_at: r.created_at,
        creator_name: r.creator_name || '未知',
        counted: counted,
        note: note
      };
    });

    if (firstAcIndex >= 0) {
      const acTime = parseUtcTime(list[firstAcIndex].created_at);
      acMinutes = startTime && acTime
        ? Math.min(CONTEST_DURATION_MINUTES, Math.max(0, Math.floor((acTime.getTime() - startTime.getTime()) / 60000)))
        : 0;
      penalty = startTime ? acMinutes + countedBeforeAc * PENALTY_MINUTES : 0;
      enriched[firstAcIndex].penalty = penalty;
      enriched[firstAcIndex].note = '计分 · 赛时 ' + acMinutes + ' 分钟'
        + (countedBeforeAc ? ' + ' + countedBeforeAc + ' 次非 AC ×' + PENALTY_MINUTES : '')
        + ' → 罚时 ' + penalty + ' 分钟';
      solvedCount += 1;
      totalPenalty += penalty;
    }

    const last = list.length ? list[list.length - 1] : null;
    problems.push({
      problem: problem,
      solved: firstAcIndex >= 0,
      status: firstAcIndex >= 0 ? 'AC' : (last ? last.status : null),
      attempts: list.length,
      waCount: countedBeforeAc,
      acMinutes: acMinutes,
      penalty: penalty
    });

    for (const view of enriched) recordViews.push(view);
  }

  recordViews.sort((a, b) => parseUtcTime(a.created_at) - parseUtcTime(b.created_at));

  return {
    contestId: contest.id,
    startAt: contest.started_at,
    endsAt: endTime ? endTime.toISOString() : null,
    durationMinutes: CONTEST_DURATION_MINUTES,
    phase: phase,
    remainingSeconds: remainingSeconds,
    serverNow: new Date().toISOString(),
    solvedCount: solvedCount,
    totalProblems: PROBLEM_SET.length,
    totalPenalty: totalPenalty,
    problems: problems,
    records: recordViews
  };
}

// 旧表缺少 name 列时补充（幂等）
const versionColumns = db.prepare('PRAGMA table_info(submission_versions)').all();
if (!versionColumns.some(col => col.name === 'name')) {
  db.exec("ALTER TABLE submission_versions ADD COLUMN name TEXT DEFAULT ''");
}

// 比赛开始时间（旧比赛保持未开始状态，不影响原有数据）
const contestColumns = db.prepare('PRAGMA table_info(contests)').all();
if (!contestColumns.some(col => col.name === 'started_at')) {
  db.exec('ALTER TABLE contests ADD COLUMN started_at DATETIME');
}

// 为历史提交补齐初始版本记录（幂等）
const existingSubmissions = db.prepare(
  'SELECT contest_id, problem, user_id, code, updated_at FROM submissions'
).all();
const countVersions = db.prepare(
  'SELECT COUNT(*) AS n FROM submission_versions WHERE contest_id = ? AND problem = ? AND user_id = ?'
);
const insertVersion = db.prepare(
  'INSERT INTO submission_versions (contest_id, problem, user_id, code, created_at) VALUES (?, ?, ?, ?, ?)'
);
db.transaction(() => {
  for (const sub of existingSubmissions) {
    if (countVersions.get(sub.contest_id, sub.problem, sub.user_id).n === 0) {
      insertVersion.run(
        sub.contest_id, sub.problem, sub.user_id, sub.code || '',
        sub.updated_at || new Date().toISOString()
      );
    }
  }
})();

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

  const contest = db.prepare('SELECT * FROM contests WHERE id = ?').get(contestId);
  if (!contest) {
    return res.status(404).json({ error: '比赛不存在' });
  }

  db.prepare('DELETE FROM activities WHERE contest_id = ?').run(contestId);
  db.prepare('DELETE FROM contest_records WHERE contest_id = ?').run(contestId);
  db.prepare('DELETE FROM submission_versions WHERE contest_id = ?').run(contestId);
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

app.get('/api/contests/:id/submissions/:problem/versions', (req, res) => {
  const problem = req.params.problem.toUpperCase();
  const owner = req.query.owner;

  if (!/^[A-N]$/.test(problem) || !owner) {
    return res.status(400).json({ error: '缺少题目或代码作者参数' });
  }

  const ownerUser = db.prepare('SELECT id FROM users WHERE username = ?').get(owner);
  if (!ownerUser) {
    return res.status(404).json({ error: '代码作者不存在' });
  }

  const versions = db.prepare(`
    SELECT id, code, name, created_at FROM submission_versions
    WHERE contest_id = ? AND problem = ? AND user_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(req.params.id, problem, ownerUser.id);

  res.json({ versions });
});

app.put('/api/submission-versions/:id', requireAuth, (req, res) => {
  const version = db.prepare('SELECT * FROM submission_versions WHERE id = ?').get(req.params.id);
  if (!version) {
    return res.status(404).json({ error: '版本不存在' });
  }
  if (version.user_id !== req.session.userId) {
    return res.status(403).json({ error: '只能重命名自己的版本' });
  }

  const name = String((req.body || {}).name || '').trim();
  if (name.length > 50) {
    return res.status(400).json({ error: '版本名称最多 50 字' });
  }

  db.prepare('UPDATE submission_versions SET name = ? WHERE id = ?').run(name, version.id);
  res.json({ success: true });
});

app.delete('/api/submission-versions/:id', requireAuth, (req, res) => {
  const version = db.prepare('SELECT * FROM submission_versions WHERE id = ?').get(req.params.id);
  if (!version) {
    return res.status(404).json({ error: '版本不存在' });
  }
  if (version.user_id !== req.session.userId) {
    return res.status(403).json({ error: '只能删除自己的版本' });
  }

  db.prepare('DELETE FROM submission_versions WHERE id = ?').run(version.id);

  const latest = db.prepare(`
    SELECT code FROM submission_versions
    WHERE contest_id = ? AND problem = ? AND user_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(version.contest_id, version.problem, version.user_id);

  if (latest) {
    db.prepare(`
      UPDATE submissions SET code = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND contest_id = ? AND problem = ?
    `).run(latest.code || '', version.user_id, version.contest_id, version.problem);
  } else {
    db.prepare(`
      DELETE FROM submissions WHERE user_id = ? AND contest_id = ? AND problem = ?
    `).run(version.user_id, version.contest_id, version.problem);
  }

  res.json({ success: true });
});

app.put('/api/contests/:id/submissions/:problem', requireAuth, (req, res) => {
  const contestId = req.params.id;
  const problem = req.params.problem.toUpperCase();
  const userId = req.session.userId;
  const { code } = req.body;

  if (!/^[A-N]$/.test(problem)) {
    return res.status(400).json({ error: '题目必须是 A-N' });
  }

  const latestVersion = db.prepare(`
    SELECT code FROM submission_versions
    WHERE user_id = ? AND contest_id = ? AND problem = ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(userId, contestId, problem);

  if (latestVersion && (latestVersion.code || '') === (code || '')) {
    return res.status(400).json({ error: '代码与上一版本相同，无需重复提交' });
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
    'INSERT INTO submission_versions (contest_id, problem, user_id, code) VALUES (?, ?, ?, ?)'
  ).run(contestId, problem, userId, code || '');

  db.prepare(
    'INSERT INTO activities (contest_id, user_id, problem, action) VALUES (?, ?, ?, ?)'
  ).run(contestId, userId, problem, 'update');

  res.json({ success: true });
});

app.delete('/api/contests/:id/submissions/:problem', requireAuth, (req, res) => {
  const contestId = req.params.id;
  const problem = req.params.problem.toUpperCase();
  const userId = req.session.userId;

  if (!/^[A-N]$/.test(problem)) {
    return res.status(400).json({ error: '题目必须是 A-N' });
  }

  db.prepare(
    'DELETE FROM submissions WHERE user_id = ? AND contest_id = ? AND problem = ?'
  ).run(userId, contestId, problem);

  db.prepare(
    'DELETE FROM submission_versions WHERE user_id = ? AND contest_id = ? AND problem = ?'
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

app.post('/api/contests/:id/start', requireAuth, (req, res) => {
  const contest = db.prepare('SELECT id, started_at FROM contests WHERE id = ?').get(req.params.id);
  if (!contest) {
    return res.status(404).json({ error: '比赛不存在' });
  }
  if (contest.started_at) {
    return res.status(400).json({ error: '比赛已经开始' });
  }

  db.prepare('UPDATE contests SET started_at = CURRENT_TIMESTAMP WHERE id = ?').run(contest.id);
  res.json({ success: true });
});

app.get('/api/contests/:id/scoreboard', (req, res) => {
  const data = computeScoreboard(req.params.id);
  if (!data) {
    return res.status(404).json({ error: '比赛不存在' });
  }
  res.json(data);
});

app.post('/api/contests/:id/records', requireAuth, (req, res) => {
  const contestId = req.params.id;
  const problem = String((req.body || {}).problem || '').toUpperCase();
  const status = String((req.body || {}).status || '').toUpperCase();

  if (PROBLEM_SET.indexOf(problem) < 0) {
    return res.status(400).json({ error: '题目必须是 A-N' });
  }
  if (RECORD_STATUSES.indexOf(status) < 0) {
    return res.status(400).json({ error: '判题结果无效' });
  }

  const contest = db.prepare('SELECT id, started_at FROM contests WHERE id = ?').get(contestId);
  if (!contest) {
    return res.status(404).json({ error: '比赛不存在' });
  }
  if (!contest.started_at) {
    return res.status(400).json({ error: '比赛尚未开始，请先开始比赛' });
  }
  const startTime = parseUtcTime(contest.started_at);
  if (Date.now() >= startTime.getTime() + CONTEST_DURATION_MINUTES * 60000) {
    return res.status(400).json({ error: '比赛已结束，无法添加记录' });
  }

  db.prepare(
    'INSERT INTO contest_records (contest_id, problem, status, created_by) VALUES (?, ?, ?, ?)'
  ).run(contestId, problem, status, req.session.userId);

  res.json({ success: true });
});

app.delete('/api/contests/:id/records/:recordId', requireAuth, (req, res) => {
  const record = db.prepare('SELECT * FROM contest_records WHERE id = ?').get(req.params.recordId);
  if (!record || String(record.contest_id) !== String(req.params.id)) {
    return res.status(404).json({ error: '记录不存在' });
  }

  db.prepare('DELETE FROM contest_records WHERE id = ?').run(record.id);
  res.json({ success: true });
});

app.get('/api/users', (req, res) => {
  const users = db.prepare('SELECT id, username FROM users ORDER BY username').all();
  res.json({ users });
});

// ===== 机器占用 =====
app.get('/api/machine-status', (req, res) => {
  const row = db.prepare(`
    SELECT u.username FROM machine_status m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.id = 1
  `).get();

  res.json({ user: row && row.username ? { username: row.username } : null });
});

app.post('/api/machine-status', requireAuth, (req, res) => {
  const username = String((req.body || {}).username || '').trim();
  const current = db.prepare('SELECT user_id FROM machine_status WHERE id = 1').get();

  const target = username
    ? db.prepare('SELECT id, username FROM users WHERE username = ?').get(username)
    : null;

  if (username && !target) {
    return res.status(404).json({ error: '用户不存在' });
  }

  // 点击当前占机者视为释放，其余情况切换给被点击的人
  const nextId = (!target || (current && current.user_id === target.id)) ? null : target.id;

  db.prepare(
    'UPDATE machine_status SET user_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
  ).run(nextId);

  res.json({ user: nextId ? { username: target.username } : null });
});


app.listen(PORT, () => {
  console.log(`ACM GroupWork server running at http://localhost:${PORT}`);
});

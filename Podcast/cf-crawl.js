// 批量采集 luogu 上的 CF 中文题面，存入 SQLite 数据库
// 用法: node cf-crawl.js [limit]  (limit 可选，测试用)
const Database = require('better-sqlite3');
const path = require('path');
const { execFileSync } = require('child_process');

const DB_PATH = path.join(__dirname, 'cf-trainer.db');
const DATA_PATH = path.join(__dirname, 'problem-set-data.json');
const LIMIT = process.argv[2] ? parseInt(process.argv[2]) : null;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS cf_problems (
    key TEXT PRIMARY KEY,
    contest_id INTEGER NOT NULL,
    index_code TEXT NOT NULL,
    title TEXT NOT NULL,
    rating INTEGER,
    tags TEXT,
    link TEXT,
    statement_zh TEXT,        -- 中文题面（Markdown，描述+输入+输出+说明）
    samples TEXT,             -- JSON 数组 [[input, output], ...]
    source TEXT DEFAULT 'luogu',
    crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// 读取题目列表
const data = JSON.parse(require('fs').readFileSync(DATA_PATH, 'utf8'));
let problems = [];
for (const cat of data.categories) {
  for (const sub of cat.subs) {
    for (const p of sub.problems) {
      problems.push(p);
    }
  }
}
// 去重
const seen = new Set();
problems = problems.filter(p => {
  if (seen.has(p.key)) return false;
  seen.add(p.key);
  return true;
});
if (LIMIT) problems = problems.slice(0, LIMIT);
console.log('待采集题目:', problems.length);

// 已采集的
const done = new Set(db.prepare('SELECT key FROM cf_problems').all().map(r => r.key));
const todo = problems.filter(p => !done.has(p.key));
console.log('已采集:', done.size, '待采集:', todo.length);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchLuogu(key) {
  const pid = 'CF' + key; // luogu 的 CF 题号格式 CF1157E
  const url = `https://www.luogu.com.cn/problem/${pid}?_contentOnly=1`;
  // Node fetch 与 luogu TLS 不兼容，改用系统 curl（服务器上已验证可用）
  const html = execFileSync('curl', [
    '-sL', '--max-time', '25',
    '-A', UA,
    '-H', 'Referer: https://www.luogu.com.cn/',
    '-c', '/tmp/lg-cookie.txt', '-b', '/tmp/lg-cookie.txt',
    url
  ], { encoding: 'utf8', timeout: 30000 });
  return html;
}

// 解析 HTML -> { statementZh, samples }
function parseLuogu(html) {
  const stmt = { desc: '', input: '', output: '', hint: '' };
  // 按 section 解析
  const sections = [...html.matchAll(/<section>\s*<h2>(.*?)<\/h2>\s*<div>([\s\S]*?)<\/div>\s*<\/section>/g)];
  for (const m of sections) {
    const title = m[1].replace(/<[^>]+>/g, '').trim();
    let body = m[2]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (title.includes('题目描述')) stmt.desc = body;
    else if (title.includes('输入格式')) stmt.input = body;
    else if (title.includes('输出格式')) stmt.output = body;
    else if (title.includes('说明') || title.includes('提示')) stmt.hint = body;
  }
  // 提取样例（内嵌 JSON: "samples":[["in","out"],...]）
  let samples = [];
  const sm = html.match(/"samples"\s*:\s*(\[\[[\s\S]*?\]\])/);
  if (sm) {
    try {
      samples = JSON.parse(sm[1]);
    } catch (e) { /* ignore */ }
  }
  // 组装 Markdown 题面
  let md = '';
  if (stmt.desc) md += '## 题目描述\n\n' + stmt.desc + '\n\n';
  if (stmt.input) md += '## 输入格式\n\n' + stmt.input + '\n\n';
  if (stmt.output) md += '## 输出格式\n\n' + stmt.output + '\n\n';
  if (samples.length) {
    md += '## 样例\n\n';
    samples.forEach((s, i) => {
      md += '**样例 ' + (i + 1) + '**\n\n输入：\n```\n' + s[0].trim() + '\n```\n\n输出：\n```\n' + s[1].trim() + '\n```\n\n';
    });
  }
  if (stmt.hint) md += '## 说明/提示\n\n' + stmt.hint + '\n\n';
  return { statementZh: md, samples };
}

async function main() {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO cf_problems (key, contest_id, index_code, title, rating, tags, link, statement_zh, samples)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    try {
      const html = await fetchLuogu(p.key);
      const { statementZh, samples } = parseLuogu(html);
      if (!statementZh) throw new Error('题面解析为空');
      insert.run(p.key, p.contestId, p.index, p.name, p.rating || null,
        JSON.stringify(p.tags || []), p.link, statementZh, JSON.stringify(samples));
      ok++;
      console.log('[' + (i + 1) + '/' + todo.length + '] ' + p.key + ' ' + p.name + ' [OK] 题面 ' + statementZh.length + ' 字, 样例 ' + samples.length + ' 组');
    } catch (e) {
      fail++;
      console.log('[' + (i + 1) + '/' + todo.length + '] ' + p.key + ' ' + p.name + ' [FAIL] ' + e.message);
    }
    await sleep(800); // 限速，防被封
  }
  console.log('');
  console.log('完成: 成功 ' + ok + ', 失败 ' + fail + ', 数据库总计 ' + db.prepare('SELECT COUNT(*) c FROM cf_problems').get().c + ' 题');
}

main().catch(e => { console.error('致命错误:', e); process.exit(1); });

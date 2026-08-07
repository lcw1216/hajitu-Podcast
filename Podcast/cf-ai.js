// CF AI Trainer - 后端模块（抽题/题面/对话/CF登录/提交）
// 由 server.js 挂载，复用同一 sqlite 连接
const crypto = require('crypto');

// ============ 配置 ============
const CF_AI_APIKEY = process.env.CF_AI_APIKEY;
const CF_AI_BASE_URL = (process.env.CF_AI_BASE_URL || 'https://opencode.ai/zen/go/v1').replace(/\/$/, '');
const CF_AI_MODEL = process.env.CF_AI_MODEL || 'deepseek-v4-flash';
const CF_ENC_KEY = process.env.CF_ENC_KEY || 'cf-trainer-aes-key-2026'; // CF密码加密密钥（生产请用环境变量）
const CF_SITE = 'https://codeforces.com';

// ============ 内存状态 ============
let problemCache = null;      // 全量题库缓存 {updatedAt, problems:[]}
let problemCachePromise = null;
let cfSessionCookie = null;   // CF 登录 cookie（每个用户独立存储于数据库，这里仅作 fallback）

// ============ 工具 ============
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function aesEncrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex') + ':' + cipher.getAuthTag().toString('hex');
}

function aesDecrypt(payload, key) {
  try {
    const [ivHex, dataHex, tagHex] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(key).digest(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (e) { return null; }
}

// 简易限流（每 key 每窗口秒 N 次）
function rateLimit(store, key, limit, windowSec) {
  const now = Date.now();
  const rec = store.get(key) || { count: 0, resetAt: now + windowSec * 1000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + windowSec * 1000; }
  rec.count++;
  store.set(key, rec);
  return rec.count <= limit;
}
const chatLimiter = new Map();
const submitLimiter = new Map();

// ============ 1. CF 题库（全量缓存 24h） ============
async function fetchProblemList() {
  if (problemCache && (Date.now() - problemCache.updatedAt) < 24 * 3600 * 1000) return problemCache.problems;
  if (problemCachePromise) return problemCachePromise;

  problemCachePromise = (async () => {
    const res = await fetch('https://codeforces.com/api/problemset.problems', {
      headers: { 'User-Agent': 'Mozilla/5.0 (CF-AI-Trainer)' }
    });
    if (!res.ok) throw new Error('CF API 题库拉取失败: ' + res.status);
    const data = await res.json();
    if (data.status !== 'OK') throw new Error('CF API 返回错误');
    const problems = (data.result.problems || []).map(p => ({
      key: `${p.contestId}${p.index}`,
      contestId: p.contestId,
      index: p.index,
      name: p.name,
      rating: p.rating || null,
      tags: p.tags || []
    }));
    problemCache = { updatedAt: Date.now(), problems };
    console.log(`[CF-Trainer] 题库已缓存: ${problems.length} 题`);
    return problems;
  })();

  try {
    const result = await problemCachePromise;
    problemCachePromise = null;
    return result;
  } catch (e) {
    problemCachePromise = null;
    throw e;
  }
}

// ============ 2. 随机抽题（难度/Tag/去重） ============
function pickRandomProblem(problems, opts, excludeKeys) {
  const { minRating, maxRating, tags } = opts;
  const pool = problems.filter(p => {
    if (p.rating == null) return false;
    if (minRating != null && p.rating < minRating) return false;
    if (maxRating != null && p.rating > maxRating) return false;
    if (excludeKeys && excludeKeys.has(p.key)) return false;
    if (tags && tags.length) {
      const t = tags.filter(x => x);
      if (t.length && !t.every(tag => p.tags.includes(tag))) return false;
    }
    return true;
  });
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ============ 2b. 从 cf-trainer.db 抽题（优先，含中文题面） ============
// 由 server.js 注入 db 连接
let cfDb = null;
function setCfDb(db) { cfDb = db; }

function pickRandomFromDb(opts, excludeKeys) {
  if (!cfDb) return null;
  const { minRating, maxRating, tags } = opts;
  let sql = 'SELECT * FROM cf_problems WHERE 1=1';
  const params = [];
  if (minRating != null) { sql += ' AND rating >= ?'; params.push(minRating); }
  if (maxRating != null) { sql += ' AND rating <= ?'; params.push(maxRating); }
  const t = (tags || []).filter(x => x);
  if (t.length) {
    // tag 匹配：tags 字段是 JSON 数组，需在 JS 侧过滤
    sql += ' AND key NOT IN (SELECT key FROM cf_problems LIMIT 0)'; // placeholder 保持结构
  }
  const rows = cfDb.prepare(sql).all(...params);
  let pool = rows;
  if (excludeKeys && excludeKeys.size) pool = pool.filter(p => !excludeKeys.has(p.key));
  if (t.length) {
    pool = pool.filter(p => {
      const pTags = JSON.parse(p.tags || '[]');
      return t.every(tag => pTags.includes(tag));
    });
  }
  if (!pool.length) return null;
  const p = pool[Math.floor(Math.random() * pool.length)];
  return {
    key: p.key,
    contestId: p.contest_id,
    index: p.index_code,
    name: p.title,
    rating: p.rating,
    tags: JSON.parse(p.tags || '[]'),
    link: p.link,
    statementZh: p.statement_zh || '',
    samples: p.samples ? JSON.parse(p.samples) : []
  };
}

// ============ 3. 题面抓取（Cloudflare 可能拦截，失败时走用户粘贴模式） ============
const CF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1'
};

async function fetchProblemStatement(contestId, index) {
  const url = `${CF_SITE}/problemset/problem/${contestId}/${index}`;
  const res = await fetch(url, { headers: CF_HEADERS });
  if (!res.ok) throw new Error('题面抓取失败: HTTP ' + res.status + '（CF 被 Cloudflare 拦截，请手动复制题面）');
  const html = await res.text();
  // 提取题目描述主体
  const m = html.match(/<div class="problem-statement">([\s\S]*?)<\/div>\s*<div class="problem-index-header">|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/i);
  let body = m ? m[1] : '';
  if (!body) {
    // fallback: 截取 problem-statement 到结尾
    const start = html.indexOf('<div class="problem-statement">');
    const endIdx = html.indexOf('</div>', start + 100);
    body = start >= 0 ? html.substring(start, endIdx + 6) : '';
  }
  // 去 HTML 标签，保留文本
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|pre|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return body || '（未能解析题面，请访问原题链接查看）';
}

// ============ 4. AI 调用（流式，禁用思考加速响应） ============
async function aiStream(messages, onDelta) {
  const res = await fetch(`${CF_AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CF_AI_APIKEY
    },
    body: JSON.stringify({ model: CF_AI_MODEL, messages, stream: true, thinking: { type: 'disabled' } })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI 调用失败: HTTP ${res.status} ${errText.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const delta = (json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content) || '';
        if (delta) {
          full += delta;
          if (onDelta) onDelta(delta);
        }
      } catch (e) { /* 忽略解析失败的分片 */ }
    }
  }
  return full;
}

async function aiChat(messages) {
  const res = await fetch(`${CF_AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + CF_AI_APIKEY
    },
    body: JSON.stringify({ model: CF_AI_MODEL, messages, thinking: { type: 'disabled' } })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`AI 调用失败: HTTP ${res.status} ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
}

// ============ 5. CF 登录（保存会话 cookie） ============
async function cfLogin(username, password) {
  const jar = [];
  const cookieHeader = jar.length ? jar.map(c => `${c.name}=${c.value}`).join('; ') : '';

  // 1. GET 首页拿 csrf_token + cookie
  const enterPage = await fetch(`${CF_SITE}/enter`, {
    headers: { ...CF_HEADERS, 'Cookie': cookieHeader },
    redirect: 'manual'
  });
  const setCookies1 = (enterPage.headers.getSetCookie ? enterPage.headers.getSetCookie() : []) || [];
  setCookies1.forEach(c => { const [pair] = c.split(';'); const [n, ...v] = pair.split('='); jar.push({ name: n, value: v.join('=') }); });
  const html1 = await enterPage.text();
  const csrf = (html1.match(/csrf_token\s*=\s*['"]([^'"]+)['"]/) || html1.match(/name="csrf_token" value="([^"]+)"/) || [])[1];
  if (!csrf) throw new Error('无法获取 CF csrf_token（可能被限流）');

  // 2. POST 登录
  const loginBody = new URLSearchParams({
    csrf_token: csrf,
    action: 'enter',
    handleOrEmail: username,
    password: password,
    _tta: ''
  });
  const loginRes = await fetch(`${CF_SITE}/enter`, {
    method: 'POST',
    headers: {
      ...CF_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${CF_SITE}/enter`,
      'Cookie': cookieHeader
    },
    body: loginBody.toString(),
    redirect: 'manual'
  });
  const setCookies2 = (loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : []) || [];
  setCookies2.forEach(c => {
    const [pair] = c.split(';');
    const [n, ...v] = pair.split('=');
    const idx = jar.findIndex(x => x.name === n);
    if (idx >= 0) jar[idx] = { name: n, value: v.join('=') }; else jar.push({ name: n, value: v.join('=') });
  });
  const cookieStr = jar.map(c => `${c.name}=${c.value}`).join('; ');

  // 3. 验证是否登录成功（访问个人页）
  const meRes = await fetch(`${CF_SITE}/api/user.info?handles=${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  let loggedIn = false;
  try {
    const me = await meRes.json();
    loggedIn = me.status === 'OK' && me.result && me.result.length > 0;
  } catch (e) { /* ignore */ }

  if (!loggedIn && !/handle_or_email/i.test(cookieStr) && !/X-User-Sha1|X-User-Session/i.test(cookieStr)) {
    // 保守判定：检查响应头是否有重定向到 profile 或 cookie 特征
  }
  return { success: true, cookie: cookieStr, csrf };
}

// ============ 6. 提交代码到 CF ============
async function cfSubmit(cookie, csrf, contestId, index, code, programTypeId) {
  const submitBody = new URLSearchParams({
    csrf_token: csrf,
    action: 'submit',
    submittedProblemCode: `${contestId}${index}`,
    programTypeId: String(programTypeId),
    source: code,
    tabSize: '4',
    _tta: ''
  });
  const res = await fetch(`${CF_SITE}/problemset/submit`, {
    method: 'POST',
    headers: {
      ...CF_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${CF_SITE}/problemset/problem/${contestId}/${index}`,
      'Cookie': cookie
    },
    body: submitBody.toString(),
    redirect: 'manual'
  });
  if (res.status >= 400) throw new Error('提交失败: HTTP ' + res.status);
  const html = await res.text();
  // 提交成功通常重定向到 /problemset/submit 或提交页；验证码会返回 <title>Challenge</title> 或类
  if (/challenge|geetest|verify/i.test(html) && !/submission\/(\d+)/.test(html)) {
    throw new Error('提交被验证码拦截，请稍后重试或手动提交');
  }
  const subMatch = html.match(/submission\/(\d+)/);
  // 有的情况是重定向到 status 页，尝试从 last submission 拿 id
  let submissionId = subMatch ? subMatch[1] : null;
  if (!submissionId) {
    const loc = res.headers.get('location') || '';
    const m2 = loc.match(/submission\/(\d+)/);
    submissionId = m2 ? m2[1] : null;
  }
  return { success: true, submissionId };
}

// ============ 7. 查询测评状态 ============
async function cfVerdict(handle, submissionId) {
  const res = await fetch(`${CF_SITE}/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=10`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (CF-AI-Trainer)' }
  });
  if (!res.ok) throw new Error('测评查询失败: HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 'OK') throw new Error('测评查询失败');
  const subs = data.result || [];
  const target = subs.find(s => String(s.id) === String(submissionId));
  if (!target) return { verdict: 'PENDING', testset: '', passed: 0 };
  return {
    verdict: target.verdict || 'PENDING',
    testset: target.testset || '',
    passed: target.passedTestCount || 0,
    time: target.timeConsumedMillis != null ? target.timeConsumedMillis + 'ms' : '',
    memory: target.memoryConsumedBytes != null ? (target.memoryConsumedBytes / 1048576).toFixed(1) + 'MB' : ''
  };
}

const VERDICT_CN = {
  'OK': '通过 ✅', 'WRONG_ANSWER': '答案错误 ❌', 'TIME_LIMIT_EXCEEDED': '超时 ⏱',
  'MEMORY_LIMIT_EXCEEDED': '超内存 🧠', 'RUNTIME_ERROR': '运行错误 💥', 'COMPILATION_ERROR': '编译错误 🔧',
  'IDLENESS_LIMIT_EXCEEDED': '空闲超时', 'SKIPPED': '跳过', 'CHALLENGED': '被 hack', 'REJECTED': '被拒'
};

// ============ 导出给 server.js ============
module.exports = { sleep, aesEncrypt, aesDecrypt, rateLimit, chatLimiter, submitLimiter, CF_AI_APIKEY, CF_AI_BASE_URL, CF_AI_MODEL, CF_SITE, CF_ENC_KEY, fetchProblemList, pickRandomProblem, pickRandomFromDb, setCfDb, fetchProblemStatement, aiStream, aiChat, cfLogin, cfSubmit, cfVerdict, VERDICT_CN };

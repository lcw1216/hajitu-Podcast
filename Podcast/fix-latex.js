// 批量修复 cf-trainer.db 题面中的 LaTeX 命令为可读 Unicode
// 幂等：可重复运行
const D = require('better-sqlite3');
const db = new D('./cf-trainer.db');

// 替换规则（注意顺序：长的先替换，避免 \le 先匹配 \leq 的部分）
function fixLatex(s) {
  if (!s) return s;
  let out = s;
  // 分数 \frac{a}{b} → (a)/(b)
  out = out.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)');
  // 带参数的命令
  out = out.replace(/\\pmod\{([^}]*)\}/g, ' (mod $1)');
  out = out.replace(/\\operatorname\{([^}]*)\}/g, '$1');
  out = out.replace(/\\text\{([^}]*)\}/g, '$1');
  out = out.replace(/\\mathrm\{([^}]*)\}/g, '$1');
  out = out.replace(/\\mathbf\{([^}]*)\}/g, '$1');
  out = out.replace(/\\mathit\{([^}]*)\}/g, '$1');
  // 常用符号
  const sym = [
    [/\\leq/g, '≤'], [/\\geq/g, '≥'],
    [/\\le\b/g, '≤'], [/\\ge\b/g, '≥'],
    [/\\neq/g, '≠'], [/\\approx/g, '≈'], [/\\pm/g, '±'],
    [/\\times/g, '×'], [/\\cdot/g, '·'],
    [/\\dots/g, '…'], [/\\ldots/g, '…'], [/\\cdots/g, '…'],
    [/\\infty/g, '∞'], [/\\in\b/g, '∈'], [/\\notin/g, '∉'],
    [/\\mid\b/g, '|'], [/\\cup/g, '∪'], [/\\cap/g, '∩'],
    [/\\oplus/g, '⊕'], [/\\otimes/g, '⊗'],
    [/\\lfloor/g, '⌊'], [/\\rfloor/g, '⌋'],
    [/\\lceil/g, '⌈'], [/\\rceil/g, '⌉'],
    [/\\to\b/g, '→'], [/\\rightarrow/g, '→'], [/\\leftarrow/g, '←'],
    [/\\leftrightarrow/g, '↔'], [/\\Rightarrow/g, '⇒'], [/\\Leftrightarrow/g, '⇔'],
    [/\\sum\b/g, '∑'], [/\\prod\b/g, '∏'], [/\\sqrt/g, '√'],
    [/\\bmod\b/g, ' mod '], [/\\mod\b/g, ' mod '],
    [/\\land\b/g, '∧'], [/\\lor\b/g, '∨'], [/\\neg\b/g, '¬'],
    [/\\forall/g, '∀'], [/\\exists/g, '∃'],
    [/\\%\\?/g, '%'], [/\\%/g, '%'],
    [/\\_/g, '_'],
    [/\\\(/g, '('], [/\\\)/g, ')'], [/\\\[/g, '['], [/\\\]/g, ']'],
    [/\\\{/g, '{'], [/\\\}/g, '}'], [/\\\$/g, '$']
  ];
  for (const [re, rep] of sym) out = out.replace(re, rep);
  // 残留的 \x 命令（未知命令）去掉反斜杠保留字母
  out = out.replace(/\\([a-zA-Z]+)/g, '$1');
  // 清理多余空格（连字符前后、多个空格）
  out = out.replace(/[ \t]{2,}/g, ' ');
  return out;
}

// 统计
let changed = 0;
const rows = db.prepare('SELECT key, statement_zh FROM cf_problems').all();
const update = db.prepare('UPDATE cf_problems SET statement_zh = ? WHERE key = ?');
for (const r of rows) {
  const fixed = fixLatex(r.statement_zh);
  if (fixed !== r.statement_zh) {
    update.run(fixed, r.key);
    changed++;
  }
}
console.log('修复题数:', changed, '/', rows.length);

// 验证残留
const after = db.prepare("SELECT COUNT(*) c FROM cf_problems WHERE statement_zh LIKE '%\\\\%'").get();
console.log('仍含反斜杠的题数:', after.c);
const sample = db.prepare("SELECT key, substr(statement_zh,1,200) s FROM cf_problems WHERE key = '1856C'").get();
console.log('示例 1856C 修复后:', sample ? sample.s : '(无)');

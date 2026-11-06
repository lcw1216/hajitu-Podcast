(function() {
  var PROBLEMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'];
  var POLL_INTERVAL = 12000;
  var activityTimer = null;
  var isRegisterMode = false;
  var currentUser = null;
  var viewingUser = null;
  var pendingDeleteInfo = null;
  var lastLoadedCode = '';
  var codeCtx = null;
  var versionCtx = null;
  var previewVersionId = null;
  var previewCode = '';
  var currentContestId = null;
  var currentScoreboard = null;
  var lastSubmittedSet = {};
  var lastScoreboardKey = '';
  var scoreTimer = null;
  var timerRemainingSeconds = 0;

  var CPP_KEYWORDS = {};
  ('alignas alignof asm auto bool break case catch char class const constexpr const_cast continue '
    + 'decltype default delete do double dynamic_cast else enum explicit export extern false float for '
    + 'friend goto if inline int long mutable namespace new noexcept nullptr operator private protected '
    + 'public register reinterpret_cast return short signed sizeof static static_assert static_cast struct '
    + 'switch template this throw true try typedef typeid typename union unsigned using virtual void '
    + 'volatile wchar_t while override final').split(' ').forEach(function(w) { CPP_KEYWORDS[w] = true; });

  var CPP_TYPES = {};
  ('std string vector map set unordered_map unordered_set queue stack deque list pair tuple array cout cin '
    + 'cerr endl printf scanf puts getline sort max min swap push_back pop_back push front back size empty '
    + 'begin end iterator int64_t uint64_t size_t').split(' ').forEach(function(w) { CPP_TYPES[w] = true; });

  var CPP_TOKEN_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\n?[ \t]*#[^\n]*|\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[uUlLfF]*\b|\b[A-Za-z_]\w*\b|\s+|[^\s]/g;

  function $(id) { return document.getElementById(id); }

  function showView(name) {
    var views = document.querySelectorAll('.acm-view');
    for (var i = 0; i < views.length; i++) {
      views[i].style.display = 'none';
    }
    var target = $('view-' + name);
    if (target) target.style.display = '';
  }

  function getHash() {
    var h = window.location.hash.replace('#', '') || '';
    return h.split('/');
  }

  function setHash(hash) {
    window.location.hash = hash;
  }

  function api(path, options) {
    var opts = options || {};
    var method = opts.method || 'GET';
    var body = opts.body || null;

    var fetchOpts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };

    if (body) {
      fetchOpts.body = JSON.stringify(body);
    }

    return fetch(path, fetchOpts).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) {
          throw new Error(data.error || '请求失败');
        }
        return data;
      });
    });
  }

  function ensureUser() {
    if (currentUser) return Promise.resolve(currentUser);
    return api('/api/me').then(function(data) {
      currentUser = data.user;
      return currentUser;
    });
  }

  function timeAgo(dateStr) {
    var now = new Date();
    var date = new Date(dateStr + 'Z');
    if (isNaN(date.getTime())) date = new Date(dateStr);
    var diff = Math.floor((now - date) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + '天前';
    return date.toLocaleDateString('zh-CN');
  }

  function stopPolling() {
    if (activityTimer) {
      clearInterval(activityTimer);
      activityTimer = null;
    }
    stopScoreTimer();
  }

  function stopScoreTimer() {
    if (scoreTimer) {
      clearInterval(scoreTimer);
      scoreTimer = null;
    }
  }

  // ==================== 轻提示 ====================
  function showToast(message, type) {
    var container = $('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'acm-toast' + (type ? ' acm-toast-' + type : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() { toast.classList.add('show'); }, 20);
    setTimeout(function() {
      toast.classList.remove('show');
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, 2600);
  }

  // ==================== C++ 语法高亮 ====================
  function highlightCpp(code) {
    if (!code) return '';
    CPP_TOKEN_RE.lastIndex = 0;
    var html = '';
    var match;
    while ((match = CPP_TOKEN_RE.exec(code)) !== null) {
      var token = match[0];
      var cls = '';
      var first = token.charAt(0);

      if (token.indexOf('//') === 0 || token.indexOf('/*') === 0) {
        cls = 'com';
      } else if (first === '"' || first === "'") {
        cls = 'str';
      } else if (/^\n?[ \t]*#/.test(token)) {
        cls = 'pre';
      } else if (/^(?:0[xX][0-9a-fA-F]+|\d)/.test(token)) {
        cls = 'num';
      } else if (/^[A-Za-z_]/.test(token)) {
        if (CPP_KEYWORDS[token]) {
          cls = 'kw';
        } else if (code.charAt(CPP_TOKEN_RE.lastIndex) === '(') {
          cls = 'fn';
        } else if (CPP_TYPES[token]) {
          cls = 'type';
        } else if (/^[A-Z]/.test(token)) {
          cls = 'type';
        }
      }

      html += cls
        ? '<span class="tok-' + cls + '">' + escapeHtml(token) + '</span>'
        : escapeHtml(token);
    }
    return html;
  }

  function updateCodeHighlight() {
    var highlight = $('code-highlight');
    var editor = $('code-editor');
    if (!highlight || !editor) return;
    highlight.innerHTML = highlightCpp(editor.value) + '\n';
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  }

  function syncCodeScroll() {
    var highlight = $('code-highlight');
    var editor = $('code-editor');
    if (!highlight || !editor) return;
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
  }

  function getDisplayedCode() {
    if (previewVersionId !== null) return previewCode;
    var editorMode = $('code-editor-wrap').style.display !== 'none';
    return editorMode ? $('code-editor').value : lastLoadedCode;
  }

  function copyCode() {
    var text = getDisplayedCode();

    if (!text) {
      showToast('没有可复制的代码', 'error');
      return;
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function() {
        showToast('代码已复制', 'success');
      }).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }

    function fallbackCopy() {
      var temp = document.createElement('textarea');
      temp.value = text;
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(temp);
      showToast(ok ? '代码已复制' : '复制失败，请手动选择复制', ok ? 'success' : 'error');
    }
  }

  // ==================== 全屏查看代码 ====================
  function openFullscreenCode() {
    var text = getDisplayedCode();
    if (!text) {
      showToast('没有可查看的代码', 'error');
      return;
    }

    var title = $('problem-title').textContent || '代码';
    var branch = $('branch-select').value;
    if (previewVersionId !== null) {
      var sel = $('version-select');
      title += ' · ' + sel.options[sel.selectedIndex].textContent;
    }
    $('fullscreen-title').textContent = branch ? title + ' · ' + branch : title;
    $('fullscreen-code').innerHTML = highlightCpp(text);
    $('code-fullscreen').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeFullscreenCode() {
    $('code-fullscreen').style.display = 'none';
    $('fullscreen-code').innerHTML = '';
    document.body.style.overflow = '';
  }

  // ==================== 初始化 ====================
  function init() {
    ensureUser().then(function(user) {
      if (user) {
        handleHashChange();
      } else {
        showView('login');
        setHash('login');
      }
    }).catch(function() {
      currentUser = null;
      showView('login');
      setHash('login');
    });

    window.addEventListener('hashchange', handleHashChange);
    bindEvents();
  }

  function handleHashChange() {
    stopPolling();
    var parts = getHash();

    ensureUser().then(function(user) {
      currentUser = user;
      if (!user) {
        showView('login');
        return;
      }

      if (parts[0] === 'contest' && parts[1] && parts[2] === 'problem' && parts[3]) {
        showContestProblem(parts[1], parts[3]);
      } else if (parts[0] === 'contest' && parts[1]) {
        showContestDetail(parts[1]);
      } else {
        showLobby();
      }
    }).catch(function() {
      currentUser = null;
      showView('login');
    });
  }

  // ==================== 事件绑定 ====================
  function bindEvents() {
    $('auth-submit-btn').addEventListener('click', handleAuth);
    $('auth-password').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') handleAuth();
    });
    $('auth-switch-link').addEventListener('click', toggleAuthMode);
    $('btn-logout').addEventListener('click', handleLogout);
    $('btn-create-contest').addEventListener('click', showCreateContestModal);
    $('btn-confirm-create').addEventListener('click', createContest);
    $('btn-cancel-create').addEventListener('click', hideCreateContestModal);
    $('btn-back-lobby').addEventListener('click', function() { setHash('lobby'); });
    $('btn-back-lobby-from-problem').addEventListener('click', function() { setHash('lobby'); });
    $('btn-back-contest').addEventListener('click', function() {
      var parts = getHash();
      if (parts[1]) setHash('contest/' + parts[1]);
    });
    $('btn-submit-code').addEventListener('click', submitCode);
    $('btn-delete-code').addEventListener('click', function() {
      showDeleteConfirm('code');
    });
    $('btn-confirm-delete').addEventListener('click', confirmDelete);
    $('btn-cancel-delete').addEventListener('click', hideDeleteConfirm);
    $('btn-rename-version').addEventListener('click', openRenameVersion);
    $('btn-confirm-rename').addEventListener('click', confirmRenameVersion);
    $('btn-cancel-rename').addEventListener('click', closeRenameVersion);
    $('btn-delete-version').addEventListener('click', function() {
      showDeleteConfirm('version');
    });
    $('rename-version-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') confirmRenameVersion();
    });
    $('branch-select').addEventListener('change', onBranchChange);
    $('contest-branch-select').addEventListener('change', onContestBranchChange);
    $('btn-copy-code').addEventListener('click', copyCode);
    $('btn-fullscreen-code').addEventListener('click', openFullscreenCode);
    $('btn-close-fullscreen').addEventListener('click', closeFullscreenCode);
    $('version-select').addEventListener('change', onVersionChange);
    $('code-fullscreen').addEventListener('click', function(e) {
      if (e.target === this) closeFullscreenCode();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && $('code-fullscreen').style.display !== 'none') {
        closeFullscreenCode();
      }
    });
    $('code-editor').addEventListener('input', updateCodeHighlight);
    $('code-editor').addEventListener('input', updateSubmitState);
    $('code-editor').addEventListener('scroll', syncCodeScroll);

    $('create-contest-modal').addEventListener('click', function(e) {
      if (e.target === this) hideCreateContestModal();
    });
    $('delete-confirm-modal').addEventListener('click', function(e) {
      if (e.target === this) hideDeleteConfirm();
    });
    $('rename-version-modal').addEventListener('click', function(e) {
      if (e.target === this) closeRenameVersion();
    });
    $('btn-add-record').addEventListener('click', openAddRecordModal);
    $('btn-start-contest').addEventListener('click', startContest);
    $('btn-confirm-record').addEventListener('click', addRecord);
    $('btn-cancel-record').addEventListener('click', closeAddRecordModal);
    $('add-record-modal').addEventListener('click', function(e) {
      if (e.target === this) closeAddRecordModal();
    });
  }

  // ==================== 登录 / 注册 ====================
  function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
      $('auth-title').textContent = '注册';
      $('auth-submit-btn').textContent = '注册';
      $('auth-switch-text').textContent = '已有账号？';
      $('auth-switch-link').textContent = '登录';
    } else {
      $('auth-title').textContent = '登录';
      $('auth-submit-btn').textContent = '登录';
      $('auth-switch-text').textContent = '没有账号？';
      $('auth-switch-link').textContent = '注册';
    }
    $('auth-error').textContent = '';
    $('auth-error').style.display = 'none';
  }

  function handleAuth() {
    var username = $('auth-username').value.trim();
    var password = $('auth-password').value;

    if (!username || !password) {
      showAuthError('用户名和密码不能为空');
      return;
    }

    var url = isRegisterMode ? '/api/register' : '/api/login';
    api(url, { method: 'POST', body: { username: username, password: password } })
      .then(function(data) {
        if (data.success) {
          currentUser = data.user;
          $('auth-username').value = '';
          $('auth-password').value = '';
          $('auth-error').style.display = 'none';
          setHash('lobby');
        }
      })
      .catch(function(err) {
        showAuthError(err.message);
      });
  }

  function showAuthError(msg) {
    $('auth-error').textContent = msg;
    $('auth-error').style.display = 'block';
  }

  function handleLogout() {
    api('/api/logout', { method: 'POST' }).then(function() {
      currentUser = null;
      stopPolling();
      showView('login');
      setHash('login');
    });
  }

  // ==================== 比赛大厅 ====================
  function showLobby() {
    showView('lobby');
    stopPolling();
    $('lobby-username').textContent = currentUser ? currentUser.username : '';

    api('/api/contests').then(function(data) {
      renderContestList(data.contests);
    });
  }

  function renderContestList(contests) {
    var container = $('contest-list');
    if (!contests || contests.length === 0) {
      container.innerHTML = '<div class="acm-empty">暂无比赛，点击上方按钮创建一个吧</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < contests.length; i++) {
      var c = contests[i];
      html += '<div class="acm-contest-card" data-id="' + c.id + '">';
      html += '<div class="acm-contest-card-left">';
      html += '<div class="acm-contest-card-name">' + escapeHtml(c.name) + '</div>';
      html += '<div class="acm-contest-card-meta">';
      html += '创建者：' + escapeHtml(c.creator_name) + ' · ';
      html += timeAgo(c.created_at);
      html += '</div>';
      html += '</div>';
      html += '<div class="acm-contest-card-right">';
      html += '<button class="acm-btn acm-btn-danger acm-btn-xs btn-delete-contest" data-id="' + c.id + '" data-name="' + escapeHtml(c.name) + '">删除</button>';
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;

    var cards = container.querySelectorAll('.acm-contest-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function(e) {
        if (e.target.classList.contains('btn-delete-contest')) return;
        setHash('contest/' + this.getAttribute('data-id'));
      });
    }

    var delBtns = container.querySelectorAll('.btn-delete-contest');
    for (var k = 0; k < delBtns.length; k++) {
      delBtns[k].addEventListener('click', function(e) {
        e.stopPropagation();
        var id = this.getAttribute('data-id');
        var name = this.getAttribute('data-name');
        if (confirm('确定要删除比赛 "' + name + '" 吗？\n该比赛下的所有提交和动态记录将被永久删除，此操作不可撤销。')) {
          api('/api/contests/' + id, { method: 'DELETE' }).then(function() {
            showLobby();
          }).catch(function(err) {
            showToast('删除失败：' + err.message, 'error');
          });
        }
      });
    }
  }

  function showCreateContestModal() {
    $('new-contest-name').value = '';
    $('modal-error').style.display = 'none';
    $('create-contest-modal').style.display = '';
    setTimeout(function() { $('new-contest-name').focus(); }, 100);
  }

  function hideCreateContestModal() {
    $('create-contest-modal').style.display = 'none';
  }

  function createContest() {
    var name = $('new-contest-name').value.trim();
    if (!name) {
      $('modal-error').textContent = '比赛名不能为空';
      $('modal-error').style.display = 'block';
      return;
    }

    api('/api/contests', { method: 'POST', body: { name: name } })
      .then(function(data) {
        if (data.success) {
          hideCreateContestModal();
          setHash('contest/' + data.contest.id);
        }
      })
      .catch(function(err) {
        $('modal-error').textContent = err.message;
        $('modal-error').style.display = 'block';
      });
  }

  // ==================== 比赛主页 ====================
  function showContestDetail(contestId) {
    showView('contest');
    stopPolling();
    currentContestId = String(contestId);
    currentScoreboard = null;
    lastSubmittedSet = {};
    lastScoreboardKey = '';
    $('contest-username').textContent = currentUser ? currentUser.username : '';

    api('/api/contests/' + contestId).then(function(data) {
      $('contest-title').textContent = data.contest.name;
    });

    api('/api/users').then(function(usersData) {
      var users = usersData.users || [];
      var select = $('contest-branch-select');
      select.innerHTML = '';

      var selectedValue = viewingUser || (currentUser ? currentUser.username : null);

      for (var i = 0; i < users.length; i++) {
        var opt = document.createElement('option');
        opt.value = users[i].username;
        opt.textContent = users[i].username;
        if (users[i].username === selectedValue) opt.selected = true;
        select.appendChild(opt);
      }

      if (!viewingUser && currentUser) {
        viewingUser = currentUser.username;
      }

      loadContestData(contestId);
    });

    activityTimer = setInterval(function() {
      loadActivities(contestId);
      loadScoreboard(contestId);
    }, POLL_INTERVAL);
  }

  function onContestBranchChange() {
    viewingUser = $('contest-branch-select').value;
    var parts = getHash();
    if (parts[1]) loadContestData(parts[1]);
  }

  function loadContestData(contestId) {
    loadProblems(contestId);
    loadScoreboard(contestId);
    loadActivities(contestId);
  }

  function loadProblems(contestId) {
    api('/api/contests/' + contestId + '/submissions').then(function(data) {
      var submissions = data.submissions || [];
      var submittedSet = {};
      for (var i = 0; i < submissions.length; i++) {
        var s = submissions[i];
        if (viewingUser && s.username === viewingUser && s.code) {
          submittedSet[s.problem] = true;
        }
      }
      if (currentContestId !== String(contestId)) return;
      lastSubmittedSet = submittedSet;
      renderProblemGrid(contestId, submittedSet, currentScoreboard);
    });
  }

  function renderProblemGrid(contestId, submittedSet, scoreboard) {
    var statusMap = {};
    if (scoreboard && scoreboard.problems) {
      for (var i = 0; i < scoreboard.problems.length; i++) {
        statusMap[scoreboard.problems[i].problem] = scoreboard.problems[i];
      }
    }

    var grid = $('problem-grid');
    var html = '';
    for (var j = 0; j < PROBLEMS.length; j++) {
      var p = PROBLEMS[j];
      var info = statusMap[p];
      var cardClass = '';
      var statusClass = '';
      var statusText = '未提交';

      if (info && info.solved) {
        cardClass = ' ac';
        statusClass = ' status-ac';
        statusText = 'AC';
      } else if (info && info.status) {
        cardClass = ' attempted';
        statusClass = ' status-' + info.status.toLowerCase();
        statusText = info.status + (info.attempts > 1 ? ' ×' + info.attempts : '');
      }

      html += '<div class="acm-problem-card' + cardClass + '" data-contest="' + contestId + '" data-problem="' + p + '">';
      html += '<span class="acm-problem-letter">' + p + '</span>';
      html += '<span class="acm-problem-status' + statusClass + '">' + statusText + '</span>';
      if (info && info.penalty > 0) {
        html += '<span class="acm-problem-penalty">罚时 ' + info.penalty + '</span>';
      }
      if (submittedSet[p]) {
        html += '<span class="acm-problem-code">代码已上传</span>';
      }
      html += '</div>';
    }
    grid.innerHTML = html;

    var cards = grid.querySelectorAll('.acm-problem-card');
    for (var k = 0; k < cards.length; k++) {
      cards[k].addEventListener('click', function() {
        var cid = this.getAttribute('data-contest');
        var prob = this.getAttribute('data-problem');
        setHash('contest/' + cid + '/problem/' + prob);
      });
    }
  }

  // ==================== 记分板与提交记录 ====================
  function parseRecordTime(str) {
    if (!str) return null;
    if (/Z$|[+-]\d{2}:\d{2}$/.test(str)) return new Date(str);
    return new Date(str.replace(' ', 'T') + 'Z');
  }

  function formatRecordTime(str) {
    var date = parseRecordTime(str);
    if (!date || isNaN(date.getTime())) return str || '';
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' '
      + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function formatPenalty(minutes) {
    var total = Math.max(0, minutes || 0);
    if (total === 0) return '0 分钟';
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (h === 0) return m + ' 分钟';
    return h + ' 小时' + (m ? ' ' + m + ' 分' : '');
  }

  function loadScoreboard(contestId) {
    api('/api/contests/' + contestId + '/scoreboard').then(function(data) {
      if (currentContestId !== String(contestId)) return;
      currentScoreboard = data;

      // 计时秒数每次都变，不参与比对，避免每轮轮询重绘题卡
      var key = JSON.stringify({
        startAt: data.startAt,
        endsAt: data.endsAt,
        phase: data.phase,
        solvedCount: data.solvedCount,
        totalPenalty: data.totalPenalty,
        problems: data.problems,
        records: data.records
      });
      if (key === lastScoreboardKey) return;
      lastScoreboardKey = key;

      renderScoreboard(data);
      renderRecords(data.records);
      renderProblemGrid(contestId, lastSubmittedSet, data);
    }).catch(function() {});
  }

  function renderScoreboard(data) {
    $('score-solved').textContent = data.solvedCount + ' / ' + data.totalProblems;
    $('score-penalty').textContent = formatPenalty(data.totalPenalty);
    $('score-records').textContent = (data.records ? data.records.length : 0) + ' 条';
    renderScoreTimer(data);
  }

  function formatClock(seconds) {
    var total = Math.max(0, seconds || 0);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return pad(h) + ':' + pad(m) + ':' + pad(s);
  }

  function renderScoreTimer(data) {
    var startBtn = $('btn-start-contest');
    var addBtn = $('btn-add-record');
    var timerText = $('score-timer');
    var durationSeconds = (data.durationMinutes || 300) * 60;

    if (data.phase === 'not_started') {
      timerText.textContent = '未开始';
      startBtn.style.display = '';
      addBtn.disabled = true;
      addBtn.title = '请先开始比赛';
    } else if (data.phase === 'ended') {
      timerText.textContent = '已结束（' + (data.durationMinutes || 300) / 60 + ' 小时）';
      startBtn.style.display = 'none';
      addBtn.disabled = true;
      addBtn.title = '比赛已结束';
    } else {
      timerRemainingSeconds = data.remainingSeconds || 0;
      timerText.textContent = '剩余 ' + formatClock(timerRemainingSeconds)
        + ' / 已用 ' + formatClock(durationSeconds - timerRemainingSeconds);
      startBtn.style.display = 'none';
      addBtn.disabled = false;
      addBtn.title = '';
      stopScoreTimer();
      scoreTimer = setInterval(function() {
        if (timerRemainingSeconds > 0) {
          timerRemainingSeconds -= 1;
          timerText.textContent = '剩余 ' + formatClock(timerRemainingSeconds)
            + ' / 已用 ' + formatClock(durationSeconds - timerRemainingSeconds);
        }
        if (timerRemainingSeconds <= 0) {
          stopScoreTimer();
          timerText.textContent = '已结束（' + (data.durationMinutes || 300) / 60 + ' 小时）';
          addBtn.disabled = true;
          addBtn.title = '比赛已结束';
        }
      }, 1000);
    }

    if (data.phase !== 'running') {
      stopScoreTimer();
    }
  }

  function startContest() {
    if (!currentContestId) return;
    var contestId = currentContestId;

    api('/api/contests/' + contestId + '/start', { method: 'POST' })
      .then(function() {
        showToast('比赛已开始，计时 5 小时', 'success');
        lastScoreboardKey = '';
        loadScoreboard(contestId);
      })
      .catch(function(err) {
        showToast('开始失败：' + err.message, 'error');
      });
  }

  function renderRecords(records) {
    var container = $('record-list');
    if (!container) return;

    if (!records || records.length === 0) {
      container.innerHTML = '<div class="acm-empty">暂无提交记录</div>';
      return;
    }

    var html = '';
    // 服务端按时间升序返回，这里从新到旧展示
    for (var i = records.length - 1; i >= 0; i--) {
      var r = records[i];
      html += '<div class="acm-record-row">';
      html += '<span class="acm-record-time">' + formatRecordTime(r.created_at) + '</span>';
      html += '<span class="acm-record-problem">' + r.problem + '题</span>';
      html += '<span class="acm-status-badge status-' + r.status.toLowerCase() + '">' + r.status + '</span>';
      html += '<span class="acm-record-note' + (r.counted ? ' acm-record-note-counted' : '') + '">'
        + escapeHtml(r.note || '') + ' · ' + escapeHtml(r.creator_name) + '</span>';
      html += '<button class="acm-btn acm-btn-danger acm-btn-xs btn-delete-record" data-id="' + r.id + '">删除</button>';
      html += '</div>';
    }
    container.innerHTML = html;

    var btns = container.querySelectorAll('.btn-delete-record');
    for (var j = 0; j < btns.length; j++) {
      btns[j].addEventListener('click', function() {
        showDeleteConfirm('record', this.getAttribute('data-id'));
      });
    }
  }

  function openAddRecordModal() {
    var select = $('record-problem');
    if (select.options.length === 0) {
      for (var i = 0; i < PROBLEMS.length; i++) {
        var opt = document.createElement('option');
        opt.value = PROBLEMS[i];
        opt.textContent = PROBLEMS[i] + '题';
        select.appendChild(opt);
      }
    }
    select.value = PROBLEMS[0];
    $('record-status').value = 'AC';
    $('add-record-modal').style.display = '';
  }

  function closeAddRecordModal() {
    $('add-record-modal').style.display = 'none';
  }

  function addRecord() {
    if (!currentContestId) return;
    var contestId = currentContestId;
    var problem = $('record-problem').value;
    var status = $('record-status').value;

    api('/api/contests/' + contestId + '/records', {
      method: 'POST',
      body: { problem: problem, status: status }
    }).then(function() {
      closeAddRecordModal();
      showToast('记录已添加', 'success');
      lastScoreboardKey = '';
      loadScoreboard(contestId);
    }).catch(function(err) {
      closeAddRecordModal();
      showToast('添加失败：' + err.message, 'error');
    });
  }

  function loadActivities(contestId) {
    var container = $('activity-list');
    if (!container) return;

    api('/api/contests/' + contestId + '/activities?limit=30').then(function(data) {
      var activities = data.activities || [];
      if (activities.length === 0) {
        container.innerHTML = '<div class="acm-empty">暂无动态</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < activities.length; i++) {
        var a = activities[i];
        var actionText = a.action === 'delete' ? '删除了' : '更新了';
        html += '<div class="acm-activity-item" data-contest="' + a.contest_id + '" data-problem="' + a.problem + '" data-user="' + escapeHtml(a.username) + '">';
        html += '<span class="acm-activity-user">' + escapeHtml(a.username) + '</span>';
        html += ' <span class="acm-activity-action">' + actionText + '</span> ';
        html += '<span class="acm-activity-problem">' + a.problem + '题</span>';
        html += '<span class="acm-activity-time">' + timeAgo(a.created_at) + '</span>';
        html += '</div>';
      }
      container.innerHTML = html;

      var items = container.querySelectorAll('.acm-activity-item');
      for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', function() {
          var cid = this.getAttribute('data-contest');
          var prob = this.getAttribute('data-problem');
          var user = this.getAttribute('data-user');
          setHash('contest/' + cid + '/problem/' + prob + '?user=' + encodeURIComponent(user));
        });
      }
    }).catch(function() {});
  }

  // ==================== 题目页 ====================
  function showContestProblem(contestId, problemWithQuery) {
    showView('problem');
    stopPolling();

    var problem = problemWithQuery;
    var branchUser = null;
    var qIdx = problem.indexOf('?');
    if (qIdx >= 0) {
      var queryStr = problem.substring(qIdx + 1);
      problem = problem.substring(0, qIdx);
      var params = new URLSearchParams(queryStr);
      branchUser = params.get('user');
    }

    problem = problem.toUpperCase();
    if (PROBLEMS.indexOf(problem) < 0) {
      setHash('contest/' + contestId);
      return;
    }

    $('problem-username').textContent = currentUser ? currentUser.username : '';
    $('problem-title').textContent = 'Problem ' + problem;

    loadProblemData(contestId, problem, branchUser);
  }

  function loadProblemData(contestId, problem, branchUser) {
    api('/api/users').then(function(usersData) {
      var users = usersData.users || [];
      var select = $('branch-select');
      select.innerHTML = '';

      var selectedUser = branchUser || viewingUser || (currentUser ? currentUser.username : null);

      for (var i = 0; i < users.length; i++) {
        var opt = document.createElement('option');
        opt.value = users[i].username;
        opt.textContent = users[i].username;
        if (users[i].username === selectedUser) opt.selected = true;
        select.appendChild(opt);
      }

      if (!selectedUser) {
        for (var j = 0; j < select.options.length; j++) {
          if (select.options[j].value === (currentUser ? currentUser.username : '')) {
            select.selectedIndex = j;
            break;
          }
        }
      }

      loadCode(contestId, problem, select.value);
    });
  }

  function onBranchChange() {
    var parts = getHash();
    if (parts[0] !== 'contest' || !parts[1] || parts[2] !== 'problem' || !parts[3]) return;
    var contestId = parts[1];
    var problem = parts[3];
    var qIdx = problem.indexOf('?');
    if (qIdx >= 0) problem = problem.substring(0, qIdx);
    var branchUser = $('branch-select').value;

    loadCode(contestId, problem.toUpperCase(), branchUser);
  }

  function loadCode(contestId, problem, branchUser) {
    var isMe = currentUser && currentUser.username === branchUser;

    api('/api/contests/' + contestId + '/submissions?problem=' + problem).then(function(data) {
      var submissions = data.submissions || [];
      var found = null;
      for (var i = 0; i < submissions.length; i++) {
        if (submissions[i].username === branchUser) {
          found = submissions[i];
          break;
        }
      }

      lastLoadedCode = found && found.code ? found.code : '';
      codeCtx = { contestId: contestId, problem: problem, owner: branchUser, isMe: isMe };
      previewVersionId = null;
      previewCode = '';
      versionCtx = null;
      $('version-bar').style.display = 'none';
      $('version-select').innerHTML = '';

      $('code-empty').style.display = 'none';
      $('code-viewer').style.display = 'none';
      $('code-editor-wrap').style.display = 'none';
      $('code-actions').style.display = 'none';
      $('code-toolbar').style.display = 'none';

      renderCodeBase();

      if (lastLoadedCode && branchUser) {
        loadVersions(contestId, problem, branchUser);
      }
    }).catch(function() {});
  }

  function renderCodeBase() {
    var isMe = codeCtx && codeCtx.isMe;

    $('code-empty').style.display = 'none';
    $('code-viewer').style.display = 'none';
    $('code-editor-wrap').style.display = 'none';
    $('code-actions').style.display = 'none';
    $('code-toolbar').style.display = 'none';

    if (isMe) {
      $('code-editor-wrap').style.display = '';
      $('code-toolbar').style.display = '';
      $('code-actions').style.display = '';
      $('code-editor').value = lastLoadedCode;
      updateCodeHighlight();
      updateSubmitState();
    } else if (lastLoadedCode) {
      $('code-viewer').style.display = '';
      $('code-viewer').innerHTML = highlightCpp(lastLoadedCode);
      $('code-toolbar').style.display = '';
    } else {
      $('code-empty').style.display = '';
    }
  }

  function loadVersions(contestId, problem, owner) {
    api('/api/contests/' + contestId + '/submissions/' + problem + '/versions?owner='
      + encodeURIComponent(owner))
      .then(function(data) {
        var versions = data.versions || [];
        if (!versions.length || !codeCtx || codeCtx.owner !== owner || codeCtx.problem !== problem) return;

        var select = $('version-select');
        select.innerHTML = '';
        // 接口按时间升序返回，下拉列表从新到旧展示
        for (var i = versions.length - 1; i >= 0; i--) {
          var opt = document.createElement('option');
          opt.value = String(i);
          var label = 'v' + (i + 1);
          if (versions[i].name) label += ' · ' + versions[i].name;
          label += ' · ' + timeAgo(versions[i].created_at);
          if (i === versions.length - 1) label += '（最新）';
          opt.textContent = label;
          select.appendChild(opt);
        }
        select.value = String(versions.length - 1);
        select.setAttribute('data-latest', String(versions.length - 1));

        versionCtx = { versions: versions, owner: owner };
        $('version-hint').textContent = '共 ' + versions.length + ' 个版本';
        $('version-bar').style.display = '';

        var canManage = currentUser && currentUser.username === owner;
        $('btn-rename-version').style.display = canManage ? '' : 'none';
        $('btn-delete-version').style.display = canManage ? '' : 'none';
      })
      .catch(function() {});
  }

  function selectedVersion() {
    if (!versionCtx) return null;
    var index = parseInt($('version-select').value, 10);
    if (isNaN(index)) return null;
    return versionCtx.versions[index] || null;
  }

  function onVersionChange() {
    if (!versionCtx) return;

    var select = $('version-select');
    var index = parseInt(select.value, 10);
    var latest = parseInt(select.getAttribute('data-latest'), 10);
    if (isNaN(index) || isNaN(latest)) return;

    if (index === latest) {
      previewVersionId = null;
      previewCode = '';
      $('version-hint').textContent = '共 ' + versionCtx.versions.length + ' 个版本';
      renderCodeBase();
      return;
    }

    var version = versionCtx.versions[index];
    previewVersionId = version.id;
    previewCode = version.code || '';

    $('code-empty').style.display = 'none';
    $('code-editor-wrap').style.display = 'none';
    $('code-actions').style.display = 'none';
    $('code-viewer').style.display = '';
    $('code-viewer').innerHTML = highlightCpp(previewCode);
    $('code-toolbar').style.display = '';
    $('version-hint').textContent = '正在查看历史版本 v' + (index + 1) + '（只读）';
  }

  function openRenameVersion() {
    var version = selectedVersion();
    if (!version) return;
    $('rename-version-input').value = version.name || '';
    $('rename-version-modal').style.display = '';
    $('rename-version-input').focus();
  }

  function closeRenameVersion() {
    $('rename-version-modal').style.display = 'none';
  }

  function confirmRenameVersion() {
    var version = selectedVersion();
    if (!version) return;

    api('/api/submission-versions/' + version.id, {
      method: 'PUT',
      body: { name: $('rename-version-input').value.trim() }
    }).then(function() {
      closeRenameVersion();
      showToast('版本已重命名', 'success');
      refreshCodeView();
    }).catch(function(err) {
      closeRenameVersion();
      showToast('重命名失败：' + err.message, 'error');
    });
  }

  function refreshCodeView() {
    if (!codeCtx) return;
    loadProblemData(codeCtx.contestId, codeCtx.problem, codeCtx.owner);
  }

  function updateSubmitState() {
    if ($('code-editor-wrap').style.display === 'none') return;
    $('btn-submit-code').disabled = $('code-editor').value === lastLoadedCode;
  }

  function submitCode() {
    var parts = getHash();
    if (parts[0] !== 'contest' || !parts[1] || parts[2] !== 'problem' || !parts[3]) return;
    var contestId = parts[1];
    var problem = parts[3];
    var qIdx = problem.indexOf('?');
    if (qIdx >= 0) problem = problem.substring(0, qIdx);

    var code = $('code-editor').value;

    if (code === lastLoadedCode) {
      showToast('代码与上一版本相同，无需重复提交', 'error');
      return;
    }

    api('/api/contests/' + contestId + '/submissions/' + problem, {
      method: 'PUT',
      body: { code: code }
    }).then(function() {
      showToast('提交成功', 'success');
      loadProblemData(contestId, problem, currentUser ? currentUser.username : null);
    }).catch(function(err) {
      showToast('提交失败：' + err.message, 'error');
    });
  }

  function showDeleteConfirm(type, recordId) {
    if (type === 'version') {
      pendingDeleteInfo = { type: 'version' };
      $('delete-confirm-text').textContent = '确定要删除选中的历史版本吗？此操作不可撤销。';
    } else if (type === 'record') {
      pendingDeleteInfo = { type: 'record', recordId: recordId };
      $('delete-confirm-text').textContent = '确定要删除这条提交记录吗？罚时会被重新计算。';
    } else {
      pendingDeleteInfo = { type: 'code' };
      $('delete-confirm-text').textContent = '确定要删除该题目的提交吗？此操作不可撤销。';
    }
    $('delete-confirm-modal').style.display = '';
  }

  function hideDeleteConfirm() {
    pendingDeleteInfo = null;
    $('delete-confirm-modal').style.display = 'none';
  }

  function confirmDelete() {
    if (!pendingDeleteInfo) return;
    if (pendingDeleteInfo.type === 'version') {
      deleteSelectedVersion();
    } else if (pendingDeleteInfo.type === 'record') {
      deleteRecord(pendingDeleteInfo.recordId);
    } else {
      deleteCode();
    }
  }

  function deleteRecord(recordId) {
    hideDeleteConfirm();
    if (!currentContestId || !recordId) return;

    api('/api/contests/' + currentContestId + '/records/' + recordId, { method: 'DELETE' })
      .then(function() {
        showToast('记录已删除', 'success');
        lastScoreboardKey = '';
        loadScoreboard(currentContestId);
      })
      .catch(function(err) {
        showToast('删除失败：' + err.message, 'error');
      });
  }

  function deleteSelectedVersion() {
    var version = selectedVersion();
    if (!version) {
      hideDeleteConfirm();
      return;
    }

    api('/api/submission-versions/' + version.id, { method: 'DELETE' })
      .then(function() {
        hideDeleteConfirm();
        showToast('版本已删除', 'success');
        refreshCodeView();
      })
      .catch(function(err) {
        hideDeleteConfirm();
        showToast('删除失败：' + err.message, 'error');
      });
  }

  function deleteCode() {
    var parts = getHash();
    if (parts[0] !== 'contest' || !parts[1] || parts[2] !== 'problem' || !parts[3]) return;
    var contestId = parts[1];
    var problem = parts[3];
    var qIdx = problem.indexOf('?');
    if (qIdx >= 0) problem = problem.substring(0, qIdx);

    hideDeleteConfirm();

    api('/api/contests/' + contestId + '/submissions/' + problem, { method: 'DELETE' })
      .then(function() {
        showToast('删除成功', 'success');
        loadProblemData(contestId, problem, currentUser ? currentUser.username : null);
      })
      .catch(function(err) {
        showToast('删除失败：' + err.message, 'error');
      });
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  init();
})();

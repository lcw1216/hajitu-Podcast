(function() {
  var PROBLEMS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  var POLL_INTERVAL = 12000;
  var activityTimer = null;
  var isRegisterMode = false;
  var currentUser = null;
  var viewingUser = null;
  var pendingDeleteInfo = null;

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
    $('btn-delete-code').addEventListener('click', showDeleteConfirm);
    $('btn-confirm-delete').addEventListener('click', deleteCode);
    $('btn-cancel-delete').addEventListener('click', hideDeleteConfirm);
    $('branch-select').addEventListener('change', onBranchChange);
    $('contest-branch-select').addEventListener('change', onContestBranchChange);

    $('create-contest-modal').addEventListener('click', function(e) {
      if (e.target === this) hideCreateContestModal();
    });
    $('delete-confirm-modal').addEventListener('click', function(e) {
      if (e.target === this) hideDeleteConfirm();
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
      var isCreator = currentUser && c.creator_id === currentUser.id;
      html += '<div class="acm-contest-card" data-id="' + c.id + '">';
      html += '<div class="acm-contest-card-left">';
      html += '<div class="acm-contest-card-name">' + escapeHtml(c.name) + '</div>';
      html += '<div class="acm-contest-card-meta">';
      html += '创建者：' + escapeHtml(c.creator_name) + ' · ';
      html += timeAgo(c.created_at);
      html += '</div>';
      html += '</div>';
      html += '<div class="acm-contest-card-right">';
      if (isCreator) {
        html += '<button class="acm-btn acm-btn-danger acm-btn-xs btn-delete-contest" data-id="' + c.id + '" data-name="' + escapeHtml(c.name) + '">删除</button>';
      }
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
            alert('删除失败：' + err.message);
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

    activityTimer = setInterval(function() { loadActivities(contestId); }, POLL_INTERVAL);
  }

  function onContestBranchChange() {
    viewingUser = $('contest-branch-select').value;
    var parts = getHash();
    if (parts[1]) loadContestData(parts[1]);
  }

  function loadContestData(contestId) {
    loadProblems(contestId);
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
      renderProblemGrid(contestId, submittedSet);
    });
  }

  function renderProblemGrid(contestId, submittedSet) {
    var grid = $('problem-grid');
    var html = '';
    for (var i = 0; i < PROBLEMS.length; i++) {
      var p = PROBLEMS[i];
      var isSubmitted = submittedSet[p];
      html += '<div class="acm-problem-card' + (isSubmitted ? ' submitted' : '') + '" data-contest="' + contestId + '" data-problem="' + p + '">';
      html += '<span class="acm-problem-letter">' + p + '</span>';
      html += '<span class="acm-problem-status">' + (isSubmitted ? '已提交' : '未提交') + '</span>';
      html += '</div>';
    }
    grid.innerHTML = html;

    var cards = grid.querySelectorAll('.acm-problem-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function() {
        var cid = this.getAttribute('data-contest');
        var prob = this.getAttribute('data-problem');
        setHash('contest/' + cid + '/problem/' + prob);
      });
    }
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

      $('code-empty').style.display = 'none';
      $('code-viewer').style.display = 'none';
      $('code-editor').style.display = 'none';
      $('code-actions').style.display = 'none';

      if (isMe) {
        $('code-editor').style.display = '';
        $('code-actions').style.display = '';
        $('code-editor').value = found && found.code ? stripHtml(found.code) : '';
      } else if (found && found.code) {
        $('code-viewer').style.display = '';
        $('code-viewer').textContent = stripHtml(found.code);
      } else {
        $('code-empty').style.display = '';
      }
    }).catch(function() {});
  }

  function submitCode() {
    var parts = getHash();
    if (parts[0] !== 'contest' || !parts[1] || parts[2] !== 'problem' || !parts[3]) return;
    var contestId = parts[1];
    var problem = parts[3];
    var qIdx = problem.indexOf('?');
    if (qIdx >= 0) problem = problem.substring(0, qIdx);

    var code = stripHtml($('code-editor').value);

    api('/api/contests/' + contestId + '/submissions/' + problem, {
      method: 'PUT',
      body: { code: code }
    }).then(function() {
      alert('提交成功！');
      loadProblemData(contestId, problem, currentUser ? currentUser.username : null);
    }).catch(function(err) {
      alert('提交失败：' + err.message);
    });
  }

  function showDeleteConfirm() {
    $('delete-confirm-modal').style.display = '';
  }

  function hideDeleteConfirm() {
    $('delete-confirm-modal').style.display = 'none';
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
        alert('删除成功！');
        loadProblemData(contestId, problem, currentUser ? currentUser.username : null);
      })
      .catch(function(err) {
        alert('删除失败：' + err.message);
      });
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function stripHtml(text) {
    if (!text) return '';
    return text.replace(/<[^>]*>/g, '');
  }

  init();
})();

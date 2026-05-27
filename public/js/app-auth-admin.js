// ── Auth ──
let currentUser = null;
let isRegisterMode = false;
let trendChart = null;
let sourceChart = null;

// Helper — true when the URL points at an auth endpoint where a 401 means
// "wrong credentials" (e.g. /api/auth/login, /api/auth/password) and MUST NOT
// be reinterpreted as "session expired → show login overlay".
function _isAuthEndpoint(url) {
  try { return String(url || '').includes('/api/auth/'); }
  catch { return false; }
}

function _handleSessionExpired() {
  currentUser = null;
  resetAuthFormToLogin();
  var overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.remove('hidden');
  // Re-pull setup/login-required so the overlay shows the right copy
  // (e.g. needsSetup vs. login form) instead of whatever was rendered last.
  if (typeof checkAuthStatus === 'function') {
    try { checkAuthStatus(); } catch (e) { /* swallow — overlay already visible */ }
  }
}

// Global fetch 401 interceptor
const _origFetch = window.fetch;
window.fetch = function(...args) {
  return _origFetch.apply(this, args).then(res => {
    if (res.status === 401 && !_isAuthEndpoint(args[0])) {
      _handleSessionExpired();
    }
    return res;
  });
};

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'same-origin' });
  // Treat 401 on auth endpoints (wrong password, etc.) as a normal failure —
  // the caller renders the error. Only session-expired 401s from non-auth
  // endpoints should boot the user to the login overlay.
  if (res.status === 401 && !_isAuthEndpoint(url)) {
    _handleSessionExpired();
    throw new Error('未登录');
  }
  return res;
}

// Reset the auth overlay to its default "login" state. Called whenever we
// show the overlay so stale register-mode copy / cleared password input from
// the prior session doesn't bleed through.
function resetAuthFormToLogin() {
  isRegisterMode = false;
  var title = document.getElementById('authTitle');
  if (title) title.textContent = '欢迎回来，请登录';
  var submit = document.getElementById('authSubmitBtn');
  if (submit) {
    submit.textContent = '登录';
    submit.disabled = false;
  }
  var err = document.getElementById('authError');
  if (err) err.textContent = '';
  var pwd = document.getElementById('authPassword');
  if (pwd) pwd.value = '';
}

// 记录上次 status 拉回来的 loginRequired —— 退出登录后用来决定要不要露出
// "继续以访客身份使用"链接（免登录模式下退出要停在登录页，需要一个回访客的入口）。
var lastLoginRequired = true;
function updateGuestContinueVisibility() {
  var el = document.getElementById('authGuestContinue');
  if (!el) return;
  el.style.display = lastLoginRequired ? 'none' : '';
}

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
    const data = await readApiResponse(res);
    lastLoginRequired = !!data.loginRequired;
    updateGuestContinueVisibility();
    if (data.user) {
      currentUser = data.user;
      document.getElementById('authOverlay').classList.add('hidden');
      onAuthReady();
      return;
    }
    // No user — start from a clean login form before applying the right copy.
    resetAuthFormToLogin();
    if (data.needsSetup) {
      isRegisterMode = true;
      document.getElementById('authTitle').textContent = '首次启动，请创建管理员账号';
      document.getElementById('authSubmitBtn').textContent = '注册';
      document.getElementById('authToggle').textContent = '';
      document.getElementById('authOverlay').classList.remove('hidden');
    } else if (!data.loginRequired) {
      // Login not required — backend should hand us a guest user; fall back
      // to a synthetic guest if the response is empty. Mirror the backend
      // default tab list so a stale response doesn't expose all tabs.
      currentUser = { id: 0, username: '_guest', displayName: '访客', role: 'user', allowedTabs: ['search', 'batch', 'complete'] };
      document.getElementById('authOverlay').classList.add('hidden');
      onAuthReady();
    } else {
      document.getElementById('authToggle').textContent = data.registrationEnabled ? '没有账号？注册' : '';
      document.getElementById('authOverlay').classList.remove('hidden');
    }
  } catch (e) {
    // Network/parse failure — show login overlay with a clean form so the
    // user can retry (the form submit handler will surface "网络错误").
    resetAuthFormToLogin();
    document.getElementById('authOverlay').classList.remove('hidden');
  }
}

function onAuthReady() {
  document.getElementById('udHeader').innerHTML = `${escapeHtml(currentUser.displayName || currentUser.username)} <span>${escapeHtml(currentUser.role)}</span>`;
  document.getElementById('sidebarUserName').textContent = currentUser.displayName || currentUser.username;
  document.getElementById('sidebarUserRole').textContent = currentUser.role;
  document.getElementById('udManageUsers').style.display = 'none';
  document.getElementById('udChangePwd').style.display = currentUser.username === '_guest' ? 'none' : '';
  var sb = document.getElementById('sidebarUsersBtn');
  if (sb) sb.style.display = 'none';
  if (currentUser.role === 'admin') {
    document.getElementById('udManageUsers').style.display = '';
    if (sb) sb.style.display = '';
  }
  // 手机端「我」页 — 填充用户卡片 + 按角色控制管理员项。桌面端 me 页通常不暴露
  // 入口，但 force-desktop 模式下进 ?tab=me 时也能正常显示。
  var meName = document.getElementById('meUserName');
  if (meName) meName.textContent = currentUser.displayName || currentUser.username;
  var meRole = document.getElementById('meUserRole');
  if (meRole) meRole.textContent = currentUser.role === 'admin' ? '管理员' : (currentUser.username === '_guest' ? '访客' : '普通用户');
  var meLogout = document.getElementById('meLogoutBtn');
  if (meLogout) meLogout.style.display = currentUser.username === '_guest' ? 'none' : '';
  var meStats = document.getElementById('meRowStats');
  var meUsers = document.getElementById('meRowUsers');
  if (meStats) meStats.style.display = currentUser.role === 'admin' ? '' : 'none';
  if (meUsers) meUsers.style.display = currentUser.role === 'admin' ? '' : 'none';
  // Apply per-user tab permissions
  applyTabPermissions();
  // Show announcements & release notes after auth
  try { if (typeof checkAnnouncements === 'function') checkAnnouncements(); } catch(e){}
  try { if (typeof checkReleaseNotesIfUpgraded === 'function') checkReleaseNotesIfUpgraded(); } catch(e){}
  // Default stats date range: last 30 days
  const today = beijingDate();
  const monthAgo = new Date(new Date().getTime() + 8*3600000 - 30 * 86400000).toISOString().slice(0, 10);
  document.getElementById('statsTo').value = today;
  document.getElementById('statsFrom').value = monthAgo;
  initPanels();
  if (typeof initAppUpdateCheck === 'function') initAppUpdateCheck();
  if (typeof renderTopSourceHealth === 'function') renderTopSourceHealth();
  if (typeof refreshSourceHealth === 'function' && Date.now() - (sourceHealthCheckedAt || 0) > 5 * 60 * 1000) {
    refreshSourceHealth();
  }
  if (typeof pollEnvironmentCheck === 'function') pollEnvironmentCheck();
}

var TAB_LABELS = {search:'标准检索',batch:'批量下载',complete:'标准补全',history:'下载历史',qual:'资质查询',labr:'Labr库检索',stats:'使用统计',users:'用户管理',settings:'系统设置',me:'我'};

function applyTabPermissions() {
  var allowed = currentUser.allowedTabs; // null = all allowed
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(function(item) {
    var tab = item.dataset.tab;
    if (tab === 'users') return; // admin-only handled separately
    if (allowed === null || allowed.indexOf(tab) >= 0) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
  // If current tab is hidden, switch to first allowed
  var activeTab = document.querySelector('.sidebar-item.active');
  if (activeTab && activeTab.style.display === 'none') {
    var first = document.querySelector('.sidebar-item[data-tab]:not([style*="display: none"])');
    if (first) switchTab(first.dataset.tab);
  }
}


// Close user dropdown on outside click
document.addEventListener("click", (e) => {
  const dd = document.getElementById("userDropdown");
  const btn = document.getElementById("sidebarUserToggle");
  if (dd.classList.contains("open") && !dd.contains(e.target) && (!btn || !btn.contains(e.target))) {
    dd.classList.remove("open");
  }
});


document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  const submitBtn = document.getElementById('authSubmitBtn');
  errEl.textContent = '';
  if (!username || !password) {
    errEl.textContent = '请填写用户名和密码';
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    });
    const data = await readApiResponse(res);
    if (!res.ok || !data.user) {
      errEl.textContent = data.message || (isRegisterMode ? '注册失败' : '登录失败');
      return;
    }
    currentUser = data.user;
    // Reset transient form state on success so a future logout shows a clean form.
    document.getElementById('authPassword').value = '';
    isRegisterMode = false;
    document.getElementById('authOverlay').classList.add('hidden');
    onAuthReady();
  } catch (err) {
    errEl.textContent = '网络错误';
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

document.getElementById('authToggle').addEventListener('click', () => {
  if (!document.getElementById('authToggle').textContent) return;
  isRegisterMode = !isRegisterMode;
  document.getElementById('authTitle').textContent = isRegisterMode ? '创建账号，开始使用 标准盒子' : '欢迎回来，请登录';
  document.getElementById('authSubmitBtn').textContent = isRegisterMode ? '注册' : '登录';
  document.getElementById('authToggle').textContent = isRegisterMode ? '已有账号？登录' : '没有账号？注册';
  document.getElementById('authError').textContent = '';
  // Avoid carrying the password across modes — a value typed for login should
  // not survive into the register flow (and vice versa).
  var pwd = document.getElementById('authPassword');
  if (pwd) pwd.value = '';
});

async function doLogout() {
  try {
    await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  } catch (e) { /* network failure shouldn't block logout UI */ }
  currentUser = null;
  document.getElementById('userDropdown').classList.remove('open');
  resetAuthFormToLogin();
  document.getElementById('authOverlay').classList.remove('hidden');
  // 免登录 + loopback 模式下，露出"继续以访客身份使用"，用户点了才回访客态；
  // 不再立即 checkAuthStatus，否则后端会马上发一个新 guest 会话，看起来像退不掉。
  updateGuestContinueVisibility();
  try { if (typeof showToast === 'function') showToast('已退出登录', 'success'); } catch (e) { /* toast 不阻塞 */ }
}

// 用户在登录页点"继续以访客身份使用"时调用 —— 重新拉 status，
// 若后端给了 guest 会话就会自动 onAuthReady + 隐藏 overlay。
async function continueAsGuest() {
  try { await checkAuthStatus(); } catch (e) { /* overlay 已可见 */ }
}

function toggleUserDropdown() {
  document.getElementById('userDropdown').classList.toggle('open');
}

// ── Login overlay: version + online status ──
function initLoginOverlayMeta() {
  // 先启动健康检查轮询，避免 IPC 调用挂起时整个登录页一直显示“正在检查服务…”
  pollLoginHealth();
  setInterval(pollLoginHealth, 30000);

  // 版本号尽力而为：给 IPC 调用一个 2 秒超时，避免 preload 未就绪时阻塞
  const verEl = document.getElementById('authVersion');
  if (verEl && window.bzxz && typeof window.bzxz.getAppVersion === 'function') {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
    Promise.race([window.bzxz.getAppVersion(), timeout])
      .then((v) => { if (v) verEl.textContent = 'v' + v; })
      .catch(() => { /* 留给 /api/health 返回的 version 兜底 */ });
  }
}

async function pollLoginHealth() {
  const el = document.getElementById('authStatus');
  if (!el) return;
  const overlay = document.getElementById('authOverlay');
  // Skip polling when login overlay is hidden
  if (!overlay || overlay.classList.contains('hidden')) return;
  const textEl = el.querySelector('.auth-status-text');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('/api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const total = Array.isArray(data.sources) ? data.sources.length : 0;
      el.dataset.state = 'online';
      if (textEl) textEl.textContent = total > 0 ? `服务在线 · ${total} 个数据源` : '服务在线';
      const verEl = document.getElementById('authVersion');
      if (verEl && (!verEl.textContent || verEl.textContent === 'v—') && data.version) {
        verEl.textContent = 'v' + data.version;
      }
      return;
    }
    throw new Error('bad status');
  } catch {
    el.dataset.state = 'offline';
    if (textEl) textEl.textContent = '服务离线';
  }
}

document.addEventListener('DOMContentLoaded', initLoginOverlayMeta);

function showChangePwd() {
  document.getElementById('userDropdown').classList.remove('open');
  const oldPwd = prompt('请输入原密码');
  if (!oldPwd) return;
  const newPwd = prompt('请输入新密码（至少6位）');
  if (!newPwd || newPwd.length < 6) { showToast('密码至少6位', 'fail'); return; }
  // /api/auth/password is in the auth-endpoint exclude list, so a 401 from
  // a wrong old password no longer bumps the user back to the login overlay.
  apiFetch('/api/auth/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
  }).then(async (r) => {
    const d = await readApiResponse(r);
    if (r.ok && d.ok) showToast('密码已修改', 'success');
    else showToast(d.message || '修改失败', 'fail');
  }).catch(() => showToast('修改失败', 'fail'));
}

// ── Stats ──
async function loadStats() {
  const from = document.getElementById('statsFrom').value;
  const to = document.getElementById('statsTo').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  try {
    const [summaryRes, tsRes, srcRes] = await Promise.all([
      apiFetch(`/api/stats/summary?${params}`).then(r => readApiResponse(r)),
      apiFetch(`/api/stats/timeseries?${params}`).then(r => readApiResponse(r)),
      apiFetch(`/api/stats/by-source?${params}`).then(r => readApiResponse(r)),
    ]);

    // Summary cards
    const typeMap = { search: '搜索', download: '下载', batch_resolve: '批量解析', complete: '补全' };
    let html = `<div class="stat-card"><div class="stat-value">${summaryRes.total}</div><div class="stat-label">总操作数</div></div>`;
    html += `<div class="stat-card"><div class="stat-value">${summaryRes.uniqueUsers}</div><div class="stat-label">活跃用户</div></div>`;
    for (const item of summaryRes.byType) {
      html += `<div class="stat-card"><div class="stat-value">${item.count}</div><div class="stat-label">${typeMap[item.eventType] || item.eventType}</div></div>`;
    }
    document.getElementById('statsSummary').innerHTML = html;

    // Trend chart
    const dates = [...new Set(tsRes.items.map(r => r.date))].sort();
    const types = [...new Set(tsRes.items.map(r => r.eventType))];
    const colors = { search: '#3b82f6', download: '#10b981', batch_resolve: '#f59e0b', complete: '#8b5cf6' };
    const datasets = types.map(t => ({
      label: typeMap[t] || t,
      data: dates.map(d => { const row = tsRes.items.find(r => r.date === d && r.eventType === t); return row ? row.count : 0; }),
      borderColor: colors[t] || '#666',
      backgroundColor: (colors[t] || '#666') + '33',
      tension: 0.3, fill: true,
    }));
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(document.getElementById('chartTrend'), {
      type: 'line',
      data: { labels: dates, datasets },
      options: { responsive: true, plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#888', font: { size: 10 } } }, y: { beginAtZero: true, ticks: { color: '#888', font: { size: 10 }, stepSize: 1 } } } },
    });

    // Source pie chart
    const srcLabels = srcRes.items.map(r => r.source);
    const srcCounts = srcRes.items.map(r => r.count);
    const srcColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
    if (sourceChart) sourceChart.destroy();
    sourceChart = new Chart(document.getElementById('chartSource'), {
      type: 'doughnut',
      data: { labels: srcLabels, datasets: [{ data: srcCounts, backgroundColor: srcColors }] },
      options: { responsive: true, plugins: { legend: { labels: { color: '#aaa', font: { size: 11 } } } } },
    });
  } catch (e) { console.error('Stats load error:', e); }
}

// ── Users management ──
var selectedUserIds = new Set();

// Cache of current users keyed by id — actions read username/role/etc. from
// here instead of trusting attributes that would otherwise need to be re-
// escaped through string templates (XSS risk vector).
var usersById = new Map();

async function loadUsers() {
  try {
    const [usersRes, settingsRes] = await Promise.all([
      apiFetch('/api/admin/users').then(r => readApiResponse(r)),
      apiFetch('/api/admin/settings').then(r => readApiResponse(r)),
    ]);
    document.getElementById('regEnabledToggle').checked = settingsRes.registrationEnabled;
    document.getElementById('loginRequiredToggle').checked = settingsRes.loginRequired;
    var lgEl = document.getElementById('lanGuestAllowedToggle');
    if (lgEl) lgEl.checked = !!settingsRes.lanGuestAllowed;
    usersById = new Map(usersRes.users.map(u => [u.id, u]));
    let html = '';
    for (const u of usersRes.users) {
      const roleBadge = u.role === 'admin' ? '<span class="badge badge-admin">管理员</span>' : '<span class="badge badge-user">用户</span>';
      const statusBadge = u.isActive ? '<span class="badge badge-active">启用</span>' : '<span class="badge badge-inactive">禁用</span>';
      const toggleLabel = u.isActive ? '禁用' : '启用';
      const roleLabel = u.role === 'admin' ? '降为用户' : '升为管理员';
      const checked = selectedUserIds.has(u.id) ? 'checked' : '';
      html += `<tr>
        <td><input type="checkbox" class="user-select" data-uid="${u.id}" ${checked}></td>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.displayName || '—')}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>${Number(u.searchCount) || 0}</td>
        <td>${Number(u.downloadCount) || 0}</td>
        <td class="users-actions">
          <button data-user-action="detail" data-uid="${u.id}">明细</button>
          <button data-user-action="perms" data-uid="${u.id}">权限</button>
          <button data-user-action="toggle-active" data-uid="${u.id}">${toggleLabel}</button>
          <button data-user-action="toggle-role" data-uid="${u.id}">${roleLabel}</button>
          <button style="color:var(--danger)" data-user-action="delete" data-uid="${u.id}">删除</button>
        </td>
      </tr>`;
    }
    document.getElementById('usersBody').innerHTML = html;
    updateBatchBar();
  } catch (e) { console.error('Users load error:', e); }
}

// Single delegated listener on the users table body. Replaces inline onclick
// handlers that previously embedded raw username strings into JS source — a
// stored-XSS sink if a username contained a single quote or backslash.
document.addEventListener('DOMContentLoaded', () => {
  const body = document.getElementById('usersBody');
  if (!body) return;
  body.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-user-action]');
    if (!btn) return;
    const id = parseInt(btn.dataset.uid, 10);
    if (!Number.isFinite(id)) return;
    const user = usersById.get(id);
    if (!user) return;
    const action = btn.dataset.userAction;
    if (action === 'detail') showUserDetail(id);
    else if (action === 'perms') showUserPerms(id);
    else if (action === 'toggle-active') toggleUserActive(id, user.isActive ? 0 : 1);
    else if (action === 'toggle-role') changeUserRole(id, user.role === 'admin' ? 'user' : 'admin');
    else if (action === 'delete') deleteUser(id);
  });
  body.addEventListener('change', (ev) => {
    const cb = ev.target.closest('input.user-select[data-uid]');
    if (!cb) return;
    const id = parseInt(cb.dataset.uid, 10);
    if (!Number.isFinite(id)) return;
    toggleUserSelect(id, cb.checked);
  });
});

function toggleUserSelect(id, checked) {
  if (checked) selectedUserIds.add(id); else selectedUserIds.delete(id);
  updateBatchBar();
}

function toggleSelectAllUsers(checked) {
  document.querySelectorAll('#usersBody [data-uid]').forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.dataset.uid);
    if (checked) selectedUserIds.add(id); else selectedUserIds.delete(id);
  });
  updateBatchBar();
}

function updateBatchBar() {
  const bar = document.getElementById('usersBatchBar');
  const count = selectedUserIds.size;
  document.getElementById('usersSelectedCount').textContent = count;
  bar.style.display = count > 0 ? 'inline-flex' : 'none';
}

async function batchSetActive(active) {
  const ids = [...selectedUserIds];
  if (!ids.length) return;
  const label = active ? '启用' : '禁用';
  if (!await showConfirm({ title: label + '用户', body: '确定' + label + '选中的 ' + ids.length + ' 个用户？', confirmText: label })) return;
  await Promise.all(ids.map(id =>
    apiFetch('/api/admin/users/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !!active }),
    })
  ));
  selectedUserIds.clear();
  showToast('已' + label + ' ' + ids.length + ' 个用户');
  loadUsers();
}

async function batchDeleteUsers() {
  const ids = [...selectedUserIds];
  if (!ids.length) return;
  if (!await showConfirm({ title: '批量删除用户', body: '确定删除选中的 ' + ids.length + ' 个用户？此操作不可恢复。', danger: true, confirmText: '删除' })) return;
  await Promise.all(ids.map(id => apiFetch('/api/admin/users/' + id, { method: 'DELETE' })));
  selectedUserIds.clear();
  showToast('已删除 ' + ids.length + ' 个用户');
  loadUsers();
}

function showDefaultPerms() {
  var modal = document.getElementById('modalBody');
  var overlay = document.getElementById('modalOverlay');
  // Load current default from settings
  apiFetch('/api/admin/settings').then(r => readApiResponse(r)).then(function(s) {
    var defaults = s.defaultAllowedTabs; // null = all allowed
    var html = '<h3 style="margin-bottom:12px;font-size:16px">新用户默认权限</h3>';
    html += '<p style="font-size:12px;color:var(--text-3);margin-bottom:12px">新建用户时自动应用的权限，用户创建后可单独调整</p>';
    html += '<div id="defaultPermCheckboxes">';
    TAB_ITEMS.forEach(function(t) {
      var checked = (defaults === null || defaults.indexOf(t.key) >= 0) ? 'checked' : '';
      html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background=\'var(--surface-h)\'" onmouseout="this.style.background=\'\'">';
      html += '<input type="checkbox" data-defperm="' + t.key + '" ' + checked + ' style="accent-color:var(--accent);width:16px;height:16px">';
      html += '<span style="font-size:14px;font-weight:500">' + t.label + '</span>';
      html += '<span style="font-size:12px;color:var(--text-3)">' + t.desc + '</span>';
      html += '</label>';
    });
    html += '</div>';
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
    html += '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">取消</button>';
    html += '<button class="btn btn-primary btn-sm" onclick="saveDefaultPerms()">保存</button>';
    html += '</div>';
    modal.innerHTML = html;
    overlay.classList.add('open');
  });
}

async function saveDefaultPerms() {
  var checks = document.querySelectorAll('#defaultPermCheckboxes [data-defperm]');
  var tabs = [];
  checks.forEach(function(cb) { if (cb.checked) tabs.push(cb.dataset.defperm); });
  await apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ defaultAllowedTabs: tabs }),
  });
  document.getElementById('modalOverlay').classList.remove('open');
  showToast('默认权限已保存');
}

async function toggleUserActive(id, active) {
  await apiFetch(`/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: !!active }),
  });
  loadUsers();
}

async function changeUserRole(id, role) {
  await apiFetch(`/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  loadUsers();
}

async function deleteUser(id) {
  const user = usersById.get(id);
  if (!user) return;
  if (!await showConfirm({ title: '删除用户', body: '确定删除用户「' + user.username + '」？此操作不可恢复。', danger: true, confirmText: '删除' })) return;
  const res = await apiFetch('/api/admin/users/' + id, { method: 'DELETE' });
  const d = await readApiResponse(res);
  if (d.ok) { showToast('用户已删除'); loadUsers(); }
  else showToast(d.message || '删除失败', 'fail');
}

function toggleRegistration(enabled) {
  apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registrationEnabled: enabled }),
  }).then(r => readApiResponse(r)).then(d => {
    document.getElementById('regEnabledToggle').checked = d.registrationEnabled;
  });
}

function toggleLoginRequired(enabled) {
  apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginRequired: enabled }),
  }).then(r => readApiResponse(r)).then(d => {
    document.getElementById('loginRequiredToggle').checked = d.loginRequired;
  });
}

// 「允许局域网游客」——默认关。开启意味着任何 Wi-Fi 内能访问到 5937 端口的客户端
// 都能以访客身份匿名使用（绕过登录页），等价于把账号体系关掉。仅在「家用/小团队
// + 内网完全可信」时启用。开启时弹 confirm 让管理员显式确认风险。
function toggleLanGuestAllowed(enabled) {
  var el = document.getElementById('lanGuestAllowedToggle');
  if (enabled) {
    var ok = window.confirm(
      '⚠ 开启「允许局域网游客」后，任何能访问本机 5937 端口的设备（同 Wi-Fi 手机、同事电脑等）都可以匿名以访客身份使用，绕过登录页。\n\n' +
      '账号系统、权限、审计将对 LAN 客户端失效。请仅在内网完全可信的场景启用。\n\n' +
      '确认开启？'
    );
    if (!ok) { if (el) el.checked = false; return; }
  }
  apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lanGuestAllowed: enabled }),
  }).then(r => readApiResponse(r)).then(d => {
    if (el) el.checked = !!d.lanGuestAllowed;
    if (typeof showToast === 'function') {
      showToast(d.lanGuestAllowed ? '局域网游客已开启' : '局域网游客已关闭', d.lanGuestAllowed ? 'warn' : 'success');
    }
  }).catch(function () {
    if (el) el.checked = !enabled; // 回滚
  });
}

async function showCreateUser() {
  const username = prompt('用户名（至少2位）');
  if (!username || username.length < 2) return;
  const password = prompt('密码（至少6位）');
  if (!password || password.length < 6) { showToast('密码至少6位', 'fail'); return; }
  // Fetch default permissions
  let allowedTabs = null;
  try {
    const s = await apiFetch('/api/admin/settings').then(r => readApiResponse(r));
    allowedTabs = s.defaultAllowedTabs; // null = all
  } catch { /* keep null */ }
  apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, allowedTabs }),
  }).then(r => readApiResponse(r)).then(d => {
    if (d.user) { showToast('用户已创建'); loadUsers(); }
    else showToast(d.message || '创建失败', 'fail');
  });
}

var TAB_ITEMS = [
  { key: 'search', label: '标准检索', desc: '搜索和下载标准' },
  { key: 'batch', label: '批量下载', desc: '批量解析和下载' },
  { key: 'complete', label: '标准补全', desc: 'Excel/CSV 自动补全' },
  { key: 'history', label: '下载历史', desc: '查看下载记录' },
  { key: 'qual', label: '资质查询', desc: 'CNAS/CMA 资质' },
  { key: 'labr', label: 'Labr库检索', desc: 'labr.cc 标准库补给' },
  { key: 'stats', label: '使用统计', desc: '查看使用数据' },
  { key: 'settings', label: '系统设置', desc: '下载参数和源' },
];

function showUserPerms(userId) {
  var user = usersById.get(userId);
  if (!user) return;
  var allowed = user.allowedTabs; // null = all allowed
  var modal = document.getElementById('modalBody');
  var overlay = document.getElementById('modalOverlay');
  var html = '<h3 style="margin-bottom:12px;font-size:16px">功能权限 — ' + escapeHtml(user.username) + '</h3>';
  html += '<p style="font-size:12px;color:var(--text-3);margin-bottom:12px">勾选用户可使用的功能，未勾选的功能在侧边栏中不显示</p>';
  html += '<div id="permCheckboxes">';
  TAB_ITEMS.forEach(function(t) {
    var checked = (allowed === null || allowed.indexOf(t.key) >= 0) ? 'checked' : '';
    html += '<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background=\'var(--surface-h)\'" onmouseout="this.style.background=\'\'">';
    html += '<input type="checkbox" data-perm-tab="' + t.key + '" ' + checked + ' style="accent-color:var(--accent);width:16px;height:16px">';
    html += '<span style="font-size:14px;font-weight:500">' + t.label + '</span>';
    html += '<span style="font-size:12px;color:var(--text-3)">' + t.desc + '</span>';
    html += '</label>';
  });
  html += '</div>';
  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">';
  html += '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'modalOverlay\').classList.remove(\'open\')">取消</button>';
  html += '<button class="btn btn-primary btn-sm" onclick="saveUserPerms(' + userId + ')">保存</button>';
  html += '</div>';
  modal.innerHTML = html;
  overlay.classList.add('open');
}

async function saveUserPerms(userId) {
  var checks = document.querySelectorAll('#permCheckboxes [data-perm-tab]');
  var tabs = [];
  checks.forEach(function(cb) { if (cb.checked) tabs.push(cb.dataset.permTab); });
  await apiFetch('/api/admin/users/' + userId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowedTabs: tabs }),
  });
  document.getElementById('modalOverlay').classList.remove('open');
  loadUsers();
}

async function showUserDetail(userId) {
  const modal = document.getElementById('modalBody');
  const overlay = document.getElementById('modalOverlay');
  modal.innerHTML = '<p style="color:var(--text-3)">加载中...</p>';
  overlay.classList.add('open');
  try {
    const res = await apiFetch(`/api/admin/users/${userId}/events`);
    const d = await readApiResponse(res);
    if (!res.ok) throw new Error(d.message || '加载失败');

    const typeLabels = { search: '搜索', download: '下载', batch_resolve: '批量解析', complete: '补全' };
    const typeColors = { search: 'var(--accent)', download: 'var(--success)', batch_resolve: 'var(--warn)', complete: '#a78bfa' };

    let summaryHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:12px 0">';
    const total = d.summary.reduce((s, r) => s + r.count, 0);
    summaryHtml += `<div style="padding:8px 14px;border-radius:8px;background:oklch(25% 0.01 250 / 0.5);text-align:center"><div style="font-size:20px;font-weight:600;color:var(--text)">${total}</div><div style="font-size:11px;color:var(--text-3)">总计</div></div>`;
    for (const s of d.summary) {
      const color = typeColors[s.eventType] || 'var(--text-2)';
      summaryHtml += `<div style="padding:8px 14px;border-radius:8px;background:oklch(25% 0.01 250 / 0.5);text-align:center"><div style="font-size:20px;font-weight:600;color:${color}">${s.count}</div><div style="font-size:11px;color:var(--text-3)">${typeLabels[s.eventType] || s.eventType}</div></div>`;
    }
    summaryHtml += '</div>';

    let sourceHtml = '';
    if (d.bySource.length > 0) {
      sourceHtml = '<div style="margin:8px 0;font-size:13px;color:var(--text-2)">来源分布: ' +
        d.bySource.map(s => `<span class="source-badge source-${escapeHtml(s.source)}">${srcLabel(s.source)} ${s.count}</span>`).join(' ') +
        '</div>';
    }

    let listHtml = '';
    if (d.recent.length > 0) {
      listHtml = '<div style="max-height:320px;overflow-y:auto;margin-top:8px"><table class="users-table"><thead><tr><th>时间</th><th>类型</th><th>来源</th><th>标准号</th></tr></thead><tbody>';
      for (const e of d.recent) {
        const time = e.createdAt ? utcToBeijing(e.createdAt) : '—';
        const typeLabel = typeLabels[e.eventType] || e.eventType;
        const color = typeColors[e.eventType] || 'var(--text-2)';
        listHtml += `<tr>
          <td style="font-size:12px;white-space:nowrap">${time}</td>
          <td><span style="color:${color};font-size:12px">${typeLabel}</span></td>
          <td>${e.source ? srcLabel(e.source) : '—'}</td>
          <td style="font-size:12px">${e.standardId ? escapeHtml(e.standardId) : '—'}</td>
        </tr>`;
      }
      listHtml += '</tbody></table></div>';
    } else {
      listHtml = '<p style="color:var(--text-3);font-size:13px;margin-top:8px">暂无使用记录</p>';
    }

    modal.innerHTML = `<h3>用户: ${escapeHtml(d.user.displayName || d.user.username)}</h3>
      ${summaryHtml}${sourceHtml}${listHtml}
      <button class="btn btn-ghost btn-sm" style="margin-top:12px" data-action="modal-close">关闭</button>`;
  } catch (e) {
    modal.innerHTML = `<p style="color:var(--danger)">加载失败: ${escapeHtml(e.message)}</p>`;
  }
}

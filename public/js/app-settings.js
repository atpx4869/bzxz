// ── Settings (floating panel) ──
const SETTINGS_LABELS = { gbw: 'BW源', bz: 'BZ源', by: 'BY源', bzvip: 'BZvip源' };
const SETTINGS_NOTES = { gbw: '自动验证码 5~15s', bz: '合成PDF 30~90s', by: '直链PDF 2~5s', bzvip: '账号池 2~5s' };
var startupSettingState = { loaded: false, loading: false, enabled: false, supported: false, error: '' };
var webAccessState = { loaded: false, loading: false, info: null, error: '' };

function hasDesktopStartupApi() {
  return Boolean(window.bzxz && window.bzxz.isElectron && window.bzxz.getOpenAtLogin && window.bzxz.setOpenAtLogin);
}

function hasDesktopWebAccessApi() {
  return Boolean(window.bzxz && window.bzxz.isElectron && window.bzxz.getWebAccessInfo && window.bzxz.setWebServiceEnabled);
}

function renderWebAccessCard() {
  var supported = hasDesktopWebAccessApi();
  var info = webAccessState.info || {};
  var lanUrls = Array.isArray(info.lanUrls) ? info.lanUrls : [];
  var enabled = supported ? info.webServiceEnabled !== false : false;
  var urls = supported ? [info.localUrl].concat(enabled ? lanUrls : []).filter(Boolean) : [window.location.origin].filter(Boolean);
  var title = supported
    ? (enabled ? (lanUrls.length ? '局域网可访问' : '仅本机地址') : '已关闭')
    : '仅桌面端可启动';
  var note = supported
    ? (webAccessState.error || info.firewallHint || '桌面程序最小化到托盘后，内置 Web 服务仍会继续运行。')
    : '当前是浏览器 Web 端，无法控制桌面内置服务。';
  var statusClass = webAccessState.error ? ' danger' : (enabled && lanUrls.length ? ' success' : '');
  var urlRows = urls.length ? urls.map(function(url, idx) {
    var label = idx === 0 ? '本机' : '内网';
    return `
      <div class="web-access-url-row">
        <span>${label}</span>
        <code title="${escapeHtml(url)}">${escapeHtml(url)}</code>
        ${supported ? `<button class="btn btn-sm btn-ghost" onclick="copyWebAccessUrl('${escapeHtml(url)}')">复制</button>` : ''}
        ${supported ? `<button class="btn btn-sm btn-ghost" onclick="openWebAccessUrl('${escapeHtml(url)}')">打开</button>` : ''}
      </div>`;
  }).join('') : '<div class="setting-hint">未获取到访问地址</div>';
  return `
      <div class="settings-card wide web-access-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-kicker">网页版启动器</div>
            <div class="settings-value">内置 Web 服务</div>
            <div class="setting-hint">${escapeHtml(note)}</div>
          </div>
          <div class="desktop-setting-controls">
            <span class="desktop-setting-status${statusClass}">${webAccessState.loading ? '读取中' : title}</span>
            <label class="toggle-switch" title="${supported ? '允许同一局域网设备访问网页版' : '仅桌面程序可用'}">
              <input type="checkbox" ${enabled ? 'checked' : ''} ${!supported || webAccessState.loading ? 'disabled' : ''} onchange="toggleWebServiceSetting(this.checked)">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </div>
        </div>
        <div class="web-access-url-list">${urlRows}</div>
      </div>`;
}

async function ensureWebAccessLoaded(force) {
  if (!hasDesktopWebAccessApi()) {
    webAccessState = { loaded: true, loading: false, info: null, error: '' };
    return;
  }
  if (!force && (webAccessState.loaded || webAccessState.loading)) return;
  webAccessState.loading = true;
  webAccessState.error = '';
  try {
    var info = await window.bzxz.getWebAccessInfo();
    webAccessState = { loaded: true, loading: false, info: info, error: '' };
  } catch (err) {
    webAccessState = { loaded: true, loading: false, info: null, error: err?.message || '读取 Web 访问地址失败' };
  }
  renderSettings();
}

async function copyWebAccessUrl(url) {
  if (!window.bzxz?.copyWebAccessUrl) return;
  try {
    var result = await window.bzxz.copyWebAccessUrl(url);
    if (typeof showToast === 'function') showToast('已复制: ' + result.url, 'success');
  } catch (err) {
    if (typeof showToast === 'function') showToast(err?.message || '复制失败', 'fail');
  }
}

async function openWebAccessUrl(url) {
  if (!window.bzxz?.openWebAccessUrl) return;
  try {
    await window.bzxz.openWebAccessUrl(url);
  } catch (err) {
    if (typeof showToast === 'function') showToast(err?.message || '打开失败', 'fail');
  }
}

async function toggleWebServiceSetting(enabled) {
  if (!hasDesktopWebAccessApi()) return;
  webAccessState.loading = true;
  webAccessState.error = '';
  renderSettings();
  try {
    var info = await window.bzxz.setWebServiceEnabled(Boolean(enabled));
    webAccessState = { loaded: true, loading: false, info: info, error: '' };
    if (typeof showToast === 'function') showToast(Boolean(info?.webServiceEnabled) ? '局域网 Web 服务已开启' : '局域网 Web 服务已关闭', 'success');
  } catch (err) {
    webAccessState.loading = false;
    webAccessState.error = err?.message || '设置 Web 服务失败';
  }
  renderSettings();
}

function renderStartupSettingCard() {
  var supported = hasDesktopStartupApi();
  var disabled = !supported || startupSettingState.loading;
  var title = supported ? (startupSettingState.enabled ? '已开启' : '未开启') : '仅桌面端';
  var note = supported
    ? (startupSettingState.error || '开启后，登录 Windows 时自动启动 bzxz 桌面程序。')
    : 'Web 端不能写入系统启动项，请在桌面程序中设置。';
  var statusClass = startupSettingState.error ? ' danger' : (startupSettingState.enabled ? ' success' : '');
  return `
      <div class="settings-card wide desktop-setting-card">
        <div class="setting-row desktop-setting-row">
          <div class="setting-row-main">
            <div class="settings-kicker">桌面程序</div>
            <div class="setting-row-title">开机自启</div>
            <div class="setting-row-note">${escapeHtml(note)}</div>
          </div>
          <span class="desktop-setting-status${statusClass}">${startupSettingState.loading ? '读取中' : title}</span>
          <label class="toggle-switch" title="${supported ? '登录 Windows 后自动启动' : '仅桌面程序可用'}">
            <input type="checkbox" ${startupSettingState.enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="toggleStartupSetting(this.checked)">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
        </div>
      </div>`;
}

async function ensureStartupSettingLoaded(force) {
  if (!hasDesktopStartupApi()) {
    startupSettingState = { loaded: true, loading: false, enabled: false, supported: false, error: '' };
    return;
  }
  if (!force && (startupSettingState.loaded || startupSettingState.loading)) return;
  startupSettingState.loading = true;
  startupSettingState.error = '';
  try {
    var info = await window.bzxz.getOpenAtLogin();
    startupSettingState = {
      loaded: true,
      loading: false,
      enabled: Boolean(info && info.openAtLogin),
      supported: info?.supported !== false,
      error: '',
    };
  } catch (err) {
    startupSettingState = {
      loaded: true,
      loading: false,
      enabled: false,
      supported: true,
      error: err?.message || '读取开机自启状态失败',
    };
  }
  renderSettings();
}

async function toggleStartupSetting(enabled) {
  if (!hasDesktopStartupApi()) return;
  startupSettingState.loading = true;
  startupSettingState.error = '';
  renderSettings();
  try {
    var info = await window.bzxz.setOpenAtLogin(Boolean(enabled));
    startupSettingState = {
      loaded: true,
      loading: false,
      enabled: Boolean(info && info.openAtLogin),
      supported: info?.supported !== false,
      error: '',
    };
  } catch (err) {
    startupSettingState.loading = false;
    startupSettingState.error = err?.message || '设置开机自启失败';
  }
  renderSettings();
}

function renderSettings() {
  const priorityRows = downloadPriority.map((s, i) => {
    const enabled = downloadSources.includes(s);
    return `
    <div class="setting-row source-priority-row" data-priority="${s}" style="opacity:${enabled ? '1' : '0.45'}">
      <span class="drag-handle">⋮</span>
      <span class="priority-rank">${i + 1}</span>
      <div class="setting-row-main">
        <div class="setting-row-title">${SETTINGS_LABELS[s]}</div>
        <div class="setting-row-note">${SETTINGS_NOTES[s]}</div>
      </div>
      <span class="source-tag source-pill">${srcLabel(s)}</span>
      <label class="toggle-switch">
        <input type="checkbox" ${enabled ? 'checked' : ''} onchange="toggleDownloadSource('${s}', this.checked);renderSettings()">
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>`;
  }).join('');

  const concurrencyOpts = [1, 2, 3, 4, 5].map(n => {
    return `<button class="btn btn-sm ${n === downloadConcurrency ? 'btn-primary' : 'btn-ghost'}" onclick="setConcurrency(${n});renderSettings()">${n}</button>`;
  }).join('');

  const timeoutOpts = [10, 15, 20, 30, 60].map(n => {
    return `<button class="btn btn-sm ${n === downloadTimeout ? 'btn-primary' : 'btn-ghost'}" onclick="setTimeoutVal(${n});renderSettings()">${n}s</button>`;
  }).join('');

  const historyOpts = [3, 5, 8, 10, 15, 20].map(n => {
    return `<button class="btn btn-sm ${n === getHistoryLimit() ? 'btn-primary' : 'btn-ghost'}" onclick="setHistoryLimit(${n});renderSettings()">${n}</button>`;
  }).join('');
  const webAccessCard = renderWebAccessCard();
  const startupCard = renderStartupSettingCard();

  document.getElementById('settingsBody').innerHTML = `
    <div class="settings-grid">
      <div class="settings-card wide">
        <div class="settings-card-header">
          <div>
            <div class="settings-kicker">下载模式</div>
            <div class="settings-value">${downloadMode === 'cascade' ? '顺序模式' : '竞速模式'}</div>
          </div>
        </div>
        <div class="setting-choice-grid">
          <button class="setting-choice ${downloadMode === 'cascade' ? 'active' : ''}" onclick="setDownloadMode('cascade');renderSettings()">
            <span>省资源</span><strong>顺序模式</strong><em>按优先级逐源下载，失败后回退。</em>
          </button>
          <button class="setting-choice ${downloadMode === 'race' ? 'active' : ''}" onclick="setDownloadMode('race');renderSettings()">
            <span>更快</span><strong>竞速模式</strong><em>多源同时请求，采用最快结果。</em>
          </button>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-kicker">并发数</div>
        <div class="settings-value">${downloadConcurrency}</div>
        <div class="setting-options">${concurrencyOpts}</div>
      </div>
      <div class="settings-card">
        <div class="settings-kicker">超时时间</div>
        <div class="settings-value">${downloadTimeout}s</div>
        <div class="setting-options">${timeoutOpts}</div>
      </div>
      <div class="settings-card">
        <div class="settings-kicker">搜索记录</div>
        <div class="settings-value">${getHistoryLimit()}条</div>
        <div class="setting-options">${historyOpts}</div>
      </div>
      ${webAccessCard}
      ${startupCard}
    </div>
    <div class="setting-section">
      <div class="field-label">源优先级</div>
      <div class="setting-hint">拖拽调整顺序，顺序模式下排前面的源会先尝试。</div>
      <div id="priorityList" class="source-priority-list">${priorityRows}</div>
    </div>
    <div class="setting-section">
      <div class="field-label settings-source-head">
        数据源状态
        <button class="btn btn-sm btn-ghost" onclick="checkAllSources()" id="checkSourcesBtn">全部检测</button>
      </div>
      <div id="sourceStatusList" class="source-status-list">点击“全部检测”或单个源的“重试”按钮</div>
    </div>
    <div class="settings-actions">
      <button class="btn btn-ghost btn-sm" onclick="resetSettings();renderSettings()">恢复默认</button>
    </div>`;
  initDragSort();
  ensureWebAccessLoaded(false);
  ensureStartupSettingLoaded(false);
}

var sourceStatusCache = {};
var sourceHealthCheckedAt = 0;

function renderTopSourceHealth() {
  var el = document.getElementById('sourceHealthStrip');
  if (!el) return;
  var known = Object.keys(sourceStatusCache).length;
  if (!known) {
    el.innerHTML = '<button class="source-health-mini muted" onclick="refreshSourceHealth()">检测来源</button>';
    return;
  }
  el.innerHTML = ALL_SOURCES.map(function(s) {
    var r = sourceStatusCache[s];
    var cls = !r ? 'unknown' : r.status === 'ok' ? 'ok' : 'bad';
    var text = !r ? '—' : r.status === 'ok' ? (r.ms + 'ms') : '异常';
    var title = r?.error ? srcLabel(s) + ': ' + r.error : srcLabel(s) + ': ' + text;
    return '<button class="source-health-mini ' + cls + '" data-health-source="' + escapeHtml(s) + '" title="' + escapeHtml(title) + '"><b>' + srcLabel(s) + '</b><span>' + escapeHtml(text) + '</span></button>';
  }).join('');
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-health-source]');
  if (!btn) return;
  checkSingleSource(btn.dataset.healthSource);
});

async function refreshSourceHealth() {
  var el = document.getElementById('sourceHealthStrip');
  if (el) el.innerHTML = ALL_SOURCES.map(function(s) {
    return '<span class="source-health-mini loading"><b>' + srcLabel(s) + '</b><span>...</span></span>';
  }).join('');
  try {
    var res = await fetch('/api/standards/check-sources');
    var data = await res.json();
    sourceStatusCache = data.results || {};
    sourceHealthCheckedAt = Date.now();
  } catch {
    ALL_SOURCES.forEach(function(s) { sourceStatusCache[s] = { status: 'error', ms: 0, error: '请求失败' }; });
  }
  renderTopSourceHealth();
  var list = document.getElementById('sourceStatusList');
  if (list) list.innerHTML = renderSourceStatusList();
}

async function checkAllSources() {
  var btn = document.getElementById('checkSourcesBtn');
  if (btn) { btn.textContent = '检测中...'; btn.disabled = true; }
  var list = document.getElementById('sourceStatusList');
  if (list) list.innerHTML = renderSourceStatusLoading();
  await refreshSourceHealth();
  if (btn) { btn.textContent = '全部检测'; btn.disabled = false; }
}

async function checkSingleSource(src) {
  var el = document.getElementById('ss-' + src);
  if (el) el.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span>';
  try {
    var res = await fetch('/api/standards/check-sources?sources=' + src);
    var data = await res.json();
    Object.assign(sourceStatusCache, data.results || {});
  } catch { sourceStatusCache[src] = { status: 'error', ms: 0, error: '请求失败' }; }
  sourceHealthCheckedAt = Date.now();
  if (el) el.innerHTML = renderSourceStatusItem(src);
  renderTopSourceHealth();
}

function renderSourceStatusLoading() {
  return ALL_SOURCES.map(function(s) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'
      + '<span style="font-weight:500;color:var(--text);min-width:80px">' + srcLabel(s) + '</span>'
      + '<span class="spinner" style="width:12px;height:12px"></span>'
      + '<span style="color:var(--text-3)">检测中...</span></div>';
  }).join('');
}

function renderSourceStatusItem(src) {
  var r = sourceStatusCache[src];
  if (!r) return '<span style="color:var(--text-3)">未检测</span>';
  if (r.status === 'ok') {
    return '<span style="color:var(--success)">● 正常</span> <span style="color:var(--text-3)">' + r.ms + 'ms</span>';
  }
  return '<span style="color:var(--danger)">● 异常</span> <span style="color:var(--text-3)">' + escapeHtml(r.error || '未知错误') + '</span>';
}

function renderSourceStatusList() {
  return ALL_SOURCES.map(function(s) {
    var r = sourceStatusCache[s];
    var statusHtml = renderSourceStatusItem(s);
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'
      + '<span style="font-weight:500;color:var(--text);min-width:80px">' + srcLabel(s) + '</span>'
      + '<span id="ss-' + s + '" style="flex:1">' + statusHtml + '</span>'
      + '<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:2px 8px" onclick="checkSingleSource(\'' + s + '\')">重试</button>'
      + '</div>';
  }).join('');
}
function toggleDownloadSource(source, enabled) {
  if (enabled) { if (!downloadSources.includes(source)) downloadSources.push(source); }
  else { downloadSources = downloadSources.filter(s => s !== source); }
  saveSettings();
}
function setConcurrency(n) { downloadConcurrency = n; saveSettings(); }
function setTimeoutVal(n) { downloadTimeout = n; saveSettings(); }
function setDownloadMode(mode) { downloadMode = mode; saveSettings(); }

function resetSettings() {
  downloadSources = [...DEFAULT_DOWNLOAD_SOURCES];
  downloadConcurrency = DEFAULT_CONCURRENCY;
  downloadPriority = ['bzvip', 'gbw', 'by', 'bz'];
  downloadTimeout = 15; downloadMode = 'cascade';
  saveSettings();
}

function initDragSort() {
  const list = document.getElementById('priorityList');
  if (!list) return;
  list.querySelectorAll('.setting-row').forEach(row => {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', row.dataset.priority);
      row.classList.add('sortable-drag');
    });
    row.addEventListener('dragend', () => { row.classList.remove('sortable-drag'); });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      const after = getDragAfter(list, e.clientY);
      if (after) list.insertBefore(row, after);
      else list.appendChild(row);
    });
    row.addEventListener('drop', e => {
      e.preventDefault(); row.classList.remove('sortable-drag');
      const order = [...list.querySelectorAll('.setting-row')].map(r => r.dataset.priority);
      downloadPriority = order; saveSettings(); renderSettings();
    });
  });
}

function getDragAfter(container, y) {
  const draggables = [...container.querySelectorAll('.setting-row:not(.sortable-drag)')];
  return draggables.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > (closest.offset || -Infinity)) return { offset, element: child };
    return closest;
  }, { offset: -Infinity }).element;
}

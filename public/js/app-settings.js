// ── Settings (floating panel) ──
const SETTINGS_LABELS = { gbw: 'BW源', bz: 'BZ源', by: 'BY源' };
const SETTINGS_NOTES = { gbw: '自动验证码 5~15s', bz: '合成PDF 30~90s', by: '直链PDF 2~5s' };
var startupSettingState = { loaded: false, loading: false, enabled: false, supported: false, error: '' };
var webAccessState = { loaded: false, loading: false, info: null, error: '' };
var appUpdateState = { loaded: false, checking: false, installing: false, progress: null, info: null, error: '' };
var portSettingState = {
  loaded: false,
  loading: false,
  preferredPort: null,
  actualPort: 0,
  minPort: 1024,
  maxPort: 65535,
  inputValue: '',
  pendingPort: null,
  checking: false,
  checkResult: null,   // { available, error, port, note }
  saving: false,
  saveError: '',
  needsRestart: false,
};

function hasDesktopPortApi() {
  return Boolean(window.bzxz && window.bzxz.isElectron && window.bzxz.getPortConfig && window.bzxz.setPortConfig && window.bzxz.checkPort);
}

function hasDesktopStartupApi() {
  return Boolean(window.bzxz && window.bzxz.isElectron && window.bzxz.getOpenAtLogin && window.bzxz.setOpenAtLogin);
}

function hasDesktopWebAccessApi() {
  return Boolean(window.bzxz && window.bzxz.isElectron && window.bzxz.getWebAccessInfo && window.bzxz.setWebServiceEnabled);
}

function hasDesktopUpdateApi() {
  return Boolean(window.bzxz && window.bzxz.isElectron && window.bzxz.checkForUpdates);
}

function formatAssetSize(size) {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size >= 1024 * 1024) return Math.round(size / 1024 / 1024) + 'MB';
  if (size >= 1024) return Math.round(size / 1024) + 'KB';
  return size + 'B';
}

function jsStringArg(value) {
  return JSON.stringify(String(value || '')).replace(/"/g, '&quot;');
}

function getInstallerAsset(assets) {
  return (Array.isArray(assets) ? assets : []).find(function(asset) {
    return /\.exe$/i.test(asset.name || '') && /setup/i.test(asset.name || '');
  });
}

function renderUpdateCard() {
  var supported = hasDesktopUpdateApi();
  var info = appUpdateState.info || {};
  var current = supported ? (info.currentVersion || '读取中') : 'Web';
  var latest = info.latestVersion || '—';
  var title = supported
    ? (appUpdateState.checking ? '检查中' : info.updateAvailable ? '发现新版本' : appUpdateState.loaded ? '已是最新' : '未检查')
    : '仅桌面端';
  var note = supported
    ? (appUpdateState.error || (info.updateAvailable ? 'GitHub Actions 已发布新版本，可打开下载页更新。' : '启动时会自动轻量检查，必要时也可以手动检查。'))
    : '当前是浏览器 Web 端，无法检查桌面客户端更新。';
  var statusClass = appUpdateState.error ? ' danger' : (info.updateAvailable ? ' success' : '');
  var assets = Array.isArray(info.assets) ? info.assets.slice(0, 3) : [];
  var installerAsset = getInstallerAsset(info.assets);
  var progressText = appUpdateState.installing
    ? ('下载中' + (appUpdateState.progress?.percent ? ' ' + appUpdateState.progress.percent + '%' : '...'))
    : '';
  var assetList = assets.length ? `
        <div class="update-asset-list">
          ${assets.map(function(asset) {
            var size = formatAssetSize(asset.size);
            return `<button class="update-asset" onclick="openAppUpdatePage(${jsStringArg(asset.url || info.releaseUrl || '')})">
              <span>${escapeHtml(asset.name || '下载文件')}</span><em>${escapeHtml(size)}</em>
            </button>`;
          }).join('')}
        </div>` : '';
  return `
      <div class="settings-card wide update-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-kicker">在线更新</div>
            <div class="settings-value">客户端版本</div>
            <div class="setting-hint">${escapeHtml(note)}</div>
          </div>
          <span class="desktop-setting-status${statusClass}">${title}</span>
        </div>
        <div class="version-row">
          <span>当前版本 <strong>v${escapeHtml(current)}</strong></span>
          <span>最新版本 <strong>${latest === '—' ? '—' : 'v' + escapeHtml(latest)}</strong></span>
        </div>
        ${progressText ? `<div class="update-progress"><div><span style="width:${Math.max(4, Math.min(100, appUpdateState.progress?.percent || 8))}%"></span></div><em>${escapeHtml(progressText)}</em></div>` : ''}
        ${assetList}
        <div class="settings-actions">
          <button class="btn btn-sm btn-primary" ${!supported || appUpdateState.checking ? 'disabled' : ''} onclick="checkAppUpdate(false)">检查更新</button>
          <button class="btn btn-sm btn-primary" ${!supported || appUpdateState.installing || !info.updateAvailable || !installerAsset ? 'disabled' : ''} onclick="downloadAndInstallAppUpdate()">下载并安装</button>
          <button class="btn btn-sm btn-ghost" ${!supported || !info.releaseUrl ? 'disabled' : ''} onclick="openAppUpdatePage(${jsStringArg(info.releaseUrl || '')})">打开下载页</button>
        </div>
      </div>`;
}

function ensureUpdateBadge() {
  var actions = document.querySelector('.topbar-actions');
  if (!actions) return null;
  var badge = document.getElementById('appUpdateBadge');
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'appUpdateBadge';
    badge.className = 'topbar-btn update-badge';
    badge.type = 'button';
    badge.onclick = function() {
      var info = appUpdateState.info || {};
      if (info.updateAvailable && info.releaseUrl) openAppUpdatePage(info.releaseUrl);
      else switchTab('settings');
    };
    actions.insertBefore(badge, actions.firstChild);
  }
  return badge;
}

function renderUpdateBadge() {
  var badge = ensureUpdateBadge();
  if (!badge) return;
  if (!hasDesktopUpdateApi()) {
    badge.style.display = 'none';
    return;
  }
  var info = appUpdateState.info || {};
  if (appUpdateState.checking) {
    badge.style.display = '';
    badge.textContent = '检查更新';
    badge.title = '正在检查客户端更新';
    badge.classList.remove('has-update');
    return;
  }
  if (info.updateAvailable) {
    badge.style.display = '';
    badge.textContent = '新版 v' + info.latestVersion;
    badge.title = '发现新版本，点击打开下载页';
    badge.classList.add('has-update');
    return;
  }
  badge.style.display = 'none';
  badge.classList.remove('has-update');
}

async function checkAppUpdate(silent) {
  if (!hasDesktopUpdateApi()) {
    appUpdateState = { loaded: true, checking: false, info: null, error: '' };
    renderUpdateBadge();
    return;
  }
  appUpdateState.checking = true;
  appUpdateState.error = '';
  renderUpdateBadge();
  if (document.getElementById('settingsBody')) renderSettings();
  try {
    var info = await window.bzxz.checkForUpdates();
    appUpdateState = { loaded: true, checking: false, installing: false, progress: null, info: info, error: '' };
    if (!silent && typeof showToast === 'function') {
      showToast(info.updateAvailable ? ('发现新版本 v' + info.latestVersion) : '当前已是最新版', info.updateAvailable ? 'success' : 'info');
    }
  } catch (err) {
    appUpdateState = { loaded: true, checking: false, installing: false, progress: null, info: appUpdateState.info, error: err?.message || '检查更新失败' };
    if (!silent && typeof showToast === 'function') showToast(appUpdateState.error, 'fail');
  }
  renderUpdateBadge();
  if (document.getElementById('settingsBody')) renderSettings();
}

async function downloadAndInstallAppUpdate() {
  if (!window.bzxz?.downloadAndInstallUpdate) return;
  appUpdateState.installing = true;
  appUpdateState.error = '';
  appUpdateState.progress = { percent: 0 };
  renderSettings();
  try {
    await window.bzxz.downloadAndInstallUpdate();
    if (typeof showToast === 'function') showToast('安装器已启动，客户端即将退出', 'success', 5000);
  } catch (err) {
    appUpdateState.installing = false;
    appUpdateState.error = err?.message || '下载并安装失败';
    if (typeof showToast === 'function') showToast(appUpdateState.error, 'fail');
    renderSettings();
  }
}

function initUpdateDownloadProgress() {
  if (!window.bzxz?.onUpdateDownloadProgress || window.__bzxzUpdateProgressBound) return;
  window.__bzxzUpdateProgressBound = true;
  window.bzxz.onUpdateDownloadProgress(function(progress) {
    appUpdateState.installing = !progress?.done;
    appUpdateState.progress = progress || null;
    if (document.getElementById('settingsBody')) renderSettings();
  });
}

function initAppUpdateCheck() {
  initUpdateDownloadProgress();
  if (!hasDesktopUpdateApi() || appUpdateState.loaded || appUpdateState.checking) {
    renderUpdateBadge();
    return;
  }
  checkAppUpdate(true);
}

async function openAppUpdatePage(url) {
  if (!window.bzxz?.openUpdatePage) return;
  try {
    await window.bzxz.openUpdatePage(url);
  } catch (err) {
    if (typeof showToast === 'function') showToast(err?.message || '打开下载页失败', 'fail');
  }
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

function renderPortSettingCard() {
  var supported = hasDesktopPortApi();
  var s = portSettingState;
  var mode = supported ? (s.preferredPort ? '固定端口' : '随机端口') : '仅桌面端';
  var statusClass = s.saveError ? ' danger'
    : (s.checkResult && s.checkResult.available === false) ? ' danger'
    : (s.preferredPort && s.preferredPort === s.actualPort) ? ' success'
    : '';
  var inputValue = s.inputValue != null ? s.inputValue : (s.preferredPort == null ? '' : String(s.preferredPort));
  var note;
  if (!supported) {
    note = '仅桌面端可设置内置服务端口，Web 页面无法修改。';
  } else if (s.saveError) {
    note = s.saveError;
  } else if (s.needsRestart) {
    note = '已保存。需要重启桌面程序后新端口才会生效。';
  } else if (s.preferredPort && s.actualPort && s.preferredPort !== s.actualPort) {
    note = '已配置 ' + s.preferredPort + '，但启动时被占用，当前实际使用随机端口 ' + s.actualPort + '。';
  } else if (s.preferredPort) {
    note = '已固定端口。修改后需要重启桌面程序。';
  } else {
    note = '留空使用随机端口；填入 1024 - 65535 之间的端口号可固定。';
  }
  var checkText = '';
  if (s.checking) {
    checkText = '检测中…';
  } else if (s.checkResult) {
    if (s.checkResult.available) {
      checkText = '端口 ' + s.checkResult.port + ' 可用' + (s.checkResult.note ? '（' + s.checkResult.note + '）' : '');
    } else {
      checkText = '端口 ' + (s.checkResult.port != null ? s.checkResult.port : '?') + ' 不可用：' + (s.checkResult.error || '未知原因');
    }
  }
  var checkClass = s.checking ? ' muted'
    : (s.checkResult && s.checkResult.available) ? ' success'
    : (s.checkResult && s.checkResult.available === false) ? ' danger'
    : ' muted';
  var disabled = !supported || s.loading || s.saving;
  return `
      <div class="settings-card wide port-setting-card">
        <div class="settings-card-header">
          <div>
            <div class="settings-kicker">桌面程序</div>
            <div class="settings-value">内置服务端口</div>
            <div class="setting-hint">${escapeHtml(note)}</div>
          </div>
          <span class="desktop-setting-status${statusClass}">${s.loading ? '读取中' : escapeHtml(mode)}</span>
        </div>
        <div class="port-setting-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px">
          <input id="portSettingInput" type="number" inputmode="numeric"
            min="${s.minPort}" max="${s.maxPort}"
            placeholder="留空 = 随机"
            value="${escapeHtml(inputValue)}"
            ${disabled ? 'disabled' : ''}
            oninput="onPortInputChange(this.value)"
            style="flex:0 0 160px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg-2);color:var(--text);font:13px 'DM Mono',monospace">
          <button class="btn btn-sm btn-ghost" ${disabled || !s.inputValue ? 'disabled' : ''} onclick="checkPortNow()">${s.checking ? '检测中…' : '检测'}</button>
          <button class="btn btn-sm btn-primary" ${disabled ? 'disabled' : ''} onclick="savePortConfig()">${s.saving ? '保存中…' : '保存'}</button>
          <button class="btn btn-sm btn-ghost" ${disabled || !s.preferredPort ? 'disabled' : ''} onclick="clearPortConfig()">恢复随机</button>
          ${s.needsRestart ? `<button class="btn btn-sm btn-primary" onclick="relaunchAppNow()">立即重启</button>` : ''}
        </div>
        <div class="setting-hint port-setting-status${checkClass}" style="margin-top:6px;min-height:18px">${escapeHtml(checkText)}</div>
        <div class="setting-hint" style="margin-top:4px;color:var(--text-3)">当前实际端口: <code>${s.actualPort || '—'}</code></div>
      </div>`;
}

async function ensurePortSettingLoaded(force) {
  if (!hasDesktopPortApi()) {
    portSettingState.loaded = true;
    return;
  }
  if (!force && (portSettingState.loaded || portSettingState.loading)) return;
  portSettingState.loading = true;
  try {
    var cfg = await window.bzxz.getPortConfig();
    portSettingState.preferredPort = cfg && cfg.preferredPort != null ? Number(cfg.preferredPort) : null;
    portSettingState.actualPort = cfg && cfg.actualPort ? Number(cfg.actualPort) : 0;
    portSettingState.minPort = cfg && cfg.minPort ? Number(cfg.minPort) : 1024;
    portSettingState.maxPort = cfg && cfg.maxPort ? Number(cfg.maxPort) : 65535;
    if (portSettingState.inputValue === '' && portSettingState.preferredPort != null) {
      portSettingState.inputValue = String(portSettingState.preferredPort);
    }
  } catch (err) {
    portSettingState.saveError = (err && err.message) || '读取端口配置失败';
  } finally {
    portSettingState.loaded = true;
    portSettingState.loading = false;
  }
  renderSettings();
}

function onPortInputChange(value) {
  portSettingState.inputValue = String(value || '').trim();
  portSettingState.checkResult = null;
  portSettingState.saveError = '';
  // Keep the input in sync without a full re-render so the cursor doesn't jump.
  var hint = document.querySelector('.port-setting-status');
  if (hint) hint.textContent = '';
  var checkBtn = document.querySelector('.port-setting-row .btn-ghost');
  if (checkBtn) checkBtn.disabled = !portSettingState.inputValue;
}

async function checkPortNow() {
  if (!hasDesktopPortApi()) return;
  var raw = (portSettingState.inputValue || '').trim();
  if (!raw) {
    portSettingState.checkResult = { available: false, error: '请先输入端口号', port: null };
    renderSettings();
    return;
  }
  var n = Number(raw);
  if (!Number.isInteger(n) || n < portSettingState.minPort || n > portSettingState.maxPort) {
    portSettingState.checkResult = { available: false, error: '端口必须是 ' + portSettingState.minPort + ' - ' + portSettingState.maxPort + ' 之间的整数', port: n };
    renderSettings();
    return;
  }
  portSettingState.checking = true;
  portSettingState.checkResult = null;
  renderSettings();
  try {
    var res = await window.bzxz.checkPort(n);
    portSettingState.checkResult = res || { available: false, error: '检测失败', port: n };
  } catch (err) {
    portSettingState.checkResult = { available: false, error: (err && err.message) || '检测失败', port: n };
  } finally {
    portSettingState.checking = false;
  }
  renderSettings();
}

async function savePortConfig() {
  if (!hasDesktopPortApi()) return;
  var raw = (portSettingState.inputValue || '').trim();
  var n = raw === '' ? null : Number(raw);
  if (n !== null && (!Number.isInteger(n) || n < portSettingState.minPort || n > portSettingState.maxPort)) {
    portSettingState.saveError = '端口必须是 ' + portSettingState.minPort + ' - ' + portSettingState.maxPort + ' 之间的整数（留空使用随机端口）';
    renderSettings();
    return;
  }
  portSettingState.saving = true;
  portSettingState.saveError = '';
  renderSettings();
  try {
    var res = await window.bzxz.setPortConfig(n);
    portSettingState.preferredPort = res && res.preferredPort != null ? Number(res.preferredPort) : null;
    portSettingState.actualPort = res && res.actualPort ? Number(res.actualPort) : portSettingState.actualPort;
    portSettingState.needsRestart = Boolean(res && res.needsRestart);
    if (typeof showToast === 'function') {
      showToast(portSettingState.needsRestart ? '已保存，重启桌面程序后生效' : '已保存', 'success');
    }
  } catch (err) {
    portSettingState.saveError = (err && err.message) || '保存失败';
  } finally {
    portSettingState.saving = false;
  }
  renderSettings();
}

async function clearPortConfig() {
  portSettingState.inputValue = '';
  portSettingState.checkResult = null;
  await savePortConfig();
}

async function relaunchAppNow() {
  if (!window.bzxz?.relaunchApp) return;
  try {
    await window.bzxz.relaunchApp();
  } catch (err) {
    if (typeof showToast === 'function') showToast((err && err.message) || '重启失败', 'fail');
  }
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

  const concurrencyOpts = VALID_CONCURRENCY.map(n => {
    return `<button class="btn btn-sm ${n === downloadConcurrency ? 'btn-primary' : 'btn-ghost'}" onclick="setConcurrency(${n});renderSettings()">${n}</button>`;
  }).join('');

  const timeoutOpts = [10, 15, 20, 30, 60].map(n => {
    return `<button class="btn btn-sm ${n === downloadTimeout ? 'btn-primary' : 'btn-ghost'}" onclick="setTimeoutVal(${n});renderSettings()">${n}s</button>`;
  }).join('');

  const historyOpts = [3, 5, 8, 10, 15, 20].map(n => {
    return `<button class="btn btn-sm ${n === getHistoryLimit() ? 'btn-primary' : 'btn-ghost'}" onclick="setHistoryLimit(${n});renderSettings()">${n}</button>`;
  }).join('');
  const updateCard = renderUpdateCard();
  const webAccessCard = renderWebAccessCard();
  const startupCard = renderStartupSettingCard();
  const portCard = renderPortSettingCard();
  const announcementCard = renderAnnouncementAdminCard();

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
      ${updateCard}
      ${webAccessCard}
      ${portCard}
      ${startupCard}
    </div>
    ${announcementCard}
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
      <button class="btn btn-ghost btn-sm" onclick="showDiagnostics()">🩺 诊断</button>
      <button class="btn btn-ghost btn-sm" onclick="resetSettings();renderSettings()">恢复默认</button>
    </div>`;
  initDragSort();
  ensureWebAccessLoaded(false);
  ensureStartupSettingLoaded(false);
  ensurePortSettingLoaded(false);
  // Keep focus on the port input across re-renders so typing isn't interrupted.
  var portInput = document.getElementById('portSettingInput');
  if (portInput && document.activeElement !== portInput && portSettingState.inputValue && document.querySelector('.port-setting-row')) {
    // Only refocus if the user just touched it (input value differs from saved).
    var saved = portSettingState.preferredPort == null ? '' : String(portSettingState.preferredPort);
    if (portSettingState.inputValue !== saved) {
      portInput.focus();
      try { portInput.setSelectionRange(portInput.value.length, portInput.value.length); } catch {}
    }
  }
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
    var data = await readApiResponse(res);
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
    var data = await readApiResponse(res);
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

// ── Diagnostics: environment self-check + OCR engine status + recent server logs ──

const ENV_CHECK_BADGE = {
  ok:      { icon: '✅', color: 'var(--success)' },
  fail:    { icon: '❌', color: 'var(--danger)' },
  pending: { icon: '⏳', color: 'var(--text-3)' },
  skip:    { icon: '⏭️', color: 'var(--text-3)' },
};

/** Poll /api/diagnostics/environment until it finishes (or 30s timeout),
 *  then render the warning banner if anything failed.  Triggered on login. */
async function pollEnvironmentCheck() {
  const bannerEl = document.getElementById('envWarning');
  const textEl = document.getElementById('envWarningText');
  if (!bannerEl || !textEl) return;

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('/api/diagnostics/environment');
      const report = await readApiResponse(res);
      if (report && report.finishedAt) {
        renderEnvironmentBanner(report);
        return;
      }
    } catch { /* keep trying */ }
    await new Promise(r => setTimeout(r, 1500));
  }
}

function renderEnvironmentBanner(report) {
  const bannerEl = document.getElementById('envWarning');
  const textEl = document.getElementById('envWarningText');
  if (!bannerEl || !textEl) return;
  const failed = Object.values(report.checks || {}).filter(c => c.status === 'fail');
  if (!failed.length) { bannerEl.style.display = 'none'; return; }
  const labels = failed.map(c => c.label.replace(/\s*\(.+/, '')).join('、');
  textEl.textContent = `检测到 ${failed.length} 项异常: ${labels}`;
  bannerEl.style.display = 'flex';
}

function envCheckListHtml(checks) {
  return Object.values(checks || {}).map(c => {
    const badge = ENV_CHECK_BADGE[c.status] || ENV_CHECK_BADGE.pending;
    const tail = c.status === 'ok' && c.ms != null
      ? `<span style="color:var(--text-3);font-size:11px">· ${c.ms}ms</span>`
      : '';
    const detail = c.detail
      ? `<div style="font-size:11px;color:var(--text-3);margin-left:24px;word-break:break-all">${escapeHtml(c.detail)}</div>`
      : '';
    return `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px;font-size:13px">
        <span style="color:${badge.color}">${badge.icon}</span>
        <span>${escapeHtml(c.label)}</span>
        ${tail}
      </div>
      ${detail}
    </div>`;
  }).join('');
}

async function showDiagnostics() {
  const modalBody = document.getElementById('modalBody');
  const overlay = document.getElementById('modalOverlay');
  modalBody.innerHTML = '<h3 style="margin-bottom:12px">🩺 诊断信息</h3><div style="padding:24px;text-align:center;color:var(--text-3)"><span class="spinner"></span> 加载中…</div>';
  overlay.classList.add('open');

  try {
    const [envRes, ocrRes, hostsRes, logsRes] = await Promise.all([
      fetch('/api/diagnostics/environment').then(r => readApiResponse(r)),
      fetch('/api/diagnostics/ocr').then(r => readApiResponse(r)),
      fetch('/api/diagnostics/hosts').then(r => readApiResponse(r)),
      fetch('/api/diagnostics/logs?limit=100').then(r => readApiResponse(r)),
    ]);
    const env = envRes || {};
    const ocr = ocrRes || {};
    const hosts = (hostsRes && hostsRes.hosts) || {};
    const logs = (logsRes && logsRes.items) || [];

    renderEnvironmentBanner(env);

    const engineLabel = {
      ddddocr: '<span style="color:var(--success)">✅ ddddocr（最优）</span>',
      tesseract: '<span style="color:var(--warning)">⚠️ tesseract（慢，fallback）</span>',
      unavailable: '<span style="color:var(--danger)">❌ ddddocr 不可用，将用 tesseract</span>',
      unknown: '<span style="color:var(--text-3)">尚未触发 OCR</span>',
    }[ocr.engine] || ocr.engine;

    const solveStats = ['ddddocr', 'tesseract'].map(eng => {
      const s = (ocr.solves && ocr.solves[eng]) || { count: 0, avgMs: 0 };
      return `<div><b>${eng}</b>: ${s.count} 次 · 平均 ${s.avgMs}ms</div>`;
    }).join('');

    const logHtml = logs.length === 0
      ? '<div style="color:var(--text-3);padding:8px">暂无日志</div>'
      : logs.map(l => {
          const color = l.level === 'error' ? 'var(--danger)' : l.level === 'warn' ? 'var(--warning)' : 'var(--text-3)';
          const time = l.ts ? l.ts.slice(11, 19) : '';
          return `<div style="padding:3px 0;font:11px 'DM Mono',monospace;border-bottom:1px solid var(--border)"><span style="color:var(--text-3)">${time}</span> <span style="color:${color}">${l.level.toUpperCase()}</span> ${escapeHtml(l.message)}</div>`;
        }).join('');

    modalBody.innerHTML = `
      <h3 style="margin-bottom:14px">🩺 诊断信息</h3>
      <section style="margin-bottom:18px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:12px;color:var(--text-3)">环境自检</div>
          <button class="btn btn-ghost btn-sm" onclick="recheckEnvironment()">重新检查</button>
        </div>
        ${envCheckListHtml(env.checks)}
      </section>
      <section style="margin-bottom:18px">
        <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">OCR 引擎详细</div>
        <div style="font-size:14px;margin-bottom:8px">${engineLabel}</div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.7">
          ${ocr.pythonCommand ? `<div>Python 命令: <code>${escapeHtml(ocr.pythonCommand)}</code></div>` : ''}
          <div>桥接脚本: <code>${escapeHtml(ocr.bridgePath || '?')}</code></div>
          <div>worker PID: <code>${ocr.workerPid ?? '—'}</code></div>
          <div>启动尝试次数: <b>${ocr.startupAttempts ?? 0}</b></div>
          ${ocr.envPath ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:var(--text-3);font-size:11px">查看 PATH 环境变量 (用于排查 python 找不到)</summary><div style="font:11px 'DM Mono',monospace;color:var(--text-3);margin-top:4px;word-break:break-all;max-height:120px;overflow-y:auto">${escapeHtml(ocr.envPath)}</div></details>` : ''}
          ${ocr.lastError ? `<div style="color:var(--danger);word-break:break-all">最近错误: ${escapeHtml(ocr.lastError)}</div>` : ''}
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-2);line-height:1.7">${solveStats}</div>
        ${ocr.engine === 'unavailable' ? '<div style="margin-top:10px;padding:8px 12px;background:oklch(58% 0.20 25 / 0.1);border-left:3px solid var(--danger);font-size:12px;line-height:1.6">⚠️ ddddocr 不可用是 BW 下载慢的主要原因。请确认：<br>1. 已安装 Python 3.8+（命令行能跑 <code>python --version</code>）<br>2. 已执行 <code>pip install ddddocr</code></div>' : ''}
      </section>
      <section style="margin-bottom:18px">
        <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">上游延迟统计（每个 host 最近一次/平均/最大）</div>
        ${Object.keys(hosts).length === 0
          ? '<div style="color:var(--text-3);font-size:12px;padding:4px 0">暂无请求记录</div>'
          : Object.entries(hosts).map(([host, s]) => {
              const slow = s.avgMs > 2000;
              const color = slow ? 'var(--warning)' : s.avgMs > 5000 ? 'var(--danger)' : 'var(--text-2)';
              return `<div style="padding:4px 0;font-size:12px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border)">
                <code style="font-size:11px;color:var(--text-3);min-width:200px">${escapeHtml(host)}</code>
                <span style="color:${color}">avg <b>${s.avgMs}ms</b></span>
                <span style="color:var(--text-3)">max ${s.maxMs}ms</span>
                <span style="color:var(--text-3)">last ${s.lastMs}ms</span>
                <span style="color:var(--text-3)">${s.count}次${s.errors ? ` · <span style="color:var(--danger)">${s.errors}失败</span>` : ''}</span>
              </div>`;
            }).join('')}
      </section>
      <section>
        <div style="font-size:12px;color:var(--text-3);margin-bottom:6px">最近服务端日志（${logs.length} 条）</div>
        <div style="max-height:300px;overflow-y:auto;background:oklch(14% 0.014 255);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border)">${logHtml}</div>
      </section>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="showDiagnostics()">刷新</button>
        <button class="btn btn-primary btn-sm" data-action="modal-close">关闭</button>
      </div>`;
  } catch (e) {
    modalBody.innerHTML = `<h3>诊断信息</h3><p style="color:var(--danger)">加载失败: ${escapeHtml(e.message)}</p><div style="margin-top:14px;text-align:right"><button class="btn btn-primary btn-sm" data-action="modal-close">关闭</button></div>`;
  }
}

async function recheckEnvironment() {
  try {
    await fetch('/api/diagnostics/environment/recheck', { method: 'POST' });
  } catch { /* ignore */ }
  showDiagnostics();
}

function resetSettings() {
  downloadSources = [...DEFAULT_DOWNLOAD_SOURCES];
  downloadConcurrency = DEFAULT_CONCURRENCY;
  downloadPriority = ['gbw', 'by', 'bz'];
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


// ===== Admin announcement management =====
function renderAnnouncementAdminCard() {
  if (!window.currentUser || window.currentUser.role !== 'admin') return '';
  return `
    <div class="setting-section" id="ann-admin-section">
      <div class="field-label">公告管理 <button class="btn btn-sm btn-primary" onclick="showAnnAdminCreate()" style="margin-left:8px">新建公告</button></div>
      <div class="setting-hint">创建后，所有用户在下次登录后首次进入时弹出一次；可随时编辑或停用。</div>
      <div id="annAdminList" class="ann-admin-list">加载中...</div>
    </div>`;
}

async function loadAnnAdminList() {
  const box = document.getElementById('annAdminList');
  if (!box) return;
  try {
    const data = await adminListAnnouncements();
    const items = (data && (data.announcements || data.items)) || [];
    if (!items.length) { box.innerHTML = '<div class="setting-hint">暂无公告</div>'; return; }
    box.innerHTML = items.map(it => {
      const t = escapeHtml ? escapeHtml(it.title || '') : (it.title || '');
      const active = (it.isActive ?? it.is_active) ? '已启用' : '已停用';
      const readCount = (it.readCount ?? it.read_count ?? 0);
      const created = (it.createdAt || it.created_at || '').replace('T', ' ').slice(0, 16);
      return `<div class="ann-admin-item">
        <div>
          <div style="font-weight:600">${t}</div>
          <div class="ann-meta">${active} · 已读 ${readCount} · ${created}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm btn-ghost" onclick='showAnnAdminEdit(${it.id})'>编辑</button>
          <button class="btn btn-sm btn-ghost" onclick='annAdminDelete(${it.id})'>删除</button>
        </div>
      </div>`;
    }).join('');
    window.__annAdminCache = items;
  } catch (e) {
    box.innerHTML = '<div class="setting-hint" style="color:#c00">加载失败: ' + (e.message||e) + '</div>';
  }
}

function showAnnAdminCreate() {
  showAnnAdminForm({ id: 0, title: '', contentMd: '', isActive: 1 });
}
function showAnnAdminEdit(id) {
  const list = window.__annAdminCache || [];
  const item = list.find(x => x.id === id);
  if (!item) return;
  showAnnAdminForm({
    id: item.id,
    title: item.title || '',
    contentMd: item.contentMd || item.content_md || '',
    isActive: (item.isActive ?? item.is_active) ? 1 : 0
  });
}

function showAnnAdminForm(data) {
  const box = document.getElementById('annAdminList');
  if (!box) return;
  const t = data.title || '';
  const c = data.contentMd || '';
  box.insertAdjacentHTML('afterend', `
    <div class="ann-admin-form" id="annAdminForm">
      <input type="text" id="annFormTitle" placeholder="标题" value="${(window.escapeHtml||((x)=>x))(t)}">
      <textarea id="annFormContent" placeholder="Markdown 内容（支持 # 标题 / **粗体** / *斜体* / \`代码\` / [链接](url) / - 列表）">${(window.escapeHtml||((x)=>x))(c)}</textarea>
      <label style="font-size:13px"><input type="checkbox" id="annFormActive" ${data.isActive ? 'checked' : ''}> 启用</label>
      ${data.id ? '<label style="font-size:13px"><input type="checkbox" id="annFormReset"> 重置已读（保存后所有用户会再看到一次）</label>' : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm btn-ghost" onclick="closeAnnAdminForm()">取消</button>
        <button class="btn btn-sm btn-primary" onclick="annAdminSave(${data.id})">保存</button>
      </div>
    </div>`);
}

function closeAnnAdminForm() {
  const f = document.getElementById('annAdminForm');
  if (f) f.remove();
}

async function annAdminSave(id) {
  const title = (document.getElementById('annFormTitle')||{}).value || '';
  const contentMd = (document.getElementById('annFormContent')||{}).value || '';
  const isActive = (document.getElementById('annFormActive')||{}).checked ? 1 : 0;
  if (!title.trim()) { alert('标题不能为空'); return; }
  try {
    if (id) {
      const resetReads = (document.getElementById('annFormReset')||{}).checked || false;
      await adminUpdateAnnouncement(id, { title, contentMd, isActive, resetReads });
    } else {
      await adminCreateAnnouncement({ title, contentMd, isActive });
    }
    closeAnnAdminForm();
    loadAnnAdminList();
  } catch (e) {
    alert('保存失败: ' + (e.message||e));
  }
}

async function annAdminDelete(id) {
  if (!confirm('确认删除该公告？将连同已读记录一并删除。')) return;
  try {
    await adminDeleteAnnouncement(id);
    loadAnnAdminList();
  } catch (e) {
    alert('删除失败: ' + (e.message||e));
  }
}

// Hook: refresh list when settings tab is shown
(function () {
  const _orig = window.renderSettings;
  if (typeof _orig === 'function') {
    window.renderSettings = function () {
      _orig.apply(this, arguments);
      if (window.currentUser && window.currentUser.role === 'admin') {
        setTimeout(loadAnnAdminList, 0);
      }
    };
  }
})();

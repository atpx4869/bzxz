// ── Detail modal ──
function sourceCheckKey(standardNumber) {
  return String(standardNumber || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function relativeCheckTime(ts) {
  if (!ts) return '';
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 5) return '刚刚检测';
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.round(minutes / 60);
  return `${hours}小时前`;
}

function mergeSourceCheckResults(standardNumber, checkedResults) {
  const key = sourceCheckKey(standardNumber);
  if (!key) return;
  const checkedAt = Date.now();
  const enrichedResults = {};
  for (const [source, info] of Object.entries(checkedResults)) {
    enrichedResults[source] = { ...info, checkedAt };
  }
  sourceCheckCache[key] = { ...(sourceCheckCache[key] || {}), ...enrichedResults };
  const result = results.find(r => sourceCheckKey(r.standardNumber) === key);
  if (!result) return;
  result._sourceIds = result._sourceIds || {};
  result._previewAvailableBySource = result._previewAvailableBySource || {};
  result.sources = result.sources || [result._source || result.source].filter(Boolean);
  for (const [source, info] of Object.entries(enrichedResults)) {
    if (info.id) {
      result._sourceIds[source] = info.id;
      if (!result.sources.includes(source)) {
        result.sources.push(source);
        result._multiSource = result.sources.join('+');
      }
    }
    if (info.status === 'text') result._previewAvailableBySource[source] = true;
    if (info.status === 'no_text') result._previewAvailableBySource[source] = false;
  }
  result.previewAvailable = Object.values(result._previewAvailableBySource).some(Boolean);
}

function refreshModalSourcePanel() {
  if (!currentDetailContext) return;
  const panel = document.getElementById('modalSourcePanel');
  if (panel) panel.outerHTML = renderSourceDownloadPanel(currentDetailContext.id, currentDetailContext.detail);
}

async function checkModalSources(source, btn) {
  if (!currentDetailContext) return;
  const detail = currentDetailContext.detail;
  const result = findResultByAnyId(currentDetailContext.id);
  const standardNumber = detail.standardNumber || result?.standardNumber;
  if (!standardNumber) {
    showToast('来源检测失败: 缺少标准号', 'fail');
    return;
  }
  const sources = source ? [source] : ALL_SOURCES;
  const key = sourceCheckKey(standardNumber);
  const pending = {};
  sources.forEach(s => { pending[s] = { status: 'checking' }; });
  sourceCheckCache[key] = { ...(sourceCheckCache[key] || {}), ...pending };
  refreshModalSourcePanel();
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API}/api/standards/source-check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standardNumber, sources }),
    });
    const raw = await res.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { data = { message: raw || `HTTP${res.status}` }; }
    if (!res.ok) throw new Error(data.message || `HTTP${res.status}`);
    mergeSourceCheckResults(standardNumber, data.results || {});
    refreshModalSourcePanel();
    showToast(source ? `${srcLabel(source)} 检测完成` : '来源检测完成');
  } catch (e) {
    const failed = {};
    sources.forEach(s => { failed[s] = { status: 'error', message: (e && e.message) || '检测失败', checkedAt: Date.now() }; });
    sourceCheckCache[key] = { ...(sourceCheckCache[key] || {}), ...failed };
    refreshModalSourcePanel();
    showToast(`来源检测失败: ${(e && e.message) || '未知错误'}`, 'fail');
  }
}

function renderSourceDownloadPanel(id, detail) {
  const result = findResultByAnyId(id);
  const sourceIds = { ...(result?._sourceIds || {}) };
  const detailSource = detail?._source || detail?.source || sourceFromStandardId(detail?.id || id);
  if (detailSource && detail?.id) sourceIds[detailSource] = detail.id;
  const previewBySource = { ...(result?._previewAvailableBySource || {}) };
  if (detailSource && typeof detail?.previewAvailable === 'boolean') previewBySource[detailSource] = detail.previewAvailable;
  const checked = sourceCheckCache[sourceCheckKey(detail?.standardNumber || result?.standardNumber)] || {};
  Object.entries(checked).forEach(([source, info]) => {
    if (info.id) sourceIds[source] = info.id;
    if (info.status === 'text') previewBySource[source] = true;
    if (info.status === 'no_text') previewBySource[source] = false;
  });
  const orderedSources = [...downloadPriority, ...ALL_SOURCES.filter(s => !downloadPriority.includes(s))];
  const defaultId = result?.id || id;
  const defaultPath = downloadPriority.filter(s => downloadSources.includes(s)).map(s => srcLabel(s)).join(' → ') || '未启用';
  const sourceStats = { text: 0, noText: 0, missing: 0, error: 0, unknown: 0 };
  const rows = orderedSources.map(source => {
    const check = checked[source];
    const matched = Boolean(sourceIds[source]);
    const previewKnown = previewBySource[source];
    const isChecking = check?.status === 'checking';
    const statusText = isChecking ? '检测中' :
      check?.status === 'not_found' ? '未匹配' :
      check?.status === 'error' ? '检测失败' :
      previewKnown === true ? '有文本' :
      previewKnown === false ? '无文本' :
      matched ? '未确认' : '未检测';
    if (previewKnown === true) sourceStats.text++;
    else if (previewKnown === false) sourceStats.noText++;
    else if (check?.status === 'not_found') sourceStats.missing++;
    else if (check?.status === 'error') sourceStats.error++;
    else sourceStats.unknown++;
    const statusClass = previewKnown === true ? 'ok' : check?.status === 'error' ? 'bad' : (matched || isChecking) ? 'warn' : 'muted';
    const note = source === 'gbw' ? '自动验证码' : source === 'bzvip' ? '账号池' : source === 'by' ? '直链PDF' : '合成PDF';
    const timeText = relativeCheckTime(check?.checkedAt);
    const extraText = check?.status === 'error' && check.message ? check.message : timeText;
    const canDownload = matched && !isChecking && check?.status !== 'error' && previewKnown !== false;
    const canCheck = !isChecking;
    const downloadText = previewKnown === true ? '下载' : matched ? '尝试下载' : '下载';
    return `
      <div class="modal-source-row ${matched ? '' : 'disabled'} ${isChecking ? 'checking' : ''}">
        <div class="modal-source-main">
          <span class="source-badge source-${escapeHtml(source)}">${escapeHtml(srcLabel(source))}</span>
          <span class="modal-source-note" title="${escapeHtml(extraText || note)}">${note}</span>
        </div>
        <span class="modal-source-note extra" title="${escapeHtml(extraText || '')}">${extraText ? escapeHtml(extraText) : '—'}</span>
        <span class="modal-source-status ${statusClass}">${statusText}</span>
        <div class="modal-source-actions">
          <button class="btn btn-sm btn-ghost" data-action="modal-source-check" data-source="${escapeHtml(source)}" ${canCheck ? '' : 'disabled'}>${isChecking ? '检测中' : '检测'}</button>
          <button class="btn btn-sm ${canDownload ? 'btn-primary' : 'btn-ghost'}" data-action="modal-source-download" data-id="${escapeHtml(defaultId)}" data-source="${escapeHtml(source)}" ${canDownload ? '' : 'disabled'}>${downloadText}</button>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="modal-source-panel" id="modalSourcePanel">
      <div class="modal-source-title-row">
        <div>
          <div class="modal-source-title">来源下载</div>
          <div class="modal-source-subtitle">检测后可按指定来源下载，也可继续使用默认策略。</div>
        </div>
        <div class="modal-source-stats">
          <span class="ok">${sourceStats.text} 有文本</span>
          <span class="${sourceStats.noText ? 'bad' : ''}">${sourceStats.noText} 无文本</span>
          <span>${sourceStats.unknown + sourceStats.missing} 未确认</span>
        </div>
      </div>
      <div class="modal-source-default">
        <div>
          <strong>默认下载</strong>
          <span>${escapeHtml(defaultPath)}</span>
        </div>
        <div class="modal-source-actions">
          <button class="btn btn-sm btn-ghost" data-action="modal-source-check-all">检测全部来源</button>
          <button class="btn btn-sm btn-primary" data-action="modal-download" data-id="${escapeHtml(defaultId)}">按默认策略下载</button>
        </div>
      </div>
      <div class="modal-source-table-head"><span>来源</span><span>最近信息</span><span>状态</span><span>操作</span></div>
      <div class="modal-source-list">${rows}</div>
    </div>`;
}

function detailInfoItem(label, value, options = {}) {
  if (!value) return '';
  const content = options.html ? value : escapeHtml(value);
  return `<div class="detail-info-item">
    <div class="detail-info-label">${escapeHtml(label)}</div>
    <div class="detail-info-value">${content}</div>
  </div>`;
}

function renderDetailModal(id, detail) {
  const result = findResultByAnyId(id);
  const sources = (result?.sources || detail.moreInfo?.sources || detail.sources || [detail._source || detail.source]).filter(Boolean);
  const srcBadges = sources.map(s => `<span class="source-badge source-${escapeHtml(String(s))}">${escapeHtml(srcLabel(String(s)))}</span>`).join(' ');
  const status = detail.status || result?.status || '';
  const detailType = detail.standardType || result?.standardType || '';
  const publishDate = detail.publishDate || result?.publishDate || '';
  const implementDate = detail.implementDate || result?.implementDate || '';
  const infoItems = [
    detailInfoItem('标准名称', detail.title || result?.title),
    detailInfoItem('英文名', detail.contentText || detail.moreInfo?.enName),
    detailInfoItem('标准类型', detailType),
    detailInfoItem('发布日期', publishDate),
    detailInfoItem('实施日期', implementDate),
    detailInfoItem('来源', srcBadges, { html: true }),
    detailInfoItem('来源ID', detail.sourceId),
  ].join('');
  const statusBadge = status ? `<span class="status-indicator ${statusClass(status)}"><span class="dot"></span>${escapeHtml(status)}</span>` : '';
  return `
    <div class="detail-panel">
      <div class="detail-hero">
        <div class="detail-kicker">标准详情</div>
        <div class="detail-title-row">
          <h3>${escapeHtml(detail.standardNumber || result?.standardNumber || '—')}</h3>
          <button class="btn btn-ghost btn-sm" data-action="modal-copy-standard" data-standard="${escapeHtml(detail.standardNumber || result?.standardNumber || '')}">复制</button>
        </div>
        <p class="detail-title">${escapeHtml(detail.title || result?.title || '—')}</p>
        <div class="detail-chips">
          ${statusBadge}
          ${detailType ? `<span class="detail-chip">${escapeHtml(detailType)}</span>` : ''}
          ${publishDate ? `<span class="detail-chip">发布 ${escapeHtml(publishDate)}</span>` : ''}
          ${implementDate ? `<span class="detail-chip">实施 ${escapeHtml(implementDate)}</span>` : ''}
        </div>
      </div>
      <div class="detail-grid">
        <section class="detail-info-card">
          <div class="detail-section-title">基础信息</div>
          <div class="detail-info-grid">${infoItems || '<div class="detail-empty">暂无更多字段</div>'}</div>
        </section>
        ${renderSourceDownloadPanel(id, detail)}
      </div>
      <div class="detail-actions">
        <button class="btn btn-ghost btn-sm" data-action="modal-close">关闭</button>
      </div>
    </div>`;
}

async function showDetail(id) {
  try {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${API}/api/standards/${encodeURIComponent(id)}`, { signal: ctrl.signal });
    clearTimeout(timer); const d = await res.json();
    currentDetailContext = { id, detail: d };
    document.getElementById('modalBody').innerHTML = renderDetailModal(id, d);
    document.getElementById('modalOverlay').classList.add('open');
  } catch (e) {
    currentDetailContext = null;
    document.getElementById('modalBody').innerHTML = `<p style="color:var(--danger)">获取详情失败: ${escapeHtml(e.message)}</p>`;
    document.getElementById('modalOverlay').classList.add('open');
    addLog(`获取详情失败: ${e.message}`, 'fail');
  }
}
document.getElementById('modalClose').addEventListener('click', () => document.getElementById('modalOverlay').classList.remove('open'));
document.getElementById('modalOverlay').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (btn) {
    if (btn.dataset.action === 'modal-download') downloadOne(btn.dataset.id);
    else if (btn.dataset.action === 'modal-source-download') downloadSpecificSource(btn.dataset.id, btn.dataset.source, btn);
    else if (btn.dataset.action === 'modal-source-check') checkModalSources(btn.dataset.source, btn);
    else if (btn.dataset.action === 'modal-source-check-all') checkModalSources('', btn);
    else if (btn.dataset.action === 'modal-retry-batch-failed') retryFailedBatchDownload();
    else if (btn.dataset.action === 'modal-copy-standard') { navigator.clipboard.writeText(btn.dataset.standard || ''); showToast('已复制标准号'); }
    else if (btn.dataset.action === 'modal-close') document.getElementById('modalOverlay').classList.remove('open');
  }
  if (e.target === document.getElementById('modalOverlay')) document.getElementById('modalOverlay').classList.remove('open');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.getElementById('modalOverlay').classList.remove('open'); });

// ── Log ──
let logIdCounter = 0;
let logRenderScheduled = false;
function addLog(msg, status) {
  const now = new Date(new Date().getTime() + 8*3600000);
  const time = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const id = ++logIdCounter;
  logEntries.unshift({ id, time, msg, status });
  if (!logRenderScheduled) {
    logRenderScheduled = true;
    requestAnimationFrame(() => { renderLogs(); logRenderScheduled = false; });
  }
  return id;
}
function updateLog(id, msg, status) {
  const entry = logEntries.find(l => l.id === id);
  if (entry) {
    entry.msg = msg;
    if (status) entry.status = status;
    if (!logRenderScheduled) {
      logRenderScheduled = true;
      requestAnimationFrame(() => { renderLogs(); logRenderScheduled = false; });
    }
  }
}
function renderLogs() {
  const visible = logEntries.slice(0, 50);
  const successCount = logEntries.filter(l => l.status === 'success').length;
  const failCount = logEntries.filter(l => l.status === 'fail').length;
  const pendingCount = logEntries.filter(l => l.status === 'pending').length;
  const summary = logEntries.length ? `
    <div class="log-summary">
      <span><strong>${successCount}</strong> 成功</span>
      <span><strong>${failCount}</strong> 失败</span>
      <span><strong>${pendingCount}</strong> 进行中</span>
    </div>` : '';
  document.getElementById('logBody').innerHTML = summary + visible.map(l =>
    `<div class="log-item ${l.status}"><span class="log-time">${l.time}</span><span class="log-text">${escapeHtml(l.msg)}</span><span class="log-status ${l.status}">${l.status === 'success' ? '成功' : l.status === 'fail' ? '失败' : '进行中'}</span></div>`
  ).join('');
  document.getElementById('logTitle').textContent = `📋 下载日志 (${logEntries.length})`;
}
document.getElementById('logToggle').addEventListener('click', () => {
  const panel = document.getElementById('logPanel');
  panel.classList.toggle('collapsed');
  document.getElementById('logChevron').textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
  // Adjust toast position based on log panel state
  const toastContainer = document.getElementById('toastContainer');
  if (panel.classList.contains('collapsed')) {
    toastContainer.style.bottom = '160px';
  } else {
    toastContainer.style.bottom = '260px';
  }
});

document.getElementById('exportLogs').addEventListener('click', e => {
  e.stopPropagation();
  exportLogs();
});

// ── Utils ──
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
function triggerDownload(fileName) {
  const a = document.createElement('a');
  a.href = `${API}/api/downloads/${encodeURIComponent(fileName)}`;
  a.download = fileName; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => document.body.removeChild(a), 1000);
}
function recordDownload(source, fileName, standardNumber) {
  const now = new Date(new Date().getTime() + 8*3600000);
  const time = `${now.getUTCMonth()+1}/${now.getUTCDate()} ${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
  addDownloadHistory({ source, fileName, standardNumber: standardNumber || fileName, name: fileName, time });
  const key = String(standardNumber || '').replace(/\s+/g, '').toUpperCase();
  const saved = savedStandards.find(s => s.key === key);
  if (saved) {
    saved.downloaded = true;
    saved.fileName = fileName;
    saved.source = source;
    saved.downloadedAt = Date.now();
    persistSavedStandards();
  }
}

function exportLogs() {
  if (!logEntries.length) { showToast('暂无日志可导出', 'fail'); return; }
  const rows = [['时间', '状态', '消息']];
  logEntries.slice().reverse().forEach(l => rows.push([l.time, l.status, l.msg]));
  const csv = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `下载日志_${beijingDate()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`已导出 ${logEntries.length} 条日志`);
}

// ── Search history ──
const SEARCH_HISTORY_KEY = 'bzxz_search_history';
function loadSearchHistory() {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); } catch { return []; }
}
function saveSearchHistory(query) {
  let hist = loadSearchHistory();
  hist = hist.filter(h => h !== query);
  hist.unshift(query);
  const limit = getHistoryLimit(); if (hist.length > limit) hist = hist.slice(0, limit);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(hist));
}
function getHistoryLimit() {
  try { return parseInt(localStorage.getItem('bzxz_history_limit') || '10', 10) || 10; } catch { return 10; }
}
function setHistoryLimit(n) {
  localStorage.setItem('bzxz_history_limit', String(n));
  renderSettings();
}
function renderSearchHistory() {
  const el = document.getElementById('searchHistory');
  const hist = loadSearchHistory().slice(0, getHistoryLimit());
  if (!hist.length) {
    el.innerHTML = '<div class="search-history-empty">暂无搜索记录</div>';
  } else {
    el.innerHTML = hist.map(q => `<div class="search-history-item" data-query="${escapeHtml(q)}"><span class="hist-icon">🕐</span><span class="hist-query">${escapeHtml(q)}</span></div>`).join('');
  }
  el.classList.add('open');
}
function hideSearchHistory() { document.getElementById('searchHistory').classList.remove('open'); }

document.getElementById('searchInput').addEventListener('focus', () => {
  if (!document.getElementById('searchInput').value) renderSearchHistory();
});
document.getElementById('searchInput').addEventListener('blur', () => {
  setTimeout(hideSearchHistory, 150);
});
document.getElementById('searchHistory').addEventListener('click', e => {
  const item = e.target.closest('.search-history-item');
  if (!item) return;
  document.getElementById('searchInput').value = item.dataset.query;
  hideSearchHistory();
  doSearch();
});

// ── Download history ──
const DL_HISTORY_KEY = 'bzxz_dl_history';
let fileLibraryItems = [];
function loadDownloadHistory() {
  try { return JSON.parse(localStorage.getItem(DL_HISTORY_KEY) || '[]'); } catch { return []; }
}
function addDownloadHistory(entry) {
  const hist = loadDownloadHistory();
  hist.unshift(entry);
  if (hist.length > 100) hist.length = 100;
  localStorage.setItem(DL_HISTORY_KEY, JSON.stringify(hist));
}
function clearDownloadHistory() {
  localStorage.removeItem(DL_HISTORY_KEY);
  renderDownloadHistory();
  showToast('历史已清空');
}
function renderDownloadHistory() {
  renderSavedLibrary();
  refreshFileLibrary();
  const hist = loadDownloadHistory();
  const el = document.getElementById('historyList');
  if (!hist.length) { el.innerHTML = '<div style="color:var(--text-3);text-align:center;padding:32px">暂无下载记录</div>'; return; }
  el.innerHTML = hist.map(h => `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border)">
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(h.name || h.standardNumber)}">${escapeHtml(h.name || h.standardNumber)}</span>
    <span style="color:var(--text-3);font-size:11px">${escapeHtml(h.source || '')}</span>
    <span style="color:var(--text-3);font-size:11px">${escapeHtml(h.time || '')}</span>
    ${h.fileName ? `<button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" onclick="triggerDownload('${escapeHtml(h.fileName)}')">重下</button>` : ''}
  </div>`).join('');
}

function renderSavedLibrary() {
  const list = document.getElementById('savedLibraryList');
  const count = document.getElementById('savedLibraryCount');
  if (!list || !count) return;
  count.textContent = String(savedStandards.length);
  if (!savedStandards.length) {
    list.innerHTML = '<div class="library-empty">搜索结果里点“收藏”，常用标准会出现在这里。</div>';
    return;
  }
  list.innerHTML = savedStandards.map(item => `
    <div class="library-item">
      <div class="library-main">
        <strong>${escapeHtml(item.standardNumber || item.key)}</strong>
        <span>${escapeHtml(item.title || item.note || '—')}</span>
        <em>${escapeHtml(item.group || '未分组')} · ${item.downloaded ? '已下载' : '未下载'}</em>
      </div>
      <div class="library-actions">
        ${item.fileName ? `<button class="btn btn-ghost btn-sm" data-download-file="${escapeHtml(item.fileName)}">重下</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="editSavedStandard('${escapeHtml(item.key)}')">备注</button>
        <button class="btn btn-ghost btn-sm" onclick="removeSavedStandard('${escapeHtml(item.key)}')">移除</button>
      </div>
    </div>`).join('');
}

function editSavedStandard(key) {
  const item = savedStandards.find(s => s.key === key);
  if (!item) return;
  const group = prompt('分组', item.group || '');
  if (group === null) return;
  const note = prompt('备注', item.note || item.title || '');
  if (note === null) return;
  item.group = group.trim();
  item.note = note.trim();
  persistSavedStandards();
  renderSavedLibrary();
  showToast('收藏信息已更新');
}

function removeSavedStandard(key) {
  savedStandards = savedStandards.filter(s => s.key !== key);
  persistSavedStandards();
  renderSavedLibrary();
  if (typeof renderResults === 'function') { renderResults(); renderFilterBar(); updateToolbar(); }
}

async function refreshFileLibrary() {
  const list = document.getElementById('fileLibraryList');
  if (!list) return;
  try {
    const res = await fetch('/api/downloads');
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '加载失败');
    fileLibraryItems = data.items || [];
    renderFileLibrary();
  } catch (e) {
    list.innerHTML = `<div class="library-empty fail">文件库加载失败: ${escapeHtml(e.message)}</div>`;
  }
}

function renderFileLibrary() {
  const list = document.getElementById('fileLibraryList');
  const count = document.getElementById('fileLibraryCount');
  if (!list || !count) return;
  const q = (document.getElementById('fileLibrarySearch')?.value || '').trim().toLowerCase();
  const items = fileLibraryItems.filter(f => !q || `${f.fileName} ${f.standardNumber}`.toLowerCase().includes(q));
  count.textContent = String(items.length);
  if (!items.length) {
    list.innerHTML = '<div class="library-empty">暂无匹配文件</div>';
    return;
  }
  list.innerHTML = items.map(f => `
    <div class="library-item">
      <div class="library-main">
        <strong>${escapeHtml(f.standardNumber || f.fileName)}</strong>
        <span title="${escapeHtml(f.fileName)}">${escapeHtml(f.fileName)}</span>
        <em>${escapeHtml(f.source || '本地')} · ${formatSize(f.size)} · ${utcToBeijing(f.mtime)}</em>
      </div>
      <div class="library-actions">
        <button class="btn btn-ghost btn-sm" data-download-file="${escapeHtml(f.fileName)}">下载</button>
        <button class="btn btn-ghost btn-sm" onclick="copyFilePath('${escapeHtml(f.path)}')">路径</button>
        <button class="btn btn-ghost btn-sm danger" onclick="deleteLibraryFile('${escapeHtml(f.fileName)}')">删除</button>
      </div>
    </div>`).join('');
}

function copyFilePath(filePath) {
  navigator.clipboard.writeText(filePath || '');
  showToast('文件路径已复制');
}

async function deleteLibraryFile(fileName) {
  if (!confirm(`删除文件 ${fileName}？`)) return;
  try {
    const res = await fetch(`/api/downloads/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || '删除失败');
    showToast('文件已删除');
    refreshFileLibrary();
  } catch (e) {
    showToast(`删除失败: ${e.message}`, 'fail');
  }
}

// ── Toast ──
function showToast(msg, type, duration) {
  type = type || 'success'; duration = duration || 3000;
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : type === 'fail' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${escapeHtml(msg)}</span><div class="toast-bar" style="animation-duration:${duration}ms"></div>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.2s'; setTimeout(() => toast.remove(), 200); }, duration);
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement === document.body) {
    document.getElementById('shortcutsOverlay').classList.add('open');
  }
  if (e.key === 'Escape') {
    document.getElementById('shortcutsOverlay').classList.remove('open');
    document.getElementById('modalOverlay').classList.remove('open');
    closePanel('batch'); closePanel('complete');
    hideSearchHistory();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    doSearch();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    toggleDownloadCenter();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    const btn = document.getElementById('downloadSelected');
    if (btn && !btn.disabled) btn.click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    setResultDensity(resultDensity === 'compact' ? 'comfortable' : 'compact');
    if (typeof renderSavedToolbar === 'function') renderSavedToolbar();
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-6]$/.test(e.key)) {
    e.preventDefault();
    const tabs = ['search', 'batch', 'complete', 'history', 'qual', 'settings'];
    switchTab(tabs[Number(e.key) - 1]);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'a' && document.activeElement === document.body) {
    e.preventDefault();
    const filtered = getFilteredResults();
    const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));
    filtered.forEach(r => allSelected ? selectedIds.delete(r.id) : selectedIds.add(r.id));
    renderResults(); updateToolbar();
  }
});
document.getElementById('shortcutsOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('shortcutsOverlay')) {
    document.getElementById('shortcutsOverlay').classList.remove('open');
  }
});

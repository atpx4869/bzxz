const API = '';

// ── Settings ──
const ALL_SOURCES = ['gbw', 'bz', 'by', 'bzvip'];
const DEFAULT_DOWNLOAD_SOURCES = ['gbw', 'bz', 'by', 'bzvip'];
const SOURCE_LABELS = { gbw: 'BW', bz: 'BZ', by: 'BY', bzvip: 'BZVIP' };
function srcLabel(s) { return SOURCE_LABELS[s] || s.toUpperCase(); }
const DEFAULT_CONCURRENCY = 3;

const VALID_CONCURRENCY = [1, 2, 3, 4, 5];
const VALID_TIMEOUTS = [10, 15, 20, 30, 60];

let downloadSources = JSON.parse(localStorage.getItem('bzxz_download_sources') || JSON.stringify(DEFAULT_DOWNLOAD_SOURCES));
let downloadConcurrency = (v => VALID_CONCURRENCY.includes(v) ? v : DEFAULT_CONCURRENCY)(parseInt(localStorage.getItem('bzxz_concurrency') || ''));
let downloadPriority = JSON.parse(localStorage.getItem('bzxz_priority') || JSON.stringify(['bzvip', 'gbw', 'by', 'bz']));
let downloadTimeout = (v => VALID_TIMEOUTS.includes(v) ? v : 15)(parseInt(localStorage.getItem('bzxz_timeout') || ''));
let downloadMode = localStorage.getItem('bzxz_download_mode') || 'cascade';
if (!['cascade', 'race'].includes(downloadMode)) downloadMode = 'cascade';
let panelPositions = JSON.parse(localStorage.getItem('bzxz_panel_positions') || '{}');

function saveSettings() {
  localStorage.setItem('bzxz_download_sources', JSON.stringify(downloadSources));
  localStorage.setItem('bzxz_concurrency', String(downloadConcurrency));
  localStorage.setItem('bzxz_priority', JSON.stringify(downloadPriority));
  localStorage.setItem('bzxz_timeout', String(downloadTimeout));
  localStorage.setItem('bzxz_download_mode', downloadMode);
}
function savePanelPositions() {
  try { localStorage.setItem('bzxz_panel_positions', JSON.stringify(panelPositions)); }
  catch { /* quota exceeded — non-critical */ }
}

// ── State ──
let results = [];
let selectedSources = new Set(ALL_SOURCES);
let selectedIds = new Set();
let logEntries = [];
let isDownloading = false;
let searchAborted = false;
let activePanelId = null;
let filterState = { sources: new Set(), statuses: new Set() };
let sourceCheckCache = {};
let currentDetailContext = null;


// ── Panel management (sidebar/tab layout) ──
let activeDrag = null;

function switchTab(tab) {
  // Permission check
  if (currentUser && currentUser.allowed_tabs && tab !== 'users') {
    if (currentUser.allowed_tabs.indexOf(tab) < 0) return;
  }
  document.querySelectorAll('.page').forEach(function(p) { p.style.display = 'none'; });
  var page = document.getElementById('page-' + tab);
  if (page) page.style.display = 'block';
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(function(item) {
    item.classList.toggle('active', item.dataset.tab === tab);
  });
  var titleEl = document.querySelector('.topbar-title');
  if (titleEl) titleEl.textContent = TAB_LABELS[tab] || '标准检索';
  if (tab === 'stats') loadStats();
  if (tab === 'users') loadUsers();
  if (tab === 'history') renderDownloadHistory();
  if (tab === 'settings') renderSettings();
  if (tab === 'batch') updateBatchSourceHint();
  if (tab === 'qual') loadQualLabs();
}
function initRouter() { switchTab("search"); }
function toggleSidebar() { document.body.classList.toggle("sidebar-collapsed"); }

function initPanels() { initRouter(); }

function togglePanel(name) {
  switchTab(name);
}

function openPanel(name) {
  switchTab(name);
}

function closePanel(name) { /* no-op in tab layout */ }

function minimizePanel(name) { /* no-op in tab layout */ }

function activatePanel(name) {
  switchTab(name || "search");
}

function updatePanelZIndices() { /* no-op in tab layout */ }


// ── Source tag init ──
document.querySelectorAll('.source-tag').forEach(tag => {
  const src = tag.dataset.source;
  if (selectedSources.has(src)) tag.classList.add('active'); else tag.classList.remove('active');
  tag.addEventListener('click', () => {
    if (selectedSources.has(src)) { selectedSources.delete(src); tag.classList.remove('active'); }
    else { selectedSources.add(src); tag.classList.add('active'); }
  });
});

// ── Search ──
async function doSearch() {
  if (searchAborted === 'cancelling') return; // already cancelling
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  document.getElementById('searchBtn').innerHTML = '<span class="spinner"></span>取消';
  document.getElementById('searchBtn').disabled = false;
  results = []; selectedIds.clear(); updateToolbar(); searchAborted = false; qualData = {};
  // Show skeleton
  document.getElementById('results').innerHTML = Array.from({ length: 4 }, () =>
    `<div class="skeleton-card"><div class="skeleton-badge skeleton-line"></div><div class="skeleton-body"><div class="skeleton-line w80"></div><div class="skeleton-line w60"></div><div class="skeleton-line w40"></div></div></div>`
  ).join('');
  document.getElementById('toolbar').style.display = 'none';
  saveSearchHistory(q);

  const sources = [...selectedSources];
  const promises = sources.map(src => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    return fetch(`${API}/api/standards/search?q=${encodeURIComponent(q)}&source=${src}`, { signal: ctrl.signal })
      .then(r => r.json()).then(data => ({ ok: true, src, items: (data.items || []).map(i => ({ ...i, _source: src })) }))
      .catch(e => ({ ok: false, src, error: e.name === 'AbortError' ? '超时' : e.message }))
      .finally(() => clearTimeout(timer));
  });

  let receivedCount = 0; const receivedResults = [];
  let qualFetched = false;
  for (const p of promises) {
    const outcome = await p; receivedCount++;
    if (searchAborted) break;
    if (outcome.ok) { receivedResults.push(...outcome.items); addLog(`搜索 ${outcome.src}(${q}) 完成 (+${outcome.items.length} 条)`, 'success'); }
    else { addLog(`搜索 ${outcome.src}(${q}) 失败: ${outcome.error}`, 'fail'); }
    results = dedupeResults(receivedResults); results.sort(sortByStatus);
    document.getElementById('summary').innerHTML = `<span class="count-anim">找到 ${results.length} 条结果 (${receivedCount}/${sources.length} 源)</span>`;
    document.getElementById('toolbar').style.display = results.length > 0 ? 'flex' : 'none';
    if (results.length > 0) renderResults();
    updateToolbar();
    // Fetch qual badges as soon as first source returns (non-blocking)
    if (!qualFetched && results.length > 0) {
      qualFetched = true;
      const stdNums = results.map(r => r.standardNumber).filter(Boolean);
      fetchQualBadges(stdNums).then(() => { if (results.length > 0) renderResults(); });
    }
  }
  if (searchAborted) {
    addLog('搜索已取消', 'fail');
    document.getElementById('summary').innerHTML = `<span class="count-anim">已取消 (${results.length} 条结果)</span>`;
  }
  document.getElementById('searchBtn').innerHTML = '搜索'; document.getElementById('searchBtn').disabled = false;
  // If qual badges weren't fetched yet (no results on first source), fetch now
  if (!qualFetched && results.length > 0) {
    const stdNums = results.map(r => r.standardNumber).filter(Boolean);
    fetchQualBadges(stdNums).then(() => { if (results.length > 0) renderResults(); });
  }
  filterState.sources.clear(); filterState.statuses.clear(); renderFilterBar();
  if (results.length === 0 && !searchAborted) {
    document.getElementById('results').innerHTML = `<div class="empty"><p>—</p><p>未找到相关标准</p><p style="font-size:13px;color:var(--text-3)">尝试更换关键词或数据源</p></div>`;
    document.getElementById('toolbar').style.display = 'none';
  }
}

function dedupeResults(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.standardNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (map.has(key)) {
      const existing = map.get(key);
      if (!existing.sources.includes(item._source)) { existing.sources.push(item._source); existing._multiSource = existing.sources.join('+'); }
      if (!existing.title && item.title) existing.title = item.title;
      if (!existing.publishDate && item.publishDate) existing.publishDate = item.publishDate;
      if (!existing.implementDate && item.implementDate) existing.implementDate = item.implementDate;
      existing._sourceIds = existing._sourceIds || {};
      existing._sourceIds[item._source] = item.id;
      existing._previewAvailableBySource = existing._previewAvailableBySource || {};
      existing._previewAvailableBySource[item._source] = Boolean(item.previewAvailable);
      existing.previewAvailable = Boolean(existing.previewAvailable || item.previewAvailable);
    } else {
      map.set(key, {
        ...item,
        previewAvailable: Boolean(item.previewAvailable),
        sources: [item._source],
        _multiSource: item._source,
        _sourceIds: { [item._source]: item.id },
        _previewAvailableBySource: { [item._source]: Boolean(item.previewAvailable) },
      });
    }
  }
  return [...map.values()];
}

function sortByStatus(a, b) {
  const pa = statusPriority(a.status), pb = statusPriority(b.status);
  if (pa !== pb) return pa - pb;
  if (a.previewAvailable !== b.previewAvailable) return a.previewAvailable ? -1 : 1;
  return 0;
}
function statusPriority(s) {
  if (!s) return 3; if (s.includes('现行')) return 0; if (s.includes('即将实施')) return 1; if (s.includes('废止')) return 4; return 2;
}

document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { hideSearchHistory(); doSearch(); }
  if (e.key === 'Escape') hideSearchHistory();
});
document.getElementById('searchInput').addEventListener('input', () => {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if (!q) { renderSearchHistory(); return; }
  const hist = loadSearchHistory().filter(h => h.toLowerCase().includes(q)).slice(0, 5);
  const el = document.getElementById('searchHistory');
  if (!hist.length) { el.classList.remove('open'); return; }
  el.innerHTML = hist.map(h => `<div class="search-history-item" data-query="${escapeHtml(h)}"><span class="hist-icon">🕐</span><span class="hist-query">${escapeHtml(h)}</span></div>`).join('');
  el.classList.add('open');
});
document.getElementById('searchBtn').addEventListener('click', () => {
  const btn = document.getElementById('searchBtn');
  if (btn.textContent.includes('取消')) {
    searchAborted = true;
    return;
  }
  doSearch();
});

// ── Filter bar ──
function statusCategory(s) {
  if (!s) return '其它';
  if (s.includes('现行') || s.includes('部分有效')) return '现行';
  if (s.includes('废止')) return '废止';
  if (s.includes('即将实施')) return '即将实施';
  return '其它';
}

function getFilteredResults() {
  if (filterState.sources.size === 0 && filterState.statuses.size === 0) return results;
  return results.filter(r => {
    if (filterState.sources.size > 0) {
      const rSources = r.sources || [r._source];
      if (!rSources.some(s => filterState.sources.has(s))) return false;
    }
    if (filterState.statuses.size > 0) {
      if (!filterState.statuses.has(statusCategory(r.status))) return false;
    }
    return true;
  });
}

function renderFilterBar() {
  const bar = document.getElementById('filterBar');
  if (!results.length) { bar.classList.remove('visible'); bar.innerHTML = ''; return; }

  const srcCounts = {}; const statusCounts = {};
  for (const r of results) {
    for (const s of (r.sources || [r._source])) { srcCounts[s] = (srcCounts[s] || 0) + 1; }
    statusCounts[statusCategory(r.status)] = (statusCounts[statusCategory(r.status)] || 0) + 1;
  }

  const srcChips = [
    { key: '', label: '全部', count: results.length },
    ...['bz','gbw','by','bzvip'].map(s => ({ key: s, label: srcLabel(s), count: srcCounts[s] || 0 }))
  ];
  const statusChips = [
    { key: '', label: '全部', count: results.length },
    { key: '现行', label: '现行', count: statusCounts['现行'] || 0 },
    { key: '废止', label: '废止', count: statusCounts['废止'] || 0 },
    { key: '即将实施', label: '即将实施', count: statusCounts['即将实施'] || 0 },
    { key: '其它', label: '其它', count: statusCounts['其它'] || 0 }
  ];

  function chipHtml(chips, set) {
    const allActive = set.size === 0;
    return chips.map(c => {
      const active = c.key === '' ? allActive : set.has(c.key);
      return `<span class="filter-chip${active ? ' active' : ''}" data-filter-type="${set === filterState.sources ? 'source' : 'status'}" data-filter-key="${escapeHtml(c.key)}">${escapeHtml(c.label)}<span class="chip-count">${c.count}</span></span>`;
    }).join('');
  }

  bar.innerHTML = chipHtml(srcChips, filterState.sources) + '<span class="filter-sep"></span>' + chipHtml(statusChips, filterState.statuses);
  bar.classList.add('visible');
}

// ── Render cards ──
function renderResults() {
  const filtered = getFilteredResults();
  const idxMap = new Map(results.map((r, i) => [r.id, i]));
  const header = filtered.length ? `
    <div class="results-table-head">
      <span></span>
      <span>标准号</span>
      <span>标准名称</span>
      <span>状态</span>
      <span>来源</span>
      <span>日期</span>
      <span>操作</span>
    </div>` : '';
  const cards = filtered.map((r, fi) => {
    const i = idxMap.get(r.id);
    const srcBadges = (r.sources || [r._source]).map(s => `<span class="source-badge source-${escapeHtml(String(s))}">${escapeHtml(srcLabel(String(s)))}</span>`).join(' ');
    const sCls = statusClass(r.status); const hasText = r.previewAvailable;
    const statusBadge = r.status ? `<span class="status-indicator ${sCls}"><span class="dot"></span>${escapeHtml(r.status)}</span>` : '';
    const textBadge = !hasText ? '<span class="no-text-badge">无文本</span>' : '<span class="has-text-badge">有文本</span>';
    return `
    <div class="result-card card-enter${hasText ? '' : ' no-text'}" data-sid="${escapeHtml(r.id)}" style="animation-delay:${fi * 40}ms">
      <div class="check-col"><input type="checkbox" data-idx="${i}" ${selectedIds.has(r.id) ? 'checked' : ''}></div>
      <div class="card-id">
        <div class="card-number">${escapeHtml(r.standardNumber)}</div>
      </div>
      <div class="card-body">
        <div class="card-title-row">
          <span class="card-title">${escapeHtml(r.title || '—')}</span>
          ${qualBadgeHtml(r.standardNumber)}
        </div>
        ${r.standardType ? `<div class="card-subtitle">${escapeHtml(r.standardType)}</div>` : ''}
      </div>
      <div class="card-state">
        ${statusBadge || '<span class="card-muted">—</span>'}
        ${textBadge}
      </div>
      <div class="card-source-line">${srcBadges}</div>
      <div class="card-date">
        <span><b>发布</b>${r.publishDate || '—'}</span>
        <span><b>实施</b>${r.implementDate || '—'}</span>
      </div>
      <div class="card-actions">
        <button data-action="detail" data-id="${escapeHtml(r.id)}">详情</button>
        <button data-action="download" data-id="${escapeHtml(r.id)}" ${hasText ? '' : 'disabled'}>下载</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('results').innerHTML = header + cards;
  document.querySelectorAll('input[data-idx]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      const r = results[idx];
      if (!r) return;
      cb.checked ? selectedIds.add(r.id) : selectedIds.delete(r.id);
      updateToolbar();
    });
  });
}

// Filter bar chip clicks
document.getElementById('filterBar').addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  const type = chip.dataset.filterType;
  const key = chip.dataset.filterKey;
  const set = type === 'source' ? filterState.sources : filterState.statuses;
  if (key === '') { set.clear(); }
  else if (set.has(key)) { set.delete(key); }
  else { set.add(key); }
  renderFilterBar(); renderResults(); updateToolbar();
});

// Delegated event handler for result card buttons
document.getElementById('results').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'detail') showDetail(id);
  else if (btn.dataset.action === 'download') downloadOne(id, btn);
});

function setRowDownloadState(id, state) {
  const card = document.querySelector(`.result-card[data-sid="${CSS.escape(id)}"]`);
  if (!card) return;
  const btn = card.querySelector('[data-action="download"]');
  card.classList.remove('download-success', 'download-fail');
  if (state === 'downloading') {
    card.classList.add('downloading');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner" style="display:inline-block"></span>下载中'; }
  } else {
    card.classList.remove('downloading');
    if (state === 'success') card.classList.add('download-success');
    else if (state === 'fail') card.classList.add('download-fail');
    if (btn) { btn.disabled = false; btn.textContent = '下载'; }
    setTimeout(() => card.classList.remove('download-success', 'download-fail'), 2500);
  }
}

function statusClass(s) { if (!s) return ''; if (s.includes('废止')) return 'expired'; if (s.includes('实施')) return 'upcoming'; if (s.includes('现行')) return 'current'; return ''; }

// ── Toolbar ──
function updateToolbar() {
  document.getElementById('selectedCount').textContent = `已选 ${selectedIds.size}`;
  const dlBtn = document.getElementById('downloadSelected');
  if (dlBtn) dlBtn.disabled = selectedIds.size === 0 || isDownloading;
}
document.getElementById('selectAll').addEventListener('click', () => {
  const filtered = getFilteredResults();
  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));
  filtered.forEach(r => allSelected ? selectedIds.delete(r.id) : selectedIds.add(r.id));
  renderResults(); updateToolbar();
});

document.getElementById('exportResults').addEventListener('click', () => {
  const data = getFilteredResults();
  if (!data.length) { showToast('没有可导出的结果', 'fail'); return; }
  const rows = [['标准号', '标准名称', '状态', '来源', '发布日期', '实施日期']];
  data.forEach(r => {
    rows.push([r.standardNumber, r.title, r.status || '', (r.sources || [r._source]).join('+'), r.publishDate || '', r.implementDate || '']);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `搜索结果_${beijingDate()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast(`已导出 ${data.length} 条结果`);
});

// ── Download functions ──
let downloadAborted = false;

function findResultByAnyId(id) {
  return results.find(r => r.id === id || (r._sourceIds && Object.values(r._sourceIds).includes(id)));
}

function sourceFromStandardId(id) {
  return String(id || '').split(':')[0];
}

function getSourceIdForDownload(result, source, fallbackId) {
  if (result && result._sourceIds && result._sourceIds[source]) return result._sourceIds[source];
  if (fallbackId && sourceFromStandardId(fallbackId) === source) return fallbackId;
  if (result && result.source === source) return result.id;
  return '';
}

async function readApiResponse(res) {
  const raw = await res.text();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { return { message: raw }; }
}

function downloadErrorMessage(label, res, data) {
  const meta = data?.meta || {};
  const base = meta.error || data?.message || data?.error || data?.status || `HTTP${res.status}`;
  const suffix = res.ok ? '' : ` (HTTP${res.status})`;
  return `${label} ${base}${suffix}`;
}

async function downloadOne(id, btn) {
  const r = findResultByAnyId(id); if (!r) return;
  downloadAborted = false;
  const sources = (r.sources || [r._source]).filter(s => downloadSources.includes(s));
  if (!sources.length) { addLog(`${r.standardNumber} 无可用下载源`, 'fail'); return; }
  setRowDownloadState(r.id, 'downloading');
  const logId = addLog(`${r.standardNumber} 竞速 [${sources.map(s => srcLabel(s)).join('+')}]`, 'pending');
  try {
    const winner = await Promise.any(sources.map(s => raceSource(r.id, s, r.standardNumber, (msg) => updateLog(logId, msg, 'pending'))));
    const sizeStr = winner.fileSize ? ` ${formatSize(winner.fileSize)}` : '';
    updateLog(logId, `${r.standardNumber} ✅ ${srcLabel(winner.source)}胜出 ${winner.fileName}${sizeStr}`, 'success');
    setRowDownloadState(r.id, 'success');
    if (winner.fileName) { triggerDownload(winner.fileName); recordDownload(winner.source, winner.fileName, r.standardNumber); }
    showToast(`${srcLabel(winner.source)} 下载完成: ${winner.fileName || r.standardNumber}`);
  } catch (e) {
    const msgs = e instanceof AggregateError ? [...new Set(e.errors.map(err => err.message))].slice(0, 3).join('; ') : (e.message || '未知错误');
    updateLog(logId, `${r.standardNumber} ❌ ${msgs}`, 'fail');
    setRowDownloadState(r.id, 'fail');
    showToast(`下载失败: ${msgs}`, 'fail', 7000);
  }
}

async function downloadSpecificSource(id, source, btn) {
  const r = findResultByAnyId(id);
  const srcId = getSourceIdForDownload(r, source, id);
  const label = r?.standardNumber || id;
  const rowId = r?.id || id;
  if (!srcId) { addLog(`${label} 未匹配 ${srcLabel(source)} 源`, 'fail'); return; }
  downloadAborted = false;
  const originalText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '下载中'; }
  setRowDownloadState(rowId, 'downloading');
  const logId = addLog(`${label} 指定 ${srcLabel(source)} 下载...`, 'pending');
  try {
    const result = await raceSource(srcId, source, label, (msg) => updateLog(logId, msg, 'pending'));
    const sizeStr = result.fileSize ? ` ${formatSize(result.fileSize)}` : '';
    updateLog(logId, `${label} ✅ ${srcLabel(result.source)} ${result.fileName || ''}${sizeStr}`, 'success');
    setRowDownloadState(rowId, 'success');
    if (result.fileName) { triggerDownload(result.fileName); recordDownload(result.source, result.fileName, label); }
    showToast(`${srcLabel(result.source)} 下载完成: ${result.fileName || label}`);
  } catch (e) {
    const msg = (e && e.message) || '下载失败';
    const sourceLabel = srcLabel(source);
    const displayMsg = msg.startsWith(`${sourceLabel} `) ? msg.slice(sourceLabel.length + 1) : msg;
    updateLog(logId, `${label} ❌ ${sourceLabel} ${displayMsg}`, 'fail');
    setRowDownloadState(rowId, 'fail');
    showToast(`${sourceLabel} 下载失败: ${displayMsg}`, 'fail', 7000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = originalText || '下载'; }
  }
}

function raceSource(standardId, source, label, onProgress) {
  // Use source-specific ID if available (from multi-source search dedup)
  const r = findResultByAnyId(standardId);
  const srcId = (r && r._sourceIds && r._sourceIds[source]) || standardId;
  switch (source) {
    case 'gbw': return downloadGbw(srcId, onProgress);
    case 'bz':  return downloadBz(srcId, onProgress);
    case 'by':    return downloadBy(srcId, onProgress);
    case 'bzvip': return downloadBzVip(srcId, onProgress);
    default: return Promise.reject(new Error(`Unknown source ${source}`));
  }
}

async function downloadGbw(id, onProgress) {
  if (onProgress) onProgress('BW 识别验证码...');
  const res = await fetch(`${API}/api/standards/${encodeURIComponent(id)}/auto-download`, { method: 'POST' });
  const data = await readApiResponse(res);
  if (!res.ok) throw new Error(downloadErrorMessage('BW', res, data));
  if (data.status === 'downloaded') {
    const meta = data.meta || {};
    return { source: 'gbw', fileName: meta.fileName || data.fileName || '', fileSize: meta.fileSize };
  }
  throw new Error(downloadErrorMessage('BW', res, data));
}

async function downloadBz(id, onProgress) {
  const res = await fetch(`${API}/api/standards/${encodeURIComponent(id)}/export`, { method: 'POST' });
  const data = await readApiResponse(res);
  if (!res.ok) throw new Error(downloadErrorMessage('BZ', res, data));
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${API}/api/tasks/${data.id}/stream`);
    const timeout = setTimeout(() => { es.close(); reject(new Error('BZ轮询超时')); }, 120000);
    es.onmessage = (e) => {
      const td = JSON.parse(e.data);
      if (td.currentPage && td.totalPages && onProgress) onProgress(`BZ 下载 ${td.currentPage}/${td.totalPages} 页`);
      if (td.status === 'success') { clearTimeout(timeout); es.close(); const elapsed = ((Date.now() - t0) / 1000).toFixed(1); const sizeStr = td.fileSize ? ` ${formatSize(td.fileSize)}` : ''; resolve({ source: 'bz', fileName: td.fileName || '', fileSize: td.fileSize, meta: `${elapsed}s${sizeStr}` }); }
      if (td.status === 'failed') { clearTimeout(timeout); es.close(); reject(new Error(`BZ ${td.errorMessage || '失败'}`)); }
    };
    es.onerror = () => { clearTimeout(timeout); es.close(); reject(new Error('BZ SSE连接失败')); };
  });
}

async function downloadBy(id, onProgress) {
  const res = await fetch(`${API}/api/standards/${encodeURIComponent(id)}/export`, { method: 'POST' });
  const data = await readApiResponse(res);
  if (!res.ok) throw new Error(downloadErrorMessage('BY', res, data));
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const es = new EventSource(`${API}/api/tasks/${data.id}/stream`);
    const timeout = setTimeout(() => { es.close(); reject(new Error('BY轮询超时')); }, 60000);
    es.onmessage = (e) => {
      const td = JSON.parse(e.data);
      if (td.status === 'running' && onProgress) onProgress('BY 下载中...');
      if (td.status === 'success') { clearTimeout(timeout); es.close(); const elapsed = ((Date.now() - t0) / 1000).toFixed(1); const sizeStr = td.fileSize ? ` ${formatSize(td.fileSize)}` : ''; resolve({ source: 'by', fileName: td.fileName || '', fileSize: td.fileSize, meta: `${elapsed}s${sizeStr}` }); }
      if (td.status === 'failed') { clearTimeout(timeout); es.close(); reject(new Error(`BY ${td.errorMessage || '失败'}`)); }
    };
    es.onerror = () => { clearTimeout(timeout); es.close(); reject(new Error('BY SSE连接失败')); };
  });
}

async function downloadBzVip(id, onProgress) {
  if (onProgress) onProgress('BZVIP 下载中...');
  const res = await fetch(`${API}/api/standards/${encodeURIComponent(id)}/auto-download`, { method: 'POST' });
  const data = await readApiResponse(res);
  if (!res.ok) throw new Error(downloadErrorMessage('BZVIP', res, data));
  if (data.status === 'downloaded') {
    const meta = data.meta || {};
    return { source: 'bzvip', fileName: meta.fileName || data.fileName || '', fileSize: meta.fileSize };
  }
  throw new Error(downloadErrorMessage('BZVIP', res, data));
}

function stopAllDownloads() { downloadAborted = true; addLog('⏹ 中止下载', 'fail'); }

document.getElementById('downloadSelected').addEventListener('click', async () => {
  if (isDownloading) return;
  isDownloading = true; downloadAborted = false;
  document.getElementById('downloadSelected').disabled = true;
  document.getElementById('stopDownload').style.display = 'inline-block';
  const selected = results.filter(r => selectedIds.has(r.id));
  const total = selected.length; let completed = 0, success = 0, failed = 0; const wins = {};
  const t0 = Date.now();
  const progress = document.getElementById('progressWrap'); const fill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  progress.classList.add('visible');
  const queue = [...selected];
  const started = Date.now();
  function updateProgress() {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    fill.style.width = `${(completed / total) * 100}%`;
    progressText.textContent = `${completed}/${total} · ${downloadConcurrency}并发 · ${elapsed}s`;
  }
  async function worker() {
    while (queue.length > 0 && !downloadAborted) {
      const item = queue.shift();
      const sources = (item.sources || [item._source]).filter(s => downloadSources.includes(s));
      if (!sources.length) { completed++; failed++; updateProgress(); continue; }
      setRowDownloadState(item.id, 'downloading');
      const logId = addLog(`${item.standardNumber} 竞速 [${sources.map(s => srcLabel(s)).join('+')}]`, 'pending');
      try {
        const winner = await Promise.any(sources.map(s => raceSource(item.id, s, item.standardNumber, (msg) => updateLog(logId, msg, 'pending'))));
        success++; wins[winner.source] = (wins[winner.source] || 0) + 1;
        const sizeStr = winner.fileSize ? ` ${formatSize(winner.fileSize)}` : '';
        updateLog(logId, `${item.standardNumber} ✅ ${srcLabel(winner.source)}胜出 ${winner.fileName}${sizeStr}`, 'success');
        setRowDownloadState(item.id, 'success');
        if (winner.fileName) { triggerDownload(winner.fileName); recordDownload(winner.source, winner.fileName, item.standardNumber); }
      } catch (e) {
        failed++;
        const msgs = e instanceof AggregateError ? [...new Set(e.errors.map(err => err.message))].slice(0, 3).join('; ') : (e.message || '未知错误');
        updateLog(logId, `${item.standardNumber} ❌ ${msgs}`, 'fail');
        setRowDownloadState(item.id, 'fail');
      }
      completed++; updateProgress();
    }
  }
  const workers = Array.from({ length: downloadConcurrency }, () => worker());
  await Promise.all(workers);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const winSummary = Object.entries(wins).map(([k, v]) => `${srcLabel(k)}:${v}`).join(' ');
  addLog(`完成 ${success}/${total} · ${elapsed}s · ${winSummary || '无'}`, 'success');
  if (success > 0) showToast(`下载完成 ${success}/${total} · ${elapsed}s`);
  setTimeout(() => { progress.classList.remove('visible'); fill.style.width = '0%'; progressText.textContent = ''; }, 2000);
  document.getElementById('stopDownload').style.display = 'none'; isDownloading = false; updateToolbar();
});
document.getElementById('stopDownload').addEventListener('click', stopAllDownloads);

// ── Batch download (floating panel) ──
let batchResolved = [], batchUnmatched = [], batchDownloading = false, batchAborted = false;

function updateBatchSourceHint() {
  const sources = downloadPriority.filter(s => downloadSources.includes(s));
  const labels = { bzvip: 'BZVIP', gbw: 'BW', by: 'BY', bz: 'BZ' };
  const el = document.getElementById('batchSourceHint');
  if (downloadMode === 'race') {
    if (el) el.textContent = `竞速模式：${sources.map(s => labels[s]||s).join(' + ')} 同时发起（超时 ${downloadTimeout}s）`;
  } else {
    if (el) el.textContent = `级联顺序：${sources.map(s => labels[s]||s).join(' → ')}（超时 ${downloadTimeout}s）`;
  }
}

async function doBatchResolve() {
  const raw = document.getElementById('batchInput').value;
  const lines = raw.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { addLog('请粘贴标准号', 'fail'); return; }
  document.getElementById('batchResolveBtn').disabled = true;
  document.getElementById('batchResolveBtn').innerHTML = '<span class="spinner"></span>解析中';
  document.getElementById('batchSummary').innerHTML = '解析中...';
  document.getElementById('batchResults').innerHTML = '<div class="batch-results-empty">正在按来源优先级匹配标准号...</div>';
  batchResolved = []; batchUnmatched = [];
  try {
    const sources = downloadPriority.filter(s => downloadSources.includes(s));
    const res = await fetch(`${API}/api/standards/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines, sources }) });
    const data = await res.json();
    batchResolved = data.resolved || []; batchUnmatched = data.unmatched || [];
    document.getElementById('batchSummary').innerHTML = `解析完成 · 匹配 ${batchResolved.length} / 未匹配 ${batchUnmatched.length} / 总计 ${lines.length}`;
    renderBatchResults();
    addLog(`批量解析: ${batchResolved.length} 匹配, ${batchUnmatched.length} 未匹配`, 'success');
  } catch (e) {
    document.getElementById('batchSummary').innerHTML = `<span style="color:var(--danger)">解析失败</span>`;
    document.getElementById('batchResults').innerHTML = `<div class="batch-results-empty fail">解析失败: ${escapeHtml(e.message)}</div>`;
    addLog(`解析失败: ${e.message}`, 'fail');
  }
  document.getElementById('batchResolveBtn').disabled = false;
  document.getElementById('batchResolveBtn').innerHTML = '解析标准号';
}

function renderBatchResults() {
  const total = batchResolved.length + batchUnmatched.length;
  const summary = total ? `
    <div class="batch-stats">
      <div class="batch-stat"><strong>${batchResolved.length}</strong><span>已匹配</span></div>
      <div class="batch-stat ${batchUnmatched.length ? 'warn' : ''}"><strong>${batchUnmatched.length}</strong><span>未匹配</span></div>
      <div class="batch-stat"><strong>${total}</strong><span>总计</span></div>
    </div>` : '';
  const resolvedCards = batchResolved.map((r, i) => `
    <div class="batch-result-card">
      <input type="checkbox" id="br_${i}" data-batch-index="${i}" checked onchange="updateBatchToolbar()">
      <span class="card-num" title="${escapeHtml(r.standardNumber)}">${escapeHtml(r.standardNumber)}</span>
      <span class="card-title" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</span>
      <span class="card-src">${srcLabel(r.source)}</span>
    </div>`).join('');
  const unmatchedCards = batchUnmatched.map(u => `
    <div class="batch-result-card unmatched">
      <span class="card-num">${escapeHtml(u.input)}</span>
      <span class="card-title">${escapeHtml(u.reason)}</span>
    </div>`).join('');
  const toolbar = batchResolved.length > 0 ? `
    <div class="batch-toolbar">
      <span class="badge-count" id="batchSelectedCount">已选 ${batchResolved.length}</span>
      <button class="btn btn-sm btn-primary" id="batchDownloadBtn" onclick="doBatchDownload()">${downloadMode === 'race' ? '竞速下载选中' : '级联下载选中'}</button>
      <button class="btn btn-sm btn-ghost" id="batchStopBtn" onclick="stopBatchDownload()" style="display:none;color:var(--danger);border-color:var(--danger)">停止</button>
      <button class="btn btn-sm btn-ghost" onclick="toggleBatchSelect()">全选/取消</button>
    </div>` : '';
  document.getElementById('batchResults').innerHTML = summary + toolbar + `<div class="batch-results-list">${resolvedCards + unmatchedCards}</div>`;
  updateBatchSourceHint();
}

function toggleBatchSelect() {
  const checks = document.querySelectorAll('#batchResults input[type="checkbox"]');
  const allChecked = [...checks].every(c => c.checked);
  checks.forEach(c => { c.checked = !allChecked; });
  updateBatchToolbar();
}

function updateBatchToolbar() {
  const checks = document.querySelectorAll('#batchResults input[type="checkbox"]:checked');
  const el = document.getElementById('batchSelectedCount');
  if (el) el.textContent = `已选 ${checks.length}`;
}

async function doBatchDownload() {
  if (downloadMode === 'race') return doRaceDownload();
  return doCascadeDownload();
}

async function doCascadeDownload() {
  if (batchDownloading) return;
  batchDownloading = true; batchAborted = false;
  const checks = document.querySelectorAll('#batchResults input[type="checkbox"]:checked');
  const items = []; checks.forEach(c => { items.push(batchResolved[Number(c.dataset.batchIndex)]); });
  if (!items.length) { batchDownloading = false; return; }
  document.getElementById('batchDownloadBtn').disabled = true;
  document.getElementById('batchStopBtn').style.display = 'inline-block';
  document.getElementById('batchProgressWrap').classList.add('visible');
  const fill = document.getElementById('batchProgressFill'); fill.style.width = '0%';
  const progressText = document.getElementById('batchProgressText');
  const sources = downloadPriority.filter(s => downloadSources.includes(s));
  const total = items.length; let completed = 0, success = 0; const successItems = [], allFailedItems = [];
  const t0 = Date.now();
  function updateProgress() {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    fill.style.width = `${Math.round((completed / total) * 100)}%`;
    progressText.textContent = `${completed}/${total} · ${downloadConcurrency}并发 · ${elapsed}s`;
  }

  addLog(`━━ 后端自动切源下载 (${items.length}条, 优先级: ${sources.map(s => srcLabel(s)).join(' → ')})`, 'pending');
  const queue = [...items];
  async function worker() {
    while (queue.length > 0 && !batchAborted) {
      const item = queue.shift();
      setRowDownloadState(item.standardId, 'downloading');
      const logId = addLog(`${item.standardNumber} 下载中...`, 'pending');
      try {
        // Build sourceIds map for this item
        const r = results.find(r => r.id === item.standardId);
        const sourceIds = {};
        sources.forEach(s => {
          const srcId = (r && r._sourceIds && r._sourceIds[s]) || (s === item.source ? item.standardId : null);
          if (srcId) sourceIds[s] = srcId;
        });
        const resp = await fetch(`${API}/api/standards/multi-download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceIds, sources }),
        });
        const data = await resp.json();
        if (resp.ok && data.status === 'downloaded') {
          const sizeStr = data.fileSize ? ` ${formatSize(data.fileSize)}` : '';
          updateLog(logId, `${item.standardNumber} ✅ ${srcLabel(data.source)} ${data.fileName || ''}${sizeStr}`, 'success');
          setRowDownloadState(item.standardId, 'success');
          success++; successItems.push(item);
          if (data.fileName) { triggerDownload(data.fileName); recordDownload(data.source, data.fileName, item.standardNumber); }
        } else {
          const errMsg = data.message || (data.errors ? Object.values(data.errors).join('; ') : '下载失败');
          updateLog(logId, `${item.standardNumber} ❌ ${errMsg}`, 'fail');
          setRowDownloadState(item.standardId, 'fail');
          allFailedItems.push(item);
        }
      } catch (e) {
        updateLog(logId, `${item.standardNumber} ❌ ${(e && e.message) || '请求失败'}`, 'fail');
        setRowDownloadState(item.standardId, 'fail');
        allFailedItems.push(item);
      }
      completed++; updateProgress();
    }
  }
  const workers = Array.from({ length: downloadConcurrency }, () => worker());
  await Promise.all(workers);
  const finalFailed = items.filter(it => !successItems.some(s => s.standardId === it.standardId));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  addLog(`━━ 批量下载完成: ${success}/${total} 成功 (${elapsed}s)`, 'success');
  if (success > 0) showToast(`批量完成 ${success}/${total} · ${elapsed}s`);
  showBatchResultModal(successItems, allFailedItems, finalFailed, elapsed);
  batchDownloading = false;
  document.getElementById('batchDownloadBtn').disabled = false;
  document.getElementById('batchStopBtn').style.display = 'none';
}

async function doRaceDownload() {
  if (batchDownloading) return;
  batchDownloading = true; batchAborted = false;
  const checks = document.querySelectorAll('#batchResults input[type="checkbox"]:checked');
  const items = []; checks.forEach(c => { items.push(batchResolved[Number(c.dataset.batchIndex)]); });
  if (!items.length) { batchDownloading = false; return; }
  document.getElementById('batchDownloadBtn').disabled = true;
  document.getElementById('batchStopBtn').style.display = 'inline-block';
  document.getElementById('batchProgressWrap').classList.add('visible');
  const fill = document.getElementById('batchProgressFill'); fill.style.width = '0%';
  const progressText = document.getElementById('batchProgressText');
  const sources = downloadPriority.filter(s => downloadSources.includes(s));
  const total = items.length; let completed = 0, success = 0; const successItems = [], allFailedItems = [], wins = {};
  const t0 = Date.now();
  function updateProgress() {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    fill.style.width = `${Math.round((completed / total) * 100)}%`;
    progressText.textContent = `${completed}/${total} · ${downloadConcurrency}并发 · ${elapsed}s`;
  }
  const queue = [...items];
  async function worker() {
    while (queue.length > 0 && !batchAborted) {
      const item = queue.shift();
      setRowDownloadState(item.standardId, 'downloading');
      const sourceList = (sources.length > 0 ? sources : ['bzvip']).filter(s => downloadSources.includes(s));
      const logId = addLog(`${item.standardNumber} 竞速 [${sourceList.map(s => srcLabel(s)).join('+')}]`, 'pending');
      try {
        const winner = await Promise.any(sourceList.map(s => raceSourceWithTimeout(item.standardId, s, item.standardNumber, downloadTimeout * 1000, (msg) => updateLog(logId, msg, 'pending'))));
        success++; successItems.push(item); wins[winner.source] = (wins[winner.source] || 0) + 1;
        const sizeStr = winner.fileSize ? ` ${formatSize(winner.fileSize)}` : '';
        updateLog(logId, `${item.standardNumber} ✅ ${srcLabel(winner.source)}胜出 ${winner.fileName}${sizeStr}`, 'success');
        setRowDownloadState(item.standardId, 'success');
        if (winner.fileName) { triggerDownload(winner.fileName); recordDownload(winner.source, winner.fileName, item.standardNumber); }
      } catch (e) {
        allFailedItems.push(item);
        const msgs = e instanceof AggregateError ? [...new Set(e.errors.map(err => err.message))].slice(0, 3).join('; ') : (e.message || '未知错误');
        updateLog(logId, `${item.standardNumber} ❌ ${msgs}`, 'fail');
        setRowDownloadState(item.standardId, 'fail');
      }
      completed++; updateProgress();
    }
  }
  const workers = Array.from({ length: downloadConcurrency }, () => worker());
  await Promise.all(workers);
  const finalFailed = items.filter(it => !successItems.some(s => s.standardId === it.standardId));
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const winSummary = Object.entries(wins).map(([k, v]) => `${srcLabel(k)}:${v}`).join(' ');
  addLog(`━━ 竞速完成: ${success}/${total} 成功 [${winSummary}] (${elapsed}s)`, 'success');
  if (success > 0) showToast(`竞速完成 ${success}/${total} · ${elapsed}s`);
  showBatchResultModal(successItems, allFailedItems, finalFailed, elapsed);
  batchDownloading = false;
  document.getElementById('batchDownloadBtn').disabled = false;
  document.getElementById('batchStopBtn').style.display = 'none';
}

function stopBatchDownload() { batchAborted = true; addLog('⏹ 中止批量下载', 'fail'); }

function raceSourceWithTimeout(standardId, source, label, timeoutMs, onProgress) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const p = raceSource(standardId, source, label, onProgress);
    p.then(
      result => { clearTimeout(timer); resolve(result); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}

function showBatchResultModal(successItems, allFailedItems, finalFailed, elapsed) {
  const total = successItems.length + finalFailed.length;
  const successRows = successItems.map(it => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;border-bottom:1px solid var(--border)">
      <span style="color:var(--success)">✅</span>
      <span style="font:500 13px 'DM Mono',monospace;color:var(--accent);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(it.standardNumber)}</span>
    </div>`).join('');
  const failRows = finalFailed.map(it => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;border-bottom:1px solid var(--border)">
      <span style="color:var(--danger)">❌</span>
      <span style="font:500 13px 'DM Mono',monospace;color:var(--text-3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(it.standardNumber)}</span>
    </div>`).join('');
  document.getElementById('modalBody').innerHTML = `
    <h3 style="margin-bottom:16px">📊 批量下载结果</h3>
    <div style="display:flex;gap:16px;margin-bottom:20px">
      <div style="flex:1;text-align:center;padding:12px;background:oklch(68% 0.16 158 / 0.08);border-radius:var(--radius-sm)">
        <div style="font-size:24px;font-weight:600;color:var(--success)">${successItems.length}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">成功</div>
      </div>
      <div style="flex:1;text-align:center;padding:12px;background:oklch(58% 0.20 25 / 0.08);border-radius:var(--radius-sm)">
        <div style="font-size:24px;font-weight:600;color:var(--danger)">${finalFailed.length}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">失败</div>
      </div>
      <div style="flex:1;text-align:center;padding:12px;background:var(--surface-h);border-radius:var(--radius-sm)">
        <div style="font-size:24px;font-weight:600;color:var(--text)">${total}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">总计</div>
      </div>
      <div style="flex:1;text-align:center;padding:12px;background:var(--surface-h);border-radius:var(--radius-sm)">
        <div style="font-size:24px;font-weight:600;color:var(--text-2)">${elapsed}s</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">耗时</div>
      </div>
    </div>
    ${successItems.length > 0 ? `<div style="margin-bottom:8px;font-size:12px;color:var(--success);font-weight:500">成功条目 (${successItems.length})</div><div style="max-height:240px;overflow-y:auto;margin-bottom:16px">${successRows}</div>` : ''}
    ${finalFailed.length > 0 ? `<div style="margin-bottom:8px;font-size:12px;color:var(--danger);font-weight:500">失败条目 (${finalFailed.length})</div><div style="max-height:200px;overflow-y:auto;margin-bottom:16px">${failRows}</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-primary btn-sm" data-action="modal-close">关闭</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('open');
}

// ── Standard completion ──
function onCompleteFileSelected() {
  const input = document.getElementById('completeFileInput');
  const file = input.files?.[0];
  document.getElementById('completeFileName').textContent = file ? file.name : '未选择文件';
  document.getElementById('completeUploadBtn').disabled = !file;
  document.getElementById('completeSummary').innerHTML = '';
  document.getElementById('completeDownload').innerHTML = '';
}

async function doComplete() {
  const input = document.getElementById('completeFileInput');
  const file = input.files?.[0]; if (!file) return;
  const btn = document.getElementById('completeUploadBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>处理中';
  try {
    const form = new FormData(); form.append('file', file);
    form.append('sources', JSON.stringify(downloadPriority.filter(s => downloadSources.includes(s))));
    const res = await fetch(`${API}/api/standards/complete`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    document.getElementById('completeSummary').innerHTML = `补全完成：<span style="color:var(--success)">匹配 ${data.summary.resolved}</span> / <span style="color:var(--danger)">未匹配 ${data.summary.unmatched}</span> / 总计 ${data.summary.total}`;
    const dlUrl = data.downloadUrl;
    if (dlUrl && !dlUrl.startsWith('/')) throw new Error('Invalid download URL');
    document.getElementById('completeDownload').innerHTML = `<a class="btn btn-primary btn-sm" href="${escapeHtml(API + dlUrl)}" download="${escapeHtml(data.fileName)}" style="text-decoration:none;display:inline-block">⬇ 下载结果</a>`;
    addLog(`标准补全: ${data.summary.resolved}/${data.summary.total} 匹配`, 'success');
  } catch (e) {
    document.getElementById('completeSummary').innerHTML = `<span style="color:var(--danger)">处理失败: ${escapeHtml(e.message)}</span>`;
    addLog(`标准补全失败: ${e.message}`, 'fail');
  }
  btn.disabled = false; btn.innerHTML = '上传并补全';
}

// ── Settings (floating panel) ──
const SETTINGS_LABELS = { gbw: 'BW源', bz: 'BZ源', by: 'BY源', bzvip: 'BZvip源' };
const SETTINGS_NOTES = { gbw: '自动验证码 5~15s', bz: '合成PDF 30~90s', by: '直链PDF 2~5s', bzvip: '账号池 2~5s' };

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
}

var sourceStatusCache = {};
async function checkAllSources() {
  var btn = document.getElementById('checkSourcesBtn');
  btn.textContent = '检测中...'; btn.disabled = true;
  document.getElementById('sourceStatusList').innerHTML = renderSourceStatusLoading();
  try {
    var res = await fetch('/api/standards/check-sources');
    var data = await res.json();
    sourceStatusCache = data.results || {};
    document.getElementById('sourceStatusList').innerHTML = renderSourceStatusList();
  } catch (e) {
    document.getElementById('sourceStatusList').innerHTML = '<span style="color:var(--danger)">检测请求失败</span>';
  }
  btn.textContent = '全部检测'; btn.disabled = false;
}

async function checkSingleSource(src) {
  var el = document.getElementById('ss-' + src);
  if (el) el.innerHTML = '<span class="spinner" style="width:12px;height:12px"></span>';
  try {
    var res = await fetch('/api/standards/check-sources?sources=' + src);
    var data = await res.json();
    Object.assign(sourceStatusCache, data.results || {});
  } catch { sourceStatusCache[src] = { status: 'error', ms: 0, error: '请求失败' }; }
  if (el) el.innerHTML = renderSourceStatusItem(src);
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
          <span class="modal-source-note" title="${escapeHtml(extraText || note)}">${note}${extraText ? ` · ${escapeHtml(extraText)}` : ''}</span>
        </div>
        <span class="modal-source-status ${statusClass}">${statusText}</span>
        <div class="modal-source-actions">
          <button class="btn btn-sm btn-ghost" data-action="modal-source-check" data-source="${escapeHtml(source)}" ${canCheck ? '' : 'disabled'}>${isChecking ? '检测中' : '检测'}</button>
          <button class="btn btn-sm ${canDownload ? 'btn-primary' : 'btn-ghost'}" data-action="modal-source-download" data-id="${escapeHtml(defaultId)}" data-source="${escapeHtml(source)}" ${canDownload ? '' : 'disabled'}>${downloadText}</button>
        </div>
      </div>`;
  }).join('');
  return `
    <div class="modal-source-panel" id="modalSourcePanel">
      <div class="modal-source-title">来源下载</div>
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

// ── Auth ──
let currentUser = null;
let isRegisterMode = false;
let trendChart = null;
let sourceChart = null;

// Global fetch 401 interceptor
const _origFetch = window.fetch;
window.fetch = function(...args) {
  return _origFetch.apply(this, args).then(res => {
    if (res.status === 401 && !args[0]?.toString().includes('/api/auth/')) {
      currentUser = null;
      document.getElementById('authOverlay').classList.remove('hidden');
    }
    return res;
  });
};

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'same-origin' });
  if (res.status === 401) {
    currentUser = null;
    document.getElementById('authOverlay').classList.remove('hidden');
    throw new Error('未登录');
  }
  return res;
}

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    if (data.user) {
      currentUser = data.user;
      document.getElementById('authOverlay').classList.add('hidden');
      onAuthReady();
    } else if (data.needsSetup) {
      isRegisterMode = true;
      document.getElementById('authTitle').textContent = 'bzxz · 初始化注册';
      document.getElementById('authSubmitBtn').textContent = '注册';
      document.getElementById('authToggle').textContent = '';
      document.getElementById('authOverlay').classList.remove('hidden');
    } else if (!data.loginRequired) {
      // Login not required — use guest
      currentUser = { id: 0, username: '_guest', display_name: '访客', role: 'user', allowed_tabs: null };
      document.getElementById('authOverlay').classList.add('hidden');
      onAuthReady();
    } else {
      // Show/hide register toggle based on setting
      document.getElementById('authToggle').textContent = data.registrationEnabled ? '没有账号？注册' : '';
      document.getElementById('authOverlay').classList.remove('hidden');
    }
  } catch { document.getElementById('authOverlay').classList.remove('hidden'); }
}

function onAuthReady() {
  document.getElementById('udHeader').innerHTML = `${currentUser.display_name || currentUser.username} <span>${currentUser.role}</span>`;
  document.getElementById('sidebarUserName').textContent = currentUser.display_name || currentUser.username;
  document.getElementById('sidebarUserRole').textContent = currentUser.role;
  document.getElementById('udManageUsers').style.display = 'none';
  document.getElementById('udChangePwd').style.display = currentUser.username === '_guest' ? 'none' : '';
  var sb = document.getElementById('sidebarUsersBtn');
  if (sb) sb.style.display = 'none';
  if (currentUser.role === 'admin') {
    document.getElementById('udManageUsers').style.display = '';
    if (sb) sb.style.display = '';
  }
  // Apply per-user tab permissions
  applyTabPermissions();
  // Default stats date range: last 30 days
  const today = beijingDate();
  const monthAgo = new Date(new Date().getTime() + 8*3600000 - 30 * 86400000).toISOString().slice(0, 10);
  document.getElementById('statsTo').value = today;
  document.getElementById('statsFrom').value = monthAgo;
  initPanels();
}

var TAB_LABELS = {search:'标准检索',batch:'批量下载',complete:'标准补全',history:'下载历史',qual:'资质查询',stats:'使用统计',users:'用户管理',settings:'系统设置'};

function applyTabPermissions() {
  var allowed = currentUser.allowed_tabs; // null = all allowed
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
  errEl.textContent = '';
  const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.message || '操作失败'; return; }
    currentUser = data.user;
    document.getElementById('authOverlay').classList.add('hidden');
    onAuthReady();
  } catch { errEl.textContent = '网络错误'; }
});

document.getElementById('authToggle').addEventListener('click', () => {
  if (!document.getElementById('authToggle').textContent) return;
  isRegisterMode = !isRegisterMode;
  document.getElementById('authTitle').textContent = isRegisterMode ? 'bzxz · 注册' : 'bzxz · 登录';
  document.getElementById('authSubmitBtn').textContent = isRegisterMode ? '注册' : '登录';
  document.getElementById('authToggle').textContent = isRegisterMode ? '已有账号？登录' : '没有账号？注册';
  document.getElementById('authError').textContent = '';
});

async function doLogout() {
  await fetch('/api/auth/session', { method: 'DELETE' });
  currentUser = null;
  document.getElementById('userDropdown').classList.remove('open');
  document.getElementById('authOverlay').classList.remove('hidden');
}

function toggleUserDropdown() {
  document.getElementById('userDropdown').classList.toggle('open');
}

function showChangePwd() {
  document.getElementById('userDropdown').classList.remove('open');
  const oldPwd = prompt('请输入原密码');
  if (!oldPwd) return;
  const newPwd = prompt('请输入新密码（至少6位）');
  if (!newPwd || newPwd.length < 6) { alert('密码至少6位'); return; }
  apiFetch('/api/auth/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
  }).then(r => r.json()).then(d => {
    if (d.ok) alert('密码已修改');
    else alert(d.message || '修改失败');
  });
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
      apiFetch(`/api/stats/summary?${params}`).then(r => r.json()),
      apiFetch(`/api/stats/timeseries?${params}`).then(r => r.json()),
      apiFetch(`/api/stats/by-source?${params}`).then(r => r.json()),
    ]);

    // Summary cards
    const typeMap = { search: '搜索', download: '下载', batch_resolve: '批量解析', complete: '补全' };
    let html = `<div class="stat-card"><div class="stat-value">${summaryRes.total}</div><div class="stat-label">总操作数</div></div>`;
    html += `<div class="stat-card"><div class="stat-value">${summaryRes.uniqueUsers}</div><div class="stat-label">活跃用户</div></div>`;
    for (const item of summaryRes.byType) {
      html += `<div class="stat-card"><div class="stat-value">${item.count}</div><div class="stat-label">${typeMap[item.event_type] || item.event_type}</div></div>`;
    }
    document.getElementById('statsSummary').innerHTML = html;

    // Trend chart
    const dates = [...new Set(tsRes.data.map(r => r.date))].sort();
    const types = [...new Set(tsRes.data.map(r => r.event_type))];
    const colors = { search: '#3b82f6', download: '#10b981', batch_resolve: '#f59e0b', complete: '#8b5cf6' };
    const datasets = types.map(t => ({
      label: typeMap[t] || t,
      data: dates.map(d => { const row = tsRes.data.find(r => r.date === d && r.event_type === t); return row ? row.count : 0; }),
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
    const srcLabels = srcRes.data.map(r => r.source);
    const srcCounts = srcRes.data.map(r => r.count);
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

async function loadUsers() {
  try {
    const [usersRes, settingsRes] = await Promise.all([
      apiFetch('/api/admin/users').then(r => r.json()),
      apiFetch('/api/admin/settings').then(r => r.json()),
    ]);
    document.getElementById('regEnabledToggle').checked = settingsRes.registration_enabled;
    document.getElementById('loginRequiredToggle').checked = settingsRes.login_required;
    const data = usersRes;
    let html = '';
    for (const u of data.users) {
      const roleBadge = u.role === 'admin' ? '<span class="badge badge-admin">管理员</span>' : '<span class="badge badge-user">用户</span>';
      const statusBadge = u.is_active ? '<span class="badge badge-active">启用</span>' : '<span class="badge badge-inactive">禁用</span>';
      const toggleLabel = u.is_active ? '禁用' : '启用';
      const roleLabel = u.role === 'admin' ? '降为用户' : '升为管理员';
      const checked = selectedUserIds.has(u.id) ? 'checked' : '';
      html += `<tr>
        <td><input type="checkbox" data-uid="${u.id}" ${checked} onchange="toggleUserSelect(${u.id},this.checked)"></td>
        <td>${u.username}</td>
        <td>${u.display_name || '—'}</td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
        <td>${u.search_count}</td>
        <td>${u.download_count}</td>
        <td class="users-actions">
          <button onclick="showUserDetail(${u.id},'${u.username}')">明细</button>
          <button onclick="showUserPerms(${u.id},'${u.username}',${encodeURIComponent(JSON.stringify(u.allowed_tabs))})">权限</button>
          <button onclick="toggleUserActive(${u.id},${u.is_active ? 0 : 1})">${toggleLabel}</button>
          <button onclick="changeUserRole(${u.id},'${u.role === 'admin' ? 'user' : 'admin'}')">${roleLabel}</button>
          <button style="color:var(--danger)" onclick="deleteUser(${u.id},'${u.username}')">删除</button>
        </td>
      </tr>`;
    }
    document.getElementById('usersBody').innerHTML = html;
    updateBatchBar();
  } catch (e) { console.error('Users load error:', e); }
}

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
  if (!confirm('确定' + label + '选中的 ' + ids.length + ' 个用户？')) return;
  await Promise.all(ids.map(id =>
    apiFetch('/api/admin/users/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !!active }),
    })
  ));
  selectedUserIds.clear();
  showToast('已' + label + ' ' + ids.length + ' 个用户');
  loadUsers();
}

async function batchDeleteUsers() {
  const ids = [...selectedUserIds];
  if (!ids.length) return;
  if (!confirm('确定删除选中的 ' + ids.length + ' 个用户？此操作不可恢复')) return;
  await Promise.all(ids.map(id => apiFetch('/api/admin/users/' + id, { method: 'DELETE' })));
  selectedUserIds.clear();
  showToast('已删除 ' + ids.length + ' 个用户');
  loadUsers();
}

function showDefaultPerms() {
  var modal = document.getElementById('modalBody');
  var overlay = document.getElementById('modalOverlay');
  // Load current default from settings
  apiFetch('/api/admin/settings').then(r => r.json()).then(function(s) {
    var defaults = s.default_allowed_tabs; // null = all allowed
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
    body: JSON.stringify({ default_allowed_tabs: tabs }),
  });
  document.getElementById('modalOverlay').classList.remove('open');
  showToast('默认权限已保存');
}

async function toggleUserActive(id, active) {
  await apiFetch(`/api/admin/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: !!active }),
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

async function deleteUser(id, username) {
  if (!confirm('确定删除用户「' + username + '」？此操作不可恢复')) return;
  const res = await apiFetch('/api/admin/users/' + id, { method: 'DELETE' });
  const d = await res.json();
  if (d.ok) { showToast('用户已删除'); loadUsers(); }
  else showToast(d.message || '删除失败', 'fail');
}

function toggleRegistration(enabled) {
  apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registration_enabled: enabled }),
  }).then(r => r.json()).then(d => {
    document.getElementById('regEnabledToggle').checked = d.registration_enabled;
  });
}

function toggleLoginRequired(enabled) {
  apiFetch('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_required: enabled }),
  }).then(r => r.json()).then(d => {
    document.getElementById('loginRequiredToggle').checked = d.login_required;
  });
}

async function showCreateUser() {
  const username = prompt('用户名（至少2位）');
  if (!username || username.length < 2) return;
  const password = prompt('密码（至少6位）');
  if (!password || password.length < 6) { alert('密码至少6位'); return; }
  // Fetch default permissions
  let allowed_tabs = null;
  try {
    const s = await apiFetch('/api/admin/settings').then(r => r.json());
    allowed_tabs = s.default_allowed_tabs; // null = all
  } catch { /* keep null */ }
  apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, allowed_tabs }),
  }).then(r => r.json()).then(d => {
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
  { key: 'stats', label: '使用统计', desc: '查看使用数据' },
  { key: 'settings', label: '系统设置', desc: '下载模式和参数' },
];

function showUserPerms(userId, username, encodedTabs) {
  var allowed = JSON.parse(decodeURIComponent(encodedTabs)); // null = all allowed
  var modal = document.getElementById('modalBody');
  var overlay = document.getElementById('modalOverlay');
  var html = '<h3 style="margin-bottom:12px;font-size:16px">功能权限 — ' + username + '</h3>';
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
    body: JSON.stringify({ allowed_tabs: tabs }),
  });
  document.getElementById('modalOverlay').classList.remove('open');
  loadUsers();
}

async function showUserDetail(userId, username) {
  const modal = document.getElementById('modalBody');
  const overlay = document.getElementById('modalOverlay');
  modal.innerHTML = '<p style="color:var(--text-3)">加载中...</p>';
  overlay.classList.add('open');
  try {
    const res = await apiFetch(`/api/admin/users/${userId}/events`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.message || '加载失败');

    const typeLabels = { search: '搜索', download: '下载', batch_resolve: '批量解析', complete: '补全' };
    const typeColors = { search: 'var(--accent)', download: 'var(--success)', batch_resolve: 'var(--warn)', complete: '#a78bfa' };

    let summaryHtml = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin:12px 0">';
    const total = d.summary.reduce((s, r) => s + r.count, 0);
    summaryHtml += `<div style="padding:8px 14px;border-radius:8px;background:oklch(25% 0.01 250 / 0.5);text-align:center"><div style="font-size:20px;font-weight:600;color:var(--text)">${total}</div><div style="font-size:11px;color:var(--text-3)">总计</div></div>`;
    for (const s of d.summary) {
      const color = typeColors[s.event_type] || 'var(--text-2)';
      summaryHtml += `<div style="padding:8px 14px;border-radius:8px;background:oklch(25% 0.01 250 / 0.5);text-align:center"><div style="font-size:20px;font-weight:600;color:${color}">${s.count}</div><div style="font-size:11px;color:var(--text-3)">${typeLabels[s.event_type] || s.event_type}</div></div>`;
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
        const time = e.created_at ? utcToBeijing(e.created_at) : '—';
        const typeLabel = typeLabels[e.event_type] || e.event_type;
        const color = typeColors[e.event_type] || 'var(--text-2)';
        listHtml += `<tr>
          <td style="font-size:12px;white-space:nowrap">${time}</td>
          <td><span style="color:${color};font-size:12px">${typeLabel}</span></td>
          <td>${e.source ? srcLabel(e.source) : '—'}</td>
          <td style="font-size:12px">${e.standard_id ? escapeHtml(e.standard_id) : '—'}</td>
        </tr>`;
      }
      listHtml += '</tbody></table></div>';
    } else {
      listHtml = '<p style="color:var(--text-3);font-size:13px;margin-top:8px">暂无使用记录</p>';
    }

    modal.innerHTML = `<h3>用户: ${escapeHtml(d.user.display_name || d.user.username)}</h3>
      ${summaryHtml}${sourceHtml}${listHtml}
      <button class="btn btn-ghost btn-sm" style="margin-top:12px" data-action="modal-close">关闭</button>`;
  } catch (e) {
    modal.innerHTML = `<p style="color:var(--danger)">加载失败: ${escapeHtml(e.message)}</p>`;
  }
}

// ── Qualification ──
let qualSearchSource = '';
let qualData = {}; // stdCode -> Qualification[] (from search result badges)
function beijingDate() { const d = new Date(new Date().getTime() + 8*3600000); return d.toISOString().slice(0, 10); }
function beijingTime() { const d = new Date(new Date().getTime() + 8*3600000); return d.toISOString().slice(0, 19).replace('T', ' '); }
function utcToBeijing(utcStr) { if (!utcStr) return ''; const d = new Date(utcStr); d.setTime(d.getTime() + 8*3600000); return d.toISOString().slice(0, 16).replace('T', ' '); }

function switchQualTab(tab) {
  document.querySelectorAll('.qual-tab').forEach(t => {
    const active = t.dataset.qualTab === tab;
    t.classList.toggle('active', active);
    t.style.color = active ? 'var(--text)' : 'var(--text-3)';
    t.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
  });
  document.getElementById('qualSearchTab').style.display = tab === 'search' ? '' : 'none';
  document.getElementById('qualLabsTab').style.display = tab === 'labs' ? '' : 'none';
  document.getElementById('qualLogsTab').style.display = tab === 'logs' ? '' : 'none';
  if (tab === 'labs') { loadQualLabs(); loadLabsSyncLogs(); }
  if (tab === 'logs') loadQualSyncLogs('cnas');
}

function setQualFilter(btn, source) {
  qualSearchSource = source;
  btn.closest('.qual-filters').querySelectorAll('.qual-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
  doQualSearch();
}

async function doQualSearch() {
  const q = document.getElementById('qualSearchInput').value.trim();
  if (!q) { document.getElementById('qualResults').innerHTML = '<div class="qual-empty">输入关键词搜索资质信息</div>'; return; }
  document.getElementById('qualResults').innerHTML = '<span class="spinner"></span>';
  try {
    const url = `/api/qualifications/search?q=${encodeURIComponent(q)}${qualSearchSource ? '&source=' + qualSearchSource : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    renderQualSearchResults(data.items || []);
  } catch (e) {
    document.getElementById('qualResults').innerHTML = `<div class="qual-empty" style="color:var(--danger)">搜索失败: ${escapeHtml(e.message)}</div>`;
  }
}

function renderQualSearchResults(items) {
  if (!items.length) { document.getElementById('qualResults').innerHTML = '<div class="qual-empty">未找到匹配的资质信息</div>'; return; }

  // Split by source
  const cnasItems = items.filter(it => it.source === 'CNAS');
  const cmaItems = items.filter(it => it.source === 'CMA');

  const now = beijingDate();

  function buildColumn(title, color, colItems) {
    if (!colItems.length) return '<div class="qual-col"><div class="qual-col-header" style="border-left:3px solid ' + color + '">' + title + '</div><div class="qual-empty" style="padding:20px 0">无匹配结果</div></div>';
    // Group by stdCode
    const groups = {};
    for (const it of colItems) {
      if (!groups[it.stdCode]) groups[it.stdCode] = { stdName: it.stdName, items: [] };
      const g = groups[it.stdCode];
      const key = (it.category || '') + '|' + (it.testItem || '') + '|' + (it.testStandard || '');
      if (!g.seen) g.seen = new Set();
      if (g.seen.has(key)) continue;
      g.seen.add(key);
      g.items.push(it);
    }
    let html = '';
    let groupIdx = 0;
    // Strip duplicated standard code from stdName (e.g. "家具... GB 18584-2024" -> "家具...")
    function cleanStdName(code, name) {
      if (!name) return '';
      // Remove trailing standard code like " GB 18584-2024" or " GB/T 1234-2020"
      var escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return name.replace(new RegExp('\\s*' + escaped + '\\s*$', 'i'), '').trim()
                 .replace(new RegExp('^\\s*' + escaped + '\\s*', 'i'), '').trim() || name;
    }
    for (const [code, g] of Object.entries(groups)) {
      const gid = 'qg_' + title + '_' + (groupIdx++);
      const cleanName = cleanStdName(code, g.stdName);
      const rows = g.items.map(it => {
        const expired = it.expiryDate && it.expiryDate < now;
        const parts = [];
        if (it.category) {
          const cats = it.category.split('-').map(s => s.trim()).filter(Boolean);
          parts.push('<div style="margin-bottom:3px">' + cats.map(c => '<span style="display:inline-block;padding:1px 5px;background:var(--surface-h);border-radius:3px;font-size:10px;color:var(--text-2);margin-right:3px;margin-bottom:2px">' + escapeHtml(c) + '</span>').join('') + '</div>');
        }
        if (it.testItem) {
          parts.push('<div style="font-size:12px;color:var(--text);line-height:1.4"><span style="color:var(--text-3);font-size:10px">检测项目 </span>' + escapeHtml(it.testItem.length > 80 ? it.testItem.slice(0, 80) + '…' : it.testItem) + '</div>');
        }
        if (it.limitDesc && it.limitDesc !== '/' && it.limitDesc !== '—') {
          parts.push('<div style="font-size:11px;color:var(--warning);margin-top:2px">限定: ' + escapeHtml(it.limitDesc.length > 60 ? it.limitDesc.slice(0, 60) + '…' : it.limitDesc) + '</div>');
        }
        const dates = [];
        if (it.effectiveDate) dates.push('<span style="color:' + (expired ? 'var(--danger)' : 'var(--success)') + '">生效 ' + escapeHtml(it.effectiveDate) + '</span>');
        if (it.expiryDate) dates.push('<span style="color:' + (expired ? 'var(--danger)' : 'var(--text-2)') + '">' + (expired ? '已过期 ' : '到期 ') + escapeHtml(it.expiryDate) + '</span>');
        if (dates.length) parts.push('<div style="font-size:11px;margin-top:3px">' + dates.join(' · ') + '</div>');
        return '<div class="qual-result-item">' + parts.join('') + '</div>';
      }).join('');
      html += '<div class="qual-result-group">'
        + '<div class="qual-result-std" onclick="toggleQualGroup(\'' + gid + '\')" style="cursor:pointer">'
        + '<span class="qual-group-arrow" id="' + gid + '_arrow" style="display:inline-block;width:16px;font-size:10px;color:var(--text-3);transition:transform 0.2s">▶</span>'
        + escapeHtml(code) + '<span class="qual-std-name">' + escapeHtml(cleanName) + '</span>'
        + '<span style="float:right;font-size:11px;color:var(--text-3)">' + g.items.length + ' 项</span>'
        + '</div>'
        + '<div id="' + gid + '_body" style="display:none">' + rows + '</div>'
        + '</div>';
    }
    return '<div class="qual-col"><div class="qual-col-header" style="border-left:3px solid ' + color + '">' + title + ' <span style="font-size:11px;color:var(--text-3)">' + Object.keys(groups).length + ' 个标准 · ' + colItems.length + ' 条</span></div>' + html + '</div>';
  }

  const totalCount = items.length;
  const header = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    + '<span style="font-size:11px;color:var(--text-3)">共 ' + totalCount + ' 条资质</span>'
    + '<span style="display:flex;gap:8px">'
    + '<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px" onclick="toggleAllQualGroups(true)">全部展开</button>'
    + '<button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px" onclick="toggleAllQualGroups(false)">全部收起</button>'
    + '</span></div>';
  const content = '<div class="qual-results-grid">' + buildColumn('CMA', '#f59e0b', cmaItems) + buildColumn('CNAS', '#3b82f6', cnasItems) + '</div>';
  document.getElementById('qualResults').innerHTML = header + content;
}

function toggleAllQualGroups(expand) {
  document.querySelectorAll('#qualResults [id$="_body"]').forEach(function(el) {
    el.style.display = expand ? '' : 'none';
  });
  document.querySelectorAll('#qualResults .qual-group-arrow').forEach(function(el) {
    el.style.transform = expand ? 'rotate(90deg)' : '';
  });
}

function toggleQualGroup(gid) {
  var body = document.getElementById(gid + '_body');
  var arrow = document.getElementById(gid + '_arrow');
  if (!body) return;
  if (body.style.display === 'none') {
    body.style.display = '';
    arrow.style.transform = 'rotate(90deg)';
  } else {
    body.style.display = 'none';
    arrow.style.transform = '';
  }
}

// ── Qual Lab Management ──
async function loadQualLabs() {
  try {
    const [cnasRes, cmaRes] = await Promise.all([fetch('/api/cnas/labs'), fetch('/api/cma/labs')]);
    const cnasLabs = await cnasRes.json();
    const cmaLabs = await cmaRes.json();
    renderQualLabs('cnas', cnasLabs);
    renderQualLabs('cma', cmaLabs);
  } catch (e) { /* silent */ }
}

function renderQualLabs(type, labs) {
  const container = document.getElementById(type === 'cnas' ? 'qualCnasLabs' : 'qualCmaLabs');
  if (!labs.length) { container.innerHTML = '<div style="color:var(--text-3);font-size:12px;padding:8px 0">暂无订阅</div>'; return; }
  const nameField = type === 'cnas' ? 'lab_name' : 'lab_name';
  const idField = type === 'cnas' ? 'lab_no' : 'cert_number';
  const statusColors = { success: 'var(--success)', syncing: 'var(--warning)', error: 'var(--danger)' };
  container.innerHTML = labs.map(lab => {
    const statusColor = statusColors[lab.sync_status] || 'var(--text-3)';
    const syncInfo = lab.last_sync_at ? `<span>${utcToBeijing(lab.last_sync_at)}</span>` : '<span style="color:var(--text-3)">未同步</span>';
    return `<div class="qual-lab-card">
      <div class="qual-lab-header">
        <div class="qual-lab-name">${escapeHtml((lab[nameField] && !/^[?]+$/.test(lab[nameField]) && lab[nameField].length > 1) ? lab[nameField] + '（' + lab[idField] + '）' : lab[idField])}</div>
        <div class="qual-lab-actions">
          <button onclick="editQualLabName('${type}','${escapeHtml(lab[idField])}',${JSON.stringify(lab[nameField] || '').replace(/"/g, '&quot;')})">编辑</button>
          <button onclick="syncQualLab('${type}','${escapeHtml(lab[idField])}')">同步</button>
          <button class="danger" onclick="deleteQualLab('${type}','${escapeHtml(lab[idField])}')">删除</button>
        </div>
      </div>
      <div class="qual-lab-meta">
        <div>状态: <span style="color:${statusColor}">${lab.sync_status || '—'}</span> | 记录: <span>${lab.record_count}</span> | 上次同步: ${syncInfo}</div>
        ${lab.sync_error ? `<div style="color:var(--danger);font-size:11px">${escapeHtml(lab.sync_error)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function addQualLab(type) {
  const input = document.getElementById(type === 'cnas' ? 'qualCnasInput' : 'qualCmaInput');
  const val = input.value.trim();
  if (!val) return;
  try {
    let body;
    if (type === 'cnas') {
      // Try parsing as URL
      const parsed = val.includes('://') ? CnasScraper_parseUrl(val) : null;
      if (parsed) {
        body = { lab_no: parsed.labNo, base_info_id: parsed.baseInfoId, cert_update_ts: parsed.certUpdateTs, validate: parsed.validate };
      } else {
        body = { lab_no: val };
      }
      const res = await fetch('/api/cnas/labs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
    } else {
      body = { cert_number: val };
      const res = await fetch('/api/cma/labs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
    }
    input.value = '';
    loadQualLabs();
    showToast(`已添加 ${type.toUpperCase()} 实验室`);
  } catch (e) {
    showToast(`添加失败: ${e.message}`, 'fail');
  }
}

async function editQualLabName(type, id, currentName) {
  const newName = prompt('输入机构名称', currentName || '');
  if (newName === null) return;
  const url = type === 'cnas' ? `/api/cnas/labs/${encodeURIComponent(id)}` : `/api/cma/labs/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lab_name: newName }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
    loadQualLabs();
    showToast('名称已更新');
  } catch (e) {
    showToast(`更新失败: ${e.message}`, 'fail');
  }
}

function CnasScraper_parseUrl(url) {
  try {
    const u = new URL(url);
    const p = u.searchParams;
    const baseInfoId = p.get('baseInfoId');
    const licNo = p.get('licNo');
    if (!baseInfoId || !licNo) return null;
    return { baseInfoId, labNo: licNo, certUpdateTs: p.get('certUpdateTs') || '', validate: p.get('validate') || '' };
  } catch { return null; }
}

async function deleteQualLab(type, id) {
  if (!confirm(`确定删除 ${id} 及其所有资质数据？`)) return;
  const url = type === 'cnas' ? `/api/cnas/labs/${encodeURIComponent(id)}` : `/api/cma/labs/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).message);
    loadQualLabs();
    showToast('已删除');
  } catch (e) { showToast(`删除失败: ${e.message}`, 'fail'); }
}

async function syncQualLab(type, id) {
  const url = type === 'cnas' ? `/api/cnas/sync?lab_no=${encodeURIComponent(id)}` : `/api/cma/sync?cert_number=${encodeURIComponent(id)}`;
  showToast(`正在同步 ${id}…`);
  try {
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    loadQualLabs();
    loadLabsSyncLogs();
    showToast(`同步完成: ${data.records} 条记录`);
  } catch (e) { showToast(`同步失败: ${e.message}`, 'fail'); }
}

async function syncAllQualLabs() {
  showToast('正在同步全部实验室…');
  try {
    const [cnasRes, cmaRes] = await Promise.all([
      fetch('/api/cnas/sync', { method: 'POST' }),
      fetch('/api/cma/sync', { method: 'POST' }),
    ]);
    await cnasRes.json(); await cmaRes.json();
    loadQualLabs();
    loadLabsSyncLogs();
    showToast('全部同步完成');
  } catch (e) { showToast(`同步失败: ${e.message}`, 'fail'); }
}

// ── Qual Sync Logs ──
let qualLogSource = 'cnas';

function switchLogSource(btn, source) {
  qualLogSource = source;
  btn.parentElement.querySelectorAll('.qual-filter-btn').forEach(b => {
    b.classList.toggle('active', b === btn);
  });
  loadQualSyncLogs(source);
}

async function loadQualSyncLogs(source) {
  try {
    const res = await fetch(`/api/${source}/sync-logs?limit=30`);
    const logs = await res.json();
    const container = document.getElementById('qualSyncLogs');
    if (!logs.length) { container.innerHTML = '<div style="color:var(--text-3);padding:16px 0;text-align:center">暂无同步记录</div>'; return; }
    const statusColors = { success: 'var(--success)', error: 'var(--danger)' };
    container.innerHTML = logs.map(l => {
      const time = utcToBeijing(l.started_at);
      const idField = l.lab_no || l.cert_number || '';
      return `<div class="qual-sync-log">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><span style="color:var(--text)">${escapeHtml(idField)}</span> ${escapeHtml(l.action)}</span>
          <span style="color:${statusColors[l.status] || 'var(--text-3)'}">${l.status}</span>
        </div>
        <div class="log-time">${time} | ${l.records_fetched} 条${l.error_message ? ' | <span style="color:var(--danger)">' + escapeHtml(l.error_message) + '</span>' : ''}</div>
      </div>`;
    }).join('');
  } catch (e) { /* silent */ }
}

async function loadLabsSyncLogs() {
  const container = document.getElementById('qualLabsSyncLogs');
  if (!container) return;
  try {
    const [cnasRes, cmaRes] = await Promise.all([
      fetch('/api/cnas/sync-logs?limit=15'),
      fetch('/api/cma/sync-logs?limit=15'),
    ]);
    const cnasLogs = await cnasRes.json();
    const cmaLogs = await cmaRes.json();
    const allLogs = [
      ...cnasLogs.map(l => ({ ...l, _src: 'CNAS' })),
      ...cmaLogs.map(l => ({ ...l, _src: 'CMA' })),
    ].sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    if (!allLogs.length) { container.innerHTML = '<div style="color:var(--text-3);padding:16px 0;text-align:center">暂无同步记录</div>'; return; }
    const statusColors = { success: 'var(--success)', error: 'var(--danger)' };
    container.innerHTML = allLogs.slice(0, 30).map(l => {
      const time = utcToBeijing(l.started_at);
      const idField = l.lab_no || l.cert_number || '';
      return `<div class="qual-sync-log">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><span style="color:var(--text-2);font-size:10px;margin-right:4px">${l._src}</span><span style="color:var(--text)">${escapeHtml(idField)}</span> ${escapeHtml(l.action)}</span>
          <span style="color:${statusColors[l.status] || 'var(--text-3)'}">${l.status}</span>
        </div>
        <div class="log-time">${time} | ${l.records_fetched} 条${l.error_message ? ' | <span style="color:var(--danger)">' + escapeHtml(l.error_message) + '</span>' : ''}</div>
      </div>`;
    }).join('');
  } catch (e) { container.innerHTML = ''; }
}

// ── Qual badges for search results ──
function qualBadgeHtml(standardNumber) {
  if (!qualData || !standardNumber) return '';
  const quals = qualData[standardNumber];
  if (!quals || !quals.length) return '';
  const cnas = quals.filter(q => q.source === 'CNAS');
  const cma = quals.filter(q => q.source === 'CMA');
  let html = '<span class="qual-badges">';
  if (cnas.length) {
    const date = cnas[0].effectiveDate || '';
    const tip = buildQualTooltip(cnas, 'CNAS');
    html += `<span class="qual-badge qual-badge-cnas"><span class="qual-dot"></span>CNAS${date ? ' ' + date : ''}<span class="qual-tooltip">${tip}</span></span>`;
  }
  if (cma.length) {
    const date = cma[0].effectiveDate || '';
    const tip = buildQualTooltip(cma, 'CMA');
    html += `<span class="qual-badge qual-badge-cma"><span class="qual-dot"></span>CMA${date ? ' ' + date : ''}<span class="qual-tooltip">${tip}</span></span>`;
  }
  html += '</span>';
  return html;
}

function buildQualTooltip(quals, source) {
  const now = beijingDate();
  const parts = [];

  // Deduplicate by testStandard + category
  const seen = new Set();
  const unique = quals.filter(q => {
    const k = (q.testStandard || '') + '|' + (q.category || '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  for (const q of unique.slice(0, 4)) {
    const lines = [];
    if (q.stdName && q.stdName !== q.testStandard) {
      lines.push('<b>' + escapeHtml(q.stdName) + '</b>');
    }
    if (q.category) lines.push('<span style="color:var(--text-3)">领域</span> ' + escapeHtml(q.category));
    if (q.testItem) lines.push('<span style="color:var(--text-3)">项目</span> ' + escapeHtml(q.testItem.length > 40 ? q.testItem.slice(0, 40) + '…' : q.testItem));
    if (q.limitDesc && q.limitDesc !== '/' && q.limitDesc !== '—') {
      lines.push('<span style="color:var(--warning)">限定</span> ' + escapeHtml(q.limitDesc.length > 30 ? q.limitDesc.slice(0, 30) + '…' : q.limitDesc));
    }
    // Authorization dates
    const dates = [];
    if (q.effectiveDate) {
      const expired = q.expiryDate && q.expiryDate < now;
      dates.push('<span style="color:' + (expired ? 'var(--danger)' : 'var(--success)') + '">生效 ' + escapeHtml(q.effectiveDate) + '</span>');
    }
    if (q.expiryDate) {
      const expired = q.expiryDate < now;
      dates.push('<span style="color:' + (expired ? 'var(--danger)' : 'var(--text-2)') + '">到期 ' + escapeHtml(q.expiryDate) + '</span>');
    }
    if (dates.length) lines.push(dates.join(' · '));
    if (lines.length) parts.push(lines.join('<br>'));
  }

  if (unique.length > 4) parts.push('<span style="color:var(--text-3)">…还有 ' + (unique.length - 4) + ' 项</span>');
  return parts.join('<hr style="border:none;border-top:1px solid var(--border);margin:6px 0">') || source + ' 资质';
}

async function fetchQualBadges(standardNumbers) {
  if (!standardNumbers.length) return;
  try {
    const unique = [...new Set(standardNumbers)].filter(Boolean);
    const res = await fetch('/api/standards/qualifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stdCodes: unique }),
    });
    if (!res.ok) return;
    const data = await res.json();
    qualData = data;
  } catch { /* silent */ }
}

// ── Init ──
checkAuthStatus();

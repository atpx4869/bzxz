// ── Search status indicator ──
const _searchStatusEl = document.createElement('div');
_searchStatusEl.id = 'searchStatus';
_searchStatusEl.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:400;display:none;align-items:center;gap:8px;padding:10px 18px;border-radius:8px;background:oklch(20% 0.016 255 / 0.92);backdrop-filter:blur(12px);border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,0.4);font-size:13px;font-weight:500;color:var(--text);transition:opacity 0.25s;pointer-events:none;';
document.body.appendChild(_searchStatusEl);
function showSearchStatus(msg, spinning) {
  _searchStatusEl.innerHTML = (spinning ? '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>' : '') + `<span>${escapeHtml(msg)}</span>`;
  _searchStatusEl.style.display = 'flex';
  _searchStatusEl.style.opacity = '1';
}
function hideSearchStatus() {
  _searchStatusEl.style.opacity = '0';
  setTimeout(() => { _searchStatusEl.style.display = 'none'; }, 300);
}

// ── Source tag init ──
document.querySelectorAll('.source-tag').forEach(tag => {
  const src = tag.dataset.source;
  if (selectedSources.has(src)) tag.classList.add('active'); else tag.classList.remove('active');
  tag.addEventListener('click', () => {
    if (selectedSources.has(src)) { selectedSources.delete(src); tag.classList.remove('active'); }
    else { selectedSources.add(src); tag.classList.add('active'); }
  });
});

// ── GBW text availability polling ──
let _gbwTextPollTimer = null;
let _gbwTextPollAbort = false;
function stopGbwTextPoll() {
  if (_gbwTextPollTimer) { clearTimeout(_gbwTextPollTimer); _gbwTextPollTimer = null; }
  _gbwTextPollAbort = true;
}
(window._tabCleanup = window._tabCleanup || {}).gbwTextPoll = stopGbwTextPoll;
function pollGbwTextAvailability() {
  if (_gbwTextPollTimer) return;
  _gbwTextPollAbort = false;
  const gbwIds = results.filter(r => r._source === 'gbw' || (r._sourceIds && r._sourceIds.gbw)).map(r => r._sourceIds?.gbw || r.sourceId).filter(Boolean);
  if (!gbwIds.length) return;
  let emptyPolls = 0;
  const poll = async () => {
    if (_gbwTextPollAbort) return;
    try {
      const resp = await fetch(`/api/standards/text-availability?ids=${gbwIds.join(',')}`);
      const data = await readApiResponse(resp);
      let updated = false;
      for (const r of results) {
        const gbwId = r._sourceIds?.gbw || (r._source === 'gbw' ? r.sourceId : null);
        if (gbwId && data[gbwId] !== undefined) {
          const newVal = data[gbwId];
          // Mark gbw as checked so the tri-state badge can transition out of 'checking'
          if (!r._gbwTextChecked) { r._gbwTextChecked = true; updated = true; }
          if (r._source === 'gbw') {
            if (r.previewAvailable !== newVal) { r.previewAvailable = newVal; updated = true; }
          }
          if (r._previewAvailableBySource && r._previewAvailableBySource.gbw !== undefined) {
            r._previewAvailableBySource.gbw = newVal;
            r.previewAvailable = Object.values(r._previewAvailableBySource).some(Boolean);
            updated = true;
          }
        }
      }
      if (updated) renderResults();
      const hasAnyData = Object.keys(data).length > 0;
      const allChecked = hasAnyData && gbwIds.every(id => data[id] !== undefined);
      if (allChecked) {
        _gbwTextPollTimer = null;
        // 静默结束：每张卡片的「检测中」徽章已自然过渡到「有文本/无文本」
        return;
      }
      if (!hasAnyData) {
        emptyPolls++;
        if (emptyPolls >= 20) {
          _gbwTextPollTimer = null;
          // Mark all gbw rows as checked so the checking spinner stops
          let anyMark = false;
          for (const r of results) {
            const gbwId = r._sourceIds?.gbw || (r._source === 'gbw' ? r.sourceId : null);
            if (gbwId && !r._gbwTextChecked) { r._gbwTextChecked = true; anyMark = true; }
          }
          if (anyMark) renderResults();
          // 静默结束：未拿到结果的卡片已被标记为 _gbwTextChecked，徽章会落到「无文本」
          return;
        }
      } else {
        emptyPolls = 0;
      }
      // New data arrived → poll again quickly; no change → back off
      _gbwTextPollTimer = setTimeout(poll, updated ? 500 : 2000);
    } catch {
      _gbwTextPollTimer = setTimeout(poll, 2000);
    }
  };
  // 首次 poll 几乎立即发起，让缓存命中场景"瞬时"返回；之前 2s 的等待是历史保守值
  _gbwTextPollTimer = setTimeout(poll, 300);
}

// ── Per-source progress strip ──
function renderSourceProgressStrip(states) {
  const strip = document.getElementById('sourceProgressStrip');
  if (!strip) return;
  if (!states || Object.keys(states).length === 0) { strip.style.display = 'none'; strip.innerHTML = ''; return; }
  const order = ['bz', 'gbw', 'by'];
  const html = order.filter(s => states[s]).map(s => {
    const st = states[s];
    const cls = st.status; // 'loading' | 'ok' | 'fail'
    const icon = cls === 'loading' ? '<span class="src-prog-spin"></span>' : (cls === 'ok' ? '✓' : '✗');
    const num = cls === 'loading' ? '检索中' : (cls === 'ok' ? `${st.count} 条` : (st.error || '失败'));
    return `<span class="src-prog-chip src-prog-${cls} src-prog-${s}"><span class="src-prog-label">${escapeHtml(srcLabel(s))}</span><span class="src-prog-icon">${icon}</span><span class="src-prog-value">${escapeHtml(num)}</span></span>`;
  }).join('');
  strip.innerHTML = html;
  strip.style.display = html ? 'flex' : 'none';
}

// ── Search ──
async function doSearch() {
  if (searchAborted === 'cancelling') return; // already cancelling
  if (_gbwTextPollTimer) { clearTimeout(_gbwTextPollTimer); _gbwTextPollTimer = null; _gbwTextPollAbort = true; }
  const q = document.getElementById('searchInput').value.trim();
  if (!q) return;
  document.getElementById('searchBtn').innerHTML = '<span class="spinner"></span>取消';
  document.getElementById('searchBtn').disabled = false;
  results = []; selectedIds.clear(); updateToolbar(); searchAborted = false; qualData = {};
  showSearchStatus('正在搜索...', true);
  // Initialize per-source progress chips
  const _sourceProgress = {};
  for (const s of selectedSources) _sourceProgress[s] = { status: 'loading', count: 0 };
  renderSourceProgressStrip(_sourceProgress);
  // Show skeleton — count proportional to selected sources, capped 6
  const _skeletonCount = Math.min(6, Math.max(4, selectedSources.size * 2));
  document.getElementById('results').innerHTML = Array.from({ length: _skeletonCount }, (_, i) =>
    `<div class="skeleton-card sk-row" style="animation-delay:${(i * 80).toFixed(0)}ms">
      <div class="sk-check skeleton-line"></div>
      <div class="sk-id"><div class="skeleton-line sk-num"></div></div>
      <div class="sk-body">
        <div class="skeleton-line sk-title"></div>
        <div class="skeleton-line sk-sub"></div>
      </div>
      <div class="sk-state">
        <div class="skeleton-line sk-status"></div>
        <div class="skeleton-line sk-text"></div>
      </div>
      <div class="sk-source"><div class="skeleton-line sk-src"></div></div>
      <div class="sk-date"><div class="skeleton-line sk-d1"></div><div class="skeleton-line sk-d2"></div></div>
      <div class="sk-actions"><div class="skeleton-line sk-btn"></div><div class="skeleton-line sk-btn"></div><div class="skeleton-line sk-btn"></div></div>
    </div>`
  ).join('');
  document.getElementById('toolbar').style.display = 'none';
  saveSearchHistory(q);

  const sources = [...selectedSources];
  const promises = sources.map(src => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    return fetch(`${API}/api/standards/search?q=${encodeURIComponent(q)}&source=${src}`, { signal: ctrl.signal })
      .then(r => readApiResponse(r)).then(data => ({ ok: true, src, items: (data.items || []).map(i => ({ ...i, _source: src })) }))
      .catch(e => ({ ok: false, src, error: e.name === 'AbortError' ? '超时' : e.message }))
      .finally(() => clearTimeout(timer));
  });

  let receivedCount = 0; const receivedResults = [];
  let qualFetched = false;
  for (const p of promises) {
    const outcome = await p; receivedCount++;
    if (searchAborted) break;
    if (outcome.ok) {
      receivedResults.push(...outcome.items);
      addLog(`搜索 ${outcome.src}(${q}) 完成 (+${outcome.items.length} 条)`, 'success');
      _sourceProgress[outcome.src] = { status: 'ok', count: outcome.items.length };
    } else {
      addLog(`搜索 ${outcome.src}(${q}) 失败: ${outcome.error}`, 'fail');
      _sourceProgress[outcome.src] = { status: 'fail', count: 0, error: outcome.error };
    }
    renderSourceProgressStrip(_sourceProgress);
    showSearchStatus(`搜索中 ${receivedCount}/${sources.length} 源...`, true);
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
    // Poll GBW text availability in background (non-blocking)
    pollGbwTextAvailability();
  }
  if (searchAborted) {
    addLog('搜索已取消', 'fail');
    document.getElementById('summary').innerHTML = `<span class="count-anim">已取消 (${results.length} 条结果)</span>`;
    hideSearchStatus();
  }
  document.getElementById('searchBtn').innerHTML = '搜索'; document.getElementById('searchBtn').disabled = false;
  if (results.length > 0 && !searchAborted) {
    // 文本检测进度由每张卡片右侧的「检测中」徽章承担，底部 toast 不再常驻
    showSearchStatus(`搜索完成 (${results.length}条)`, false);
    setTimeout(hideSearchStatus, 1800);
  } else {
    hideSearchStatus();
  }
  // If qual badges weren't fetched yet (no results on first source), fetch now
  if (!qualFetched && results.length > 0) {
    const stdNums = results.map(r => r.standardNumber).filter(Boolean);
    fetchQualBadges(stdNums).then(() => { if (results.length > 0) renderResults(); });
  }
  // Final poll for GBW text availability
  pollGbwTextAvailability();
  filterState.sources.clear(); filterState.statuses.clear();
  filterState.onlyDownloadable = false; filterState.onlyQualified = false; filterState.onlySaved = false; filterState.sort = 'smart';
  renderFilterBar();
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
  const filtered = results.filter(r => {
    if (filterState.sources.size > 0) {
      const rSources = r.sources || [r._source];
      if (!rSources.some(s => filterState.sources.has(s))) return false;
    }
    if (filterState.statuses.size > 0) {
      if (!filterState.statuses.has(statusCategory(r.status))) return false;
    }
    if (filterState.onlyDownloadable && !r.previewAvailable) return false;
    if (filterState.onlyQualified && !hasQualificationBadge(r.standardNumber)) return false;
    if (filterState.onlySaved && !isStandardSaved(r)) return false;
    return true;
  });
  return sortFilteredResults(filtered);
}

function hasQualificationBadge(standardNumber) {
  const items = qualData?.[standardNumber] || [];
  return Array.isArray(items) && items.length > 0;
}

function sortFilteredResults(items) {
  const sorted = [...items];
  const dateValue = (value) => {
    const t = value ? new Date(value).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };
  if (filterState.sort === 'date') {
    sorted.sort((a, b) => dateValue(b.implementDate || b.publishDate) - dateValue(a.implementDate || a.publishDate));
  } else if (filterState.sort === 'downloadable') {
    sorted.sort((a, b) => Number(Boolean(b.previewAvailable)) - Number(Boolean(a.previewAvailable)) || sortByStatus(a, b));
  } else if (filterState.sort === 'sourceCount') {
    sorted.sort((a, b) => ((b.sources || [b._source]).length - (a.sources || [a._source]).length) || sortByStatus(a, b));
  } else {
    sorted.sort(sortByStatus);
  }
  return sorted;
}

function renderFilterBar() {
  const bar = document.getElementById('filterBar');
  if (!results.length) { bar.classList.remove('visible'); bar.innerHTML = ''; return; }

  const srcCounts = {}; const statusCounts = {};
  let downloadableCount = 0; let qualifiedCount = 0; let savedCount = 0;
  for (const r of results) {
    for (const s of (r.sources || [r._source])) { srcCounts[s] = (srcCounts[s] || 0) + 1; }
    statusCounts[statusCategory(r.status)] = (statusCounts[statusCategory(r.status)] || 0) + 1;
    if (r.previewAvailable) downloadableCount++;
    if (hasQualificationBadge(r.standardNumber)) qualifiedCount++;
    if (isStandardSaved(r)) savedCount++;
  }

  const srcChips = [
    { key: '', label: '全部', count: results.length },
    ...['bz','gbw','by'].map(s => ({ key: s, label: srcLabel(s), count: srcCounts[s] || 0 }))
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

  const quickTools = `
    <span class="filter-sep"></span>
    <button class="filter-chip filter-toggle${filterState.onlyDownloadable ? ' active' : ''}" data-filter-toggle="downloadable">可下载<span class="chip-count">${downloadableCount}</span></button>
    <button class="filter-chip filter-toggle${filterState.onlyQualified ? ' active' : ''}" data-filter-toggle="qualified">有资质<span class="chip-count">${qualifiedCount}</span></button>
    <button class="filter-chip filter-toggle${filterState.onlySaved ? ' active' : ''}" data-filter-toggle="saved">收藏<span class="chip-count">${savedCount}</span></button>
    <label class="filter-sort">
      <span>排序</span>
      <select id="resultSortSelect">
        <option value="smart" ${filterState.sort === 'smart' ? 'selected' : ''}>智能</option>
        <option value="downloadable" ${filterState.sort === 'downloadable' ? 'selected' : ''}>可下载优先</option>
        <option value="date" ${filterState.sort === 'date' ? 'selected' : ''}>日期最新</option>
        <option value="sourceCount" ${filterState.sort === 'sourceCount' ? 'selected' : ''}>来源最多</option>
      </select>
    </label>`;
  // 激活计数：非默认的筛选项个数（source/status 任一选中 + 三个 toggle 任一开 = 各算 1）
  // 用于折叠按钮上的徽章，让用户知道折叠态下有几条筛选生效
  const activeCount =
    (filterState.sources.size > 0 ? 1 : 0) +
    (filterState.statuses.size > 0 ? 1 : 0) +
    (filterState.onlyDownloadable ? 1 : 0) +
    (filterState.onlyQualified ? 1 : 0) +
    (filterState.onlySaved ? 1 : 0);
  const collapseBtn = `<button class="filter-collapse${activeCount ? ' has-active' : ''}" type="button" data-filter-collapse aria-expanded="false">
    <span class="filter-collapse-label">筛选</span>
    ${activeCount ? `<span class="filter-collapse-count">${activeCount}</span>` : ''}
    <span class="filter-collapse-caret" aria-hidden="true">▾</span>
  </button>`;
  const bodyHtml = chipHtml(srcChips, filterState.sources) + '<span class="filter-sep"></span>' + chipHtml(statusChips, filterState.statuses) + quickTools;
  bar.innerHTML = collapseBtn + `<div class="filter-bar-body">${bodyHtml}</div>`;
  bar.classList.add('visible');
}

// ── Render cards ──
// Progressive rendering: first batch is cheap (100 rows), then either user
// clicks "show all" or scrolls past the sentinel which triggers the next batch.
const RESULTS_FIRST_BATCH = 100;
const RESULTS_NEXT_BATCH = 200;
let _resultsRenderedCount = 0;
let _resultsLastFilteredCache = null;

function resolveTextState(r) {
  // 废止 standards never have preview text — final state, no checking
  if (r.status && r.status.includes('废止')) return 'no_text';
  // Already confirmed has text (from any source) → final
  if (r.previewAvailable) return 'text';
  // gbw uses optimistic false until poll resolves — show checking spinner
  const sources = r.sources || (r._source ? [r._source] : []);
  if (sources.includes('gbw') && !r._gbwTextChecked) return 'checking';
  return 'no_text';
}

function buildResultCardHtml(r, i) {
  const srcBadges = (r.sources || [r._source]).map(s => `<span class="source-badge source-${escapeHtml(String(s))}">${escapeHtml(srcLabel(String(s)))}</span>`).join(' ');
  const sCls = statusClass(r.status);
  const textState = resolveTextState(r);
  const hasText = textState === 'text';
  const isChecking = textState === 'checking';
  const saved = isStandardSaved(r);
  const statusBadge = r.status ? `<span class="status-indicator ${sCls}"><span class="dot"></span>${escapeHtml(r.status)}</span>` : '';
  const textBadge = isChecking
    ? '<span class="text-badge-checking"><span class="text-badge-dot"></span>检测中</span>'
    : (hasText ? '<span class="has-text-badge">有文本</span>' : '<span class="no-text-badge">无文本</span>');
  return `
    <div class="result-card card-enter${hasText ? '' : (isChecking ? ' checking-text' : ' no-text')}${saved ? ' saved' : ''}" data-sid="${escapeHtml(r.id)}">
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
      <!-- 手机端合并行：桌面 display:none，手机显示，把 state / source / 资质徽章揉成一行 flex-wrap。
           资质徽章在标题行里已经有一份（桌面用），手机端这里再渲一份；标题行那份在手机端 hide -->
      <div class="card-meta-line">
        ${statusBadge || ''}
        ${textBadge}
        ${srcBadges}
        ${qualBadgeHtml(r.standardNumber)}
      </div>
      <div class="card-date">
        <span><b>发布</b>${r.publishDate || '—'}</span>
        <span><b>实施</b>${r.implementDate || '—'}</span>
      </div>
      <div class="card-actions">
        <button data-action="save" data-id="${escapeHtml(r.id)}" class="${saved ? 'saved' : ''}" title="${saved ? '取消收藏' : '收藏'}">${saved ? '已存' : '收藏'}</button>
        <button data-action="detail" data-id="${escapeHtml(r.id)}">详情</button>
        <button data-action="preview" data-id="${escapeHtml(r.id)}" title="本地预览（已下载的标准）">预览</button>
        <button data-action="download" data-id="${escapeHtml(r.id)}" ${hasText ? '' : 'disabled'}>下载</button>
      </div>
    </div>`;
}

// Status group collapse state — persisted
const _collapsedGroupsKey = 'bzxz_collapsed_status_groups';
let _collapsedGroups = new Set(safeJsonParse(localStorage.getItem(_collapsedGroupsKey), ['废止']));
function _persistCollapsedGroups() {
  try { localStorage.setItem(_collapsedGroupsKey, JSON.stringify([..._collapsedGroups])); } catch {}
}

const STATUS_GROUP_ORDER = ['现行', '即将实施', '其它', '废止'];

function renderResults() {
  const filtered = getFilteredResults();
  const idxMap = new Map(results.map((r, i) => [r.id, i]));
  _resultsLastFilteredCache = filtered;
  _resultsRenderedCount = Math.min(RESULTS_FIRST_BATCH, filtered.length);

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

  // Group by status category when at least 2 categories present and we have >5 results.
  const visibleBatch = filtered.slice(0, _resultsRenderedCount);
  const catCounts = {};
  for (const r of filtered) { const c = statusCategory(r.status); catCounts[c] = (catCounts[c] || 0) + 1; }
  const usedCats = Object.keys(catCounts);
  const useGrouping = usedCats.length >= 2 && filtered.length > 5;

  let bodyHtml = '';
  if (useGrouping) {
    // Group first-batch rows by status category, then render in canonical order
    const groups = {};
    for (const r of visibleBatch) {
      const c = statusCategory(r.status);
      (groups[c] = groups[c] || []).push(r);
    }
    for (const cat of STATUS_GROUP_ORDER) {
      const rows = groups[cat];
      const total = catCounts[cat] || 0;
      if (!total) continue;
      const collapsed = _collapsedGroups.has(cat);
      const rendered = rows ? rows.length : 0;
      const groupCls = `status-group status-group-${cat === '现行' ? 'current' : cat === '即将实施' ? 'upcoming' : cat === '废止' ? 'expired' : 'other'}${collapsed ? ' collapsed' : ''}`;
      bodyHtml += `<div class="${groupCls}" data-group-cat="${escapeHtml(cat)}">
        <div class="status-group-header" data-group-toggle="${escapeHtml(cat)}">
          <span class="status-group-caret">▾</span>
          <span class="status-group-name">${escapeHtml(cat)}</span>
          <span class="status-group-count">${rendered}${rendered < total ? ` / ${total}` : ''}</span>
        </div>
        <div class="status-group-body">${
          rows ? rows.map(r => buildResultCardHtml(r, idxMap.get(r.id))).join('') : ''
        }</div>
      </div>`;
    }
  } else {
    bodyHtml = visibleBatch.map(r => buildResultCardHtml(r, idxMap.get(r.id))).join('');
  }

  const moreHtml = filtered.length > _resultsRenderedCount
    ? `<div id="resultsMore" class="results-more"><button class="btn btn-ghost btn-sm" id="resultsLoadMoreBtn">显示更多（还剩 ${filtered.length - _resultsRenderedCount} 条）</button></div>`
    : '';
  document.getElementById('results').innerHTML = header + bodyHtml + moreHtml;
  // Wire status group toggles
  document.querySelectorAll('[data-group-toggle]').forEach(h => {
    h.addEventListener('click', () => {
      const cat = h.dataset.groupToggle;
      const group = h.closest('.status-group');
      if (_collapsedGroups.has(cat)) { _collapsedGroups.delete(cat); group.classList.remove('collapsed'); }
      else { _collapsedGroups.add(cat); group.classList.add('collapsed'); }
      _persistCollapsedGroups();
    });
  });
  document.querySelectorAll('input[data-idx]').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      const r = results[idx];
      if (!r) return;
      cb.checked ? selectedIds.add(r.id) : selectedIds.delete(r.id);
      updateToolbar();
    });
  });
  const moreBtn = document.getElementById('resultsLoadMoreBtn');
  if (moreBtn) moreBtn.addEventListener('click', appendNextResultsBatch);
}

function appendNextResultsBatch() {
  const filtered = _resultsLastFilteredCache;
  if (!filtered) return;
  const idxMap = new Map(results.map((r, i) => [r.id, i]));
  const end = Math.min(_resultsRenderedCount + RESULTS_NEXT_BATCH, filtered.length);
  const slice = filtered.slice(_resultsRenderedCount, end);
  const moreEl = document.getElementById('resultsMore');
  const grouped = !!document.querySelector('.status-group');
  if (grouped) {
    // Distribute new rows into their status-group bodies (already exist from initial render)
    for (const r of slice) {
      const cat = statusCategory(r.status);
      const body = document.querySelector(`.status-group[data-group-cat="${CSS.escape(cat)}"] .status-group-body`);
      const html = buildResultCardHtml(r, idxMap.get(r.id));
      if (body) body.insertAdjacentHTML('beforeend', html);
      else if (moreEl) moreEl.insertAdjacentHTML('beforebegin', html); // fallback
    }
    // Refresh group counts
    const catCounts = {};
    for (const r of filtered.slice(0, end)) { const c = statusCategory(r.status); catCounts[c] = (catCounts[c] || 0) + 1; }
    document.querySelectorAll('.status-group').forEach(g => {
      const cat = g.dataset.groupCat;
      const total = filtered.reduce((acc, r) => acc + (statusCategory(r.status) === cat ? 1 : 0), 0);
      const rendered = catCounts[cat] || 0;
      const cnt = g.querySelector('.status-group-count');
      if (cnt) cnt.textContent = rendered < total ? `${rendered} / ${total}` : `${rendered}`;
    });
  } else {
    const html = slice.map(r => buildResultCardHtml(r, idxMap.get(r.id))).join('');
    if (moreEl) moreEl.insertAdjacentHTML('beforebegin', html);
  }
  // Re-bind checkboxes for newly inserted rows
  document.querySelectorAll('input[data-idx]:not([data-bound])').forEach(cb => {
    cb.setAttribute('data-bound', '1');
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      const r = results[idx];
      if (!r) return;
      cb.checked ? selectedIds.add(r.id) : selectedIds.delete(r.id);
      updateToolbar();
    });
  });
  _resultsRenderedCount = end;
  if (_resultsRenderedCount >= filtered.length) {
    if (moreEl) moreEl.remove();
  } else if (moreEl) {
    const remaining = filtered.length - _resultsRenderedCount;
    moreEl.querySelector('button').textContent = `显示更多（还剩 ${remaining} 条）`;
  }
}

// Filter bar chip clicks
document.getElementById('filterBar').addEventListener('click', e => {
  // 手机端折叠按钮：切 .open 让 .filter-bar-body 显隐；桌面端按钮 CSS display:none 永远不触发
  const collapseBtn = e.target.closest('[data-filter-collapse]');
  if (collapseBtn) {
    const bar = document.getElementById('filterBar');
    const open = bar.classList.toggle('open');
    collapseBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    return;
  }
  const toggle = e.target.closest('[data-filter-toggle]');
  if (toggle) {
    if (toggle.dataset.filterToggle === 'downloadable') filterState.onlyDownloadable = !filterState.onlyDownloadable;
    if (toggle.dataset.filterToggle === 'qualified') filterState.onlyQualified = !filterState.onlyQualified;
    if (toggle.dataset.filterToggle === 'saved') filterState.onlySaved = !filterState.onlySaved;
    renderFilterBar(); renderResults(); updateToolbar();
    return;
  }
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

document.getElementById('filterBar').addEventListener('change', e => {
  if (e.target.id !== 'resultSortSelect') return;
  filterState.sort = e.target.value;
  renderFilterBar(); renderResults(); updateToolbar();
});

// Delegated event handler for result card buttons
document.getElementById('results').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === 'detail') showDetail(id);
  else if (btn.dataset.action === 'download') downloadOne(id, btn);
  else if (btn.dataset.action === 'preview') previewStandard(id);
  else if (btn.dataset.action === 'save') toggleSavedStandard(id);
});

// ── PDF 预览（Phase 2 + Phase 3 polish）──
// 流程：POST /api/preview/request →
//   ready       → iframe 加载 /api/preview/file/:id
//   downloading → 后端已起任务，前端 poll /api/preview/task/:id 直到 ready / failed
//                 → ready 切 iframe；failed 提示用户、给「重试」按钮
//
// Phase 3 调整：
// - 后端无 deadline，前端只在 ready / failed / 用户主动关闭时停 poll
// - 失败 UI 加「重试」按钮，触发新的 /api/preview/request（后端按 stdCode+year 去重，
//   若旁路还有 pending/downloading 任务会复用；否则起新任务）
let _previewCurrent = null; // { fileId, url, fileName }
let _previewPollAbort = null; // 取消正在进行的 poll（用户关弹窗或换标准时）
let _previewLastId = null;   // 缓存最近一次预览的结果 id，用于失败重试

async function pollPreviewTask(taskId, stdCode) {
  // 用 AbortController 让"关闭预览 / 重试"能立刻停掉旧 poll。
  const ctrl = new AbortController();
  _previewPollAbort = ctrl;
  let attempt = 0;
  // 无 deadline：只在 ready / failed / abort 时返回。
  // 后端 preview-task-store 有 10 分钟无更新的 TTL 兜底，最坏情况会返回 404。
  while (!ctrl.signal.aborted) {
    attempt++;
    setPreviewBody(`<div class="preview-loading">正在自动下载…（${attempt}）<br><span class="preview-empty-hint">首次入库可能 5~30 秒，受源站速度影响</span></div>`);
    await new Promise(r => setTimeout(r, 1500));
    if (ctrl.signal.aborted) return;
    let data;
    let httpOk = true;
    try {
      const res = await fetch(`${API}/api/preview/task/${encodeURIComponent(taskId)}`, { signal: ctrl.signal });
      httpOk = res.ok;
      data = await readApiResponse(res);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      // 轮询接口短暂抖动 → 继续重试
      continue;
    }
    // 任务过期（TTL 兜底命中）→ 当作失败处理，让用户点重试
    if (!httpOk || !data || data.status === undefined) {
      renderPreviewFailedUi(data?.error || '任务已过期或不存在，请重试');
      return;
    }
    if (data.status === 'ready') {
      _previewCurrent = { fileId: data.fileId, url: data.url, fileName: stdCode };
      const safeUrl = data.url + (data.url.includes('?') ? '&' : '?') + 't=' + Date.now();
      setPreviewBody(`<iframe class="preview-iframe" src="${escapeHtml(safeUrl)}" title="预览 ${escapeHtml(stdCode)}"></iframe>`);
      return;
    }
    if (data.status === 'failed') {
      renderPreviewFailedUi(data.error || '所有源都未能下载到此标准。');
      return;
    }
    // pending / downloading → 继续循环
  }
}

/**
 * 渲染预览失败弹层：「关闭」+「重试」。
 * 重试逻辑：调用 previewStandard(_previewLastId) 重新走 /api/preview/request。
 * 后端会按 stdCode+year 去重，若有活跃任务复用，否则起新任务。
 */
function renderPreviewFailedUi(errorMsg) {
  setPreviewBody(`
    <div class="preview-empty">
      <div class="preview-empty-title">自动下载失败</div>
      <div class="preview-empty-hint">${escapeHtml(errorMsg || '未能下载到此标准。')}</div>
      <div class="preview-empty-actions">
        <button class="btn btn-primary" id="previewRetryBtn">重试</button>
        <button class="btn btn-ghost" id="previewCloseFailedBtn">关闭</button>
      </div>
    </div>`);
  const retry = document.getElementById('previewRetryBtn');
  if (retry) retry.addEventListener('click', () => {
    if (!_previewLastId) { closePreviewOverlay(); return; }
    // 停旧 poll，再走一次完整流程
    if (_previewPollAbort) {
      try { _previewPollAbort.abort(); } catch { /* ignore */ }
      _previewPollAbort = null;
    }
    previewStandard(_previewLastId);
  });
  const cls = document.getElementById('previewCloseFailedBtn');
  if (cls) cls.addEventListener('click', closePreviewOverlay);
}

async function previewStandard(id) {
  const r = findResultByAnyId ? findResultByAnyId(id) : results.find(x => x.id === id);
  if (!r) { showToast('未找到该标准', 'fail'); return; }
  const stdCode = r.standardNumber || '';
  if (!stdCode) { showToast('该结果缺少标准号，无法预览', 'fail'); return; }
  // 记录最近一次预览的 id，供失败弹层的「重试」按钮使用
  _previewLastId = id;
  // 若上一次 poll 还活着（用户连点 / 重试场景），先停掉旧的
  if (_previewPollAbort) {
    try { _previewPollAbort.abort(); } catch { /* ignore */ }
    _previewPollAbort = null;
  }
  openPreviewOverlay(stdCode + (r.title ? `  ${r.title}` : ''));
  setPreviewBody(`<div class="preview-loading">查询本地库…</div>`);
  try {
    const yearMatch = stdCode.match(/-\s*(\d{4})\s*$/);
    const year = yearMatch ? yearMatch[1] : undefined;
    const body = year ? { stdCode, year } : { stdCode };
    const res = await fetch(`${API}/api/preview/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readApiResponse(res);
    if (data.status === 'ready') {
      _previewCurrent = { fileId: data.fileId, url: data.url, fileName: stdCode };
      const safeUrl = data.url + (data.url.includes('?') ? '&' : '?') + 't=' + Date.now();
      setPreviewBody(`<iframe class="preview-iframe" src="${escapeHtml(safeUrl)}" title="预览 ${escapeHtml(stdCode)}"></iframe>`);
    } else if (data.status === 'downloading' && data.taskId) {
      // Phase 2：后端已经在后台拉，前端 poll 状态到 ready / failed
      _previewCurrent = null;
      await pollPreviewTask(data.taskId, stdCode);
    } else if (data.status === 'not_in_library') {
      // 旧 Phase 1 兜底分支（理论上 Phase 2 后端不再返回这个 status）
      _previewCurrent = null;
      setPreviewBody(`
        <div class="preview-empty">
          <div class="preview-empty-title">本地库尚无此标准</div>
          <div class="preview-empty-hint">先点击下方"下载"按钮把 PDF 拉到本地后，再点预览即可直接打开。</div>
          <div class="preview-empty-actions">
            <button class="btn btn-primary" id="previewDownloadFallbackBtn">立即下载</button>
            <button class="btn btn-ghost" id="previewCloseFallbackBtn">关闭</button>
          </div>
        </div>`);
      const dl = document.getElementById('previewDownloadFallbackBtn');
      if (dl) dl.addEventListener('click', () => {
        closePreviewOverlay();
        const card = document.querySelector(`.result-card[data-sid="${CSS.escape(id)}"]`);
        const btn = card ? card.querySelector('[data-action="download"]') : null;
        if (typeof downloadOne === 'function') downloadOne(id, btn);
      });
      const cls = document.getElementById('previewCloseFallbackBtn');
      if (cls) cls.addEventListener('click', closePreviewOverlay);
    } else {
      setPreviewBody(`<div class="preview-empty"><div class="preview-empty-title">预览失败</div><div class="preview-empty-hint">${escapeHtml(JSON.stringify(data))}</div></div>`);
    }
  } catch (e) {
    setPreviewBody(`<div class="preview-empty"><div class="preview-empty-title">预览失败</div><div class="preview-empty-hint">${escapeHtml(e?.message || String(e))}</div></div>`);
  }
}

function openPreviewOverlay(title) {
  const overlay = document.getElementById('previewOverlay');
  if (!overlay) return;
  document.getElementById('previewTitle').textContent = title || '预览';
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
}
function closePreviewOverlay() {
  const overlay = document.getElementById('previewOverlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  setPreviewBody(''); // 卸载 iframe，停止后台流式下载
  _previewCurrent = null;
  // Phase 2：用户主动关闭 → 取消 poll，避免后台继续抢请求
  if (_previewPollAbort) {
    try { _previewPollAbort.abort(); } catch { /* ignore */ }
    _previewPollAbort = null;
  }
}
function setPreviewBody(html) {
  const body = document.getElementById('previewBody');
  if (body) body.innerHTML = html;
}
(function bindPreviewOverlayEvents() {
  const overlay = document.getElementById('previewOverlay');
  if (!overlay) return;
  document.getElementById('previewClose')?.addEventListener('click', closePreviewOverlay);
  // 点击遮罩空白（panel 外）关闭；点击 panel 内不要触发
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closePreviewOverlay();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closePreviewOverlay();
  });
  document.getElementById('previewDownloadBtn')?.addEventListener('click', () => {
    if (!_previewCurrent) return;
    // 走 attachment=1 强制浏览器另存为，避免再次内联打开
    const a = document.createElement('a');
    a.href = `${_previewCurrent.url}?attachment=1`;
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  });
  document.getElementById('previewOpenNewBtn')?.addEventListener('click', () => {
    if (!_previewCurrent) return;
    window.open(_previewCurrent.url, '_blank', 'noopener,noreferrer');
  });
})();

// ── Right-click context menu ──
let _ctxMenuEl = null;
function hideCtxMenu() { if (_ctxMenuEl) { _ctxMenuEl.remove(); _ctxMenuEl = null; } }
document.addEventListener('click', hideCtxMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });
document.addEventListener('scroll', hideCtxMenu, true);

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast('已复制', 'success')).catch(() => showToast('复制失败', 'fail'));
  } else {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); showToast('已复制', 'success'); } catch { showToast('复制失败', 'fail'); }
    ta.remove();
  }
}

// ── j/k vim-style row navigation ──
let _activeRowId = null;
function _setActiveRow(card) {
  document.querySelectorAll('.result-card.row-active').forEach(el => el.classList.remove('row-active'));
  if (!card) { _activeRowId = null; return; }
  card.classList.add('row-active');
  _activeRowId = card.dataset.sid;
  // Scroll into view if needed
  const rect = card.getBoundingClientRect();
  if (rect.top < 80 || rect.bottom > window.innerHeight - 40) {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
function _getVisibleCards() {
  return Array.from(document.querySelectorAll('.result-card')).filter(c => {
    const grp = c.closest('.status-group');
    return !grp || !grp.classList.contains('collapsed');
  });
}
function _moveActiveRow(delta) {
  const cards = _getVisibleCards();
  if (!cards.length) return;
  let idx = cards.findIndex(c => c.dataset.sid === _activeRowId);
  if (idx < 0) idx = delta > 0 ? -1 : cards.length;
  idx = Math.max(0, Math.min(cards.length - 1, idx + delta));
  _setActiveRow(cards[idx]);
}
document.addEventListener('keydown', e => {
  // Mobile layout: 键盘快捷键（j/k/g/G/x/d/s 等）不可用 —— 没有物理键盘场景，
  // 也避免和"我"页等没有 active-row 的页面交互冲突。
  if (typeof window.isMobile === 'function' && window.isMobile()) return;
  // Skip when typing in input/textarea/contenteditable
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
  // Skip when modal/overlay open
  if (document.querySelector('.modal.open, .shortcuts-overlay.open')) return;
  // Skip if not on search page
  const searchPage = document.getElementById('page-search');
  if (!searchPage || searchPage.style.display === 'none') return;
  // Skip combos with modifiers (let them through)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'j') { e.preventDefault(); _moveActiveRow(1); return; }
  if (e.key === 'k') { e.preventDefault(); _moveActiveRow(-1); return; }
  if (e.key === 'g') { e.preventDefault(); const cards = _getVisibleCards(); if (cards.length) _setActiveRow(cards[0]); return; }
  if (e.key === 'G') { e.preventDefault(); const cards = _getVisibleCards(); if (cards.length) _setActiveRow(cards[cards.length - 1]); return; }
  if (!_activeRowId) return;
  const card = document.querySelector(`.result-card[data-sid="${CSS.escape(_activeRowId)}"]`);
  if (!card) return;
  if (e.key === 'x' || e.key === ' ') {
    e.preventDefault();
    const cb = card.querySelector('input[type="checkbox"]');
    if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    showDetail(_activeRowId);
  } else if (e.key === 'd') {
    e.preventDefault();
    const btn = card.querySelector('[data-action="download"]');
    if (btn && !btn.disabled) downloadOne(_activeRowId, btn); else showToast('该标准无可用文本', 'fail');
  } else if (e.key === 's') {
    e.preventDefault();
    toggleSavedStandard(_activeRowId);
  }
});

document.getElementById('results').addEventListener('contextmenu', e => {
  const card = e.target.closest('.result-card');
  if (!card) return;
  e.preventDefault();
  hideCtxMenu();
  const id = card.dataset.sid;
  const r = findResultByAnyId ? findResultByAnyId(id) : results.find(x => x.id === id);
  if (!r) return;
  // 手机端长按触发的右键菜单去掉「下载该标准」「加入收藏」，与 CSS 隐藏入口对齐
  const onMobile = typeof window.isMobile === 'function' && window.isMobile();
  const items = [
    { label: '复制标准号', icon: '#', action: () => copyToClipboard(r.standardNumber || '') },
    { label: '复制名称', icon: 'T', action: () => copyToClipboard(r.title || '') },
    { label: '复制标准号 + 名称', icon: '≣', action: () => copyToClipboard(`${r.standardNumber || ''}  ${r.title || ''}`.trim()) },
    { divider: true },
    { label: '查看详情', icon: '👁', action: () => showDetail(id) },
    { label: '预览（本地）', icon: '🗎', action: () => previewStandard(id) },
    ...(onMobile ? [] : [
      { label: r.previewAvailable ? '下载该标准' : '下载该标准（无文本）', icon: '↓', action: () => { const btn = card.querySelector('[data-action="download"]'); if (btn && !btn.disabled) downloadOne(id, btn); else showToast('该标准无可用文本', 'fail'); } },
      { label: isStandardSaved(r) ? '取消收藏' : '加入收藏', icon: '★', action: () => toggleSavedStandard(id) },
    ]),
    { divider: true },
    { label: '复制为 JSON', icon: '{}', action: () => copyToClipboard(JSON.stringify(r, null, 2)) },
  ];
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = items.map((it, idx) => it.divider
    ? '<div class="ctx-menu-divider"></div>'
    : `<div class="ctx-menu-item" data-idx="${idx}"><span class="ctx-menu-icon">${it.icon || ''}</span><span class="ctx-menu-label">${escapeHtml(it.label)}</span></div>`
  ).join('');
  // Position with viewport clamp
  const VW = window.innerWidth, VH = window.innerHeight;
  const MW = 220, MH = items.length * 30 + 20;
  const x = Math.min(e.clientX, VW - MW - 8);
  const y = Math.min(e.clientY, VH - MH - 8);
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:10000;`;
  document.body.appendChild(menu);
  _ctxMenuEl = menu;
  menu.addEventListener('click', ev => {
    const item = ev.target.closest('.ctx-menu-item');
    if (!item) return;
    const idx = parseInt(item.dataset.idx);
    const cmd = items[idx];
    if (cmd && cmd.action) cmd.action();
    hideCtxMenu();
  });
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
  renderSavedToolbar();
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

function toggleSavedStandard(id) {
  // 手机端禁用收藏：CSS 已经隐掉触发入口，这里再防一道键盘 / 外部脚本绕过
  if (typeof window !== 'undefined' && typeof window.isMobile === 'function' && window.isMobile()) return;
  const r = findResultByAnyId(id);
  if (!r) return;
  const key = standardSaveKey(r);
  const exists = savedStandards.some(s => s.key === key);
  if (exists) {
    savedStandards = savedStandards.filter(s => s.key !== key);
    showToast('已取消收藏');
  } else {
    savedStandards.unshift({
      key,
      id: r.id,
      standardNumber: r.standardNumber,
      title: r.title || '',
      status: r.status || '',
      sources: r.sources || [r._source],
      savedAt: Date.now(),
    });
    showToast('已加入收藏');
  }
  persistSavedStandards();
  renderResults();
  renderFilterBar();
  updateToolbar();
}

function renderSavedToolbar() {
  const savedCount = results.filter(r => isStandardSaved(r)).length;
  const countEl = document.getElementById('savedCount');
  const toggle = document.getElementById('savedOnlyToggle');
  const density = document.getElementById('densityToggle');
  if (countEl) countEl.textContent = `收藏 ${savedCount}`;
  if (toggle) {
    toggle.classList.toggle('active', filterState.onlySaved);
    toggle.disabled = results.length === 0;
  }
  if (density) {
    density.textContent = resultDensity === 'compact' ? '舒展' : '紧凑';
    density.classList.toggle('active', resultDensity === 'compact');
  }
}

document.getElementById('savedOnlyToggle').addEventListener('click', () => {
  filterState.onlySaved = !filterState.onlySaved;
  renderFilterBar(); renderResults(); updateToolbar();
});

document.getElementById('densityToggle').addEventListener('click', () => {
  setResultDensity(resultDensity === 'compact' ? 'comfortable' : 'compact');
  renderSavedToolbar();
});

document.getElementById('searchTemplates').addEventListener('click', e => {
  const btn = e.target.closest('[data-template]');
  if (!btn) return;
  const input = document.getElementById('searchInput');
  const template = btn.dataset.template || '';
  const current = input.value.trim();
  input.value = current && !current.startsWith(template.trim()) ? `${template}${current}` : template;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

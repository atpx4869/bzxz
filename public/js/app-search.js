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

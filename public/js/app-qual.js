// ── Qualification ──
let qualSearchSource = '';
let qualData = {}; // stdCode -> Qualification[] (from search result badges)
function beijingDate() { const d = new Date(new Date().getTime() + 8*3600000); return d.toISOString().slice(0, 10); }
function beijingTime() { const d = new Date(new Date().getTime() + 8*3600000); return d.toISOString().slice(0, 19).replace('T', ' '); }
function utcToBeijing(utcStr) { if (!utcStr) return ''; const d = new Date(utcStr); d.setTime(d.getTime() + 8*3600000); return d.toISOString().slice(0, 16).replace('T', ' '); }

function switchQualTab(tab) {
  // 订阅管理 / 同步日志 已迁移到「系统设置」，这里只保留搜索 + 可视化。
  if (tab === 'labs' || tab === 'logs') {
    if (typeof switchTab === 'function') switchTab('settings');
    setTimeout(() => switchQualSettingsTab(tab === 'logs' ? 'logs' : 'labs'), 0);
    return;
  }
  // 手机端两个子标签都可用（搜索 + 可视化）。早期版本曾强制重定向到可视化，
  // 但用户能看到「搜索」按钮却点不动反而更糟。窄屏下若搜索页有局部排版问题，
  // 应在 CSS 单点修，不要禁掉整个功能。
  document.querySelectorAll('.qual-tab').forEach(t => {
    const active = t.dataset.qualTab === tab;
    t.classList.toggle('active', active);
    t.style.color = active ? 'var(--text)' : 'var(--text-3)';
    t.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
  });
  const searchEl = document.getElementById('qualSearchTab');
  const visualEl = document.getElementById('qualVisualTab');
  if (searchEl) searchEl.style.display = tab === 'search' ? '' : 'none';
  if (visualEl) visualEl.style.display = tab === 'visual' ? '' : 'none';
}

// Sub-tab switcher for the qual-subscription section that lives inside
// the 系统设置 page. Tabs: 'labs' (订阅管理) or 'logs' (同步日志).
function switchQualSettingsTab(tab) {
  document.querySelectorAll('.qual-settings-tab').forEach(t => {
    const active = t.dataset.qualSettingsTab === tab;
    t.classList.toggle('active', active);
    t.style.color = active ? 'var(--text)' : 'var(--text-3)';
    t.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
  });
  const labsEl = document.getElementById('qualLabsTab');
  const logsEl = document.getElementById('qualLogsTab');
  if (labsEl) labsEl.style.display = tab === 'labs' ? '' : 'none';
  if (logsEl) logsEl.style.display = tab === 'logs' ? '' : 'none';
  if (tab === 'labs') {
    if (typeof loadQualLabs === 'function') loadQualLabs();
    if (typeof loadLabsSyncLogs === 'function') loadLabsSyncLogs();
  } else if (tab === 'logs') {
    if (typeof loadQualSyncLogs === 'function') loadQualSyncLogs('cnas');
  }
}

async function doQualBatchVisual() {
  const input = document.getElementById('qualBatchInput');
  // 行内分隔符：换行 / 逗号（中英）/ 分号（中英）/ 顿号 / 中文句号 / 制表符
  // 不切英文句号 `.`，否则 "GB 5009.9" 这类标准号会被切坏
  const queries = [...new Set(input.value.split(/[\n\r,，;；、。\t]+/).map(s => s.trim()).filter(Boolean))];
  const stats = document.getElementById('qualVisualStats');
  const out = document.getElementById('qualVisualResults');
  if (!queries.length) {
    stats.innerHTML = '请输入关键词';
    out.innerHTML = '';
    return;
  }
  stats.innerHTML = '<span class="spinner"></span> 正在查询本地缓存';
  out.innerHTML = '';
  try {
    const res = await fetch('/api/qualifications/visual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    });
    const data = await readQualApiJson(res);
    if (!res.ok) throw new Error(data.message || '查询失败');
    renderQualVisual(queries, data);
    // 手机模式：查询成功后折叠输入框，让结果占满视野
    if (typeof window.isMobile === 'function' && window.isMobile()) {
      const card = document.getElementById('qualVisualInputCard');
      if (card) card.classList.add('collapsed');
    }
  } catch (e) {
    stats.innerHTML = `<span style="color:var(--danger)">查询失败: ${escapeHtml(e.message)}</span>`;
  }
}

function expandQualVisualInput() {
  // 仅手机模式生效：折叠态点击标题 → 展开回 textarea
  if (typeof window.isMobile !== 'function' || !window.isMobile()) return;
  const card = document.getElementById('qualVisualInputCard');
  if (!card || !card.classList.contains('collapsed')) return;
  card.classList.remove('collapsed');
  const input = document.getElementById('qualBatchInput');
  if (input) setTimeout(() => input.focus(), 50);
}

function fillQualBatchFromSaved() {
  const input = document.getElementById('qualBatchInput');
  input.value = savedStandards.map(s => s.standardNumber).filter(Boolean).join('\n');
  input.focus();
}

function renderQualVisual(queries, data) {
  const stats = document.getElementById('qualVisualStats');
  const out = document.getElementById('qualVisualResults');
  const now = beijingDate();
  const visibleLabNames = new Set();

  let covered = 0, cnas = 0, cma = 0, expired = 0;
  for (const query of queries) {
    const items = data[query] || [];
    if (items.length) covered++;
    for (const it of items) {
      visibleLabNames.add(it.linkedLabName || it.labName || it.labNo || '未知机构');
      if (it.source === 'CNAS') cnas++;
      if (it.source === 'CMA') cma++;
      if (it.expiryDate && it.expiryDate < now) expired++;
    }
  }

  stats.innerHTML = `
    <div><strong>${covered}/${queries.length}</strong><span>关键词命中</span></div>
    <div><strong>${cnas}</strong><span>CNAS 能力</span></div>
    <div><strong>${cma}</strong><span>CMA 能力</span></div>
    <div class="${expired ? 'warn' : ''}"><strong>${expired}</strong><span>已过期记录</span></div>`;

  if (!queries.some(query => (data[query] || []).length)) {
    out.innerHTML = '<div class="qual-visual-result empty">本地缓存暂无匹配资质。请先在「系统设置 → 资质订阅」中订阅机构并同步能力。</div>';
    return;
  }

  function cleanStdName(code, name) {
    if (!name) return '';
    const escaped = String(code || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped
      ? name.replace(new RegExp('\\s*' + escaped + '\\s*$', 'i'), '').trim()
      : name;
  }

  function renderSourceColumn(title, sourceClass, items) {
    // Outer card already groups by stdCode, so flatten — show capabilities directly.
    if (!items.length) {
      return `<div class="qual-visual-source ${sourceClass} empty">
        <div class="qual-visual-source-head"><strong>${title}</strong><span>无匹配</span></div>
        <div class="qual-visual-empty-col">— 无本地缓存匹配 —</div>
      </div>`;
    }
    const INITIAL = 5;
    const gid = `qv_${sourceClass}_${Math.random().toString(36).slice(2)}`;
    const renderRow = (it) => {
      const expiredCls = it.expiryDate && it.expiryDate < now ? ' expired' : '';
      const chips = [
        it.category ? `<span>${escapeHtml(it.category)}</span>` : '',
        it.matchedQuery ? `<span>命中 ${escapeHtml(it.matchedQuery)}</span>` : '',
      ].filter(Boolean).join('');
      return `<div class="qual-visual-cap${expiredCls}">
        <div class="qual-visual-cap-main">${escapeHtml(it.testItem || it.testStandard || it.stdName || '能力记录')}</div>
        ${chips ? `<div class="qual-visual-cap-chips">${chips}</div>` : ''}
        ${it.testStandard ? `<div class="qual-visual-cap-std">${escapeHtml(it.testStandard)}</div>` : ''}
        ${it.limitDesc && it.limitDesc !== '/' && it.limitDesc !== '—' ? `<div class="qual-visual-cap-limit">限制: ${escapeHtml(it.limitDesc)}</div>` : ''}
        ${(it.effectiveDate || it.expiryDate) ? `<div class="qual-visual-cap-date">${it.effectiveDate ? '生效 ' + escapeHtml(it.effectiveDate) : ''}${it.expiryDate ? ' · 到期 ' + escapeHtml(it.expiryDate) : ''}</div>` : ''}
      </div>`;
    };
    const visibleRows = items.slice(0, INITIAL).map(renderRow).join('');
    const hiddenRows = items.length > INITIAL
      ? `<div class="qual-visual-more-wrap" id="${gid}_more" style="display:none">${items.slice(INITIAL).map(renderRow).join('')}</div>
         <button class="qual-visual-more-btn" id="${gid}_btn" onclick="toggleQualVisualMore('${gid}')">展开剩余 ${items.length - INITIAL} 条 ▼</button>`
      : '';
    return `<div class="qual-visual-source ${sourceClass}">
      <div class="qual-visual-source-head"><strong>${title}</strong><span>${items.length} 条</span></div>
      <div class="qual-visual-cap-list">${visibleRows}${hiddenRows}</div>
    </div>`;
  }

  const singleLab = visibleLabNames.size <= 1;
  function buildResultCard(group) {
    const total = group.cnas.length + group.cma.length;
    const labNamesArr = [...group.labNames];
    const labInfo = labNamesArr.length > 1 ? labNamesArr.map(n => escapeHtml(n)).join(' / ') : (labNamesArr[0] ? escapeHtml(labNamesArr[0]) : '');
    return `<div class="qual-visual-lab-card">
      <div class="qual-visual-lab-head" onclick="toggleQualVisualCard(this.parentElement)" style="cursor:pointer">
        <div>
          ${labInfo && !singleLab ? `<h4>${labInfo}</h4>` : ''}
          ${labInfo && singleLab ? `<span class="qual-visual-lab-muted">${escapeHtml(labInfo)}</span>` : ''}
          <div><span>${escapeHtml(group.stdCode || '未列标准号')}</span><span>${total} 条匹配能力</span></div>
          ${group.stdName ? `<p>${escapeHtml(group.stdName)}</p>` : ''}
        </div>
        <span class="qual-visual-lab-arrow" aria-hidden="true">▾</span>
      </div>
      <div class="qual-visual-lab-body">
        <div class="qual-visual-source-grid">
          ${renderSourceColumn('CMA', 'cma', group.cma)}
          ${renderSourceColumn('CNAS', 'cnas', group.cnas)}
        </div>
      </div>
    </div>`;
  }

  const sections = queries.map(query => {
    const sourceItems = data[query] || [];
    const itemSeen = new Set();
    const groups = new Map();
    for (const raw of sourceItems) {
      const it = { ...raw, matchedQuery: query };
      const dedupeKey = [it.source, it.labNo, it.stdCode, it.stdName, it.category, it.testItem, it.testStandard, it.limitDesc].join('|');
      if (itemSeen.has(dedupeKey)) continue;
      itemSeen.add(dedupeKey);
      const stdCode = it.stdCode || '未列标准号';
      // Group by stdCode only so CMA/CNAS for the same standard appear together
      if (!groups.has(stdCode)) groups.set(stdCode, {
        labNames: new Set(),
        stdCode,
        stdName: cleanStdName(stdCode, it.stdName || it.testStandard || ''),
        cnas: [],
        cma: [],
      });
      const g = groups.get(stdCode);
      g[it.source === 'CNAS' ? 'cnas' : 'cma'].push(it);
      g.labNames.add(it.linkedLabName || it.labName || it.labNo || '未知机构');
    }
    const cards = [...groups.values()].sort((a, b) => {
      const scoreA = (a.cma.length ? 1000 : 0) + (a.cnas.length ? 500 : 0) + a.cma.length + a.cnas.length;
      const scoreB = (b.cma.length ? 1000 : 0) + (b.cnas.length ? 500 : 0) + b.cma.length + b.cnas.length;
      return scoreB - scoreA;
    }).map(buildResultCard).join('');
    const sectionId = `qvs_${Math.random().toString(36).slice(2)}`;
    return `<section class="qual-visual-query-section" id="${sectionId}">
      <div class="qual-visual-query-head">
        <div><strong>${escapeHtml(query)}</strong><span>${groups.size ? groups.size + ' 条结果' : '无结果'}</span></div>
        <div class="qual-visual-query-actions">
          <button onclick="toggleQualVisualSection('${sectionId}', true)">全部展开</button>
          <button onclick="toggleQualVisualSection('${sectionId}', false)">全部折叠</button>
        </div>
      </div>
      ${cards || '<div class="qual-visual-result empty">本地缓存暂无匹配资质</div>'}
    </section>`;
  }).join('');

  out.innerHTML = `<div class="qual-visual-results">${sections}</div>`;
}

function toggleQualVisualMore(gid) {
  const wrap = document.getElementById(gid + '_more');
  const btn = document.getElementById(gid + '_btn');
  if (!wrap) return;
  const collapsed = wrap.style.display === 'none';
  wrap.style.display = collapsed ? '' : 'none';
  if (btn) btn.innerHTML = collapsed
    ? '收起 ▲'
    : `展开剩余 ${wrap.children.length} 条 ▼`;
}

function toggleQualVisualCard(card) {
  if (!card) return;
  card.classList.toggle('collapsed');
}

function toggleQualVisualSection(sectionId, expand) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  // 折叠/展开整张卡片（lab-body 通过 .collapsed 隐藏）
  section.querySelectorAll('.qual-visual-lab-card').forEach(card => {
    card.classList.toggle('collapsed', !expand);
  });
  // 展开时同步把每张卡片里的"展开剩余 N 条"也打开；折叠时不动溢出区
  // （反正卡片本体已隐藏，溢出区状态在用户下次展开卡片时再生效）
  if (expand) {
    section.querySelectorAll('.qual-visual-more-wrap').forEach(wrap => {
      wrap.style.display = '';
    });
    section.querySelectorAll('.qual-visual-more-btn').forEach(btn => {
      const wrap = btn.previousElementSibling;
      const cnt = wrap ? wrap.children.length : 0;
      btn.innerHTML = '收起 ▲';
      if (cnt === 0) btn.style.display = 'none';
    });
  }
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
    const data = await readApiResponse(res);
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
  const showLabName = new Set(items.map(it => it.linkedLabName || it.labName || it.labNo || '未知机构')).size > 1;

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
        if (showLabName && (it.linkedLabName || it.labName || it.labNo)) {
          parts.push('<div style="font-size:11px;color:var(--text-3);margin-bottom:3px">机构 ' + escapeHtml(it.linkedLabName || it.labName || it.labNo) + '</div>');
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
      // 手机端：点标准号头直接跳「标准搜索」并预填，桌面端保留展开/收起。
      // 决策见 onQualGroupClick 注释。code 内可能含特殊字符 → 转义反斜杠、单引号
      // 后塞进 onclick 的单引号字符串里。
      var codeJs = code.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      html += '<div class="qual-result-group">'
        + '<div class="qual-result-std" onclick="onQualGroupClick(\'' + gid + '\',\'' + codeJs + '\')" style="cursor:pointer">'
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

/**
 * 资质结果里标准号头的统一点击入口。
 *   - 手机端（≤640px 且未点「切换桌面版」）：直接跳到「标准搜索」tab 并预填 code、
 *     回车 doSearch。窄屏用户在资质页看到一个标准号，下一步就是想搜它能不能下到、
 *     看详情；让他先展开 5 行检测项目再去手动复制粘贴属于多此一举。
 *   - 桌面端：保持原 expand/collapse 行为不变，避免破坏宽屏批量浏览能力的工作流。
 */
function onQualGroupClick(gid, code) {
  var isMobile = window.matchMedia('(max-width: 640px)').matches
    && !document.body.classList.contains('force-desktop');
  if (isMobile && typeof switchTab === 'function') {
    switchTab('search');
    var input = document.getElementById('searchInput');
    if (input) {
      input.value = code;
      if (typeof doSearch === 'function') doSearch();
    }
    return;
  }
  toggleQualGroup(gid);
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
let qualCnasLabsCache = [];
let qualCmaLabsCache = [];

async function loadQualLabs() {
  try {
    const [cnasRes, cmaRes] = await Promise.all([fetch('/api/qualifications/labs/cnas'), fetch('/api/qualifications/labs/cma')]);
    const cnasData = await readApiResponse(cnasRes);
    const cmaData = await readApiResponse(cmaRes);
    const cnasLabs = cnasData.items || cnasData || [];
    const cmaLabs = cmaData.items || cmaData || [];
    qualCnasLabsCache = cnasLabs;
    qualCmaLabsCache = cmaLabs;
    renderQualLabs('cnas', cnasLabs);
    renderQualLabs('cma', cmaLabs);
    loadQualPresets();
  } catch (e) { /* silent */ }
}

async function loadQualPresets() {
  const box = document.getElementById('qualPresetCnas');
  if (!box) return;
  try {
    const res = await fetch('/api/qualifications/presets/cnas');
    const data = await readApiResponse(res);
    const items = (data && (data.items || data)) || [];
    if (!Array.isArray(items) || !items.length) {
      box.innerHTML = '<div style="color:var(--text-3);font-size:12px">暂无内置候选机构</div>';
      return;
    }
    box.innerHTML = items.map(it => {
      const labelEsc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const subscribed = !!it.subscribed;
      const btn = subscribed
        ? '<button class="btn btn-sm btn-ghost" disabled>已订阅</button>'
        : `<button class="btn btn-sm btn-primary" onclick="subscribeQualPreset('${labelEsc(it.labNo)}', this)">一键订阅</button>`;
      const meta = [it.certUpdateTs ? '认可更新 ' + it.certUpdateTs : '', it.validate ? '有效期 ' + it.validate : ''].filter(Boolean).join(' · ');
      return `<div class="qual-preset-item">
        <div class="qual-preset-info">
          <div class="qual-preset-name">${labelEsc(it.labName)} <span class="qual-preset-no">${labelEsc(it.labNo)}</span></div>
          ${it.note ? `<div class="qual-preset-note">${labelEsc(it.note)}</div>` : ''}
          ${meta ? `<div class="qual-preset-meta">${labelEsc(meta)}</div>` : ''}
        </div>
        <div class="qual-preset-actions">${btn}</div>
      </div>`;
    }).join('');
  } catch (e) {
    box.innerHTML = '<div style="color:var(--danger);font-size:12px">加载推荐订阅失败</div>';
  }
}

async function subscribeQualPreset(labNo, btn) {
  if (!labNo) return;
  if (btn) { btn.disabled = true; btn.textContent = '订阅中…'; }
  try {
    const res = await fetch('/api/qualifications/presets/cnas/' + encodeURIComponent(labNo) + '/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error((data && data.error) || '订阅失败');
    if (typeof showToast === 'function') showToast('订阅成功，开始同步…', 'success');
    try {
      await fetch('/api/qualifications/labs/cnas/sync?labNo=' + encodeURIComponent(labNo), { method: 'POST' });
    } catch (e) {}
    await loadQualLabs();
  } catch (e) {
    if (typeof showToast === 'function') showToast('订阅失败：' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '一键订阅'; }
  }
}

function formatSyncStatus(lab) {
  const statusColors = { success: 'var(--success)', syncing: 'var(--warning)', error: 'var(--danger)' };
  const color = statusColors[lab.syncStatus] || 'var(--text-3)';
  const statusText = lab.syncStatus || '—';
  if (lab.syncStatus === 'syncing' && lab.syncProgress) {
    const { fetched, total } = lab.syncProgress;
    const pct = total > 0 ? Math.round(fetched / total * 100) : 0;
    return `<span style="color:${color}">同步中</span> <span style="color:var(--accent);font-weight:600">${fetched}/${total > 0 ? total : '?'}</span>${total > 0 ? ` (${pct}%)` : ''}`;
  }
  return `<span style="color:${color}">${statusText}</span>`;
}

function renderQualLabs(type, labs) {
  const container = document.getElementById(type === 'cnas' ? 'qualCnasLabs' : 'qualCmaLabs');
  if (!labs.length) { container.innerHTML = '<div style="color:var(--text-3);font-size:12px;padding:8px 0">暂无订阅</div>'; return; }
  const nameField = type === 'cnas' ? 'lab_name' : 'lab_name';
  const idField = type === 'cnas' ? 'lab_no' : 'cert_number';
  container.innerHTML = labs.map(lab => {
    const syncInfo = lab.lastSyncAt ? `<span>${utcToBeijing(lab.lastSyncAt)}</span>` : '<span style="color:var(--text-3)">未同步</span>';
    const statusHtml = formatSyncStatus(lab);
    if (type === 'cma') {
      const certStatusColor = /正常|有效/.test(lab.certStatus || '') ? 'var(--success)' : 'var(--warning)';
      return `<div class="qual-lab-card">
        <div class="qual-lab-header">
          <div class="qual-lab-name">${escapeHtml(lab.labName || lab.certNumber)}</div>
          <div class="qual-lab-actions">
            <button onclick="linkQualLab('cma','${escapeHtml(lab.certNumber)}',${JSON.stringify(lab.labName || '').replace(/"/g, '&quot;')})">关联CNAS</button>
            <button onclick="syncQualLab('cma','${escapeHtml(lab.certNumber)}')">同步</button>
            <button class="danger" onclick="deleteQualLab('cma','${escapeHtml(lab.certNumber)}')">删除</button>
          </div>
        </div>
        <div class="qual-lab-meta">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 14px;line-height:1.6">
            <div>地址: <span>${escapeHtml(lab.address || '—')}</span></div>
            <div>证书编号: <span>${escapeHtml(lab.certNumber || '—')}</span></div>
            <div>证书颁发时间: <span>${escapeHtml(lab.issueDate || '—')}</span></div>
            <div>有效期起始: <span>${escapeHtml(lab.validFrom || '—')}</span></div>
            <div>有效期截止: <span>${escapeHtml(lab.validTo || '—')}</span></div>
            <div>证书状态: <span style="color:${certStatusColor}">${escapeHtml(lab.certStatus || '—')}</span></div>
          </div>
          <div style="margin-top:6px">同步状态: ${statusHtml} | 记录: <span>${lab.recordCount}</span> | 上次同步: ${syncInfo}</div>
          ${lab.linkedCnasLabNo ? `<div>已关联 CNAS: <span>${escapeHtml(lab.linkedCnasLabNo)}</span> · <button class="qual-inline-btn" onclick="unlinkQualLab('CMA','${escapeHtml(lab.certNumber)}')">取消关联</button></div>` : ''}
          ${lab.syncError ? `<div style="color:var(--danger);font-size:11px">${escapeHtml(lab.syncError)}</div>` : ''}
        </div>
      </div>`;
    }
    let certTasksHtml = '';
    try {
      const tasks = JSON.parse(lab.certTasks || '[]');
      if (tasks.length) {
        const taskRows = tasks.map(t => `<tr><td>${escapeHtml(t.taskNo)}</td><td>${escapeHtml(t.reviewType)}</td><td>${escapeHtml(t.signDate)}</td><td>${escapeHtml(t.scopeStatus)}</td></tr>`).join('');
        certTasksHtml = `<div class="qual-lab-tasks"><div class="qual-lab-tasks-title">证书附件（能力范围）</div><table class="qual-lab-tasks-table"><thead><tr><th>任务编号</th><th>评审类型</th><th>签发日期</th><th>公布状态</th></tr></thead><tbody>${taskRows}</tbody></table></div>`;
      }
    } catch { /* ignore */ }
    return `<div class="qual-lab-card">
      <div class="qual-lab-header">
        <div class="qual-lab-name">${escapeHtml((lab[nameField] && !/^[?]+$/.test(lab[nameField]) && lab[nameField].length > 1) ? lab[nameField] + '（' + lab[idField] + '）' : lab[idField])}</div>
        <div class="qual-lab-actions">
          <button onclick="editQualLabName('${type}','${escapeHtml(lab[idField])}',${JSON.stringify(lab[nameField] || '').replace(/"/g, '&quot;')})">编辑</button>
          <button onclick="linkQualLab('cnas','${escapeHtml(lab[idField])}',${JSON.stringify(lab[nameField] || '').replace(/"/g, '&quot;')})">关联CMA</button>
          <button onclick="syncQualLab('${type}','${escapeHtml(lab[idField])}')">同步</button>
          <button class="danger" onclick="deleteQualLab('${type}','${escapeHtml(lab[idField])}')">删除</button>
        </div>
      </div>
      <div class="qual-lab-meta">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:3px 12px;line-height:1.6">
          <div>注册编号: <span>${escapeHtml(lab.labNo || '—')}</span></div>
          ${lab.otherNames ? `<div>其他名称: <span>${escapeHtml(lab.otherNames)}</span></div>` : ''}
          ${lab.orgAddress ? `<div>单位地址: <span>${escapeHtml(lab.orgAddress)}</span></div>` : ''}
          ${lab.validityPeriod ? `<div>认可有效期限: <span>${escapeHtml(lab.validityPeriod)}</span></div>` : ''}
          ${lab.certUpdateTs ? `<div>证书更新日期: <span>${escapeHtml(lab.certUpdateTs)}</span></div>` : ''}
          ${lab.validate ? `<div>有效期至: <span>${escapeHtml(lab.validate)}</span></div>` : ''}
        </div>
        <div style="margin-top:5px">状态: ${statusHtml} | 记录: <span>${lab.recordCount}</span> | 上次同步: ${syncInfo}</div>
        ${lab.linkedCmaCertNumber ? `<div>已关联 CMA: <span>${escapeHtml(lab.linkedCmaCertNumber)}</span> · <button class="qual-inline-btn" onclick="unlinkQualLab('CNAS','${escapeHtml(lab[idField])}')">取消关联</button></div>` : ''}
        ${lab.syncError ? `<div style="color:var(--danger);font-size:11px">${escapeHtml(lab.syncError)}</div>` : ''}
      </div>
      ${certTasksHtml}
    </div>`;
  }).join('');
}

async function searchCmaLabCandidates() {
  const input = document.getElementById('qualCmaInput');
  const container = document.getElementById('qualCmaCandidates');
  const q = input.value.trim();
  if (!q) return;
  container.innerHTML = '<span class="spinner"></span> 正在搜索机构…';
  try {
    const res = await fetch(`/api/qualifications/labs/cma/search?q=${encodeURIComponent(q)}`);
    const data = await readQualApiJson(res);
    if (!res.ok) throw new Error(data.message || '搜索失败');
    const items = data.items || [];
    if (!items.length) {
      container.innerHTML = '<div style="color:var(--text-3);font-size:12px;padding:8px 0">未找到候选机构</div>';
      return;
    }
    container.innerHTML = items.map(item => {
      const id = escapeHtml(item.publicDetailId);
      return `
      <div class="qual-lab-card" style="margin-bottom:6px" data-cma-candidate="${id}">
        <div class="qual-lab-header">
          <div>
            <div class="qual-lab-name">${escapeHtml(item.sysName || '未命名机构')}</div>
            <div class="qual-lab-meta">行政区划: ${escapeHtml(item.areaName || '—')} | 行业: ${escapeHtml(item.majorCategory || '—')} | 状态: ${escapeHtml(item.licState || '—')}</div>
          </div>
          <div class="qual-lab-actions">
            <button data-cma-subscribe="${id}" onclick="subscribeCmaCandidate('${id}')">订阅</button>
          </div>
        </div>
        <div class="qual-cma-progress" data-cma-progress="${id}"></div>
      </div>
    `;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:var(--danger);font-size:12px;padding:8px 0">搜索失败: ${escapeHtml(e.message)}</div>`;
  }
}

async function subscribeCmaCandidate(publicDetailId) {
  const btn = document.querySelector(`[data-cma-subscribe="${cssEscape(publicDetailId)}"]`);
  const progress = document.querySelector(`[data-cma-progress="${cssEscape(publicDetailId)}"]`);
  const card = document.querySelector(`[data-cma-candidate="${cssEscape(publicDetailId)}"]`);
  document.querySelectorAll('[data-cma-subscribe]').forEach(b => { b.disabled = true; });
  if (btn) btn.innerHTML = '<span class="spinner"></span>订阅中';
  if (card) card.classList.add('is-working');
  if (progress) progress.innerHTML = '<span class="spinner"></span>正在获取证书详情，请稍候…';
  try {
    const res = await fetch('/api/qualifications/labs/cma', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicDetailId: publicDetailId }),
    });
    const data = await readQualApiJson(res);
    if (!res.ok) throw new Error(data.message || '订阅失败');
    if (progress) progress.innerHTML = `已订阅 ${escapeHtml(data.labName || data.certNumber || 'CMA 机构')}，正在刷新列表…`;
    loadQualLabs();
    setTimeout(() => { document.getElementById('qualCmaCandidates').innerHTML = ''; }, 900);
    showToast(`已订阅 CMA 机构: ${data.labName || data.certNumber}`);
  } catch (e) {
    document.querySelectorAll('[data-cma-subscribe]').forEach(b => { b.disabled = false; });
    if (btn) btn.innerHTML = '订阅';
    if (card) card.classList.remove('is-working');
    if (progress) progress.innerHTML = `<span style="color:var(--danger)">订阅失败: ${escapeHtml(e.message)}</span>`;
    showToast(`订阅失败: ${e.message}`, 'fail');
  }
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

async function readQualApiJson(res) {
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('接口返回了页面 HTML，后端可能还没重启或未加载最新路由');
    }
    throw new Error('接口返回格式不是 JSON');
  }
  // Unwrap Result envelope { data, error } if present
  if (parsed && typeof parsed === 'object' && 'data' in parsed && 'error' in parsed) {
    if (parsed.error) {
      return { code: parsed.error.code, message: parsed.error.message, details: parsed.error.details };
    }
    return parsed.data == null ? {} : parsed.data;
  }
  return parsed;
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
        body = { labNo: parsed.labNo, baseInfoId: parsed.baseInfoId, certUpdateTs: parsed.certUpdateTs, validate: parsed.validate, urlParams: parsed.urlParams };
      } else {
        body = { labNo: val };
      }
      const res = await fetch('/api/qualifications/labs/cnas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await readApiResponse(res); throw new Error(d.message); }
    } else {
      await searchCmaLabCandidates();
      return;
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
  const url = type === 'cnas' ? `/api/qualifications/labs/cnas/${encodeURIComponent(id)}` : `/api/qualifications/labs/cma/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labName: newName }),
    });
    if (!res.ok) { const d = await readApiResponse(res); throw new Error(d.message); }
    loadQualLabs();
    showToast('名称已更新');
  } catch (e) {
    showToast(`更新失败: ${e.message}`, 'fail');
  }
}

async function linkQualLab(type, id, currentName) {
  const candidates = type === 'cnas' ? qualCmaLabsCache : qualCnasLabsCache;
  const targetLabel = type === 'cnas' ? 'CMA证书编号' : 'CNAS实验室编号';
  const options = candidates.slice(0, 12).map(l => {
    const candidateId = type === 'cnas' ? l.certNumber : l.labNo;
    return `${candidateId} - ${l.labName || ''}`;
  }).join('\n');
  const targetId = prompt(`输入要关联的${targetLabel}：\n\n可选项：\n${options || '暂无可选订阅'}`, '');
  if (!targetId) return;
  const displayName = prompt('输入合并后显示的机构名称', currentName || '');
  if (!displayName) return;

  const body = type === 'cnas'
    ? { display_name: displayName, cnas_lab_no: id, cma_cert_number: targetId.trim() }
    : { display_name: displayName, cnas_lab_no: targetId.trim(), cma_cert_number: id };

  try {
    const res = await fetch('/api/qualifications/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await readQualApiJson(res);
    if (!res.ok) throw new Error(data.message || '关联失败');
    loadQualLabs();
    showToast('机构关联已保存');
  } catch (e) {
    showToast(`关联失败: ${e.message}`, 'fail');
  }
}

async function unlinkQualLab(source, id) {
  if (!await showConfirm({ title: '取消关联', body: '确定取消这组机构关联？', confirmText: '确定取消' })) return;
  try {
    const res = await fetch(`/api/qualifications/links/${source}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await readQualApiJson(res);
    if (!res.ok) throw new Error(data.message || '取消关联失败');
    loadQualLabs();
    showToast('机构关联已取消');
  } catch (e) {
    showToast(`取消关联失败: ${e.message}`, 'fail');
  }
}

function CnasScraper_parseUrl(url) {
  try {
    const u = new URL(url);
    const p = u.searchParams;
    const baseInfoId = p.get('baseInfoId');
    const licNo = p.get('licNo');
    if (!baseInfoId || !licNo) return null;
    const extraKeys = ['id', 'labType', 'scopeStr', 'orgEnOrCh', 'attactdate'];
    const urlParams = {};
    for (const key of extraKeys) {
      const val = p.get(key);
      if (val) urlParams[key] = val;
    }
    return { baseInfoId, labNo: licNo, certUpdateTs: p.get('certUpdateTs') || '', validate: p.get('validate') || '', urlParams };
  } catch { return null; }
}

async function deleteQualLab(type, id) {
  if (!await showConfirm({ title: '删除订阅', body: `确定删除 ${id} 及其所有资质数据？此操作不可恢复。`, danger: true, confirmText: '删除' })) return;
  const url = type === 'cnas' ? `/api/qualifications/labs/cnas/${encodeURIComponent(id)}` : `/api/qualifications/labs/cma/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error((await readApiResponse(res)).message);
    loadQualLabs();
    showToast('已删除');
  } catch (e) { showToast(`删除失败: ${e.message}`, 'fail'); }
}

let _qualSyncPollTimer = null;

function stopQualSyncPoll() {
  if (_qualSyncPollTimer) { clearInterval(_qualSyncPollTimer); _qualSyncPollTimer = null; }
}
(window._tabCleanup = window._tabCleanup || {}).qualSyncPoll = stopQualSyncPoll;

function startSyncProgressPoll() {
  if (_qualSyncPollTimer) return;
  _qualSyncPollTimer = setInterval(async () => {
    await loadQualLabs();
    const anySyncing = qualCnasLabsCache.some(l => l.syncStatus === 'syncing') || qualCmaLabsCache.some(l => l.syncStatus === 'syncing');
    if (!anySyncing) {
      clearInterval(_qualSyncPollTimer);
      _qualSyncPollTimer = null;
      loadLabsSyncLogs();
    }
  }, 2000);
}

async function syncQualLab(type, id) {
  const url = type === 'cnas' ? `/api/qualifications/labs/cnas/sync?labNo=${encodeURIComponent(id)}` : `/api/qualifications/labs/cma/sync?certNumber=${encodeURIComponent(id)}`;
  showToast(`正在同步 ${id}…`);
  startSyncProgressPoll();
  try {
    const res = await fetch(url, { method: 'POST' });
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error(data.message);
    loadQualLabs();
    loadLabsSyncLogs();
    showToast(`同步完成: ${data.records} 条记录`);
  } catch (e) { showToast(`同步失败: ${e.message}`, 'fail'); }
}

async function syncAllQualLabs() {
  showToast('正在同步全部实验室…');
  startSyncProgressPoll();
  try {
    const [cnasRes, cmaRes] = await Promise.all([
      fetch('/api/qualifications/labs/cnas/sync', { method: 'POST' }),
      fetch('/api/qualifications/labs/cma/sync', { method: 'POST' }),
    ]);
    await readApiResponse(cnasRes); await readApiResponse(cmaRes);
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
    const data = await readApiResponse(res);
    const logs = data.items || data || [];
    const container = document.getElementById('qualSyncLogs');
    if (!logs.length) { container.innerHTML = '<div style="color:var(--text-3);padding:16px 0;text-align:center">暂无同步记录</div>'; return; }
    const statusColors = { success: 'var(--success)', error: 'var(--danger)' };
    container.innerHTML = logs.map(l => {
      const time = utcToBeijing(l.startedAt);
      const idField = l.labNo || l.certNumber || '';
      return `<div class="qual-sync-log">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><span style="color:var(--text)">${escapeHtml(idField)}</span> ${escapeHtml(l.action)}</span>
          <span style="color:${statusColors[l.status] || 'var(--text-3)'}">${l.status}</span>
        </div>
        <div class="log-time">${time} | ${l.recordsFetched} 条${l.errorMessage ? ' | <span style="color:var(--danger)">' + escapeHtml(l.errorMessage) + '</span>' : ''}</div>
      </div>`;
    }).join('');
  } catch (e) { /* silent */ }
}

async function loadLabsSyncLogs() {
  const container = document.getElementById('qualLabsSyncLogs');
  if (!container) return;
  try {
    const [cnasRes, cmaRes] = await Promise.all([
      fetch('/api/qualifications/labs/cnas/sync-logs?limit=15'),
      fetch('/api/qualifications/labs/cma/sync-logs?limit=15'),
    ]);
    const cnasData = await readApiResponse(cnasRes);
    const cmaData = await readApiResponse(cmaRes);
    const cnasLogs = cnasData.items || cnasData || [];
    const cmaLogs = cmaData.items || cmaData || [];
    const allLogs = [
      ...cnasLogs.map(l => ({ ...l, _src: 'CNAS' })),
      ...cmaLogs.map(l => ({ ...l, _src: 'CMA' })),
    ].sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    if (!allLogs.length) { container.innerHTML = '<div style="color:var(--text-3);padding:16px 0;text-align:center">暂无同步记录</div>'; return; }
    const statusColors = { success: 'var(--success)', error: 'var(--danger)' };
    container.innerHTML = allLogs.slice(0, 30).map(l => {
      const time = utcToBeijing(l.startedAt);
      const idField = l.labNo || l.certNumber || '';
      return `<div class="qual-sync-log">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span><span style="color:var(--text-2);font-size:10px;margin-right:4px">${l._src}</span><span style="color:var(--text)">${escapeHtml(idField)}</span> ${escapeHtml(l.action)}</span>
          <span style="color:${statusColors[l.status] || 'var(--text-3)'}">${l.status}</span>
        </div>
        <div class="log-time">${time} | ${l.recordsFetched} 条${l.errorMessage ? ' | <span style="color:var(--danger)">' + escapeHtml(l.errorMessage) + '</span>' : ''}</div>
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
  // Badge text 只显示 source 简称（CNAS / CMA），保持两源视觉对齐；
  // 完整证书有效期 / 机构数等明细在 hover tooltip 里给。
  if (cnas.length) {
    const tip = buildQualTooltip(cnas, 'CNAS');
    html += `<span class="qual-badge qual-badge-cnas"><span class="qual-dot"></span>CNAS<span class="qual-tooltip">${tip}</span></span>`;
  }
  if (cma.length) {
    const tip = buildQualTooltip(cma, 'CMA');
    html += `<span class="qual-badge qual-badge-cma"><span class="qual-dot"></span>CMA<span class="qual-tooltip">${tip}</span></span>`;
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
    const res = await fetch('/api/qualifications/batch-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stdCodes: unique }),
    });
    if (!res.ok) return;
    const data = await readApiResponse(res);
    qualData = data;
  } catch { /* silent */ }
}

// ── Init ──
checkAuthStatus();

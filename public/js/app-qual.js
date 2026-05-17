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
  document.getElementById('qualVisualTab').style.display = tab === 'visual' ? '' : 'none';
  document.getElementById('qualLabsTab').style.display = tab === 'labs' ? '' : 'none';
  document.getElementById('qualLogsTab').style.display = tab === 'logs' ? '' : 'none';
  if (tab === 'labs') { loadQualLabs(); loadLabsSyncLogs(); }
  if (tab === 'logs') loadQualSyncLogs('cnas');
}

async function doQualBatchVisual() {
  const input = document.getElementById('qualBatchInput');
  const queries = [...new Set(input.value.split(/[\n\r,，;；]+/).map(s => s.trim()).filter(Boolean))];
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
  } catch (e) {
    stats.innerHTML = `<span style="color:var(--danger)">查询失败: ${escapeHtml(e.message)}</span>`;
  }
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
    out.innerHTML = '<div class="qual-visual-result empty">本地缓存暂无匹配资质。请先在订阅管理中订阅机构并同步能力。</div>';
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
    const grouped = new Map();
    for (const it of items) {
      const code = it.stdCode || '未列标准号';
      if (!grouped.has(code)) grouped.set(code, { code, name: cleanStdName(code, it.stdName || it.testStandard || ''), items: [] });
      grouped.get(code).items.push(it);
    }
    const blocks = [...grouped.values()].map((g, idx) => {
      const gid = `qv_${sourceClass}_${Math.random().toString(36).slice(2)}_${idx}`;
      const rows = g.items.slice(0, 8).map(it => {
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
      }).join('');
      const more = g.items.length > 8 ? `<div class="qual-visual-more">还有 ${g.items.length - 8} 条匹配能力</div>` : '';
      return `<div class="qual-visual-standard">
        <div class="qual-visual-standard-head" onclick="toggleQualVisualStandard('${gid}')">
          <div>
            <span class="qual-visual-arrow" id="${gid}_arrow">▶</span>
            <strong>${escapeHtml(g.code)}</strong>
          </div>
          <span>${g.items.length} 条</span>
        </div>
        ${g.name ? `<div class="qual-visual-standard-name">${escapeHtml(g.name)}</div>` : ''}
        <div class="qual-visual-standard-body" id="${gid}_body" style="display:none">${rows}${more}</div>
      </div>`;
    }).join('');
    return `<div class="qual-visual-source ${sourceClass}">
      <div class="qual-visual-source-head"><strong>${title}</strong><span>${items.length ? items.length + ' 条' : '无匹配'}</span></div>
      ${blocks || '<div class="qual-visual-empty-col">无本地缓存匹配</div>'}
    </div>`;
  }

  const singleLab = visibleLabNames.size <= 1;
  function buildResultCard(group) {
    const total = group.cnas.length + group.cma.length;
    const labNamesArr = [...group.labNames];
    const labInfo = labNamesArr.length > 1 ? labNamesArr.map(n => escapeHtml(n)).join(' / ') : (labNamesArr[0] ? escapeHtml(labNamesArr[0]) : '');
    return `<div class="qual-visual-lab-card">
      <div class="qual-visual-lab-head">
        <div>
          ${labInfo && !singleLab ? `<h4>${labInfo}</h4>` : ''}
          ${labInfo && singleLab ? `<span class="qual-visual-lab-muted">${escapeHtml(labInfo)}</span>` : ''}
          <div><span>${escapeHtml(group.stdCode || '未列标准号')}</span><span>${total} 条匹配能力</span></div>
          ${group.stdName ? `<p>${escapeHtml(group.stdName)}</p>` : ''}
        </div>
      </div>
      <div class="qual-visual-source-grid">
        ${renderSourceColumn('CMA', 'cma', group.cma)}
        ${renderSourceColumn('CNAS', 'cnas', group.cnas)}
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

function toggleQualVisualStandard(gid) {
  const body = document.getElementById(gid + '_body');
  const arrow = document.getElementById(gid + '_arrow');
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if (arrow) arrow.style.transform = collapsed ? 'rotate(90deg)' : '';
}

function toggleQualVisualSection(sectionId, expand) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.querySelectorAll('.qual-visual-standard-body').forEach(body => {
    body.style.display = expand ? '' : 'none';
  });
  section.querySelectorAll('.qual-visual-arrow').forEach(arrow => {
    arrow.style.transform = expand ? 'rotate(90deg)' : '';
  });
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
let qualCnasLabsCache = [];
let qualCmaLabsCache = [];

async function loadQualLabs() {
  try {
    const [cnasRes, cmaRes] = await Promise.all([fetch('/api/cnas/labs'), fetch('/api/cma/labs')]);
    const cnasLabs = await cnasRes.json();
    const cmaLabs = await cmaRes.json();
    qualCnasLabsCache = cnasLabs || [];
    qualCmaLabsCache = cmaLabs || [];
    renderQualLabs('cnas', cnasLabs);
    renderQualLabs('cma', cmaLabs);
  } catch (e) { /* silent */ }
}

function formatSyncStatus(lab) {
  const statusColors = { success: 'var(--success)', syncing: 'var(--warning)', error: 'var(--danger)' };
  const color = statusColors[lab.sync_status] || 'var(--text-3)';
  const statusText = lab.sync_status || '—';
  if (lab.sync_status === 'syncing' && lab.sync_progress) {
    const { fetched, total } = lab.sync_progress;
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
    const syncInfo = lab.last_sync_at ? `<span>${utcToBeijing(lab.last_sync_at)}</span>` : '<span style="color:var(--text-3)">未同步</span>';
    const statusHtml = formatSyncStatus(lab);
    if (type === 'cma') {
      const certStatusColor = /正常|有效/.test(lab.cert_status || '') ? 'var(--success)' : 'var(--warning)';
      return `<div class="qual-lab-card">
        <div class="qual-lab-header">
          <div class="qual-lab-name">${escapeHtml(lab.lab_name || lab.cert_number)}</div>
          <div class="qual-lab-actions">
            <button onclick="linkQualLab('cma','${escapeHtml(lab.cert_number)}',${JSON.stringify(lab.lab_name || '').replace(/"/g, '&quot;')})">关联CNAS</button>
            <button onclick="syncQualLab('cma','${escapeHtml(lab.cert_number)}')">同步</button>
            <button class="danger" onclick="deleteQualLab('cma','${escapeHtml(lab.cert_number)}')">删除</button>
          </div>
        </div>
        <div class="qual-lab-meta">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 14px;line-height:1.6">
            <div>地址: <span>${escapeHtml(lab.address || '—')}</span></div>
            <div>证书编号: <span>${escapeHtml(lab.cert_number || '—')}</span></div>
            <div>证书颁发时间: <span>${escapeHtml(lab.issue_date || '—')}</span></div>
            <div>有效期起始: <span>${escapeHtml(lab.valid_from || '—')}</span></div>
            <div>有效期截止: <span>${escapeHtml(lab.valid_to || '—')}</span></div>
            <div>证书状态: <span style="color:${certStatusColor}">${escapeHtml(lab.cert_status || '—')}</span></div>
          </div>
          <div style="margin-top:6px">同步状态: ${statusHtml} | 记录: <span>${lab.record_count}</span> | 上次同步: ${syncInfo}</div>
          ${lab.linked_cnas_lab_no ? `<div>已关联 CNAS: <span>${escapeHtml(lab.linked_cnas_lab_no)}</span> · <button class="qual-inline-btn" onclick="unlinkQualLab('CMA','${escapeHtml(lab.cert_number)}')">取消关联</button></div>` : ''}
          ${lab.sync_error ? `<div style="color:var(--danger);font-size:11px">${escapeHtml(lab.sync_error)}</div>` : ''}
        </div>
      </div>`;
    }
    let certTasksHtml = '';
    try {
      const tasks = JSON.parse(lab.cert_tasks || '[]');
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
          <div>注册编号: <span>${escapeHtml(lab.lab_no || '—')}</span></div>
          ${lab.other_names ? `<div>其他名称: <span>${escapeHtml(lab.other_names)}</span></div>` : ''}
          ${lab.org_address ? `<div>单位地址: <span>${escapeHtml(lab.org_address)}</span></div>` : ''}
          ${lab.validity_period ? `<div>认可有效期限: <span>${escapeHtml(lab.validity_period)}</span></div>` : ''}
          ${lab.cert_update_ts ? `<div>证书更新日期: <span>${escapeHtml(lab.cert_update_ts)}</span></div>` : ''}
          ${lab.validate ? `<div>有效期至: <span>${escapeHtml(lab.validate)}</span></div>` : ''}
        </div>
        <div style="margin-top:5px">状态: ${statusHtml} | 记录: <span>${lab.record_count}</span> | 上次同步: ${syncInfo}</div>
        ${lab.linked_cma_cert_number ? `<div>已关联 CMA: <span>${escapeHtml(lab.linked_cma_cert_number)}</span> · <button class="qual-inline-btn" onclick="unlinkQualLab('CNAS','${escapeHtml(lab[idField])}')">取消关联</button></div>` : ''}
        ${lab.sync_error ? `<div style="color:var(--danger);font-size:11px">${escapeHtml(lab.sync_error)}</div>` : ''}
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
    const res = await fetch(`/api/cma/search-labs?q=${encodeURIComponent(q)}`);
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
    const res = await fetch('/api/cma/labs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_detail_id: publicDetailId }),
    });
    const data = await readQualApiJson(res);
    if (!res.ok) throw new Error(data.message || '订阅失败');
    if (progress) progress.innerHTML = `已订阅 ${escapeHtml(data.lab_name || data.cert_number || 'CMA 机构')}，正在刷新列表…`;
    loadQualLabs();
    setTimeout(() => { document.getElementById('qualCmaCandidates').innerHTML = ''; }, 900);
    showToast(`已订阅 CMA 机构: ${data.lab_name || data.cert_number}`);
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
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
      throw new Error('接口返回了页面 HTML，后端可能还没重启或未加载最新路由');
    }
    throw new Error('接口返回格式不是 JSON');
  }
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
        body = { lab_no: parsed.labNo, base_info_id: parsed.baseInfoId, cert_update_ts: parsed.certUpdateTs, validate: parsed.validate, url_params: parsed.urlParams };
      } else {
        body = { lab_no: val };
      }
      const res = await fetch('/api/cnas/labs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message); }
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

async function linkQualLab(type, id, currentName) {
  const candidates = type === 'cnas' ? qualCmaLabsCache : qualCnasLabsCache;
  const targetLabel = type === 'cnas' ? 'CMA证书编号' : 'CNAS实验室编号';
  const options = candidates.slice(0, 12).map(l => {
    const candidateId = type === 'cnas' ? l.cert_number : l.lab_no;
    return `${candidateId} - ${l.lab_name || ''}`;
  }).join('\n');
  const targetId = prompt(`输入要关联的${targetLabel}：\n\n可选项：\n${options || '暂无可选订阅'}`, '');
  if (!targetId) return;
  const displayName = prompt('输入合并后显示的机构名称', currentName || '');
  if (!displayName) return;

  const body = type === 'cnas'
    ? { display_name: displayName, cnas_lab_no: id, cma_cert_number: targetId.trim() }
    : { display_name: displayName, cnas_lab_no: targetId.trim(), cma_cert_number: id };

  try {
    const res = await fetch('/api/qualification-links', {
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
  if (!confirm('确定取消这组机构关联？')) return;
  try {
    const res = await fetch(`/api/qualification-links/${source}/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
  if (!confirm(`确定删除 ${id} 及其所有资质数据？`)) return;
  const url = type === 'cnas' ? `/api/cnas/labs/${encodeURIComponent(id)}` : `/api/cma/labs/${encodeURIComponent(id)}`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).message);
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
    const anySyncing = qualCnasLabsCache.some(l => l.sync_status === 'syncing') || qualCmaLabsCache.some(l => l.sync_status === 'syncing');
    if (!anySyncing) {
      clearInterval(_qualSyncPollTimer);
      _qualSyncPollTimer = null;
      loadLabsSyncLogs();
    }
  }, 2000);
}

async function syncQualLab(type, id) {
  const url = type === 'cnas' ? `/api/cnas/sync?lab_no=${encodeURIComponent(id)}` : `/api/cma/sync?cert_number=${encodeURIComponent(id)}`;
  showToast(`正在同步 ${id}…`);
  startSyncProgressPoll();
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
  startSyncProgressPoll();
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

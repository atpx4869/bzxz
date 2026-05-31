// 标准查新（见 docs/CHECK-UPDATE-AND-STATS.md）。Phase 1：导入清单 → 后端查三源存基线 +
// 立即 diff（首次基线==最新，故首查通常无变动）→ 分组渲染。后续在同一清单上「重新查新」才出变动。
// Phase 1 先做"建清单即查"的最小闭环；清单管理/Excel 导入是 Phase 2。

let checkCurrentWatchlistId = null;

const CHECK_FLAG_LABEL = {
  status: ['状态变化', 'bad'],
  newVersion: ['有新版本', 'warn'],
  implDate: ['实施日期变化', 'info'],
  replacedBy: ['被代替', 'info'],
};

async function doCheckImport() {
  const ta = document.getElementById('checkInput');
  const lines = (ta.value || '').split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) { showToast('请粘贴标准号', 'fail'); return; }
  const btn = document.getElementById('checkRunBtn');
  btn.disabled = true; btn.textContent = '查新中…';
  document.getElementById('checkResults').innerHTML = '<div class="check-empty">正在按三源逐个查新，请稍候…</div>';
  try {
    const res = await apiFetch('/api/check/watchlists', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines }),
    });
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error(data.message || '查新失败');
    checkCurrentWatchlistId = data.id;
    await loadCheckItems(data.id);
    showToast(`已导入 ${data.itemCount} 项并完成查新`);
  } catch (e) {
    document.getElementById('checkResults').innerHTML = `<div class="check-empty">查新失败：${escapeHtml(e.message)}</div>`;
    showToast(`查新失败：${e.message}`, 'fail');
  }
  btn.disabled = false; btn.textContent = '导入并查新';
}

async function doRecheck() {
  if (!checkCurrentWatchlistId) return;
  const btn = document.getElementById('checkRecheckBtn');
  if (btn) { btn.disabled = true; btn.textContent = '查新中…'; }
  try {
    const res = await apiFetch(`/api/check/watchlists/${checkCurrentWatchlistId}/recheck`, { method: 'POST' });
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error(data.message || '查新失败');
    renderCheckItems(data.items || []);
    showToast('已重新查新');
  } catch (e) { showToast(`查新失败：${e.message}`, 'fail'); }
  if (btn) { btn.disabled = false; btn.textContent = '重新查新'; }
}

async function loadCheckItems(id) {
  const res = await apiFetch(`/api/check/watchlists/${id}`);
  const data = await readApiResponse(res);
  renderCheckItems(data.items || []);
}

function renderCheckItems(items) {
  const host = document.getElementById('checkResults');
  if (!items.length) { host.innerHTML = '<div class="check-empty">清单为空</div>'; return; }
  const changed = items.filter(i => (i.changeFlags || []).length > 0);
  const notFound = items.filter(i => i.sourceUsed === 'not_found');
  const noChange = items.filter(i => (i.changeFlags || []).length === 0 && i.sourceUsed !== 'not_found');

  const stats = `<div class="set-stats" style="margin-bottom:16px">
    <div class="set-stat"><div class="set-stat-value">${items.length}</div><div class="set-stat-label">总计</div></div>
    <div class="set-stat is-bad"><div class="set-stat-value">${changed.length}</div><div class="set-stat-label">有变动</div></div>
    <div class="set-stat is-ok"><div class="set-stat-value">${noChange.length}</div><div class="set-stat-label">无变动</div></div>
    <div class="set-stat"><div class="set-stat-value">${notFound.length}</div><div class="set-stat-label">无法核验</div></div>
  </div>
  <div class="check-toolbar"><button class="btn btn-sm btn-ghost" id="checkRecheckBtn" onclick="doRecheck()">重新查新</button></div>`;

  let html = stats;
  if (changed.length) {
    html += `<div class="check-group-title">⚠ 有变动（${changed.length}）</div>`;
    html += changed.map(renderCheckChangedItem).join('');
  }
  if (noChange.length) {
    html += `<div class="check-group-title">无变动（${noChange.length}）</div>`;
    html += `<div class="check-nochange" onclick="this.classList.toggle('open')">
      <div class="check-nc-head"><span class="check-caret">▸</span>${noChange.length} 项与上次查新一致，点击展开</div>
      <div class="check-nc-body">${noChange.map(i =>
        `<div class="check-nc-row"><span class="check-code">${escapeHtml(i.stdCode)}</span><span class="check-title">${escapeHtml(i.lastTitle || '')}</span><span class="badge-ok">${escapeHtml(statusText(i.lastStatus))} · 无变动</span></div>`
      ).join('')}</div>
    </div>`;
  }
  if (notFound.length) {
    html += `<div class="check-group-title">无法核验（${notFound.length}）</div>`;
    html += notFound.map(i =>
      `<div class="check-item nf"><div class="check-item-head"><span class="check-code">${escapeHtml(i.stdCode)}</span><span class="check-title muted">三源均未命中</span></div></div>`
    ).join('');
  }
  host.innerHTML = html;
}

function renderCheckChangedItem(i) {
  const flags = (i.changeFlags || []).map(f => {
    const m = CHECK_FLAG_LABEL[f] || [f, 'info'];
    return `<span class="check-badge ${m[1]}">${m[0]}</span>`;
  }).join(' ');
  const sev = (i.changeFlags || []).includes('status') ? 'bad' : ((i.changeFlags || []).includes('newVersion') ? 'warn' : 'info');
  const diffRows = [];
  if ((i.changeFlags || []).includes('status'))
    diffRows.push(diffRow('状态', statusText(i.baseStatus), statusText(i.lastStatus)));
  if ((i.changeFlags || []).includes('implDate'))
    diffRows.push(diffRow('实施日期', i.baseImplDate || '—', i.lastImplDate || '—'));
  if ((i.changeFlags || []).includes('replacedBy'))
    diffRows.push(`<dt>被代替</dt><dd><span class="diff-new">${escapeHtml(i.lastReplacedBy || '')}</span></dd>`);
  if ((i.changeFlags || []).includes('newVersion'))
    diffRows.push(`<dt>新版本</dt><dd><span class="diff-new">检出同基础号更新年版</span>（据 ${escapeHtml(i.sourceUsed || '源')}）</dd>`);
  return `<div class="check-item ${sev}" onclick="this.classList.toggle('open')">
    <div class="check-item-head">
      <span class="check-caret">▸</span>
      <span class="check-code">${escapeHtml(i.stdCode)}</span>
      <span class="check-title">${escapeHtml(i.lastTitle || i.baseTitle || '')}</span>
      <span class="check-badges">${flags}</span>
    </div>
    <div class="check-detail"><dl class="check-diff">${diffRows.join('')}</dl></div>
  </div>`;
}

function diffRow(label, oldV, newV) {
  return `<dt>${label}</dt><dd><span class="diff-old">${escapeHtml(oldV)}</span><span class="diff-new">${escapeHtml(newV)}</span></dd>`;
}
function statusText(s) { return s || '—'; }

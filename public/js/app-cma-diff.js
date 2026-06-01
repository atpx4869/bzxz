/**
 * CMA 一单一库比对页（tab="cma-diff"）。
 *
 * 整体逻辑：
 *  1) switchTab('cma-diff') 触发 loadCapLibPage()，并发拉 domains / summary / labs
 *  2) 用户勾领域 → PUT /api/cma-diff/domains/:name/subscribe（仅 admin）
 *  3) 点「立即同步」→ POST /api/cma-diff/sync/:name 拿 jobId → 1.5s 轮询 progress
 *  4) 同步完成 → window.capLibInvalidateCache() + 重渲整页
 *
 * 与其它 tab 的解耦：本文件只动 #page-cma-diff 内的 DOM，不干扰任何全局状态。
 * window._tabCleanup.capLibDiff 用于离开 tab 时停止进度轮询。
 */

(function () {
  if (typeof window === 'undefined') return;

  const DIFF_STATUS_META = {
    in_lib:      { label: '在库',         color: 'var(--ok)',         emoji: '✅' },
    cite_only:   { label: '废止·可引用',   color: 'var(--warning)',    emoji: '⚠'  },
    abolished:   { label: '已废止',       color: '#d97706',           emoji: '🟠' },
    series_only: { label: '年版过期',     color: 'var(--danger)',     emoji: '🔴' },
    not_in_lib:  { label: '未入库',       color: '#7f1d1d',           emoji: '⛔' },
  };
  const STATUS_ORDER = ['in_lib', 'cite_only', 'abolished', 'series_only', 'not_in_lib'];

  /** 进度轮询定时器 jobId → setInterval handle */
  const progressTimers = new Map();

  window._tabCleanup = window._tabCleanup || {};
  window._tabCleanup.capLibDiff = function () {
    for (const t of progressTimers.values()) clearInterval(t);
    progressTimers.clear();
  };

  // ── 入口 ──────────────────────────────────────────────────────────

  window.loadCapLibPage = async function loadCapLibPage() {
    const adminBtn = document.getElementById('capLibCleanupBtn');
    if (adminBtn) adminBtn.style.display = (window.currentUser && window.currentUser.role === 'admin') ? '' : 'none';
    const syncBtn = document.getElementById('capLibSyncAllBtn');
    if (syncBtn) syncBtn.disabled = !(window.currentUser && window.currentUser.role === 'admin');
    if (syncBtn) syncBtn.title = syncBtn.disabled ? '仅管理员可触发同步' : '同步勾选的领域';

    await Promise.all([renderDomains(), renderSummary(), renderLabs()]);
  };

  // 在 app-core.switchTab 末尾 case 列表里没本 tab 的特殊 hook，所以这里订阅 tabchange 事件
  window.addEventListener('tabchange', function (e) {
    const tab = e && e.detail && e.detail.tab;
    if (tab === 'cma-diff') {
      try { loadCapLibPage(); } catch { /* ignore */ }
    }
  });

  // ── 领域订阅 + 同步 ───────────────────────────────────────────────

  async function renderDomains() {
    const box = document.getElementById('capLibDomainsBody');
    if (!box) return;
    try {
      const res = await fetch('/api/cma-diff/domains');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await readApiResponse(res);
      const items = (data && data.items) || [];
      if (!items.length) { box.innerHTML = '<div style="color:var(--text-3)">无领域数据</div>'; return; }
      const isAdmin = window.currentUser && window.currentUser.role === 'admin';
      box.innerHTML = '<div class="cap-lib-dom-table">' + items.map(it => {
        const synced = it.lastSyncedAt ? formatDateTime(it.lastSyncedAt) : '从未';
        const remote = it.remoteTotal ? it.remoteTotal.toLocaleString() : '?';
        const local = it.localTotal ? it.localTotal.toLocaleString() : '0';
        const stats = it.lastSyncStats;
        const statsHtml = stats
          ? `<span class="cap-lib-dom-stats">+${stats.added} 改${stats.changed} 留${stats.unchanged}${stats.removedSoft ? ' 远端少' + stats.removedSoft : ''}</span>`
          : '';
        const checked = it.subscribed ? 'checked' : '';
        const subAttr = isAdmin ? '' : 'disabled';
        const syncBtn = isAdmin
          ? `<button class="btn btn-sm btn-ghost" onclick="capLibSyncOne('${escAttr(it.domain)}', this)">${it.lastSyncedAt ? '刷新' : '拉取'}</button>`
          : '';
        return `
          <div class="cap-lib-dom-row" data-domain="${escAttr(it.domain)}">
            <label class="cap-lib-dom-check">
              <input type="checkbox" ${checked} ${subAttr}
                onchange="capLibToggleSub('${escAttr(it.domain)}', this.checked)">
              <span class="cap-lib-dom-name">${escHtml(it.domain)}</span>
            </label>
            <div class="cap-lib-dom-counts">
              <span class="cap-lib-dom-total" title="本地 / 远端">${local} / ${remote}</span>
              ${statsHtml}
            </div>
            <div class="cap-lib-dom-synced">${escHtml(synced)}</div>
            <div class="cap-lib-dom-actions">${syncBtn}
              <div class="cap-lib-dom-progress" id="capLibDomProg-${escAttr(it.domain)}"></div>
            </div>
          </div>`;
      }).join('') + '</div>';
    } catch (e) {
      box.innerHTML = `<div style="color:var(--danger)">加载失败：${escHtml(e.message || String(e))}</div>`;
    }
  }

  window.capLibToggleSub = async function (domain, subscribed) {
    try {
      const res = await fetch('/api/cma-diff/domains/' + encodeURIComponent(domain) + '/subscribe', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribed }),
      });
      if (!res.ok) {
        const txt = await res.text();
        showToast('保存失败：' + (txt || res.status), 'fail');
      }
    } catch (e) {
      showToast('保存失败：' + (e.message || e), 'fail');
    }
  };

  window.capLibSyncOne = async function (domain, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
    try {
      const res = await fetch('/api/cma-diff/sync/' + encodeURIComponent(domain), { method: 'POST' });
      if (!res.ok) {
        const txt = await res.text();
        showToast('启动同步失败：' + (txt || res.status), 'fail');
        if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
        return;
      }
      const body = await readApiResponse(res);
      pollSyncProgress(body.jobId, domain, btn);
    } catch (e) {
      showToast('启动同步失败：' + (e.message || e), 'fail');
      if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
    }
  };

  window.capLibSyncAll = async function () {
    const btn = document.getElementById('capLibSyncAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
    try {
      const res = await fetch('/api/cma-diff/sync-all', { method: 'POST' });
      if (!res.ok) {
        const txt = await res.text();
        showToast('启动同步失败：' + (txt || res.status), 'fail');
        return;
      }
      const body = await readApiResponse(res);
      const jobs = (body && body.jobs) || [];
      if (!jobs.length) {
        showToast('没有勾选领域可同步', 'fail');
        return;
      }
      for (const j of jobs) pollSyncProgress(j.jobId, j.domain, null);
    } catch (e) {
      showToast('启动同步失败：' + (e.message || e), 'fail');
    } finally {
      if (btn) { setTimeout(function () { btn.disabled = false; btn.textContent = '同步勾选领域'; }, 600); }
    }
  };

  function pollSyncProgress(jobId, domain, btn) {
    if (progressTimers.has(jobId)) return; // 同 jobId 已在轮询
    const progEl = document.getElementById('capLibDomProg-' + domain);
    const tick = async function () {
      try {
        const res = await fetch('/api/cma-diff/sync/progress/' + encodeURIComponent(jobId));
        if (!res.ok) { stop(); return; }
        const p = await readApiResponse(res);
        const pct = p.total ? Math.min(100, Math.round((p.current || 0) / p.total * 100)) : 0;
        if (progEl) {
          progEl.innerHTML = '<div class="cap-lib-prog-bar"><div style="width:' + pct + '%"></div></div>'
            + '<span class="cap-lib-prog-text">' + escHtml(phaseLabel(p.phase)) + ' ' + pct + '%</span>';
        }
        if (p.phase === 'done') {
          showToast('「' + domain + '」同步完成 · 新增 ' + (p.stats?.added || 0) + ' / 变更 ' + (p.stats?.changed || 0));
          stop();
          if (window.capLibInvalidateCache) window.capLibInvalidateCache();
          window.loadCapLibPage();
        } else if (p.phase === 'error') {
          showToast('「' + domain + '」同步失败：' + (p.error || '未知错误'), 'fail');
          stop();
        }
      } catch (e) { stop(); }
    };
    const stop = function () {
      const h = progressTimers.get(jobId); if (h) clearInterval(h);
      progressTimers.delete(jobId);
      if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
    };
    tick();
    progressTimers.set(jobId, setInterval(tick, 1500));
  }

  function phaseLabel(phase) {
    switch (phase) {
      case 'pending': return '排队';
      case 'fetching': return '拉取中';
      case 'parsing': return '解析中';
      case 'upserting': return '入库中';
      case 'done': return '完成';
      case 'error': return '失败';
      default: return phase || '';
    }
  }

  // ── 摘要卡 ────────────────────────────────────────────────────────

  async function renderSummary() {
    const box = document.getElementById('capLibSummaryBody');
    if (!box) return;
    try {
      const res = await fetch('/api/cma-diff/summary');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await readApiResponse(res);
      const by = data.byStatus || {};
      const tiles = STATUS_ORDER.map(k => {
        const meta = DIFF_STATUS_META[k];
        return `<div class="cap-lib-stat-tile" style="border-left:3px solid ${meta.color}">
          <div class="cap-lib-stat-num">${meta.emoji} ${(by[k] || 0).toLocaleString()}</div>
          <div class="cap-lib-stat-lab">${escHtml(meta.label)}</div>
        </div>`;
      }).join('');
      const unsynced = (data.unsyncedDomains && data.unsyncedDomains.length)
        ? `<div class="cap-lib-warn">⚠ 已订阅但从未同步的领域：${data.unsyncedDomains.map(escHtml).join('、')}</div>`
        : '';
      box.innerHTML = `
        <div class="cap-lib-summary-head">订阅 CMA 机构 <b>${data.labCount || 0}</b> 家 · 总持有资质 <b>${(data.totalQuals || 0).toLocaleString()}</b> 行</div>
        <div class="cap-lib-stat-grid">${tiles}</div>
        ${unsynced}
      `;
    } catch (e) {
      box.innerHTML = `<div style="color:var(--danger)">加载失败：${escHtml(e.message || String(e))}</div>`;
    }
  }

  // ── 机构列表 ──────────────────────────────────────────────────────

  async function renderLabs() {
    const box = document.getElementById('capLibLabsBody');
    if (!box) return;
    try {
      const res = await fetch('/api/cma-diff/labs');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await readApiResponse(res);
      const items = (data && data.items) || [];
      if (!items.length) {
        box.innerHTML = '<div class="cap-lib-empty">未订阅任何 CMA 机构。请先到「资质查询」页订阅。</div>';
        return;
      }
      // 默认按 not_in_lib + series_only 降序排（最值得关注的在前）
      items.sort((a, b) => {
        const sa = (a.byStatus?.not_in_lib || 0) + (a.byStatus?.series_only || 0);
        const sb = (b.byStatus?.not_in_lib || 0) + (b.byStatus?.series_only || 0);
        if (sa !== sb) return sb - sa;
        return (b.total || 0) - (a.total || 0);
      });
      box.innerHTML = items.map(lab => {
        const dots = STATUS_ORDER.map(k => {
          const n = lab.byStatus?.[k] || 0;
          if (!n) return '';
          const meta = DIFF_STATUS_META[k];
          return `<span class="cap-lib-lab-dot" style="color:${meta.color}">${meta.emoji} ${n}</span>`;
        }).filter(Boolean).join('');
        const gid = 'capLibLab_' + escAttr(lab.certNumber);
        return `
          <div class="cap-lib-lab-group">
            <div class="cap-lib-lab-head" onclick="capLibToggleLab('${escAttr(lab.certNumber)}')">
              <span class="cap-lib-lab-arrow" id="${gid}_arrow">▸</span>
              <span class="cap-lib-lab-name">${escHtml(lab.labName)}</span>
              <span class="cap-lib-lab-cert">${escHtml(lab.certNumber)}</span>
              <span class="cap-lib-lab-counts">${dots || '<span style="color:var(--text-3)">无数据</span>'}</span>
              <span class="cap-lib-lab-total">${(lab.total || 0).toLocaleString()} 行</span>
            </div>
            <div class="cap-lib-lab-body" id="${gid}_body" style="display:none"></div>
          </div>`;
      }).join('');
    } catch (e) {
      box.innerHTML = `<div style="color:var(--danger)">加载失败：${escHtml(e.message || String(e))}</div>`;
    }
  }

  window.capLibToggleLab = async function (certNumber) {
    const gid = 'capLibLab_' + certNumber;
    const body = document.getElementById(gid + '_body');
    const arrow = document.getElementById(gid + '_arrow');
    if (!body) return;
    if (body.style.display === '') {
      body.style.display = 'none';
      if (arrow) arrow.textContent = '▸';
      return;
    }
    body.style.display = '';
    if (arrow) arrow.textContent = '▾';
    if (body.dataset.loaded === '1') return;
    body.innerHTML = '<div style="padding:8px;color:var(--text-3)">加载中…</div>';
    try {
      const res = await fetch('/api/cma-diff/labs/' + encodeURIComponent(certNumber));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await readApiResponse(res);
      const rows = (data && data.rows) || [];
      if (!rows.length) {
        body.innerHTML = '<div style="padding:8px;color:var(--text-3)">该机构无 CMA 资质行</div>';
        return;
      }
      // 默认按 diff_status 顺序倒置（最差的在前）
      const rev = { not_in_lib: 0, series_only: 1, abolished: 2, cite_only: 3, in_lib: 4 };
      rows.sort((a, b) => (rev[a.diffStatus] - rev[b.diffStatus]));

      body.innerHTML = `
        <div class="cap-lib-lab-filter">
          <span style="font-size:12px;color:var(--text-3)">筛选：</span>
          ${STATUS_ORDER.map(k => {
            const meta = DIFF_STATUS_META[k];
            return `<label class="cap-lib-filter-chip"><input type="checkbox" checked data-status="${k}" onchange="capLibApplyFilter('${escAttr(certNumber)}')">${meta.emoji} ${escHtml(meta.label)}</label>`;
          }).join('')}
        </div>
        <table class="cap-lib-diff-table">
          <thead><tr>
            <th>状态</th><th>标准号</th><th>标准名</th><th>类别/项目</th><th>替代/备注</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => renderDiffRow(r)).join('')}
          </tbody>
        </table>`;
      body.dataset.loaded = '1';
    } catch (e) {
      body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escHtml(e.message || String(e))}</div>`;
    }
  };

  function renderDiffRow(r) {
    const meta = DIFF_STATUS_META[r.diffStatus] || { label: r.diffStatus, color: 'var(--text-3)', emoji: '·' };
    const note = r.diffStatus === 'series_only' && r.seriesNewCode
      ? `建议改用 <b>${escHtml(r.seriesNewCode)}</b>${r.seriesDomain ? ' · ' + escHtml(r.seriesDomain) : ''}`
      : (r.libRemark ? escHtml(r.libRemark) : '');
    return `
      <tr class="cap-lib-diff-row" data-status="${r.diffStatus}">
        <td><span class="cap-lib-row-status" style="color:${meta.color}">${meta.emoji} ${escHtml(meta.label)}</span></td>
        <td class="cap-lib-row-code">${escHtml(r.stdCode)}</td>
        <td>${escHtml(r.stdName || '')}</td>
        <td><div class="cap-lib-row-cat">${escHtml(r.category || '')}</div><div class="cap-lib-row-item">${escHtml(r.testItem || '')}</div></td>
        <td>${note}</td>
      </tr>`;
  }

  window.capLibApplyFilter = function (certNumber) {
    const gid = 'capLibLab_' + certNumber + '_body';
    const body = document.getElementById(gid);
    if (!body) return;
    const allowed = new Set();
    body.querySelectorAll('.cap-lib-filter-chip input[data-status]').forEach(inp => {
      if (inp.checked) allowed.add(inp.getAttribute('data-status'));
    });
    body.querySelectorAll('.cap-lib-diff-row').forEach(tr => {
      tr.style.display = allowed.has(tr.getAttribute('data-status')) ? '' : 'none';
    });
  };

  // ── Cleanup（admin） ───────────────────────────────────────────────

  window.capLibCleanup = async function () {
    if (!confirm('确认删除 30 天未在远端出现的本地条目？此操作不可恢复。')) return;
    try {
      const res = await fetch('/api/cma-diff/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 30 }),
      });
      if (!res.ok) {
        const txt = await res.text();
        showToast('清理失败：' + (txt || res.status), 'fail'); return;
      }
      const body = await readApiResponse(res);
      showToast('清理完成：删除 ' + (body.deleted || 0) + ' 条');
      if (window.capLibInvalidateCache) window.capLibInvalidateCache();
      window.loadCapLibPage();
    } catch (e) { showToast('清理失败：' + (e.message || e), 'fail'); }
  };

  // ── utils ─────────────────────────────────────────────────────────

  function formatDateTime(s) {
    if (!s) return '';
    try {
      const d = new Date(s);
      const pad = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    } catch { return s; }
  }
  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }
})();

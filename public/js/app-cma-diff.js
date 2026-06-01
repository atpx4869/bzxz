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
  /**
   * 单一 worst→best 严重度顺序（修正 #2）。分组渲染、默认展开「最严重档」、
   * diffByLab 行排序、导出排序统一引这一个常量，避免散落多份失同步。
   */
  const GROUP_ORDER = ['not_in_lib', 'series_only', 'abolished', 'cite_only', 'in_lib'];
  /** 机构内每个状态档分页大小 */
  const PAGE_SIZE = 50;

  /** 进度轮询定时器 jobId → setInterval handle */
  const progressTimers = new Map();

  window._tabCleanup = window._tabCleanup || {};
  window._tabCleanup.capLibDiff = function () {
    for (const t of progressTimers.values()) clearInterval(t);
    progressTimers.clear();
  };

  // ── 入口 ──────────────────────────────────────────────────────────

  // 注：currentUser 在 app-auth-admin.js 用 `let` 顶层声明，不挂 window；
  // 但脚本顶层 let 在浏览器里是"脚本作用域"全局变量，跨 <script> 文件可直读，
  // 只是 `window.currentUser` 拿不到。统一靠局部 helper 兜底未登录状态。
  function getCurrentUser() {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (e) { return null; }
  }
  function isAdminUser() {
    const u = getCurrentUser();
    return !!(u && u.role === 'admin');
  }

  window.loadCapLibPage = async function loadCapLibPage() {
    const adminBtn = document.getElementById('capLibCleanupBtn');
    if (adminBtn) adminBtn.style.display = isAdminUser() ? '' : 'none';
    const syncBtn = document.getElementById('capLibSyncAllBtn');
    if (syncBtn) syncBtn.disabled = !isAdminUser();
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
      const isAdmin = isAdminUser();

      // 收起态标题栏摘要：已订阅 N 个领域 · 最近同步 时间（取所有领域里最新一次）
      const subscribedCount = items.filter(it => it.subscribed).length;
      let latestSynced = '';
      for (const it of items) {
        if (it.lastSyncedAt && (!latestSynced || it.lastSyncedAt > latestSynced)) latestSynced = it.lastSyncedAt;
      }
      const summaryEl = document.getElementById('capLibDomSummary');
      if (summaryEl) {
        summaryEl.textContent = `已订阅 ${subscribedCount} 个领域 · 最近同步 ${latestSynced ? formatDateTime(latestSynced) : '从未'}`;
      }

      // 批量同步条（仅 admin）：更新勾选（串行）/ 全部更新（复用 sync-all）
      const batchBar = isAdmin
        ? `<div class="cap-lib-dom-batchbar">
             <button class="btn btn-sm btn-ghost" onclick="capLibSyncChecked(this)">更新勾选</button>
             <button class="btn btn-sm btn-ghost" onclick="capLibSyncAll()">全部更新</button>
             <span class="cap-lib-dom-batchhint">更新勾选 = 串行同步勾中的领域；全部更新 = 同步全部已勾选订阅领域</span>
           </div>`
        : '';

      box.innerHTML = batchBar + '<div class="cap-lib-dom-table">' + items.map(it => {
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
              <span class="cap-lib-dom-name" title="${escAttr(it.domain)}">${escHtml(it.domain)}</span>
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

      // 恢复整卡折叠态（默认收起）
      const card = document.getElementById('capLibDomCard');
      const arrow = document.getElementById('capLibDomFoldArrow');
      if (card) {
        const collapsed = localStorage.getItem('capLib.domCollapsed') !== '0'; // 默认收起
        card.classList.toggle('collapsed', collapsed);
        if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
      }
    } catch (e) {
      box.innerHTML = `<div style="color:var(--danger)">加载失败：${escHtml(e.message || String(e))}</div>`;
    }
  }

  // 整卡折叠：toggle .collapsed + arrow + 写 localStorage（'0'=展开 / 其它=收起）
  window.capLibToggleDomCard = function () {
    const card = document.getElementById('capLibDomCard');
    const arrow = document.getElementById('capLibDomFoldArrow');
    if (!card) return;
    const collapsed = card.classList.toggle('collapsed');
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
    try { localStorage.setItem('capLib.domCollapsed', collapsed ? '1' : '0'); } catch { /* ignore */ }
  };

  /**
   * 更新勾选：串行同步勾中的领域（避免 N 个 pageSize=60000 长请求并发轰上游）。
   * 逐个 await 现有 capLibSyncOne 完成再发下一个；进度条复用每行 pollSyncProgress。
   */
  window.capLibSyncChecked = async function (triggerBtn) {
    if (!isAdminUser()) return;
    const checked = [...document.querySelectorAll('.cap-lib-dom-row input[type=checkbox]:checked')]
      .map(cb => cb.closest('.cap-lib-dom-row'))
      .map(row => row && row.getAttribute('data-domain'))
      .filter(Boolean);
    if (!checked.length) { showToast('未勾选任何领域', 'fail'); return; }
    if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = '同步中…'; }
    try {
      for (const domain of checked) {
        const rowBtn = document.querySelector(
          `.cap-lib-dom-row[data-domain="${cssEscape(domain)}"] .cap-lib-dom-actions button`);
        await syncDomainAndWait(domain, rowBtn);
      }
      showToast('勾选领域已全部同步完成');
    } finally {
      if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = '更新勾选'; }
    }
  };

  /**
   * 同步单个领域并等待其完成（串行批量同步用）。包装 sync 启动 + 轮询 done/error，
   * 返回 Promise，避免一次 for 循环把所有 sync 并发打出去。
   */
  function syncDomainAndWait(domain, btn) {
    return new Promise((resolve) => {
      if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
      const progEl = document.getElementById('capLibDomProg-' + domain);
      fetch('/api/cma-diff/sync/' + encodeURIComponent(domain), { method: 'POST' })
        .then(async (res) => {
          if (!res.ok) {
            const txt = await res.text();
            showToast('启动同步失败：' + (txt || res.status), 'fail');
            if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
            resolve();
            return;
          }
          const body = await readApiResponse(res);
          const jobId = body.jobId;
          if (progressTimers.has(jobId)) { resolve(); return; }
          const tick = async function () {
            try {
              const pr = await fetch('/api/cma-diff/sync/progress/' + encodeURIComponent(jobId));
              if (!pr.ok) { stop(); resolve(); return; }
              const p = await readApiResponse(pr);
              const pct = p.total ? Math.min(100, Math.round((p.current || 0) / p.total * 100)) : 0;
              if (progEl) {
                progEl.innerHTML = '<div class="cap-lib-prog-bar"><div style="width:' + pct + '%"></div></div>'
                  + '<span class="cap-lib-prog-text">' + escHtml(phaseLabel(p.phase)) + ' ' + pct + '%</span>';
              }
              if (p.phase === 'done') {
                stop();
                if (window.capLibInvalidateCache) window.capLibInvalidateCache();
                resolve();
              } else if (p.phase === 'error') {
                showToast('「' + domain + '」同步失败：' + (p.error || '未知错误'), 'fail');
                stop();
                resolve();
              }
            } catch (e) { stop(); resolve(); }
          };
          const stop = function () {
            const h = progressTimers.get(jobId); if (h) clearInterval(h);
            progressTimers.delete(jobId);
            if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
          };
          tick();
          progressTimers.set(jobId, setInterval(tick, 1500));
        })
        .catch((e) => {
          showToast('启动同步失败：' + (e.message || e), 'fail');
          if (btn) { btn.disabled = false; btn.textContent = '刷新'; }
          resolve();
        });
    });
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
        const labNameAttr = escAttr(lab.labName || lab.certNumber);
        return `
          <div class="cap-lib-lab-group">
            <div class="cap-lib-lab-head" onclick="capLibToggleLab('${escAttr(lab.certNumber)}')">
              <span class="cap-lib-lab-arrow" id="${gid}_arrow">▸</span>
              <span class="cap-lib-lab-name">${escHtml(lab.labName)}</span>
              <span class="cap-lib-lab-cert">${escHtml(lab.certNumber)}</span>
              <span class="cap-lib-lab-counts">${dots || '<span style="color:var(--text-3)">无数据</span>'}</span>
              <span class="cap-lib-lab-total">${(lab.total || 0).toLocaleString()} 行</span>
              <button class="btn btn-sm btn-ghost cap-lib-lab-export"
                onclick="event.stopPropagation();capLibExportDiff({ certNumbers: ['${escAttr(lab.certNumber)}'] }, this)"
                title="导出「${labNameAttr}」整表">导出此机构</button>
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
      // 收起：清缓存让 GC 回收（长机构 _capLibGroups 可能上百行）
      body.style.display = 'none';
      if (arrow) arrow.textContent = '▸';
      body._capLibGroups = null;
      body.dataset.loaded = '';
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
        body.dataset.loaded = '1';
        return;
      }
      // 按 5 档分组缓存到 DOM 引用上（避免 JSON 反复 parse）
      const groups = { not_in_lib: [], series_only: [], abolished: [], cite_only: [], in_lib: [] };
      for (const r of rows) (groups[r.diffStatus] || groups.not_in_lib).push(r);
      body._capLibGroups = groups;
      body.dataset.cert = certNumber;
      renderStatusGroups(body, groups, certNumber);
      body.dataset.loaded = '1';
    } catch (e) {
      body.innerHTML = `<div style="padding:8px;color:var(--danger)">加载失败：${escHtml(e.message || String(e))}</div>`;
    }
  };

  /**
   * 渲染机构内 5 个状态档折叠卡。默认展开第一个非空的最严重档（GROUP_ORDER 首个 count>0）。
   * 每档内是分页表（renderPagedTable），其余档懒渲染（点开才生成 HTML）。
   */
  function renderStatusGroups(body, groups, certNumber) {
    const firstNonEmpty = GROUP_ORDER.find(k => (groups[k] || []).length > 0);
    let html = '';
    for (const status of GROUP_ORDER) {
      const list = groups[status] || [];
      if (!list.length) continue;             // 空组不渲染
      const meta = DIFF_STATUS_META[status];
      const expanded = status === firstNonEmpty;
      const gid = body.id + '_s_' + status;
      const exportBtn = `<button class="btn btn-sm btn-ghost cap-lib-stgroup-export"
        onclick="event.stopPropagation();capLibExportDiff({ certNumbers: ['${escAttr(certNumber)}'], statuses: ['${status}'] }, this)"
        title="只导该档">导出</button>`;
      html += `
        <div class="cap-lib-stgroup" data-status="${status}">
          <div class="cap-lib-stgroup-head" onclick="capLibToggleStGroup('${gid}')">
            <span class="cap-lib-stgroup-arrow" id="${gid}_arrow">${expanded ? '▾' : '▸'}</span>
            <span style="color:${meta.color}">${meta.emoji} ${escHtml(meta.label)}</span>
            <span class="cap-lib-stgroup-count">${list.length} 条</span>
            ${exportBtn}
          </div>
          <div class="cap-lib-stgroup-body" id="${gid}_body" data-page="1"
               data-rendered="${expanded ? '1' : ''}" style="display:${expanded ? '' : 'none'}">
            ${expanded ? renderPagedTable(list, 1) : ''}
          </div>
        </div>`;
    }
    body.innerHTML = html;
  }

  /** 按 PAGE_SIZE 切片 + 翻页器。pages≤1 只显示总数。 */
  function renderPagedTable(list, page) {
    const total = list.length;
    const pages = Math.ceil(total / PAGE_SIZE) || 1;
    const p = Math.min(Math.max(1, page), pages);
    const slice = list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
    const tableHtml = `
      <table class="cap-lib-diff-table">
        <thead><tr><th>状态</th><th>标准号</th><th>标准名</th><th>类别/项目</th><th>替代/备注</th></tr></thead>
        <tbody>${slice.map(renderDiffRow).join('')}</tbody>
      </table>`;
    const pagerHtml = pages > 1
      ? renderPager(p, pages, total)
      : `<div class="cap-lib-pager">共 ${total} 条</div>`;
    return tableHtml + pagerHtml;
  }

  /** 翻页器：≤7 页全列，否则压缩成「1 … cur-1 cur cur+1 … last」。 */
  function renderPager(current, pages, total) {
    const btns = compressPages(current, pages);
    return `<div class="cap-lib-pager">
      <button onclick="capLibPageGo(this, ${current - 1})" ${current === 1 ? 'disabled' : ''}>‹</button>
      ${btns.map(pg => pg === '…'
        ? '<span class="cap-lib-pager-gap">…</span>'
        : `<button class="${pg === current ? 'is-active' : ''}" onclick="capLibPageGo(this, ${pg})">${pg}</button>`
      ).join('')}
      <button onclick="capLibPageGo(this, ${current + 1})" ${current === pages ? 'disabled' : ''}>›</button>
      <span class="cap-lib-pager-info">共 ${total} 条</span>
    </div>`;
  }

  /** ≤7 页全列；否则首尾固定 + 当前页 ±1，两侧省略号。 */
  function compressPages(cur, pages) {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const out = [1];
    if (cur > 3) out.push('…');
    for (let p = Math.max(2, cur - 1); p <= Math.min(pages - 1, cur + 1); p++) out.push(p);
    if (cur < pages - 2) out.push('…');
    out.push(pages);
    return out;
  }

  // 翻页：定位所在 stgroup-body，从机构缓存取该档 list，重渲表 + 翻页器
  window.capLibPageGo = function (btn, page) {
    const stbody = btn.closest('.cap-lib-stgroup-body');
    const group = btn.closest('.cap-lib-stgroup');
    const labBody = btn.closest('.cap-lib-lab-body');
    if (!stbody || !group || !labBody) return;
    const status = group.getAttribute('data-status');
    const list = (labBody._capLibGroups || {})[status] || [];
    stbody.dataset.page = String(page);
    stbody.innerHTML = renderPagedTable(list, page);
    stbody.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // 状态档折叠：首次展开懒渲染该档分页表
  window.capLibToggleStGroup = function (gid) {
    const stbody = document.getElementById(gid + '_body');
    const arrow = document.getElementById(gid + '_arrow');
    if (!stbody) return;
    if (stbody.style.display === 'none') {
      if (!stbody.dataset.rendered) {
        const group = stbody.closest('.cap-lib-stgroup');
        const labBody = stbody.closest('.cap-lib-lab-body');
        const status = group && group.getAttribute('data-status');
        const list = (labBody && labBody._capLibGroups || {})[status] || [];
        stbody.innerHTML = renderPagedTable(list, Number(stbody.dataset.page) || 1);
        stbody.dataset.rendered = '1';
      }
      stbody.style.display = '';
      if (arrow) arrow.textContent = '▾';
    } else {
      stbody.style.display = 'none';
      if (arrow) arrow.textContent = '▸';
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

  /**
   * 三级导出（Part 2b）：状态档头 / 机构头 / 顶部三处共用。
   * filter = { certNumbers: string[], statuses?: DiffStatus[] }，certNumbers 空 = 全部订阅机构。
   * 流式下载：fetch blob → Content-Disposition 取文件名 → a.click。
   */
  window.capLibExportDiff = async function (filter, btn) {
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/cma-diff/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filter || { certNumbers: [] }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        showToast('导出失败：' + (txt || res.status), 'fail');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const fn = m ? decodeURIComponent(m[1]) : 'CMA一单一库比对.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fn; document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
      showToast('已导出：' + fn);
    } catch (e) {
      showToast('导出失败：' + (e.message || e), 'fail');
    } finally {
      if (btn) btn.disabled = false;
    }
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
  // CSS attribute-selector 转义（批量同步按 data-domain 反查行用）。优先用原生 CSS.escape。
  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\\]]/g, '\\$&');
  }
})();

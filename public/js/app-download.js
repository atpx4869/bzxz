// ── Download functions ──
let downloadAborted = false;
let downloadTaskSeq = 0;
let downloadTasks = [];
let lastBatchFailedItems = [];

function toggleDownloadCenter(force) {
  const panel = document.getElementById('downloadCenterPanel');
  if (!panel) return;
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
}

function createDownloadTask(task) {
  const id = ++downloadTaskSeq;
  downloadTasks.unshift({
    id,
    status: 'running',
    progress: '排队中',
    startedAt: Date.now(),
    updatedAt: Date.now(),
    ...task,
  });
  renderDownloadCenter();
  return id;
}

function updateDownloadTask(id, patch) {
  const task = downloadTasks.find(t => t.id === id);
  if (!task) return;
  Object.assign(task, patch, { updatedAt: Date.now() });
  renderDownloadCenter();
}

function completeDownloadTask(id, status, patch = {}) {
  updateDownloadTask(id, { status, finishedAt: Date.now(), ...patch });
}

function retryDownloadTask(id) {
  const task = downloadTasks.find(t => t.id === id);
  if (!task?.retry) return;
  task.retry();
}

function clearCompletedDownloadTasks() {
  downloadTasks = downloadTasks.filter(t => t.status !== 'success');
  renderDownloadCenter();
}

function renderDownloadCenter() {
  const body = document.getElementById('downloadCenterBody');
  const summary = document.getElementById('downloadCenterSummary');
  const badge = document.getElementById('downloadCenterBadge');
  if (!body || !summary || !badge) return;

  const running = downloadTasks.filter(t => t.status === 'running').length;
  const failed = downloadTasks.filter(t => t.status === 'fail').length;
  const done = downloadTasks.filter(t => t.status === 'success').length;
  badge.textContent = String(running || failed || downloadTasks.length);
  badge.classList.toggle('warn', failed > 0);
  summary.innerHTML = downloadTasks.length
    ? `<span>${running} 进行中</span><span>${done} 成功</span><span class="${failed ? 'bad' : ''}">${failed} 失败</span><button class="mini-link" onclick="clearCompletedDownloadTasks()">清理完成项</button>`
    : '暂无下载任务';

  if (!downloadTasks.length) {
    body.innerHTML = '<div class="download-center-empty">下载任务会显示在这里。</div>';
    return;
  }

  body.innerHTML = downloadTasks.map(task => {
    const elapsed = ((Date.now() - task.startedAt) / 1000).toFixed(0);
    const size = task.fileSize ? ` · ${formatSize(task.fileSize)}` : '';
    const sources = (task.sources || []).map(s => `<span class="source-badge source-${escapeHtml(s)}">${escapeHtml(srcLabel(s))}</span>`).join('');
    const retry = task.status === 'fail' && task.retry ? `<button class="btn btn-sm btn-ghost" onclick="retryDownloadTask(${task.id})">重试</button>` : '';
    const open = task.fileName ? `<button class="btn btn-sm btn-ghost" data-download-file="${escapeHtml(task.fileName)}">重下</button>` : '';
    return `
      <div class="download-task ${task.status}">
        <div class="download-task-main">
          <div class="download-task-title">${escapeHtml(task.label || task.standardNumber || task.standardId || '下载任务')}</div>
          <div class="download-task-meta">${sources}<span>${escapeHtml(task.mode || '')}</span><span>${elapsed}s${size}</span></div>
          <div class="download-task-progress">${escapeHtml(task.progress || task.error || '')}</div>
        </div>
        <div class="download-task-actions">${retry}${open}</div>
      </div>`;
  }).join('');
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-download-file]');
  if (!btn) return;
  triggerDownload(btn.dataset.downloadFile);
});

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

// readApiResponse is now defined in app-core.js (loaded before this file).

function downloadErrorMessage(label, res, data) {
  const meta = data?.meta || {};
  const base = meta.error || data?.message || data?.error || data?.status || `HTTP${res.status}`;
  const suffix = res.ok ? '' : ` (HTTP${res.status})`;
  return `${label} ${base}${suffix}`;
}

function getOrderedDownloadSourcesForResult(r) {
  const available = (r?.sources || [r?._source]).filter(Boolean);
  const enabled = new Set(downloadSources);
  const ordered = [...downloadPriority, ...available.filter(s => !downloadPriority.includes(s))];
  return [...new Set(ordered)].filter(s => enabled.has(s) && available.includes(s));
}

async function downloadByCurrentMode(rowId, sources, label, onProgress) {
  if (downloadMode === 'race') {
    return Promise.any(sources.map(s => raceSource(rowId, s, label, onProgress)));
  }

  const errors = [];
  for (const source of sources) {
    if (downloadAborted || batchAborted) throw new Error('已中止');
    try {
      onProgress?.(`尝试 ${srcLabel(source)}...`);
      return await raceSource(rowId, source, label, onProgress);
    } catch (e) {
      errors.push(e);
      onProgress?.(`${srcLabel(source)} 失败，继续下一个来源`);
    }
  }
  throw new AggregateError(errors, '所有来源下载失败');
}

function summarizeDownloadError(e) {
  if (e instanceof AggregateError) {
    return [...new Set(e.errors.map(err => err.message || String(err)))].slice(0, 3).join('; ');
  }
  return e?.message || '未知错误';
}

async function downloadOne(id, btn) {
  const r = findResultByAnyId(id); if (!r) return;
  downloadAborted = false;
  const sources = getOrderedDownloadSourcesForResult(r);
  if (!sources.length) { addLog(`${r.standardNumber} 无可用下载源`, 'fail'); return; }
  setRowDownloadState(r.id, 'downloading');
  const modeText = downloadMode === 'race' ? '竞速' : '级联';
  const joiner = downloadMode === 'race' ? '+' : ' → ';
  const logId = addLog(`${r.standardNumber} ${modeText} [${sources.map(s => srcLabel(s)).join(joiner)}]`, 'pending');
  const taskId = createDownloadTask({
    standardId: r.id,
    label: r.standardNumber,
    sources,
    mode: modeText,
    retry: () => downloadOne(id),
  });
  try {
    const winner = await downloadByCurrentMode(r.id, sources, r.standardNumber, (msg) => {
      updateLog(logId, msg, 'pending');
      updateDownloadTask(taskId, { progress: msg });
    });
    const sizeStr = winner.fileSize ? ` ${formatSize(winner.fileSize)}` : '';
    updateLog(logId, `${r.standardNumber} ✅ ${srcLabel(winner.source)}完成 ${winner.fileName}${sizeStr}`, 'success');
    setRowDownloadState(r.id, 'success');
    if (winner.fileName) { triggerDownload(winner.fileName); recordDownload(winner.source, winner.fileName, r.standardNumber); }
    completeDownloadTask(taskId, 'success', { source: winner.source, fileName: winner.fileName, fileSize: winner.fileSize, progress: `${srcLabel(winner.source)} 下载完成` });
    showToast(`${srcLabel(winner.source)} 下载完成: ${winner.fileName || r.standardNumber}`);
  } catch (e) {
    const msgs = summarizeDownloadError(e);
    updateLog(logId, `${r.standardNumber} ❌ ${msgs}`, 'fail');
    setRowDownloadState(r.id, 'fail');
    completeDownloadTask(taskId, 'fail', { error: msgs, progress: msgs });
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
  const taskId = createDownloadTask({
    standardId: srcId,
    label,
    sources: [source],
    mode: '指定来源',
    retry: () => downloadSpecificSource(id, source),
  });
  try {
    const result = await raceSource(srcId, source, label, (msg) => {
      updateLog(logId, msg, 'pending');
      updateDownloadTask(taskId, { progress: msg });
    });
    const sizeStr = result.fileSize ? ` ${formatSize(result.fileSize)}` : '';
    updateLog(logId, `${label} ✅ ${srcLabel(result.source)} ${result.fileName || ''}${sizeStr}`, 'success');
    setRowDownloadState(rowId, 'success');
    if (result.fileName) { triggerDownload(result.fileName); recordDownload(result.source, result.fileName, label); }
    completeDownloadTask(taskId, 'success', { source: result.source, fileName: result.fileName, fileSize: result.fileSize, progress: `${srcLabel(result.source)} 下载完成` });
    showToast(`${srcLabel(result.source)} 下载完成: ${result.fileName || label}`);
  } catch (e) {
    const msg = (e && e.message) || '下载失败';
    const sourceLabel = srcLabel(source);
    const displayMsg = msg.startsWith(`${sourceLabel} `) ? msg.slice(sourceLabel.length + 1) : msg;
    updateLog(logId, `${label} ❌ ${sourceLabel} ${displayMsg}`, 'fail');
    setRowDownloadState(rowId, 'fail');
    completeDownloadTask(taskId, 'fail', { error: displayMsg, progress: displayMsg });
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
      const ev = parseSseEvent(e.data);
      if (!ev.ok) { clearTimeout(timeout); es.close(); reject(new Error(`BZ ${ev.error.message || '失败'}`)); return; }
      const td = ev.value;
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
      const ev = parseSseEvent(e.data);
      if (!ev.ok) { clearTimeout(timeout); es.close(); reject(new Error(`BY ${ev.error.message || '失败'}`)); return; }
      const td = ev.value;
      if (td.status === 'running' && onProgress) onProgress('BY 下载中...');
      if (td.status === 'success') { clearTimeout(timeout); es.close(); const elapsed = ((Date.now() - t0) / 1000).toFixed(1); const sizeStr = td.fileSize ? ` ${formatSize(td.fileSize)}` : ''; resolve({ source: 'by', fileName: td.fileName || '', fileSize: td.fileSize, meta: `${elapsed}s${sizeStr}` }); }
      if (td.status === 'failed') { clearTimeout(timeout); es.close(); reject(new Error(`BY ${td.errorMessage || '失败'}`)); }
    };
    es.onerror = () => { clearTimeout(timeout); es.close(); reject(new Error('BY SSE连接失败')); };
  });
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
      const sources = getOrderedDownloadSourcesForResult(item);
      if (!sources.length) { completed++; failed++; updateProgress(); continue; }
      setRowDownloadState(item.id, 'downloading');
      const modeText = downloadMode === 'race' ? '竞速' : '级联';
      const joiner = downloadMode === 'race' ? '+' : ' → ';
      const logId = addLog(`${item.standardNumber} ${modeText} [${sources.map(s => srcLabel(s)).join(joiner)}]`, 'pending');
      const taskId = createDownloadTask({
        standardId: item.id,
        label: item.standardNumber,
        sources,
        mode: modeText,
        retry: () => downloadOne(item.id),
      });
      try {
        const winner = await downloadByCurrentMode(item.id, sources, item.standardNumber, (msg) => {
          updateLog(logId, msg, 'pending');
          updateDownloadTask(taskId, { progress: msg });
        });
        success++; wins[winner.source] = (wins[winner.source] || 0) + 1;
        const sizeStr = winner.fileSize ? ` ${formatSize(winner.fileSize)}` : '';
        updateLog(logId, `${item.standardNumber} ✅ ${srcLabel(winner.source)}完成 ${winner.fileName}${sizeStr}`, 'success');
        setRowDownloadState(item.id, 'success');
        if (winner.fileName) { triggerDownload(winner.fileName); recordDownload(winner.source, winner.fileName, item.standardNumber); }
        completeDownloadTask(taskId, 'success', { source: winner.source, fileName: winner.fileName, fileSize: winner.fileSize, progress: `${srcLabel(winner.source)} 下载完成` });
      } catch (e) {
        failed++;
        const msgs = summarizeDownloadError(e);
        updateLog(logId, `${item.standardNumber} ❌ ${msgs}`, 'fail');
        setRowDownloadState(item.id, 'fail');
        completeDownloadTask(taskId, 'fail', { error: msgs, progress: msgs });
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
  const labels = { gbw: 'BW', by: 'BY', bz: 'BZ' };
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
    const data = await readApiResponse(res);
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
      const taskId = createDownloadTask({
        standardId: item.standardId,
        label: item.standardNumber,
        sources,
        mode: '批量级联',
        retry: () => retryBatchItem(item),
      });
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
        const data = await readApiResponse(resp);
        if (resp.ok && data.status === 'downloaded') {
          const sizeStr = data.fileSize ? ` ${formatSize(data.fileSize)}` : '';
          updateLog(logId, `${item.standardNumber} ✅ ${srcLabel(data.source)} ${data.fileName || ''}${sizeStr}`, 'success');
          setRowDownloadState(item.standardId, 'success');
          success++; successItems.push(item);
          if (data.fileName) { triggerDownload(data.fileName); recordDownload(data.source, data.fileName, item.standardNumber); }
          completeDownloadTask(taskId, 'success', { source: data.source, fileName: data.fileName, fileSize: data.fileSize, progress: `${srcLabel(data.source)} 下载完成` });
        } else {
          const perSource = data.details?.perSource || data.errors;
          const errMsg = data.message || (perSource ? Object.values(perSource).join('; ') : '下载失败');
          updateLog(logId, `${item.standardNumber} ❌ ${errMsg}`, 'fail');
          setRowDownloadState(item.standardId, 'fail');
          allFailedItems.push(item);
          completeDownloadTask(taskId, 'fail', { error: errMsg, progress: errMsg });
        }
      } catch (e) {
        const msg = (e && e.message) || '请求失败';
        updateLog(logId, `${item.standardNumber} ❌ ${msg}`, 'fail');
        setRowDownloadState(item.standardId, 'fail');
        allFailedItems.push(item);
        completeDownloadTask(taskId, 'fail', { error: msg, progress: msg });
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
      const sourceList = (sources.length > 0 ? sources : ['gbw']).filter(s => downloadSources.includes(s));
      const logId = addLog(`${item.standardNumber} 竞速 [${sourceList.map(s => srcLabel(s)).join('+')}]`, 'pending');
      const taskId = createDownloadTask({
        standardId: item.standardId,
        label: item.standardNumber,
        sources: sourceList,
        mode: '批量竞速',
        retry: () => retryBatchItem(item),
      });
      try {
        const winner = await Promise.any(sourceList.map(s => raceSourceWithTimeout(item.standardId, s, item.standardNumber, downloadTimeout * 1000, (msg) => {
          updateLog(logId, msg, 'pending');
          updateDownloadTask(taskId, { progress: msg });
        })));
        success++; successItems.push(item); wins[winner.source] = (wins[winner.source] || 0) + 1;
        const sizeStr = winner.fileSize ? ` ${formatSize(winner.fileSize)}` : '';
        updateLog(logId, `${item.standardNumber} ✅ ${srcLabel(winner.source)}胜出 ${winner.fileName}${sizeStr}`, 'success');
        setRowDownloadState(item.standardId, 'success');
        if (winner.fileName) { triggerDownload(winner.fileName); recordDownload(winner.source, winner.fileName, item.standardNumber); }
        completeDownloadTask(taskId, 'success', { source: winner.source, fileName: winner.fileName, fileSize: winner.fileSize, progress: `${srcLabel(winner.source)} 下载完成` });
      } catch (e) {
        allFailedItems.push(item);
        const msgs = e instanceof AggregateError ? [...new Set(e.errors.map(err => err.message))].slice(0, 3).join('; ') : (e.message || '未知错误');
        updateLog(logId, `${item.standardNumber} ❌ ${msgs}`, 'fail');
        setRowDownloadState(item.standardId, 'fail');
        completeDownloadTask(taskId, 'fail', { error: msgs, progress: msgs });
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

function retryBatchItem(item) {
  const idx = batchResolved.findIndex(r => r.standardId === item.standardId);
  if (idx < 0) {
    showToast('重试失败: 当前批量结果中找不到该项目', 'fail');
    return;
  }
  document.querySelectorAll('#batchResults input[type="checkbox"]').forEach(cb => {
    cb.checked = Number(cb.dataset.batchIndex) === idx;
  });
  updateBatchToolbar();
  doBatchDownload();
}

function retryFailedBatchDownload() {
  if (!lastBatchFailedItems.length) return;
  const failedIds = new Set(lastBatchFailedItems.map(item => item.standardId));
  document.querySelectorAll('#batchResults input[type="checkbox"]').forEach(cb => {
    const item = batchResolved[Number(cb.dataset.batchIndex)];
    cb.checked = Boolean(item && failedIds.has(item.standardId));
  });
  updateBatchToolbar();
  document.getElementById('modalOverlay').classList.remove('open');
  doBatchDownload();
}

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
  lastBatchFailedItems = finalFailed;
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
      ${finalFailed.length > 0 ? '<button class="btn btn-primary btn-sm" data-action="modal-retry-batch-failed">重试失败项</button>' : ''}
      <button class="btn btn-primary btn-sm" data-action="modal-close">关闭</button>
    </div>`;
  document.getElementById('modalOverlay').classList.add('open');
}

// ── Standard completion ──
function setCompleteFlow(state) {
  const states = {
    idle: { active: 'file', done: [] },
    selected: { active: 'process', done: ['file'] },
    processing: { active: 'process', done: ['file'] },
    success: { active: 'download', done: ['file', 'process'] },
    error: { active: 'process', done: ['file'], error: 'process' },
  };
  const cfg = states[state] || states.idle;
  document.querySelectorAll('[data-complete-step]').forEach(step => {
    const key = step.dataset.completeStep;
    step.classList.toggle('active', cfg.active === key);
    step.classList.toggle('done', cfg.done.includes(key));
    step.classList.toggle('error', cfg.error === key);
  });
}

function setCompleteStatus(message, type = 'idle') {
  const el = document.getElementById('completeSummary');
  el.className = `complete-status ${type}`;
  el.innerHTML = message;
}

function onCompleteFileSelected() {
  const input = document.getElementById('completeFileInput');
  const file = input.files?.[0];
  document.getElementById('completeFileName').textContent = file ? file.name : '未选择文件';
  document.getElementById('completeUploadBtn').disabled = !file;
  document.getElementById('completeDownload').innerHTML = '';
  if (file) {
    setCompleteFlow('selected');
    setCompleteStatus(`<strong>文件已选择</strong><span>${escapeHtml(file.name)}</span>`, 'ready');
  } else {
    setCompleteFlow('idle');
    setCompleteStatus('等待选择文件', 'idle');
  }
}

async function doComplete() {
  const input = document.getElementById('completeFileInput');
  const file = input.files?.[0]; if (!file) return;
  const btn = document.getElementById('completeUploadBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>处理中';
  setCompleteFlow('processing');
  setCompleteStatus('<strong>处理中</strong><span>正在识别 A 列标准号并按来源优先级补全...</span>', 'working');
  document.getElementById('completeDownload').innerHTML = '';
  try {
    const form = new FormData(); form.append('file', file);
    form.append('sources', JSON.stringify(downloadPriority.filter(s => downloadSources.includes(s))));
    form.append('inputColumn', document.getElementById('completeInputColumn').value || 'A');
    form.append('outputColumn', document.getElementById('completeOutputColumn').value || 'B');
    form.append('preserveStyle', String(document.getElementById('completePreserveStyle').checked));
    form.append('includeStatus', String(document.getElementById('completeIncludeStatus').checked));
    form.append('includeSource', String(document.getElementById('completeIncludeSource').checked));
    form.append('includeDownloadLink', String(document.getElementById('completeIncludeLink').checked));
    form.append('includeTextFlag', String(document.getElementById('completeIncludeText').checked));
    const res = await fetch(`${API}/api/standards/complete`, { method: 'POST', body: form });
    const data = await readApiResponse(res);
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    setCompleteFlow('success');
    setCompleteStatus(`
      <div class="complete-result-stats">
        <div><strong>${data.summary.resolved}</strong><span>已补全</span></div>
        <div class="${data.summary.unmatched ? 'warn' : ''}"><strong>${data.summary.unmatched}</strong><span>未匹配</span></div>
        <div><strong>${data.summary.total}</strong><span>总计</span></div>
      </div>`, 'success');
    const dlUrl = data.downloadUrl;
    if (dlUrl && !dlUrl.startsWith('/')) throw new Error('Invalid download URL');
    document.getElementById('completeDownload').innerHTML = `
      <div class="complete-download-card">
        <div>
          <strong>${escapeHtml(data.fileName || '补全结果')}</strong>
          <span>已生成补全文件</span>
        </div>
        <a class="btn btn-primary btn-sm" href="${escapeHtml(API + dlUrl)}" download="${escapeHtml(data.fileName)}">下载结果</a>
      </div>`;
    addLog(`标准补全: ${data.summary.resolved}/${data.summary.total} 匹配`, 'success');
  } catch (e) {
    setCompleteFlow('error');
    setCompleteStatus(`<strong>处理失败</strong><span>${escapeHtml(e.message)}</span>`, 'fail');
    addLog(`标准补全失败: ${e.message}`, 'fail');
  }
  btn.disabled = false; btn.innerHTML = '上传并补全';
}

// 公告系统：管理员公告 + 版本升级公告
(function () {
  'use strict';

  const LS_VERSION_KEY = 'bzxz:last-seen-version';

  // ---------- Minimal Markdown renderer ----------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderMarkdown(md) {
    if (!md) return '';
    const lines = String(md).replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inList = false;
    let inCode = false;
    let codeBuf = [];

    const inline = (s) => {
      let t = escapeHtml(s);
      // code
      t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
      // bold
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // italic
      t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      // links [text](url)
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return t;
    };

    const closeList = () => {
      if (inList) { out.push('</ul>'); inList = false; }
    };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw;

      // fenced code
      if (/^```/.test(line)) {
        if (inCode) {
          out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
          codeBuf = [];
          inCode = false;
        } else {
          closeList();
          inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      // headings
      let m;
      if ((m = line.match(/^###\s+(.*)/))) { closeList(); out.push('<h3>' + inline(m[1]) + '</h3>'); continue; }
      if ((m = line.match(/^##\s+(.*)/)))  { closeList(); out.push('<h2>' + inline(m[1]) + '</h2>'); continue; }
      if ((m = line.match(/^#\s+(.*)/)))   { closeList(); out.push('<h1>' + inline(m[1]) + '</h1>'); continue; }

      // list item
      if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(m[1]) + '</li>');
        continue;
      }

      // blank
      if (/^\s*$/.test(line)) { closeList(); out.push(''); continue; }

      closeList();
      out.push('<p>' + inline(line) + '</p>');
    }
    if (inCode) {
      out.push('<pre><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
    }
    closeList();
    return out.join('\n');
  }

  // ---------- Modal ----------
  function ensureModal() {
    let modal = document.getElementById('announcement-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'announcement-modal';
    modal.className = 'ann-modal-mask';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="ann-modal-card">
        <div class="ann-modal-header">
          <span class="ann-modal-title">公告</span>
          <button class="ann-modal-close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="ann-modal-body markdown-body"></div>
        <div class="ann-modal-footer">
          <button class="ann-modal-ok btn btn-primary" type="button">我知道了</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function showModal(title, contentHtml, onClose) {
    const modal = ensureModal();
    modal.querySelector('.ann-modal-title').textContent = title || '公告';
    modal.querySelector('.ann-modal-body').innerHTML = contentHtml || '';
    modal.style.display = 'flex';
    const close = () => {
      modal.style.display = 'none';
      if (typeof onClose === 'function') onClose();
    };
    modal.querySelector('.ann-modal-close').onclick = close;
    modal.querySelector('.ann-modal-ok').onclick = close;
  }

  // ---------- API helpers ----------
  async function apiJson(url, opts) {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // ---------- Admin announcements: queued display ----------
  async function checkAnnouncements() {
    try {
      const data = await apiJson('/api/announcements/unread');
      const list = Array.isArray(data && data.items) ? data.items : (Array.isArray(data) ? data : []);
      if (!list.length) return;
      let idx = 0;
      const next = () => {
        if (idx >= list.length) return;
        const item = list[idx++];
        const html = renderMarkdown(item.contentMd || item.content_md || '');
        showModal(item.title || '公告', html, async () => {
          try { await fetch('/api/announcements/' + item.id + '/read', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
          next();
        });
      };
      next();
    } catch (e) {
      console.warn('[announcements] check failed', e);
    }
  }

  // ---------- Release-notes: first launch / upgrade ----------
  async function checkReleaseNotesIfUpgraded() {
    try {
      let version = '';
      try {
        const h = await apiJson('/api/health');
        version = (h && (h.version || h.appVersion)) || '';
      } catch (e) {}
      if (!version) return;
      const last = localStorage.getItem(LS_VERSION_KEY);
      if (last === version) return;
      // fetch release notes for current version
      let notes = null;
      try {
        notes = await apiJson('/api/announcements/release-notes?version=' + encodeURIComponent(version));
      } catch (e) {}
      const title = (notes && notes.name) ? notes.name : ('版本更新 ' + version);
      const body = (notes && (notes.body || notes.contentMd)) || ('当前版本：' + version);
      const html = renderMarkdown(body);
      showModal(title, html, () => {
        try { localStorage.setItem(LS_VERSION_KEY, version); } catch (e) {}
      });
    } catch (e) {
      console.warn('[release-notes] check failed', e);
    }
  }

  // ---------- Admin UI helpers (used by settings panel) ----------
  async function adminListAnnouncements() {
    return apiJson('/api/admin/announcements');
  }
  async function adminCreateAnnouncement(payload) {
    return apiJson('/api/admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  async function adminUpdateAnnouncement(id, payload) {
    return apiJson('/api/admin/announcements/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
  async function adminDeleteAnnouncement(id) {
    return apiJson('/api/admin/announcements/' + id, { method: 'DELETE' });
  }

  // expose globals
  window.checkAnnouncements = checkAnnouncements;
  window.checkReleaseNotesIfUpgraded = checkReleaseNotesIfUpgraded;
  window.renderAnnouncementMarkdown = renderMarkdown;
  window.showAnnouncementModal = (title, md) => showModal(title, renderMarkdown(md || ''));
  window.adminListAnnouncements = adminListAnnouncements;
  window.adminCreateAnnouncement = adminCreateAnnouncement;
  window.adminUpdateAnnouncement = adminUpdateAnnouncement;
  window.adminDeleteAnnouncement = adminDeleteAnnouncement;
})();

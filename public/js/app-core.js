const API = '';

// ── Settings ──
const ALL_SOURCES = ['gbw', 'bz', 'by', 'bzvip'];
const DEFAULT_DOWNLOAD_SOURCES = ['gbw', 'bz', 'by', 'bzvip'];
const SOURCE_LABELS = { gbw: 'BW', bz: 'BZ', by: 'BY', bzvip: 'BZVIP' };
function srcLabel(s) { return SOURCE_LABELS[s] || s.toUpperCase(); }
const DEFAULT_CONCURRENCY = 3;

const VALID_CONCURRENCY = [1, 2, 3, 4, 5];
const VALID_TIMEOUTS = [10, 15, 20, 30, 60];

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

function normalizeSourceArray(value, fallback) {
  const list = Array.isArray(value) ? value : fallback;
  const valid = list.filter(s => ALL_SOURCES.includes(s));
  return valid.length ? [...new Set(valid)] : [...fallback];
}

let downloadSources = normalizeSourceArray(safeJsonParse(localStorage.getItem('bzxz_download_sources'), DEFAULT_DOWNLOAD_SOURCES), DEFAULT_DOWNLOAD_SOURCES);
let downloadConcurrency = (v => VALID_CONCURRENCY.includes(v) ? v : DEFAULT_CONCURRENCY)(parseInt(localStorage.getItem('bzxz_concurrency') || ''));
let downloadPriority = normalizeSourceArray(safeJsonParse(localStorage.getItem('bzxz_priority'), ['bzvip', 'gbw', 'by', 'bz']), ['bzvip', 'gbw', 'by', 'bz']);
let downloadTimeout = (v => VALID_TIMEOUTS.includes(v) ? v : 15)(parseInt(localStorage.getItem('bzxz_timeout') || ''));
let downloadMode = localStorage.getItem('bzxz_download_mode') || 'cascade';
if (!['cascade', 'race'].includes(downloadMode)) downloadMode = 'cascade';
let panelPositions = safeJsonParse(localStorage.getItem('bzxz_panel_positions'), {});

function saveSettings() {
  localStorage.setItem('bzxz_download_sources', JSON.stringify(downloadSources));
  localStorage.setItem('bzxz_concurrency', String(downloadConcurrency));
  localStorage.setItem('bzxz_priority', JSON.stringify(downloadPriority));
  localStorage.setItem('bzxz_timeout', String(downloadTimeout));
  localStorage.setItem('bzxz_download_mode', downloadMode);
}
function savePanelPositions() {
  try { localStorage.setItem('bzxz_panel_positions', JSON.stringify(panelPositions)); }
  catch { /* quota exceeded — non-critical */ }
}

// ── State ──
let results = [];
let selectedSources = new Set(ALL_SOURCES);
let selectedIds = new Set();
let logEntries = [];
let isDownloading = false;
let searchAborted = false;
let activePanelId = null;
let filterState = { sources: new Set(), statuses: new Set() };
let sourceCheckCache = {};
let currentDetailContext = null;


// ── Panel management (sidebar/tab layout) ──
let activeDrag = null;

function switchTab(tab) {
  // Permission check
  if (currentUser && currentUser.allowed_tabs && tab !== 'users') {
    if (currentUser.allowed_tabs.indexOf(tab) < 0) return;
  }
  document.querySelectorAll('.page').forEach(function(p) { p.style.display = 'none'; });
  var page = document.getElementById('page-' + tab);
  if (page) page.style.display = 'block';
  document.querySelectorAll('.sidebar-item[data-tab]').forEach(function(item) {
    item.classList.toggle('active', item.dataset.tab === tab);
  });
  var titleEl = document.querySelector('.topbar-title');
  if (titleEl) titleEl.textContent = TAB_LABELS[tab] || '标准检索';
  if (tab === 'stats') loadStats();
  if (tab === 'users') loadUsers();
  if (tab === 'history') renderDownloadHistory();
  if (tab === 'settings') renderSettings();
  if (tab === 'batch') updateBatchSourceHint();
  if (tab === 'qual') loadQualLabs();
}
function initRouter() { switchTab("search"); }
function toggleSidebar() { document.body.classList.toggle("sidebar-collapsed"); }

function initPanels() { initRouter(); }

function togglePanel(name) {
  switchTab(name);
}

function openPanel(name) {
  switchTab(name);
}

function closePanel(name) { /* no-op in tab layout */ }

function minimizePanel(name) { /* no-op in tab layout */ }

function activatePanel(name) {
  switchTab(name || "search");
}

function updatePanelZIndices() { /* no-op in tab layout */ }

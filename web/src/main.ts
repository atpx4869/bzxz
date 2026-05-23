// Vite 入口：装配新 TS 模块 + 把它们暴露到 window 让仍在 public/js/ 下的 legacy
// 脚本（app-search.js / app-download.js / app-complete.js / app-settings.js /
// app-detail-utils.js / app-announcements.js / app-qual.js）继续可用。
//
// 迁移完成后可以删掉 window.xxx 赋值。

import '@/styles/index.css';

import {
  apiRequest,
  apiGet,
  apiPostJson,
  apiPutJson,
  apiDelete,
  readApiResponse,
  parseSseEvent,
} from '@/lib/api';
import {
  ALL_SOURCES,
  DEFAULT_DOWNLOAD_SOURCES,
  SOURCE_LABELS,
  DEFAULT_CONCURRENCY,
  VALID_CONCURRENCY,
  VALID_TIMEOUTS,
  srcLabel,
  settings,
  saveSettings,
  savedStandards,
  persistSavedStandards,
  standardSaveKey,
  isStandardSaved,
  panelPositions,
  savePanelPositions,
  setResultDensity,
  setCurrentUser,
  getCurrentUser,
  uiState,
} from '@/lib/state';
import {
  switchTab,
  toggleSidebar,
  initRouter,
  initPanels,
  togglePanel,
  openPanel,
  closePanel,
  minimizePanel,
  activatePanel,
  updatePanelZIndices,
  TAB_LABELS,
} from '@/modules/tabs';
import {
  apiFetch,
  installFetchInterceptor,
  checkAuthStatus,
  doLogout,
  continueAsGuest,
  toggleUserDropdown,
} from '@/modules/auth/session';
import {
  resetAuthFormToLogin,
  installAuthFormHandlers,
  installUserDropdownAutoClose,
  initLoginOverlayMeta,
  showChangePwd,
} from '@/modules/auth/overlay';
import { onAuthReady, applyTabPermissions } from '@/modules/auth/onReady';
import {
  loadUsers,
  installUsersTableHandlers,
  toggleUserSelect,
  toggleSelectAllUsers,
  batchSetActive,
  batchDeleteUsers,
  toggleUserActive,
  changeUserRole,
  deleteUser,
  toggleRegistration,
  toggleLoginRequired,
  showCreateUser,
  showDefaultPerms,
  saveDefaultPerms,
  showUserPerms,
  saveUserPerms,
  showUserDetail,
  TAB_ITEMS,
} from '@/modules/admin/users';
import { loadStats } from '@/modules/admin/stats';
import {
  escapeHtml,
  sleep,
  formatSize,
  triggerDownload,
  beijingDate,
  utcToBeijing,
} from '@/lib/dom-utils';
import { showToast } from '@/modules/ui/toast';
import { showConfirm } from '@/modules/ui/confirm';
import {
  sourceCheckKey,
  relativeCheckTime,
  detailInfoItem,
} from '@/modules/detail/helpers';
import {
  renderSourceDownloadPanel,
  renderDetailModal,
} from '@/modules/detail/render';
import {
  findResultByAnyId,
  sourceFromStandardId,
  statusClass,
} from '@/modules/result/lookups';

// ── 把新 TS 模块挂到 window 让 legacy 脚本看得见 ──
const w = window as any;
Object.assign(w, {
  // API
  apiRequest, apiGet, apiPostJson, apiPutJson, apiDelete, readApiResponse, parseSseEvent, apiFetch,
  // 状态/设置常量
  ALL_SOURCES, DEFAULT_DOWNLOAD_SOURCES, SOURCE_LABELS, DEFAULT_CONCURRENCY,
  VALID_CONCURRENCY, VALID_TIMEOUTS, srcLabel,
  saveSettings, persistSavedStandards, standardSaveKey, isStandardSaved,
  savePanelPositions, setResultDensity,
  // 用户/状态
  setCurrentUser, getCurrentUser,
  // Tab
  switchTab, toggleSidebar, initRouter, initPanels,
  togglePanel, openPanel, closePanel, minimizePanel, activatePanel, updatePanelZIndices,
  TAB_LABELS,
  // Auth
  checkAuthStatus, doLogout, continueAsGuest, toggleUserDropdown, showChangePwd,
  resetAuthFormToLogin, onAuthReady, applyTabPermissions,
  // Admin
  loadUsers, toggleUserSelect, toggleSelectAllUsers, batchSetActive, batchDeleteUsers,
  toggleUserActive, changeUserRole, deleteUser, toggleRegistration, toggleLoginRequired,
  showCreateUser, showDefaultPerms, saveDefaultPerms, showUserPerms, saveUserPerms,
  showUserDetail, TAB_ITEMS,
  loadStats,
  // UI 工具（TS 在 legacy 之后加载，会覆盖 legacy 同名函数 —— 这是预期，
  // 给迁移期一个统一的实现入口。下游迁完 legacy 后这一段可保留）
  escapeHtml, sleep, formatSize, triggerDownload, beijingDate, utcToBeijing,
  showToast, showConfirm,
  // Detail 渲染（覆盖 legacy app-detail-utils.js 中的同名函数）
  sourceCheckKey, relativeCheckTime, detailInfoItem,
  renderSourceDownloadPanel, renderDetailModal,
  // Result 查表（覆盖 legacy app-search.js / app-download.js 中的同名函数）
  // 注意：legacy app-search.js 顶层有 `let results = []`，与 uiState.results
  // 不是同一个数组。这一同步问题待 app-search.js 自身迁移时解决。
  findResultByAnyId, sourceFromStandardId, statusClass,
});

// Legacy 代码用 `let currentUser` 跨文件共享；用 getter 让它从 state 单一源读
Object.defineProperty(w, 'currentUser', {
  get: () => getCurrentUser(),
  set: (v) => setCurrentUser(v),
  configurable: true,
});

// 兼容旧代码直接读写 settings 字段（downloadSources / downloadConcurrency / …）
for (const k of ['downloadSources', 'downloadConcurrency', 'downloadPriority', 'downloadTimeout', 'downloadMode', 'resultDensity'] as const) {
  Object.defineProperty(w, k, {
    get: () => (settings as any)[k],
    set: (v) => { (settings as any)[k] = v; },
    configurable: true,
  });
}
// uiState 字段直通
for (const k of ['results', 'selectedSources', 'selectedIds', 'logEntries', 'isDownloading',
                 'searchAborted', 'activePanelId', 'filterState', 'sourceCheckCache',
                 'currentDetailContext'] as const) {
  Object.defineProperty(w, k, {
    get: () => (uiState as any)[k],
    set: (v) => { (uiState as any)[k] = v; },
    configurable: true,
  });
}
Object.defineProperty(w, 'sourceHealthCheckedAt', {
  get: () => uiState.sourceHealthCheckedAt,
  set: (v) => { uiState.sourceHealthCheckedAt = v; },
  configurable: true,
});
w.savedStandards = savedStandards;
w.panelPositions = panelPositions;

// ── 启动 ──
// 1. 安装全局 fetch 401 拦截
installFetchInterceptor();

// 2. DOM Ready 后绑定 UI handler + 拉鉴权状态
function bootDom(): void {
  installAuthFormHandlers();
  installUserDropdownAutoClose();
  installUsersTableHandlers();
  initLoginOverlayMeta();
  // 拉鉴权状态：成功后 overlay 隐藏 + onAuthReady 触发面板初始化
  void checkAuthStatus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootDom, { once: true });
} else {
  bootDom();
}

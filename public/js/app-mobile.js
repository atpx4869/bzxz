// app-mobile.js — 手机端布局切换 & 底部 tab bar 路由
//
// 与 app-core.js 的 switchTab() 解耦：本文件只负责
// (1) 检测视口宽度，给 <body> 加 layout-mobile / force-desktop class
// (2) ?desktop=1 / localStorage 强制桌面布局逃生口
// (3) 底部 mobile-tabbar 点击 -> 现有 switchTab()
// (4) 订阅 'tabchange' 事件，同步 tabbar 的 active 高亮
// (5) toggleDesktopLayout() 给 me 页"切换到完整版"按钮用
// (6) window.isMobile() 暴露给 legacy 脚本（app-search.js 等）做 guard
//
// CSS 侧：所有 ≤640px 规则用 body:not(.force-desktop) 包裹，保证桌面端
// 强制（URL or localStorage）能完全绕过手机收敛。

(function() {
  'use strict';

  var MOBILE_BP = 640;
  var STORAGE_KEY = 'bzxz.layout';

  function readForcedMode() {
    // URL 优先于 localStorage：?desktop=1 强制桌面，?desktop=0 强制手机
    try {
      var params = new URLSearchParams(window.location.search);
      var v = params.get('desktop');
      if (v === '1') return 'desktop';
      if (v === '0') return 'mobile';
    } catch (e) { /* ignore */ }
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'desktop' || stored === 'mobile') return stored;
    } catch (e) { /* localStorage 可能被禁用 */ }
    return null;
  }

  function viewportIsMobile() {
    try {
      return window.matchMedia('(max-width: ' + MOBILE_BP + 'px)').matches;
    } catch (e) {
      return window.innerWidth <= MOBILE_BP;
    }
  }

  // 真实生效的布局模式：受强制开关 + 视口宽度联合决定
  function getLayoutMode() {
    var forced = readForcedMode();
    if (forced === 'desktop') return 'desktop';
    if (forced === 'mobile') return 'mobile';
    return viewportIsMobile() ? 'mobile' : 'desktop';
  }

  function applyLayoutMode() {
    var mode = getLayoutMode();
    var forced = readForcedMode();
    var body = document.body;
    if (!body) return;

    // layout-mobile: 真实生效为手机版
    body.classList.toggle('layout-mobile', mode === 'mobile');

    // force-desktop: 视口本来是手机宽度，但被用户强制切到桌面
    // 该 class 用来让 CSS 的 @media (max-width:640px) body:not(.force-desktop)
    // 规则失效，避免桌面布局再被手机 CSS 收敛回去
    body.classList.toggle('force-desktop', forced === 'desktop' && viewportIsMobile());

    updateMobileTabbarVisibility(mode);
    updateMeToggleLabel(forced, mode);
  }

  // 切换 mobile-tabbar 的可见性。
  // CSS 已经用 @media 自动隐藏/显示，这里仅保证 force-desktop 时强制不显示。
  function updateMobileTabbarVisibility(mode) {
    var bar = document.getElementById('mobileTabbar');
    if (!bar) return;
    // 让 CSS 决定主控，此处只在 force-desktop 时显式隐藏
    if (document.body.classList.contains('force-desktop')) {
      bar.style.display = 'none';
    } else {
      bar.style.display = '';
    }
  }

  function updateMeToggleLabel(forced, mode) {
    var label = document.getElementById('meToggleLayoutLabel');
    if (!label) return;
    // 当前若是桌面强制 -> 提示"回到手机版"；当前若是手机模式 -> 提示"切换到完整版"
    if (forced === 'desktop' || (mode === 'desktop' && viewportIsMobile())) {
      label.textContent = '回到手机版';
    } else {
      label.textContent = '切换到完整版';
    }
  }

  // 暴露给"我"页按钮 + 桌面 sidebar 上的"完整版"开关（如有）
  function toggleDesktopLayout() {
    var current = readForcedMode();
    var next;
    if (current === 'desktop') next = null;       // 解除强制 -> 自适应
    else next = 'desktop';                         // 强制桌面
    try {
      if (next === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch (e) { /* ignore */ }
    applyLayoutMode();
  }

  // legacy 脚本 guard 入口：if (window.isMobile()) return;
  function isMobile() {
    return document.body && document.body.classList.contains('layout-mobile');
  }

  // ── 底部 tabbar 点击路由 ──
  function installMobileTabbar() {
    var bar = document.getElementById('mobileTabbar');
    if (!bar) return;
    bar.addEventListener('click', function(e) {
      var btn = e.target && e.target.closest ? e.target.closest('.mobile-tab') : null;
      if (!btn) return;
      var tab = btn.getAttribute('data-tab');
      if (!tab) return;
      if (typeof window.switchTab === 'function') {
        window.switchTab(tab);
      }
    });
  }

  // ── 同步 active 高亮 ──
  // app-core.js 的 switchTab() 末尾会 dispatch 'tabchange' 事件
  function syncTabbarActive(tab) {
    var tabs = document.querySelectorAll('#mobileTabbar .mobile-tab');
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var active = t.getAttribute('data-tab') === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  // ── 启动 ──
  function init() {
    applyLayoutMode();
    installMobileTabbar();
    window.addEventListener('resize', applyLayoutMode);
    window.addEventListener('tabchange', function(e) {
      var tab = e && e.detail && e.detail.tab;
      if (tab) syncTabbarActive(tab);
    });
  }

  // 暴露 API（legacy 全局风格，避免引入模块系统）
  window.isMobile = isMobile;
  window.toggleDesktopLayout = toggleDesktopLayout;
  window.getLayoutMode = getLayoutMode;
  window.applyLayoutMode = applyLayoutMode;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

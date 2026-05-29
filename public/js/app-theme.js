// app-theme.js — 主题切换(dark / light),所有用户可用
//
// 设计:
//  - 双主题:dark(默认) / light
//  - 持久化:localStorage 'bzxz.theme'
//  - 切换载体:<html data-theme="dark|light">,CSS 用 :root[data-theme="light"]
//    覆写所有变量 + 全局 hardcode 色值
//  - 入口:手机「我」页 chip 行(.me-theme-options),桌面 topbar 🌙/☀️ 按钮
//  - 避免 FOUC:public/index.html + web/index.html <head> 顶部加内联 script
//    在 CSS 加载前先把 data-theme 设上,浏览器一开始就按目标主题渲染
//
// 公开 API:
//   window.bzxzTheme.get()         返回 'dark' | 'light'
//   window.bzxzTheme.set('light')  切换 + persist
//   window.bzxzTheme.toggle()      dark ↔ light
//   syncThemeUI()                  让两套 UI(我页 chip / topbar 图标)反映当前态
//
// 事件:CustomEvent('themechange', { detail: { theme } }) 派发到 document,
//      其它模块(如 chartjs 渲染)可订阅做颜色重绘

(function() {
  'use strict';

  var KEY = 'bzxz.theme';
  var VALID = ['dark', 'light'];

  function getTheme() {
    try {
      var t = localStorage.getItem(KEY);
      return VALID.indexOf(t) >= 0 ? t : 'dark';
    } catch (e) { return 'dark'; }
  }

  function setTheme(theme) {
    if (VALID.indexOf(theme) < 0) theme = 'dark';
    try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore */ }
    document.documentElement.setAttribute('data-theme', theme);
    syncThemeUI();
    try {
      document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
    } catch (e) { /* CustomEvent IE 兼容兜底,生产不在乎 */ }
  }

  function toggleTheme() {
    setTheme(getTheme() === 'light' ? 'dark' : 'light');
  }

  // 让两套 UI 入口的视觉同步当前主题:
  //  - 「我」页主题 chip 行:点中的 chip 加 .active
  //  - topbar 主题切换按钮:dark 时显 ☀️(暗示"点了变亮"),light 时显 🌙
  function syncThemeUI() {
    var theme = getTheme();
    // 我页 chip
    var chips = document.querySelectorAll('.me-theme-btn');
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i];
      c.classList.toggle('active', c.getAttribute('data-theme') === theme);
    }
    // topbar 图标按钮
    var toggleBtn = document.getElementById('topbarThemeToggle');
    if (toggleBtn) {
      toggleBtn.textContent = theme === 'light' ? '🌙' : '☀️';
      toggleBtn.setAttribute('title', theme === 'light' ? '切换到深色' : '切换到浅色');
      toggleBtn.setAttribute('aria-label', theme === 'light' ? '切换到深色' : '切换到浅色');
    }
  }

  // 启动:防御性再次应用(head 内联 script 已经设过,这里兜底处理 race)
  document.documentElement.setAttribute('data-theme', getTheme());

  // DOM ready 后同步 UI
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncThemeUI);
  } else {
    syncThemeUI();
  }

  // 暴露
  window.bzxzTheme = { get: getTheme, set: setTheme, toggle: toggleTheme };
  window.syncThemeUI = syncThemeUI;
})();

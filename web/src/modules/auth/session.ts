// 鉴权 fetch 封装 + 401 拦截 —— 从 public/js/app-auth-admin.js 迁移
import { readApiResponse } from '@/lib/api';
import { setCurrentUser } from '@/lib/state';
import { resetAuthFormToLogin } from './overlay';

// 记录上次 status 拉回来的 loginRequired —— 退出登录后用来决定要不要露出
// "继续以访客身份使用"链接（免登录模式下点退出会停在登录页，需要给用户一个回访客的路）。
let lastLoginRequired = true;
export function getLastLoginRequired(): boolean {
  return lastLoginRequired;
}

function updateGuestContinueVisibility(): void {
  const el = document.getElementById('authGuestContinue');
  if (!el) return;
  (el as HTMLElement).style.display = lastLoginRequired ? 'none' : '';
}

// /api/auth/* 上的 401 表示"用户名/旧密码错误"等业务失败，
// 不应被解释为"会话过期 → 弹登录"，否则用户输错旧密码也会被踢出。
export function isAuthEndpoint(url: string | RequestInfo | URL | undefined): boolean {
  try {
    return String(url || '').includes('/api/auth/');
  } catch {
    return false;
  }
}

export function handleSessionExpired(): void {
  setCurrentUser(null);
  resetAuthFormToLogin();
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.classList.remove('hidden');
  // 重新拉取 setup/loginRequired 让 overlay 显示对的拷贝（首次启动 vs. 普通登录）
  void checkAuthStatus().catch(() => {
    /* overlay already visible */
  });
}

// 全局 fetch 拦截：非鉴权端点的 401 触发会话过期处理
let installed = false;
export function installFetchInterceptor(): void {
  if (installed) return;
  installed = true;
  const origFetch = window.fetch;
  window.fetch = function (...args: Parameters<typeof fetch>) {
    return origFetch.apply(this, args).then((res) => {
      if (res.status === 401 && !isAuthEndpoint(args[0] as any)) {
        handleSessionExpired();
      }
      return res;
    });
  };
}

// 鉴权感知的 fetch 包装：非鉴权 401 → 弹登录 + 抛错；鉴权 401 → 返回 Response 让调用方处理。
export async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...options, credentials: 'same-origin' });
  if (res.status === 401 && !isAuthEndpoint(url)) {
    handleSessionExpired();
    throw new Error('未登录');
  }
  return res;
}

// ── checkAuthStatus ──
// 从 app-auth-admin.js 直接迁移：处理首次启动 / 登录可选 / 已登录三种分支。
export async function checkAuthStatus(): Promise<void> {
  try {
    const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
    const data = await readApiResponse(res);
    lastLoginRequired = !!data.loginRequired;
    updateGuestContinueVisibility();
    if (data.user) {
      setCurrentUser(data.user);
      document.getElementById('authOverlay')?.classList.add('hidden');
      (window as any).onAuthReady?.();
      return;
    }
    // 没有 user —— 先重置成干净登录态再按响应贴文案
    resetAuthFormToLogin();
    if (data.needsSetup) {
      const overlayEl = document.getElementById('authOverlay');
      const titleEl = document.getElementById('authTitle');
      const submitEl = document.getElementById('authSubmitBtn');
      const toggleEl = document.getElementById('authToggle');
      if (titleEl) titleEl.textContent = '首次启动，请创建管理员账号';
      if (submitEl) submitEl.textContent = '注册';
      if (toggleEl) toggleEl.textContent = '';
      overlayEl?.classList.remove('hidden');
      (window as any).__isRegisterMode = true;
    } else if (!data.loginRequired) {
      // 不要求登录 —— 后端应给一个 guest，response 为空时兜底合成一个
      setCurrentUser({
        id: 0,
        username: '_guest',
        displayName: '访客',
        role: 'user',
        allowedTabs: ['search', 'batch', 'complete'],
      });
      document.getElementById('authOverlay')?.classList.add('hidden');
      (window as any).onAuthReady?.();
    } else {
      const toggleEl = document.getElementById('authToggle');
      if (toggleEl) toggleEl.textContent = data.registrationEnabled ? '没有账号？注册' : '';
      document.getElementById('authOverlay')?.classList.remove('hidden');
    }
  } catch {
    // 网络/解析失败 —— 干净登录态让用户重试（提交时会显示"网络错误"）
    resetAuthFormToLogin();
    document.getElementById('authOverlay')?.classList.remove('hidden');
  }
}

export async function doLogout(): Promise<void> {
  try {
    await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  } catch {
    /* 网络失败不阻塞 logout UI */
  }
  setCurrentUser(null);
  document.getElementById('userDropdown')?.classList.remove('open');
  resetAuthFormToLogin();
  document.getElementById('authOverlay')?.classList.remove('hidden');
  // 免登录 + loopback 模式下，露出"继续以访客身份使用"，用户点了才回访客态；
  // 不再立即 checkAuthStatus，否则后端会马上发一个新 guest 会话，看起来像退不掉。
  updateGuestContinueVisibility();
  try {
    (window as any).showToast?.('已退出登录', 'success');
  } catch {
    /* 没装 toast 不阻塞 */
  }
}

// 用户在登录页点"继续以访客身份使用"时调用 —— 重新拉 status，
// 若后端给了 guest 会话就会自动 onAuthReady + 隐藏 overlay。
export async function continueAsGuest(): Promise<void> {
  try {
    await checkAuthStatus();
  } catch {
    /* overlay 已可见，让用户重试 */
  }
}

export function toggleUserDropdown(): void {
  document.getElementById('userDropdown')?.classList.toggle('open');
}

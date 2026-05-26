import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { parseCookie } from '../shared/errors';
import { getSetting, GUEST_USERNAME } from '../services/db';
import { respondError } from '../shared/response';
import { SESSION_MAX_AGE_MS, SESSION_RENEW_THRESHOLD_MS, cookieOpts } from './session-cookie';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
  allowed_tabs: string[] | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type AuthUserRow = {
  id?: number;
  user_id?: number;
  username: string;
  display_name: string;
  role: string;
  allowed_tabs: string | null;
};

function toAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.user_id ?? row.id!,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    allowed_tabs: row.allowed_tabs ? JSON.parse(row.allowed_tabs) : null,
  };
}

export function getGuestAuthUser(db: Database.Database): AuthUser {
  const row = db.prepare(`
    SELECT id, username, display_name, role, allowed_tabs
    FROM users
    WHERE username = ? AND is_active = 1
  `).get(GUEST_USERNAME) as AuthUserRow | undefined;

  if (!row) {
    throw new Error('Guest user is not initialized');
  }

  return toAuthUser(row);
}

// IPv4 / IPv6 loopback only — guest fallback should never be granted to LAN
// peers when login_required=0 is set (the "open desktop" mode).
export function isLoopbackRequest(req: Request): boolean {
  const remote = req.socket.remoteAddress || req.ip || '';
  if (!remote) return false;
  if (remote === '127.0.0.1' || remote === '::1') return true;
  if (remote === '::ffff:127.0.0.1' || remote.startsWith('::ffff:127.')) return true;
  return false;
}

export function createAuthMiddleware(db: Database.Database) {
  const cleanExpiredSessions = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')");

  // 滑窗续期：DB + Cookie 同步刷新。
  // Why: 之前续期只更新 DB，Cookie 自己到了 30 天后过期，用户被踢出登录即使
  // 一直在用。同步刷 Cookie 才能真正实现"只要访问就续命"。
  function maybeRenewSession(res: Response, token: string, currentExpiresAt: string): void {
    const remaining = new Date(currentExpiresAt).getTime() - Date.now();
    if (remaining < SESSION_RENEW_THRESHOLD_MS) {
      const newExpiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(newExpiry, token);
      // 不覆盖已有 Set-Cookie（例如登出场景），用 append 也行；但中间件这里
      // 没人会同时写 Set-Cookie，直接 setHeader 即可。
      res.setHeader('Set-Cookie', cookieOpts(token));
    }
  }

  // Run expired-session cleanup on a timer instead of piggy-backing on the
  // request that happens to be #100 — that path had to do a synchronous DELETE
  // while the user waited. unref() so the interval doesn't keep Node alive.
  const sessionSweep = setInterval(() => {
    try { cleanExpiredSessions.run(); } catch { /* db may be closing */ }
  }, 5 * 60 * 1000);
  sessionSweep.unref?.();

  function isLoginRequired(): boolean {
    return getSetting(db, 'login_required', '0') === '1';
  }

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    // If login is not required, check for session first, fall back to guest
    // ONLY for loopback requests. LAN peers must always authenticate even
    // when "open desktop" mode is enabled, otherwise anyone on the network
    // would inherit guest's permissions implicitly.
    if (!isLoginRequired()) {
      const token = parseCookie(req.headers.cookie, 'bzxz_session');
      if (token) {
        const now = new Date().toISOString();
        const row = db.prepare(`
          SELECT s.token, s.user_id, s.expires_at,
                 u.username, u.display_name, u.role, u.is_active, u.allowed_tabs
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token = ?
        `).get(token) as {
          token: string; user_id: number; expires_at: string;
          username: string; display_name: string; role: string; is_active: number;
          allowed_tabs: string | null;
        } | undefined;

        if (row && row.expires_at >= now && row.is_active) {
          // 即使在「开放桌面」模式下，已登录用户也应该续命；
          // 否则桌面常驻这条路径的用户 30 天后会无声被踢。
          maybeRenewSession(res, token, row.expires_at);
          req.user = toAuthUser(row);
          next();
          return;
        }
      }
      // loopback 永远放行 guest；管理员开「允许局域网游客」后 LAN 也放行。
      // 此项默认关闭，开启风险见 admin-routes.ts:readAdminSettings。
      const lanGuestAllowed = getSetting(db, 'lan_guest_allowed', '0') === '1';
      if (isLoopbackRequest(req) || lanGuestAllowed) {
        req.user = getGuestAuthUser(db);
        next();
        return;
      }
      respondError(res, 401, 'UNAUTHORIZED', '局域网访问需要登录');
      return;
    }

    // Login required — normal auth flow
    const token = parseCookie(req.headers.cookie, 'bzxz_session');
    if (!token) {
      respondError(res, 401, 'UNAUTHORIZED', '请先登录');
      return;
    }

    const now = new Date().toISOString();
    const row = db.prepare(`
      SELECT s.token, s.user_id, s.expires_at,
             u.username, u.display_name, u.role, u.is_active, u.allowed_tabs
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).get(token) as {
      token: string; user_id: number; expires_at: string;
      username: string; display_name: string; role: string; is_active: number;
      allowed_tabs: string | null;
    } | undefined;

    if (!row || row.expires_at < now || !row.is_active) {
      if (row) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      }
      respondError(res, 401, 'UNAUTHORIZED', '会话已过期，请重新登录');
      return;
    }

    maybeRenewSession(res, token, row.expires_at);

    req.user = toAuthUser(row);

    next();
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    requireAuth(req, res, () => {
      if (req.user?.role !== 'admin') {
        respondError(res, 403, 'FORBIDDEN', '需要管理员权限');
        return;
      }
      next();
    });
  }

  return { requireAuth, requireAdmin, isLoginRequired };
}

import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { parseCookie } from '../shared/errors';
import { getSetting } from '../services/db';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
  allowed_tabs: string[] | null;
}

const GUEST_USER: AuthUser = {
  id: 0,
  username: '_guest',
  display_name: '访客',
  role: 'admin',
  allowed_tabs: null,
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function createAuthMiddleware(db: Database.Database) {
  const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  let requestCount = 0;
  const cleanExpiredSessions = db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')");

  function isLoginRequired(): boolean {
    return getSetting(db, 'login_required', '0') === '1';
  }

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    // Periodic cleanup: every 100 requests
    if (++requestCount % 100 === 0) {
      cleanExpiredSessions.run();
    }

    // If login is not required, check for session first, fall back to guest
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
          req.user = {
            id: row.user_id, username: row.username,
            display_name: row.display_name, role: row.role,
            allowed_tabs: row.allowed_tabs ? JSON.parse(row.allowed_tabs) : null,
          };
          next();
          return;
        }
      }
      // No valid session — use guest
      req.user = GUEST_USER;
      next();
      return;
    }

    // Login required — normal auth flow
    const token = parseCookie(req.headers.cookie, 'bzxz_session');
    if (!token) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录' });
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
      res.status(401).json({ code: 'UNAUTHORIZED', message: '会话已过期，请重新登录' });
      return;
    }

    const expiresAt = new Date(row.expires_at).getTime();
    if (expiresAt - Date.now() < 60 * 60 * 1000) {
      const newExpiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(newExpiry, token);
    }

    req.user = {
      id: row.user_id, username: row.username,
      display_name: row.display_name, role: row.role,
      allowed_tabs: row.allowed_tabs ? JSON.parse(row.allowed_tabs) : null,
    };

    next();
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    requireAuth(req, res, () => {
      if (req.user?.role !== 'admin') {
        res.status(403).json({ code: 'FORBIDDEN', message: '需要管理员权限' });
        return;
      }
      next();
    });
  }

  return { requireAuth, requireAdmin, isLoginRequired };
}


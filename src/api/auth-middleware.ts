import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function createAuthMiddleware(db: Database.Database) {
  const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = parseCookie(req.headers.cookie, 'bzxz_session');
    if (!token) {
      res.status(401).json({ code: 'UNAUTHORIZED', message: '请先登录' });
      return;
    }

    const now = new Date().toISOString();
    const row = db.prepare(`
      SELECT s.token, s.user_id, s.expires_at,
             u.username, u.display_name, u.role, u.is_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).get(token) as {
      token: string; user_id: number; expires_at: string;
      username: string; display_name: string; role: string; is_active: number;
    } | undefined;

    if (!row || row.expires_at < now || !row.is_active) {
      // Clean up expired/inactive session
      if (row) {
        db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      }
      res.status(401).json({ code: 'UNAUTHORIZED', message: '会话已过期，请重新登录' });
      return;
    }

    // Sliding window: extend expiry on each request
    const newExpiry = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(newExpiry, token);

    req.user = {
      id: row.user_id,
      username: row.username,
      display_name: row.display_name,
      role: row.role,
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

  return { requireAuth, requireAdmin };
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

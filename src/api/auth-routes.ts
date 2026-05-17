import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from './auth-middleware';
import { getGuestAuthUser } from './auth-middleware';
import { getSetting, getRealUserCount, GUEST_USERNAME } from '../services/db';
import { normalizeError, parseCookie } from '../shared/errors';
import { respond, respondError } from '../shared/response';
import { toCamelCase } from '../shared/case';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
function cookieOpts(token: string): string {
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS).toUTCString();
  return `bzxz_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Expires=${expires}`;
}
const SALT_ROUNDS = 10;

export function createAuthRoutes(db: Database.Database, requireAuth: (req: Request, res: Response, next: NextFunction) => void) {
  const router = Router();

  // GET /api/auth/status — check setup + current user
  router.get('/status', (req, res) => {
    const userCount = getRealUserCount(db);
    const token = parseCookie(req.headers.cookie, 'bzxz_session');

    let user: AuthUser | null = null;
    if (token) {
      const row = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role, u.allowed_tabs
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ? AND u.is_active = 1
      `).get(token, new Date().toISOString()) as (AuthUser & { allowed_tabs: string | null }) | undefined;
      if (row) user = { ...row, allowed_tabs: row.allowed_tabs ? JSON.parse(row.allowed_tabs) : null };
    }

    const registrationEnabled = getSetting(db, 'registration_enabled', '1') === '1';
    const loginRequired = getSetting(db, 'login_required', '0') === '1';
    if (!user && !loginRequired) {
      user = getGuestAuthUser(db);
    }
    respond(res, { needsSetup: userCount === 0, user: toCamelCase(user), registrationEnabled, loginRequired });
  });

  // POST /api/auth/register
  router.post('/register', async (req, res, next) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(2).max(32),
        password: z.string().min(6).max(128),
        displayName: z.string().trim().max(64).optional(),
      });
      const { username, password, displayName } = schema.parse(req.body);
      if (username.toLowerCase() === GUEST_USERNAME) {
        respondError(res, 400, 'BAD_REQUEST', 'Guest username is reserved');
        return;
      }

      // Check if registration is enabled (skip check if no users exist — need to bootstrap)
      const userCount = getRealUserCount(db);
      if (userCount > 0) {
        const regEnabled = getSetting(db, 'registration_enabled', '1') === '1';
        if (!regEnabled) {
          respondError(res, 403, 'FORBIDDEN', '注册已关闭，请联系管理员');
          return;
        }
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        respondError(res, 409, 'CONFLICT', '用户名已存在');
        return;
      }

      const totalUsers = getRealUserCount(db);
      const role = totalUsers === 0 ? 'admin' : 'user';
      const hash = await bcrypt.hash(password, SALT_ROUNDS);

      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)'
      ).run(username, hash, displayName || '', role);

      // Auto-login after registration
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, result.lastInsertRowid, expiresAt);

      res.setHeader('Set-Cookie', cookieOpts(token));
      respond(res, {
        user: { id: result.lastInsertRowid, username, displayName: displayName || '', role, allowedTabs: null },
      }, 201);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // POST /api/auth/login
  router.post('/login', async (req, res, next) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(1),
        password: z.string().min(1),
      });
      const { username, password } = schema.parse(req.body);
      if (username.toLowerCase() === GUEST_USERNAME) {
        respondError(res, 401, 'UNAUTHORIZED', '用户名或密码错误');
        return;
      }

      const row = db.prepare('SELECT id, username, password, display_name, role, is_active, allowed_tabs FROM users WHERE username = ?').get(username) as {
        id: number; username: string; password: string; display_name: string; role: string; is_active: number; allowed_tabs: string | null;
      } | undefined;

      if (!row || !row.is_active) {
        respondError(res, 401, 'UNAUTHORIZED', '用户名或密码错误');
        return;
      }

      const valid = await bcrypt.compare(password, row.password);
      if (!valid) {
        respondError(res, 401, 'UNAUTHORIZED', '用户名或密码错误');
        return;
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, row.id, expiresAt);

      res.setHeader('Set-Cookie', cookieOpts(token));
      respond(res, {
        user: {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
          allowedTabs: row.allowed_tabs ? JSON.parse(row.allowed_tabs) : null,
        },
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // DELETE /api/auth/session — logout
  router.delete('/session', requireAuth, (req, res) => {
    const token = parseCookie(req.headers.cookie, 'bzxz_session');
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.setHeader('Set-Cookie', 'bzxz_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    respond(res, { ok: true });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, (req, res) => {
    respond(res, { user: toCamelCase(req.user) });
  });

  // PUT /api/auth/password
  router.put('/password', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({
        oldPassword: z.string().min(1),
        newPassword: z.string().min(6).max(128),
      });
      const { oldPassword, newPassword } = schema.parse(req.body);
      if (req.user!.username === GUEST_USERNAME) {
        respondError(res, 403, 'FORBIDDEN', 'Guest user cannot change password');
        return;
      }

      const row = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user!.id) as { password: string } | undefined;
      if (!row) {
        respondError(res, 404, 'NOT_FOUND', '用户不存在');
        return;
      }

      const valid = await bcrypt.compare(oldPassword, row.password);
      if (!valid) {
        respondError(res, 401, 'UNAUTHORIZED', '原密码错误');
        return;
      }

      const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hash, new Date().toISOString(), req.user!.id);

      respond(res, { ok: true });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  return router;
}

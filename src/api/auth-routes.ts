import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from './auth-middleware';
import { getGuestAuthUser, isLoopbackRequest } from './auth-middleware';
import { getSetting, getRealUserCount, GUEST_USERNAME } from '../services/db';
import { resolveDefaultAllowedTabs } from './admin-routes';
import { normalizeError, parseCookie } from '../shared/errors';
import { respond, respondError } from '../shared/response';
import { toCamelCase } from '../shared/case';
import { createRateLimiter, clientIp } from '../shared/rate-limit';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// SameSite=Strict blocks the cookie from being sent on cross-site navigations
// (mitigating CSRF on state-changing endpoints). `Secure` would prevent the
// cookie from being sent over plain HTTP, which is the normal LAN deployment
// mode for this app — gate it behind an env opt-in for HTTPS deployments.
const COOKIE_SECURE = process.env.BZXZ_COOKIE_SECURE === '1';
function cookieOpts(token: string): string {
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS).toUTCString();
  const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_MAX_AGE_MS / 1000}`, `Expires=${expires}`];
  if (COOKIE_SECURE) flags.push('Secure');
  return `bzxz_session=${token}; ${flags.join('; ')}`;
}
function clearCookieHeader(): string {
  const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (COOKIE_SECURE) flags.push('Secure');
  return `bzxz_session=; ${flags.join('; ')}`;
}
const SALT_ROUNDS = 10;

export function createAuthRoutes(db: Database.Database, requireAuth: (req: Request, res: Response, next: NextFunction) => void) {
  const router = Router();

  // Brute-force defense: 10 attempts per IP per 5 minutes for credential
  // endpoints; an extra per-username window narrows targeted password spraying.
  const ipLoginLimiter = createRateLimiter({
    windowMs: 5 * 60 * 1000,
    max: 10,
    keyFn: (req) => `login-ip:${clientIp(req)}`,
    message: '登录尝试过于频繁，请 5 分钟后再试',
  });
  const userLoginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 8,
    keyFn: (req) => {
      const u = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
      return u ? `login-user:${u}` : '';
    },
    message: '该账号登录尝试过于频繁，请 15 分钟后再试',
  });
  const registerLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 5,
    keyFn: (req) => `register-ip:${clientIp(req)}`,
    message: '注册操作过于频繁，请 1 小时后再试',
  });
  const passwordChangeLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 6,
    keyFn: (req) => `pwd:${req.user?.id ?? clientIp(req)}`,
    message: '密码修改过于频繁，请稍后再试',
  });

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
    // Guest fallback 默认仅 loopback — 见 auth-middleware §isLoopbackRequest。
    // 管理员可在「用户管理」开「允许局域网游客」，此时 LAN 客户端也视为 loopback。
    // 风险由管理员承担（任何扫到端口的人都能匿名访问），UI 上有红字警告。
    const lanGuestAllowed = getSetting(db, 'lan_guest_allowed', '0') === '1';
    const effectiveLoginRequired = loginRequired || (!isLoopbackRequest(req) && !lanGuestAllowed);
    if (!user && !effectiveLoginRequired) {
      user = getGuestAuthUser(db);
    }
    respond(res, { needsSetup: userCount === 0, user: toCamelCase(user), registrationEnabled, loginRequired: effectiveLoginRequired });
  });

  // POST /api/auth/register
  router.post('/register', registerLimiter, async (req, res, next) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(2).max(32).regex(/^[a-zA-Z0-9_.\-]+$/, '用户名仅支持字母、数字、下划线、点和连字符'),
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

      // First user (bootstrap admin) gets full access; everyone else inherits
      // the admin-configured default (core three tabs unless overridden).
      const allowedTabs = role === 'admin' ? null : resolveDefaultAllowedTabs(db);
      const allowedTabsJson = allowedTabs ? JSON.stringify(allowedTabs) : null;

      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, role, allowed_tabs) VALUES (?, ?, ?, ?, ?)'
      ).run(username, hash, displayName || '', role, allowedTabsJson);

      // Auto-login after registration
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, result.lastInsertRowid, expiresAt);

      res.setHeader('Set-Cookie', cookieOpts(token));
      respond(res, {
        user: { id: result.lastInsertRowid, username, displayName: displayName || '', role, allowedTabs },
      }, 201);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // POST /api/auth/login
  router.post('/login', ipLoginLimiter, userLoginLimiter, async (req, res, next) => {
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
    res.setHeader('Set-Cookie', clearCookieHeader());
    respond(res, { ok: true });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, (req, res) => {
    respond(res, { user: toCamelCase(req.user) });
  });

  // PUT /api/auth/password
  router.put('/password', requireAuth, passwordChangeLimiter, async (req, res, next) => {
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

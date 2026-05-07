import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from './auth-middleware';
import { getSetting } from '../services/db';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COOKIE_OPTS = 'bzxz_session=TOKEN; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000';
const SALT_ROUNDS = 10;

export function createAuthRoutes(db: Database.Database, requireAuth: (req: Request, res: Response, next: NextFunction) => void) {
  const router = Router();

  // GET /api/auth/status — check setup + current user
  router.get('/status', (req, res) => {
    const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
    const token = parseCookie(req.headers.cookie, 'bzxz_session');

    let user: AuthUser | null = null;
    if (token) {
      const row = db.prepare(`
        SELECT u.id, u.username, u.display_name, u.role
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ? AND u.is_active = 1
      `).get(token, new Date().toISOString()) as AuthUser | undefined;
      if (row) user = row;
    }

    const registrationEnabled = getSetting(db, 'registration_enabled', '1') === '1';
    res.json({ needsSetup: userCount === 0, user, registrationEnabled });
  });

  // POST /api/auth/register
  router.post('/register', async (req, res, next) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(2).max(32),
        password: z.string().min(6).max(128),
        display_name: z.string().trim().max(64).optional(),
      });
      const { username, password, display_name } = schema.parse(req.body);

      // Check if registration is enabled (skip check if no users exist — need to bootstrap)
      const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
      if (userCount > 0) {
        const regEnabled = getSetting(db, 'registration_enabled', '1') === '1';
        if (!regEnabled) {
          res.status(403).json({ code: 'FORBIDDEN', message: '注册已关闭，请联系管理员' });
          return;
        }
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        res.status(409).json({ code: 'CONFLICT', message: '用户名已存在' });
        return;
      }

      const totalUsers = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
      const role = totalUsers === 0 ? 'admin' : 'user';
      const hash = await bcrypt.hash(password, SALT_ROUNDS);

      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)'
      ).run(username, hash, display_name || '', role);

      // Auto-login after registration
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, result.lastInsertRowid, expiresAt);

      res.setHeader('Set-Cookie', COOKIE_OPTS.replace('TOKEN', token));
      res.status(201).json({
        user: { id: result.lastInsertRowid, username, display_name: display_name || '', role },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 'BAD_REQUEST', message: '参数无效', details: error.flatten() });
        return;
      }
      next(error);
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

      const row = db.prepare('SELECT id, username, password, display_name, role, is_active FROM users WHERE username = ?').get(username) as {
        id: number; username: string; password: string; display_name: string; role: string; is_active: number;
      } | undefined;

      if (!row || !row.is_active) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: '用户名或密码错误' });
        return;
      }

      const valid = await bcrypt.compare(password, row.password);
      if (!valid) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: '用户名或密码错误' });
        return;
      }

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, row.id, expiresAt);

      res.setHeader('Set-Cookie', COOKIE_OPTS.replace('TOKEN', token));
      res.json({ user: { id: row.id, username: row.username, display_name: row.display_name, role: row.role } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 'BAD_REQUEST', message: '参数无效' });
        return;
      }
      next(error);
    }
  });

  // DELETE /api/auth/session — logout
  router.delete('/session', requireAuth, (req, res) => {
    const token = parseCookie(req.headers.cookie, 'bzxz_session');
    if (token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
    res.setHeader('Set-Cookie', 'bzxz_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // PUT /api/auth/password
  router.put('/password', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({
        old_password: z.string().min(1),
        new_password: z.string().min(6).max(128),
      });
      const { old_password, new_password } = schema.parse(req.body);

      const row = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user!.id) as { password: string } | undefined;
      if (!row) {
        res.status(404).json({ code: 'NOT_FOUND', message: '用户不存在' });
        return;
      }

      const valid = await bcrypt.compare(old_password, row.password);
      if (!valid) {
        res.status(401).json({ code: 'UNAUTHORIZED', message: '原密码错误' });
        return;
      }

      const hash = await bcrypt.hash(new_password, SALT_ROUNDS);
      db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?').run(hash, new Date().toISOString(), req.user!.id);

      res.json({ ok: true });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 'BAD_REQUEST', message: '参数无效' });
        return;
      }
      next(error);
    }
  });

  return router;
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

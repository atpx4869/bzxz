import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import { getSetting, setSetting, GUEST_USERNAME } from '../services/db';
import { normalizeError } from '../shared/errors';
import { respond, respondError } from '../shared/response';
import { toCamelCase } from '../shared/case';

const SALT_ROUNDS = 10;

const ALL_TABS = ['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'] as const;
export { ALL_TABS };

function parseAllowedTabs(raw: string | null): string[] | null {
  if (!raw) return null; // null = all tabs allowed
  try { return JSON.parse(raw); } catch { return null; }
}

function readAdminSettings(db: Database.Database) {
  const defaultTabsRaw = getSetting(db, 'default_allowed_tabs', '');
  return {
    registrationEnabled: getSetting(db, 'registration_enabled', '1') === '1',
    loginRequired: getSetting(db, 'login_required', '0') === '1',
    defaultAllowedTabs: defaultTabsRaw ? parseAllowedTabs(defaultTabsRaw) : null,
  };
}

export function createAdminRoutes(db: Database.Database) {
  const router = Router();

  // GET /api/admin/settings
  router.get('/settings', (_req, res) => {
    respond(res, readAdminSettings(db));
  });

  // PUT /api/admin/settings
  router.put('/settings', (req, res, next) => {
    try {
      const schema = z.object({
        registrationEnabled: z.boolean().optional(),
        loginRequired: z.boolean().optional(),
        defaultAllowedTabs: z.array(z.enum(['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'])).nullable().optional(),
      });
      const updates = schema.parse(req.body);
      if (updates.registrationEnabled !== undefined) {
        setSetting(db, 'registration_enabled', updates.registrationEnabled ? '1' : '0');
      }
      if (updates.loginRequired !== undefined) {
        setSetting(db, 'login_required', updates.loginRequired ? '1' : '0');
      }
      if (updates.defaultAllowedTabs !== undefined) {
        setSetting(db, 'default_allowed_tabs', updates.defaultAllowedTabs ? JSON.stringify(updates.defaultAllowedTabs) : '');
      }
      respond(res, readAdminSettings(db));
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // GET /api/admin/users
  router.get('/users', (_req, res) => {
    const users = db.prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.is_active, u.allowed_tabs, u.created_at, u.updated_at,
        COALESCE(s.cnt, 0) as search_count, COALESCE(d.cnt, 0) as download_count
       FROM users u
       LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM usage_events WHERE event_type = 'search' GROUP BY user_id) s ON s.user_id = u.id
       LEFT JOIN (SELECT user_id, COUNT(*) as cnt FROM usage_events WHERE event_type = 'download' GROUP BY user_id) d ON d.user_id = u.id
       ORDER BY u.id`
    ).all() as any[];
    respond(res, {
      users: toCamelCase(users.map(u => ({ ...u, allowed_tabs: parseAllowedTabs(u.allowed_tabs) }))),
    });
  });

  // GET /api/admin/users/:id/events — user usage details
  router.get('/users/:id/events', (req, res) => {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) {
      respondError(res, 400, 'BAD_REQUEST', '无效用户 ID');
      return;
    }

    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(userId) as { id: number; username: string; display_name: string } | undefined;
    if (!user) {
      respondError(res, 404, 'NOT_FOUND', '用户不存在');
      return;
    }

    const limit = Math.max(1, Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200));

    const summary = db.prepare(
      `SELECT event_type, COUNT(*) as count FROM usage_events WHERE user_id = ? GROUP BY event_type`
    ).all(userId) as { event_type: string; count: number }[];

    const bySource = db.prepare(
      `SELECT source, COUNT(*) as count FROM usage_events WHERE user_id = ? AND source IS NOT NULL GROUP BY source ORDER BY count DESC`
    ).all(userId) as { source: string; count: number }[];

    const recent = db.prepare(
      `SELECT id, event_type, source, standard_id, metadata, created_at FROM usage_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(userId, limit) as { id: number; event_type: string; source: string | null; standard_id: string | null; metadata: string | null; created_at: string }[];

    respond(res, {
      user: toCamelCase(user),
      summary: toCamelCase(summary),
      bySource: toCamelCase(bySource),
      recent: toCamelCase(recent.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }))),
    });
  });

  // POST /api/admin/users
  router.post('/users', async (req, res, next) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(2).max(32),
        password: z.string().min(6).max(128),
        displayName: z.string().trim().max(64).optional(),
        role: z.enum(['user', 'admin']).optional(),
        allowedTabs: z.array(z.enum(['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'])).nullable().optional(),
      });
      const { username, password, displayName, role, allowedTabs } = schema.parse(req.body);
      if (username.toLowerCase() === GUEST_USERNAME) {
        respondError(res, 400, 'BAD_REQUEST', 'Guest username is reserved');
        return;
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        respondError(res, 409, 'CONFLICT', '用户名已存在');
        return;
      }

      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const tabsJson = allowedTabs ? JSON.stringify(allowedTabs) : null;
      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, role, allowed_tabs) VALUES (?, ?, ?, ?, ?)'
      ).run(username, hash, displayName || '', role || 'user', tabsJson);

      respond(res, {
        user: { id: result.lastInsertRowid, username, displayName: displayName || '', role: role || 'user', allowedTabs: allowedTabs ?? null },
      }, 201);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // PUT /api/admin/users/:id
  router.put('/users/:id', async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        respondError(res, 400, 'BAD_REQUEST', '无效用户 ID');
        return;
      }

      const schema = z.object({
        displayName: z.string().trim().max(64).optional(),
        role: z.enum(['user', 'admin']).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(6).max(128).optional(),
        allowedTabs: z.array(z.enum(['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'])).nullable().optional(),
      });
      const updates = schema.parse(req.body);

      const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as { id: number; username: string } | undefined;
      if (!user) {
        respondError(res, 404, 'NOT_FOUND', '用户不存在');
        return;
      }
      if (user.username === GUEST_USERNAME && (updates.role !== undefined || updates.isActive !== undefined || updates.password !== undefined)) {
        respondError(res, 400, 'BAD_REQUEST', 'Guest user must remain a normal active user');
        return;
      }

      const sets: string[] = [];
      const values: unknown[] = [];

      if (updates.displayName !== undefined) { sets.push('display_name = ?'); values.push(updates.displayName); }
      if (updates.role !== undefined) { sets.push('role = ?'); values.push(updates.role); }
      if (updates.isActive !== undefined) { sets.push('is_active = ?'); values.push(updates.isActive ? 1 : 0); }
      if (updates.password !== undefined) {
        const hash = await bcrypt.hash(updates.password, SALT_ROUNDS);
        sets.push('password = ?'); values.push(hash);
      }
      if (updates.allowedTabs !== undefined) {
        sets.push('allowed_tabs = ?');
        values.push(updates.allowedTabs ? JSON.stringify(updates.allowedTabs) : null);
      }

      if (sets.length === 0) {
        respondError(res, 400, 'BAD_REQUEST', '没有要更新的字段');
        return;
      }

      sets.push("updated_at = ?");
      values.push(new Date().toISOString());
      values.push(userId);

      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      // If deactivating user, delete all their sessions
      if (updates.isActive === false) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      }

      const updated = db.prepare(
        'SELECT id, username, display_name, role, is_active, allowed_tabs, created_at, updated_at FROM users WHERE id = ?'
      ).get(userId) as any;

      respond(res, { user: toCamelCase({ ...updated, allowed_tabs: parseAllowedTabs(updated.allowed_tabs) }) });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // DELETE /api/admin/users/:id
  router.delete('/users/:id', (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      respondError(res, 400, 'BAD_REQUEST', '无效用户 ID');
      return;
    }

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as { id: number; username: string } | undefined;
    if (!user) {
      respondError(res, 404, 'NOT_FOUND', '用户不存在');
      return;
    }
    if (user.username === GUEST_USERNAME) {
      respondError(res, 400, 'BAD_REQUEST', 'Guest user cannot be deleted');
      return;
    }

    // Prevent deleting self
    if (userId === (req as any).user?.id) {
      respondError(res, 400, 'BAD_REQUEST', '不能删除自己');
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    respond(res, { ok: true });
  });

  return router;
}

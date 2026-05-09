import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import { getSetting, setSetting } from '../services/db';

const SALT_ROUNDS = 10;

const ALL_TABS = ['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'] as const;
export { ALL_TABS };

function parseAllowedTabs(raw: string | null): string[] | null {
  if (!raw) return null; // null = all tabs allowed
  try { return JSON.parse(raw); } catch { return null; }
}

export function createAdminRoutes(db: Database.Database) {
  const router = Router();

  // GET /api/admin/settings
  router.get('/settings', (_req, res) => {
    const defaultTabsRaw = getSetting(db, 'default_allowed_tabs', '');
    res.json({
      registration_enabled: getSetting(db, 'registration_enabled', '1') === '1',
      login_required: getSetting(db, 'login_required', '0') === '1',
      default_allowed_tabs: defaultTabsRaw ? parseAllowedTabs(defaultTabsRaw) : null,
    });
  });

  // PUT /api/admin/settings
  router.put('/settings', (req, res) => {
    const schema = z.object({
      registration_enabled: z.boolean().optional(),
      login_required: z.boolean().optional(),
      default_allowed_tabs: z.array(z.enum(['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'])).nullable().optional(),
    });
    const updates = schema.parse(req.body);
    if (updates.registration_enabled !== undefined) {
      setSetting(db, 'registration_enabled', updates.registration_enabled ? '1' : '0');
    }
    if (updates.login_required !== undefined) {
      setSetting(db, 'login_required', updates.login_required ? '1' : '0');
    }
    if (updates.default_allowed_tabs !== undefined) {
      setSetting(db, 'default_allowed_tabs', updates.default_allowed_tabs ? JSON.stringify(updates.default_allowed_tabs) : '');
    }
    const defaultTabsRaw = getSetting(db, 'default_allowed_tabs', '');
    res.json({
      registration_enabled: getSetting(db, 'registration_enabled', '1') === '1',
      login_required: getSetting(db, 'login_required', '0') === '1',
      default_allowed_tabs: defaultTabsRaw ? parseAllowedTabs(defaultTabsRaw) : null,
    });
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
    res.json({
      users: users.map(u => ({ ...u, allowed_tabs: parseAllowedTabs(u.allowed_tabs) })),
    });
  });

  // GET /api/admin/users/:id/events — user usage details
  router.get('/users/:id/events', (req, res) => {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) {
      res.status(400).json({ code: 'BAD_REQUEST', message: '无效用户 ID' });
      return;
    }

    const user = db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(userId) as { id: number; username: string; display_name: string } | undefined;
    if (!user) {
      res.status(404).json({ code: 'NOT_FOUND', message: '用户不存在' });
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

    res.json({
      user,
      summary,
      bySource,
      recent: recent.map(r => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null })),
    });
  });

  // POST /api/admin/users
  router.post('/users', async (req, res, next) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(2).max(32),
        password: z.string().min(6).max(128),
        display_name: z.string().trim().max(64).optional(),
        role: z.enum(['user', 'admin']).optional(),
        allowed_tabs: z.array(z.enum(['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'])).nullable().optional(),
      });
      const { username, password, display_name, role, allowed_tabs } = schema.parse(req.body);

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        res.status(409).json({ code: 'CONFLICT', message: '用户名已存在' });
        return;
      }

      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const tabsJson = allowed_tabs ? JSON.stringify(allowed_tabs) : null;
      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, role, allowed_tabs) VALUES (?, ?, ?, ?, ?)'
      ).run(username, hash, display_name || '', role || 'user', tabsJson);

      res.status(201).json({
        user: { id: result.lastInsertRowid, username, display_name: display_name || '', role: role || 'user', allowed_tabs: allowed_tabs ?? null },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 'BAD_REQUEST', message: '参数无效', details: error.flatten() });
        return;
      }
      next(error);
    }
  });

  // PUT /api/admin/users/:id
  router.put('/users/:id', async (req, res, next) => {
    try {
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        res.status(400).json({ code: 'BAD_REQUEST', message: '无效用户 ID' });
        return;
      }

      const schema = z.object({
        display_name: z.string().trim().max(64).optional(),
        role: z.enum(['user', 'admin']).optional(),
        is_active: z.boolean().optional(),
        password: z.string().min(6).max(128).optional(),
        allowed_tabs: z.array(z.enum(['search', 'batch', 'complete', 'history', 'qual', 'stats', 'settings'])).nullable().optional(),
      });
      const updates = schema.parse(req.body);

      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
      if (!user) {
        res.status(404).json({ code: 'NOT_FOUND', message: '用户不存在' });
        return;
      }

      const sets: string[] = [];
      const values: unknown[] = [];

      if (updates.display_name !== undefined) { sets.push('display_name = ?'); values.push(updates.display_name); }
      if (updates.role !== undefined) { sets.push('role = ?'); values.push(updates.role); }
      if (updates.is_active !== undefined) { sets.push('is_active = ?'); values.push(updates.is_active ? 1 : 0); }
      if (updates.password !== undefined) {
        const hash = await bcrypt.hash(updates.password, SALT_ROUNDS);
        sets.push('password = ?'); values.push(hash);
      }
      if (updates.allowed_tabs !== undefined) {
        sets.push('allowed_tabs = ?');
        values.push(updates.allowed_tabs ? JSON.stringify(updates.allowed_tabs) : null);
      }

      if (sets.length === 0) {
        res.status(400).json({ code: 'BAD_REQUEST', message: '没有要更新的字段' });
        return;
      }

      sets.push("updated_at = ?");
      values.push(new Date().toISOString());
      values.push(userId);

      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);

      // If deactivating user, delete all their sessions
      if (updates.is_active === false) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      }

      const updated = db.prepare(
        'SELECT id, username, display_name, role, is_active, allowed_tabs, created_at, updated_at FROM users WHERE id = ?'
      ).get(userId) as any;

      res.json({ user: { ...updated, allowed_tabs: parseAllowedTabs(updated.allowed_tabs) } });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ code: 'BAD_REQUEST', message: '参数无效', details: error.flatten() });
        return;
      }
      next(error);
    }
  });

  // DELETE /api/admin/users/:id
  router.delete('/users/:id', (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ code: 'BAD_REQUEST', message: '无效用户 ID' });
      return;
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      res.status(404).json({ code: 'NOT_FOUND', message: '用户不存在' });
      return;
    }

    // Prevent deleting self
    if (userId === (req as any).user?.id) {
      res.status(400).json({ code: 'BAD_REQUEST', message: '不能删除自己' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ ok: true });
  });

  return router;
}

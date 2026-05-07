import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import type Database from 'better-sqlite3';
import { getSetting, setSetting } from '../services/db';

const SALT_ROUNDS = 10;

export function createAdminRoutes(db: Database.Database) {
  const router = Router();

  // GET /api/admin/settings
  router.get('/settings', (_req, res) => {
    res.json({
      registration_enabled: getSetting(db, 'registration_enabled', '1') === '1',
    });
  });

  // PUT /api/admin/settings
  router.put('/settings', (req, res) => {
    const schema = z.object({
      registration_enabled: z.boolean().optional(),
    });
    const updates = schema.parse(req.body);
    if (updates.registration_enabled !== undefined) {
      setSetting(db, 'registration_enabled', updates.registration_enabled ? '1' : '0');
    }
    res.json({
      registration_enabled: getSetting(db, 'registration_enabled', '1') === '1',
    });
  });

  // GET /api/admin/users
  router.get('/users', (_req, res) => {
    const users = db.prepare(
      'SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users ORDER BY id'
    ).all();
    res.json({ users });
  });

  // POST /api/admin/users
  router.post('/users', async (req, res, next) => {
    try {
      const schema = z.object({
        username: z.string().trim().min(2).max(32),
        password: z.string().min(6).max(128),
        display_name: z.string().trim().max(64).optional(),
        role: z.enum(['user', 'admin']).optional(),
      });
      const { username, password, display_name, role } = schema.parse(req.body);

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        res.status(409).json({ code: 'CONFLICT', message: '用户名已存在' });
        return;
      }

      const hash = await bcrypt.hash(password, SALT_ROUNDS);
      const result = db.prepare(
        'INSERT INTO users (username, password, display_name, role) VALUES (?, ?, ?, ?)'
      ).run(username, hash, display_name || '', role || 'user');

      res.status(201).json({
        user: { id: result.lastInsertRowid, username, display_name: display_name || '', role: role || 'user' },
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
        'SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE id = ?'
      ).get(userId);

      res.json({ user: updated });
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

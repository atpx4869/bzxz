import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';

import { createApp } from './app';

// All JSON endpoints return the ApiResult envelope { data, error } from
// src/shared/response.ts. Tests assert against the unwrapped fields.

describe('createApp', () => {
  const app = () => createApp();
  let cookie: string;

  beforeAll(async () => {
    // Register a unique test user and get session cookie
    const username = `test_${Date.now()}`;
    const res = await request(app())
      .post('/api/auth/register')
      .send({ username, password: 'test123456' });
    cookie = res.headers['set-cookie']?.[0]?.split(';')[0] || '';
  });

  it('returns health status (no auth)', async () => {
    const response = await request(app()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.error).toBeNull();
    expect(response.body.data.ok).toBe(true);
    expect(response.body.data.sources).toEqual(['bz', 'gbw', 'by', 'spc']);
    expect(typeof response.body.data.version).toBe('string');
  });

  it('validates search query', async () => {
    const response = await request(app())
      .get('/api/standards/search')
      .set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('BAD_REQUEST');
  });

  it('uses guest auth when login is not required', async () => {
    const status = await request(app()).get('/api/auth/status');
    expect(status.status).toBe(200);
    expect(status.body.data?.user).toMatchObject({ username: '_guest', role: 'user' });

    const response = await request(app()).get('/api/standards/search');

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('BAD_REQUEST');
  });

  it('does not allow guest to access admin routes', async () => {
    const response = await request(app()).get('/api/admin/users');

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('FORBIDDEN');
  });

  it('returns not found for unknown export task', async () => {
    const response = await request(app())
      .get('/api/tasks/unknown-task')
      .set('Cookie', cookie);

    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe('NOT_FOUND');
  });

  it('validates download-session verify body', async () => {
    const response = await request(app())
      .post('/api/download-sessions/unknown/verify')
      .set('Cookie', cookie)
      .send({ source: 'gbw' });

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('BAD_REQUEST');
  });

  it('validates source check body', async () => {
    const response = await request(app())
      .post('/api/standards/source-check')
      .set('Cookie', cookie)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe('BAD_REQUEST');
  });

  it('auth status returns user info when logged in', async () => {
    const response = await request(app())
      .get('/api/auth/status')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.data?.user).toBeTruthy();
    expect(response.body.data?.user.username).toMatch(/^test_/);
  });
});

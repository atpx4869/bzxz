import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';

import { createApp } from './app';

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
    expect(response.body).toEqual({ ok: true, sources: ['bz', 'gbw', 'by', 'bzvip'] });
  });

  it('validates search query', async () => {
    const response = await request(app())
      .get('/api/standards/search')
      .set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('returns 401 without auth', async () => {
    const response = await request(app()).get('/api/standards/search');

    expect(response.status).toBe(401);
  });

  it('returns not found for unknown export task', async () => {
    const response = await request(app())
      .get('/api/tasks/unknown-task')
      .set('Cookie', cookie);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('validates download-session verify body', async () => {
    const response = await request(app())
      .post('/api/download-sessions/unknown/verify')
      .set('Cookie', cookie)
      .send({ source: 'gbw' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('auth status returns user info when logged in', async () => {
    const response = await request(app())
      .get('/api/auth/status')
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.user).toBeTruthy();
    expect(response.body.user.username).toMatch(/^test_/);
  });
});

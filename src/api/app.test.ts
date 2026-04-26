import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app';

describe('createApp', () => {
  it('returns health status', async () => {
    const response = await request(createApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, sources: ['bz', 'gbw'] });
  });

  it('validates search query', async () => {
    const response = await request(createApp()).get('/api/standards/search');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });

  it('returns not found for unknown export task', async () => {
    const response = await request(createApp()).get('/api/tasks/unknown-task');

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('validates download-session verify body', async () => {
    const response = await request(createApp()).post('/api/download-sessions/unknown/verify').send({ source: 'gbw' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BAD_REQUEST');
  });
});

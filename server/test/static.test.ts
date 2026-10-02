import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

describe('Serving the built client', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'flowqueue-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>FlowQueue</title><div id="root"></div>');
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

  const { app } = createApp(':memory:', false, { clientDistDir: dist });

  it('serves index.html at the root and for client-side routes', async () => {
    for (const url of ['/', '/jobs/anything']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.text).toContain('<div id="root">');
    }
  });

  it('serves static assets', async () => {
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log(1)');
  });

  it('keeps API errors as JSON instead of falling back to the page', async () => {
    const res = await request(app).get('/api/missing');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('serves no pages when no client build exists', async () => {
    const { app: bare } = createApp(':memory:', false, { clientDistDir: path.join(dist, 'nope') });
    expect((await request(bare).get('/')).status).toBe(404);
  });
});

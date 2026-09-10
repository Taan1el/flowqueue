import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, AppContext } from '../src/app.js';

describe('FlowQueue API & Engine Integration Tests', () => {
  let ctx: AppContext;

  beforeEach(() => {
    // In-memory database isolated per test suite
    ctx = createApp(':memory:', true);
  });

  describe('System & Health', () => {
    it('GET /api/health returns healthy status', async () => {
      const res = await request(ctx.app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('flowqueue-api');
    });

    it('GET /api/metrics returns aggregated system metrics', async () => {
      const res = await request(ctx.app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('total_enqueued');
      expect(res.body.data).toHaveProperty('dlq_count');
      expect(res.body.data).toHaveProperty('throughput_per_minute');
    });
  });

  describe('Queue Management', () => {
    it('GET /api/queues returns all seeded queues with stats', async () => {
      const res = await request(ctx.app).get('/api/queues');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(4);

      const notificationsQueue = res.body.data.find((q: any) => q.name === 'notifications');
      expect(notificationsQueue).toBeDefined();
      expect(notificationsQueue.concurrency).toBe(5);
    });

    it('PATCH /api/queues/:id pauses and resumes a queue', async () => {
      const queuesRes = await request(ctx.app).get('/api/queues');
      const queue = queuesRes.body.data[0];

      const patchRes = await request(ctx.app)
        .patch(`/api/queues/${queue.id}`)
        .send({ is_paused: true, concurrency: 8 });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.is_paused).toBe(true);
      expect(patchRes.body.data.concurrency).toBe(8);
    });
  });

  describe('Job Enqueueing & Idempotency', () => {
    it('POST /api/jobs enqueues a new job successfully', async () => {
      const payload = { recipient: 'team@tech.ee', subject: 'Platform Alert' };
      const res = await request(ctx.app).post('/api/jobs').send({
        queue_name: 'notifications',
        name: 'send_alert_email',
        priority: 'high',
        payload,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('send_alert_email');
      expect(res.body.data.status).toBe('queued');
      expect(res.body.data.priority).toBe('high');
      expect(res.body.meta.idempotent_duplicate).toBe(false);
    });

    it('POST /api/jobs respects idempotency key and prevents duplicate execution', async () => {
      const idempotencyKey = 'idem_unique_tx_12345';
      const body = {
        queue_name: 'billing-webhooks',
        name: 'process_invoice_payment',
        idempotency_key: idempotencyKey,
        payload: { invoiceId: 'inv_8871', amount: 4900 },
      };

      // First call: 201 Created
      const res1 = await request(ctx.app).post('/api/jobs').send(body);
      expect(res1.status).toBe(201);
      expect(res1.body.meta.idempotent_duplicate).toBe(false);
      const createdId = res1.body.data.id;

      // Second call with same idempotency key: 200 OK returning existing job
      const res2 = await request(ctx.app).post('/api/jobs').send(body);
      expect(res2.status).toBe(200);
      expect(res2.body.meta.idempotent_duplicate).toBe(true);
      expect(res2.body.data.id).toBe(createdId);
    });

    it('GET /api/jobs filters jobs by queue and status', async () => {
      const res = await request(ctx.app).get('/api/jobs?status=dlq');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((j: any) => j.status === 'dlq')).toBe(true);
    });

    it('GET /api/jobs/:id returns complete job with attempt history', async () => {
      const jobsRes = await request(ctx.app).get('/api/jobs?status=dlq');
      const dlqJob = jobsRes.body.data[0];

      const res = await request(ctx.app).get(`/api/jobs/${dlqJob.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(dlqJob.id);
      expect(res.body.data.attempts_list).toBeDefined();
      expect(res.body.data.attempts_list.length).toBeGreaterThan(0);
    });
  });

  describe('Worker Processing, Retries & DLQ Flow', () => {
    it('worker processes a successful job and records attempt', async () => {
      // 1. Enqueue job
      const enqueueRes = await request(ctx.app).post('/api/jobs').send({
        queue_name: 'notifications',
        name: 'send_welcome_email',
        payload: { email: 'dev@flowqueue.io' },
      });
      const jobId = enqueueRes.body.data.id;

      // 2. Trigger worker poll
      const processedCount = await ctx.workerService.pollOnce();
      expect(processedCount).toBeGreaterThan(0);

      // 3. Verify job is completed
      const jobRes = await request(ctx.app).get(`/api/jobs/${jobId}`);
      expect(jobRes.body.data.status).toBe('completed');
      expect(jobRes.body.data.result).toBeDefined();
      expect(jobRes.body.data.attempts).toBe(1);
      expect(jobRes.body.data.attempts_list.length).toBe(1);
      expect(jobRes.body.data.attempts_list[0].status).toBe('completed');
    });

    it('worker retries failing job with backoff and transitions to DLQ when max retries exceeded', async () => {
      // Enqueue job configured with max_retries: 2 and simulated failure
      const enqueueRes = await request(ctx.app).post('/api/jobs').send({
        queue_name: 'data-sync',
        name: 'sync_data_failing',
        max_retries: 2,
        payload: { should_fail: true, error_message: 'Remote warehouse API unavailable' },
      });
      const jobId = enqueueRes.body.data.id;

      // Attempt 1: Fails, rescheduled with exponential backoff
      await ctx.workerService.pollOnce();
      let job = (await request(ctx.app).get(`/api/jobs/${jobId}`)).body.data;
      expect(job.status).toBe('queued');
      expect(job.attempts).toBe(1);
      expect(job.error).toContain('Remote warehouse API unavailable');

      // Fast-forward run_at to now for test purposes
      ctx.db.prepare("UPDATE jobs SET run_at = datetime('now', '-1 minute') WHERE id = ?;").run(jobId);

      // Attempt 2: Max retries (2) reached -> DLQ!
      await ctx.workerService.pollOnce();
      job = (await request(ctx.app).get(`/api/jobs/${jobId}`)).body.data;
      expect(job.status).toBe('dlq');
      expect(job.attempts).toBe(2);

      // 4. DLQ Replay: POST /api/jobs/:id/retry
      const replayRes = await request(ctx.app).post(`/api/jobs/${jobId}/retry`);
      expect(replayRes.status).toBe(200);
      expect(replayRes.body.data.status).toBe('queued');
      expect(replayRes.body.data.error).toBeNull();
    });
  });

  describe('Webhook Dispatcher & HMAC-SHA256 Signatures', () => {
    it('POST /api/webhooks/subscriptions creates subscription', async () => {
      const res = await request(ctx.app).post('/api/webhooks/subscriptions').send({
        name: 'Audit Webhook',
        url: 'https://audit.corp.internal/hooks',
        secret: 'whsec_secret_sample_key',
        events: ['job.completed', 'job.dlq'],
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Audit Webhook');
    });

    it('generates and verifies HMAC-SHA256 signature accurately', () => {
      const secret = 'super_secure_secret_token';
      const body = JSON.stringify({ event: 'job.completed', id: 'job_123' });

      const signature = ctx.webhookService.generateSignature(body, secret);
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

      const isValid = ctx.webhookService.verifySignature(body, secret, signature);
      expect(isValid).toBe(true);

      const isInvalid = ctx.webhookService.verifySignature(body, 'wrong_secret', signature);
      expect(isInvalid).toBe(false);
    });

    it('POST /api/webhooks/test-receiver receives and responds to test webhook', async () => {
      const res = await request(ctx.app)
        .post('/api/webhooks/test-receiver')
        .set('X-FlowQueue-Event', 'job.completed')
        .set('X-FlowQueue-Signature', 'sha256=abcdef1234567890')
        .send({ test: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');
      expect(res.body.event).toBe('job.completed');
    });
  });
});

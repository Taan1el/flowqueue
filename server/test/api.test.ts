import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { AppContext } from '../src/app.js';
import { WorkerService } from '../src/services/worker.service.js';
import { createTestApp, SentWebhook } from './helpers.js';

describe('API and worker integration', () => {
  let ctx: AppContext;
  let sent: SentWebhook[];

  beforeEach(() => {
    ({ ctx, sent } = createTestApp());
  });

  describe('system', () => {
    it('GET /api/health reports a healthy service', async () => {
      const res = await request(ctx.app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('flowqueue-api');
    });

    it('GET /api/metrics aggregates the seeded data', async () => {
      const res = await request(ctx.app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ total_enqueued: 1, active_processing: 0, dlq_count: 1 });
      expect(res.body.data.completed_today).toBeGreaterThanOrEqual(0);
    });

    it('answers unknown API paths with a JSON 404', async () => {
      const res = await request(ctx.app).get('/api/nope');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Not found' });
    });

    it('rejects malformed JSON bodies with 400', async () => {
      const res = await request(ctx.app).post('/api/jobs').set('Content-Type', 'application/json').send('{"queue_name":');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('queues', () => {
    it('lists the seeded queues with counts', async () => {
      const res = await request(ctx.app).get('/api/queues');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(4);
      const sync = res.body.data.find((q: any) => q.name === 'data-sync');
      expect(sync).toMatchObject({ concurrency: 3, dlq_jobs: 1, active_jobs: 0, queued_jobs: 0 });
    });

    it('pauses a queue and changes its concurrency', async () => {
      const [queue] = (await request(ctx.app).get('/api/queues')).body.data;
      const res = await request(ctx.app).patch(`/api/queues/${queue.id}`).send({ is_paused: true, concurrency: 8 });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ is_paused: true, concurrency: 8 });
    });

    it('returns 404 for an unknown queue', async () => {
      const res = await request(ctx.app).patch('/api/queues/missing').send({ is_paused: true });
      expect(res.status).toBe(404);
    });

    it.each([
      [{}, 'Provide'],
      [{ concurrency: 0 }, 'concurrency'],
      [{ concurrency: 2.5 }, 'concurrency'],
      [{ concurrency: 1000 }, 'concurrency'],
      [{ is_paused: 'yes' }, 'is_paused'],
      [{ max_retries: 0 }, 'max_retries'],
    ])('rejects the invalid queue update %j', async (body, fragment) => {
      const [queue] = (await request(ctx.app).get('/api/queues')).body.data;
      const res = await request(ctx.app).patch(`/api/queues/${queue.id}`).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(fragment);
    });

    it('does not start jobs of a paused queue', async () => {
      const queues = (await request(ctx.app).get('/api/queues')).body.data;
      const notifications = queues.find((q: any) => q.name === 'notifications');
      await request(ctx.app).patch(`/api/queues/${notifications.id}`).send({ is_paused: true });
      const job = (await request(ctx.app).post('/api/jobs').send({ queue_name: 'notifications', name: 'send_email' })).body.data;

      await ctx.workerService.pollOnce();
      expect((await request(ctx.app).get(`/api/jobs/${job.id}`)).body.data.status).toBe('queued');

      await request(ctx.app).patch(`/api/queues/${notifications.id}`).send({ is_paused: false });
      await ctx.workerService.pollOnce();
      expect((await request(ctx.app).get(`/api/jobs/${job.id}`)).body.data.status).toBe('completed');
    });
  });

  describe('enqueueing', () => {
    it('creates a job with the requested priority', async () => {
      const res = await request(ctx.app)
        .post('/api/jobs')
        .send({ queue_name: 'notifications', name: 'send_alert_email', priority: 'high', payload: { to: 'ops@example.com' } });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ name: 'send_alert_email', status: 'queued', priority: 'high', attempts: 0 });
      expect(res.body.meta.idempotent_duplicate).toBe(false);
    });

    it('uses the queue default for max_retries and honours an override', async () => {
      const a = await request(ctx.app).post('/api/jobs').send({ queue_name: 'heavy-reports', name: 'a' });
      expect(a.body.data.max_retries).toBe(2);
      const b = await request(ctx.app).post('/api/jobs').send({ queue_name: 'heavy-reports', name: 'b', max_retries: 7 });
      expect(b.body.data.max_retries).toBe(7);
    });

    it('delays execution with delay_seconds', async () => {
      const res = await request(ctx.app).post('/api/jobs').send({ queue_name: 'notifications', name: 'later', delay_seconds: 120 });
      expect(new Date(res.body.data.run_at).getTime()).toBeGreaterThan(Date.now() + 100_000);
      expect(await ctx.workerService.pollOnce()).toBe(1); // only the seeded report is due
      expect((await request(ctx.app).get(`/api/jobs/${res.body.data.id}`)).body.data.status).toBe('queued');
    });

    it('returns the existing job for a repeated idempotency key', async () => {
      const body = { queue_name: 'billing-webhooks', name: 'process_invoice', idempotency_key: 'tx-1', payload: { n: 1 } };
      const first = await request(ctx.app).post('/api/jobs').send(body);
      const second = await request(ctx.app).post('/api/jobs').send({ ...body, payload: { n: 2 } });
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.meta.idempotent_duplicate).toBe(true);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(second.body.data.payload).toEqual({ n: 1 });
    });

    it('answers 404 for an unknown queue', async () => {
      const res = await request(ctx.app).post('/api/jobs').send({ queue_name: 'ghost', name: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('ghost');
    });

    it.each([
      [{ name: 'x' }, 'queue_name'],
      [{ queue_name: 'notifications' }, 'name'],
      [{ queue_name: 'notifications', name: '  ' }, 'name'],
      [{ queue_name: 'notifications', name: 'x', priority: 'urgent' }, 'priority'],
      [{ queue_name: 'notifications', name: 'x', delay_seconds: -5 }, 'delay_seconds'],
      [{ queue_name: 'notifications', name: 'x', delay_seconds: 'soon' }, 'delay_seconds'],
      [{ queue_name: 'notifications', name: 'x', max_retries: 0 }, 'max_retries'],
      [{ queue_name: 'notifications', name: 'x', max_retries: 99 }, 'max_retries'],
      [{ queue_name: 'notifications', name: 'x', payload: [1, 2] }, 'payload'],
      [{ queue_name: 'notifications', name: 'x', idempotency_key: 'k'.repeat(300) }, 'idempotency_key'],
      [{ queue_name: 'notifications', name: 'n'.repeat(201) }, 'name'],
    ])('rejects the invalid enqueue body %j', async (body, field) => {
      const res = await request(ctx.app).post('/api/jobs').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(field);
    });

    it('rejects a body that is not an object', async () => {
      const res = await request(ctx.app).post('/api/jobs').send([1]);
      expect(res.status).toBe(400);
    });
  });

  describe('listing jobs', () => {
    it('filters by status', async () => {
      const res = await request(ctx.app).get('/api/jobs?status=dlq');
      expect(res.body.data.length).toBe(1);
      expect(res.body.data.every((j: any) => j.status === 'dlq')).toBe(true);
      expect(res.body.meta.total).toBe(1);
    });

    it('filters by queue and priority and searches names and payloads', async () => {
      const queues = (await request(ctx.app).get('/api/queues')).body.data;
      const billing = queues.find((q: any) => q.name === 'billing-webhooks');
      const byQueue = await request(ctx.app).get(`/api/jobs?queue_id=${billing.id}`);
      expect(byQueue.body.data.map((j: any) => j.name)).toEqual(['reconcile_stripe_charge']);

      const high = await request(ctx.app).get('/api/jobs?priority=high');
      expect(high.body.data.map((j: any) => j.name)).toEqual(['reconcile_stripe_charge']);

      const byName = await request(ctx.app).get('/api/jobs?search=welcome');
      expect(byName.body.data.map((j: any) => j.name)).toEqual(['send_welcome_email']);
      const byPayload = await request(ctx.app).get('/api/jobs?search=wh_tallinn_01');
      expect(byPayload.body.data.map((j: any) => j.name)).toEqual(['sync_erp_inventory']);
    });

    it('treats LIKE wildcards in a search as plain text', async () => {
      expect((await request(ctx.app).get('/api/jobs?search=%25')).body.data).toHaveLength(0);
      expect((await request(ctx.app).get('/api/jobs?search=__')).body.data).toHaveLength(0);
    });

    it('paginates with limit and offset', async () => {
      const page = await request(ctx.app).get('/api/jobs?limit=2&offset=1');
      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta).toEqual({ total: 4, limit: 2, offset: 1 });
    });

    it.each(['status=exploded', 'priority=urgent', 'limit=0', 'limit=500', 'limit=abc', 'offset=-1'])(
      'rejects the invalid query %s',
      async (query) => {
        const res = await request(ctx.app).get(`/api/jobs?${query}`);
        expect(res.status).toBe(400);
      }
    );

    it('returns a job with its attempt history, or 404', async () => {
      const dlq = (await request(ctx.app).get('/api/jobs?status=dlq')).body.data[0];
      const res = await request(ctx.app).get(`/api/jobs/${dlq.id}`);
      expect(res.body.data.attempts_list.map((a: any) => a.attempt_number)).toEqual([1, 2, 3]);
      expect((await request(ctx.app).get('/api/jobs/missing')).status).toBe(404);
    });
  });

  describe('worker, retries and dead letters', () => {
    async function job(id: string) {
      return (await request(ctx.app).get(`/api/jobs/${id}`)).body.data;
    }

    it('completes a job, records the attempt and sends job.completed', async () => {
      const id = (
        await request(ctx.app)
          .post('/api/jobs')
          .send({ queue_name: 'notifications', name: 'send_welcome_email', payload: { email: 'dev@example.com' } })
      ).body.data.id;
      expect(await ctx.workerService.pollOnce()).toBeGreaterThan(0);
      await ctx.webhookService.idle();

      const done = await job(id);
      expect(done.status).toBe('completed');
      expect(done.result).toMatchObject({ recipient: 'dev@example.com', status: 'delivered' });
      expect(done.attempts).toBe(1);
      expect(done.attempts_list).toHaveLength(1);
      expect(done.attempts_list[0]).toMatchObject({ status: 'completed', worker_id: ctx.workerService.workerId });
      expect(sent.map((s) => s.headers['X-FlowQueue-Event'])).toContain('job.completed');
    });

    it('backs off exponentially, then dead-letters and replays with one more run', async () => {
      const id = (
        await request(ctx.app).post('/api/jobs').send({
          queue_name: 'data-sync',
          name: 'sync_failing',
          max_retries: 2,
          payload: { should_fail: true, error_message: 'Warehouse unavailable' },
        })
      ).body.data.id;

      const before = Date.now();
      await ctx.workerService.pollOnce();
      let current = await job(id);
      expect(current).toMatchObject({ status: 'queued', attempts: 1 });
      expect(current.error).toBe('Warehouse unavailable');
      // data-sync backs off 5s after the first failure (jitter is pinned to 0 here)
      const delayMs = new Date(current.run_at).getTime() - before;
      expect(delayMs).toBeGreaterThanOrEqual(4900);
      expect(delayMs).toBeLessThan(6000);

      ctx.db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', id);
      await ctx.workerService.pollOnce();
      current = await job(id);
      expect(current).toMatchObject({ status: 'dlq', attempts: 2 });
      await ctx.webhookService.idle();
      const events = sent.map((s) => s.headers['X-FlowQueue-Event']);
      expect(events).toEqual(expect.arrayContaining(['job.failed', 'job.dlq']));

      const replay = await request(ctx.app).post(`/api/jobs/${id}/retry`);
      expect(replay.status).toBe(200);
      expect(replay.body.data).toMatchObject({ status: 'queued', error: null, max_retries: 3 });

      await ctx.workerService.pollOnce();
      expect(await job(id)).toMatchObject({ status: 'dlq', attempts: 3 });
    });

    it('runs a replayed job to completion once the cause is gone', async () => {
      const dlq = (await request(ctx.app).get('/api/jobs?status=dlq')).body.data[0];
      await request(ctx.app).post(`/api/jobs/${dlq.id}/retry`);
      await ctx.workerService.pollOnce();
      expect(await job(dlq.id)).toMatchObject({ status: 'completed', attempts: 4 });
    });

    it('only replays dead-lettered jobs', async () => {
      const queued = (await request(ctx.app).get('/api/jobs?status=queued')).body.data[0];
      const res = await request(ctx.app).post(`/api/jobs/${queued.id}/retry`);
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('queued');
      expect((await request(ctx.app).post('/api/jobs/missing/retry')).status).toBe(404);
    });

    it('lets a registered handler produce the result and fail on throw', async () => {
      const { ctx: custom } = createTestApp();
      const worker = new WorkerService(custom.jobRepo, custom.queueRepo, custom.webhookService, {
        handlerDelayMs: 0,
        random: () => 0,
        handlers: {
          resize_image: async (j) => ({ width: j.payload.width }),
          explode: () => {
            throw new Error('handler blew up');
          },
        },
      });
      const ok = custom.queueService.enqueue({ queue_name: 'notifications', name: 'resize_image', payload: { width: 640 } }).job;
      const bad = custom.queueService.enqueue({ queue_name: 'notifications', name: 'explode', payload: {}, max_retries: 1 }).job;
      await worker.pollOnce();
      expect(custom.jobRepo.getJobById(ok.id)).toMatchObject({ status: 'completed', result: { width: 640 } });
      expect(custom.jobRepo.getJobById(bad.id)).toMatchObject({ status: 'dlq', error: 'handler blew up' });
    });
  });

  describe('capacity', () => {
    it('never runs more jobs of a queue than its concurrency allows', async () => {
      const heavy = (await request(ctx.app).get('/api/queues')).body.data.find((q: any) => q.name === 'heavy-reports');
      expect(heavy.concurrency).toBe(1);
      await request(ctx.app).post('/api/jobs').send({ queue_name: 'heavy-reports', name: 'r2' });
      await request(ctx.app).post('/api/jobs').send({ queue_name: 'heavy-reports', name: 'r3' });
      const claimed = ctx.jobRepo.claimEligibleJobs(10, 'w1');
      expect(claimed).toHaveLength(1);
      const queues = (await request(ctx.app).get('/api/queues')).body.data;
      expect(queues.find((q: any) => q.name === 'heavy-reports').active_jobs).toBe(1);
    });
  });
});

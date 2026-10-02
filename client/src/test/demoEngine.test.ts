// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { DemoEngine, hmacSha256 } from '../demo/engine.js';

const T0 = Date.parse('2026-10-02T09:00:00.000Z');

describe('DemoEngine', () => {
  let clock: number;
  let engine: DemoEngine;
  const advance = (ms: number) => {
    clock += ms;
    engine.tick();
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 2; i++) advance(500);
  };

  beforeEach(() => {
    clock = T0;
    engine = new DemoEngine(() => clock);
  });

  describe('sample data', () => {
    it('starts with four queues, twelve jobs and two dead letters', async () => {
      const queues = await engine.getQueues();
      expect(queues.map((q) => q.name)).toEqual(['billing-webhooks', 'data-sync', 'heavy-reports', 'notifications']);
      const { jobs, total } = await engine.listJobs();
      expect(total).toBe(12);
      expect(jobs).toHaveLength(12);
      expect((await engine.listJobs({ status: 'dlq' })).total).toBe(2);
      expect((await engine.listJobs({ status: 'processing' })).total).toBe(1);
    });

    it('is identical for two engines started at the same moment', async () => {
      const other = new DemoEngine(() => clock);
      expect(await other.listJobs()).toEqual(await engine.listJobs());
      expect(await other.getWebhookDeliveries()).toEqual(await engine.getWebhookDeliveries());
      for (let i = 0; i < 20; i++) {
        clock += 500;
        engine.tick();
        other.tick();
      }
      expect(await other.listJobs()).toEqual(await engine.listJobs());
    });

    it('seeds deliveries whose signatures are real HMACs of their bodies', async () => {
      const [first] = await engine.getWebhookDeliveries();
      const secret = first.subscription_id === 'sub_internal' ? 'whsec_flowqueue_sample_secret_99' : 'whsec_partner_hmac_secret_4488';
      expect(first.signature).toBe(await hmacSha256(JSON.stringify(first.payload), secret));
      expect(first.signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('never exposes subscription secrets', async () => {
      const subs = await engine.getWebhookSubscriptions();
      expect(JSON.stringify(subs)).not.toContain('flowqueue_sample_secret');
      expect(subs.every((s) => s.secret.endsWith('********'))).toBe(true);
    });
  });

  describe('worker', () => {
    it('finishes the running job and starts due ones within the queue capacity', async () => {
      advance(3000);
      const jobs = (await engine.listJobs()).jobs;
      const byName = (n: string) => jobs.find((j) => j.name === n)!;
      expect(byName('sync_warehouse_stock').status).toBe('completed');
      expect(byName('generate_monthly_analytics_pdf').status).toBe('processing');
      expect(byName('send_digest_email').status).toBe('processing');
      // not due yet: scheduled 45 s ahead
      expect(byName('process_refund').status).toBe('queued');
    });

    it('runs the delayed job once it is due', async () => {
      run(60);
      const refund = (await engine.listJobs({ search: 'process_refund' })).jobs[0];
      expect(refund.status).toBe('completed');
      expect(refund.result).toMatchObject({ status: 'cleared', amount: 2500 });
    });

    it('never exceeds a queue capacity', async () => {
      for (let i = 0; i < 6; i++) await engine.enqueueJob({ queue_name: 'heavy-reports', name: `export_${i}` });
      for (let i = 0; i < 40; i++) {
        advance(500);
        const heavy = (await engine.getQueues()).find((q) => q.name === 'heavy-reports')!;
        expect(heavy.active_jobs).toBeLessThanOrEqual(heavy.concurrency);
      }
    });

    it('does not start jobs of a paused queue', async () => {
      const [queue] = (await engine.getQueues()).filter((q) => q.name === 'notifications');
      await engine.updateQueue(queue.id, { is_paused: true });
      const { job } = await engine.enqueueJob({ queue_name: 'notifications', name: 'send_email' });
      run(10);
      expect((await engine.getJob(job.id)).status).toBe('queued');
      await engine.updateQueue(queue.id, { is_paused: false });
      run(10);
      expect((await engine.getJob(job.id)).status).toBe('completed');
    });

    it('retries a failing job with backoff, then dead-letters it and sends job.dlq', async () => {
      const { job } = await engine.enqueueJob({
        queue_name: 'notifications',
        name: 'send_failing',
        max_retries: 2,
        payload: { should_fail: true, error_message: 'SMTP refused' },
      });
      run(5);
      let current = await engine.getJob(job.id);
      expect(current.status).toBe('queued');
      expect(current.attempts).toBe(1);
      expect(current.error).toBe('SMTP refused');
      // notifications back off from 2 s: 2 s plus 0 or 1 s of jitter
      const wait = Date.parse(current.run_at) - Date.parse(current.attempts_list[0].finished_at!);
      expect([2000, 3000]).toContain(wait);

      run(10);
      current = await engine.getJob(job.id);
      expect(current.status).toBe('dlq');
      expect(current.attempts_list.map((a) => a.status)).toEqual(['failed', 'failed']);
      const events = (await engine.getWebhookDeliveries()).map((d) => d.event);
      expect(events).toEqual(expect.arrayContaining(['job.failed', 'job.dlq']));
    });

    it('records a completed attempt and a job.completed delivery for a normal job', async () => {
      const { job } = await engine.enqueueJob({ queue_name: 'notifications', name: 'send_welcome_email', payload: { email: 'a@b.co' } });
      run(8);
      const done = await engine.getJob(job.id);
      expect(done).toMatchObject({ status: 'completed', attempts: 1 });
      expect(done.result).toMatchObject({ recipient: 'a@b.co', status: 'delivered' });
      expect(done.attempts_list[0]).toMatchObject({ status: 'completed', worker_id: 'demo_worker_1' });
      const delivery = (await engine.getWebhookDeliveries()).find((d) => (d.payload as any).data?.jobId === job.id);
      expect(delivery).toMatchObject({ event: 'job.completed', status_code: 200 });
    });
  });

  describe('API surface', () => {
    it('applies the filters and the search', async () => {
      const queues = await engine.getQueues();
      const billing = queues.find((q) => q.name === 'billing-webhooks')!;
      expect((await engine.listJobs({ queue_id: billing.id })).jobs.map((j) => j.name).sort()).toEqual([
        'process_refund',
        'reconcile_stripe_charge',
        'reconcile_stripe_charge',
      ]);
      expect((await engine.listJobs({ priority: 'high' })).jobs.every((j) => j.priority === 'high')).toBe(true);
      expect((await engine.listJobs({ search: 'WH_TALLINN' })).jobs.map((j) => j.name)).toEqual(['sync_erp_inventory']);
      expect((await engine.listJobs({ status: 'completed', search: 'email' })).total).toBe(3);
      expect((await engine.listJobs({ search: 'job_0001' })).total).toBe(1);
    });

    it('returns attempts only for a single job', async () => {
      const { jobs } = await engine.listJobs({ status: 'dlq' });
      expect(jobs[0]).not.toHaveProperty('attempts_list');
      const full = await engine.getJob(jobs[0].id);
      expect(full.attempts_list).toHaveLength(3);
      await expect(engine.getJob('nope')).rejects.toThrow('Job not found');
    });

    it('enqueues with the queue defaults, priority and delay', async () => {
      const { job, duplicate } = await engine.enqueueJob({ queue_name: 'heavy-reports', name: 'x', priority: 'high', delay_seconds: 30 });
      expect(duplicate).toBe(false);
      expect(job).toMatchObject({ status: 'queued', priority: 'high', max_retries: 2, attempts: 0 });
      expect(Date.parse(job.run_at) - clock).toBe(30_000);
    });

    it('returns the existing job for a repeated idempotency key', async () => {
      const first = await engine.enqueueJob({ queue_name: 'notifications', name: 'a', idempotency_key: 'k1' });
      const second = await engine.enqueueJob({ queue_name: 'notifications', name: 'b', idempotency_key: 'k1' });
      expect(second.duplicate).toBe(true);
      expect(second.job.id).toBe(first.job.id);
      expect((await engine.listJobs()).total).toBe(13);
    });

    it('rejects an unknown queue and a missing name', async () => {
      await expect(engine.enqueueJob({ queue_name: 'ghost', name: 'x' })).rejects.toThrow("Queue 'ghost' does not exist.");
      await expect(engine.enqueueJob({ queue_name: 'notifications', name: '' })).rejects.toThrow('required');
    });

    it('replays a dead letter with one more attempt and refuses other jobs', async () => {
      const [dead] = (await engine.listJobs({ status: 'dlq' })).jobs;
      const replayed = await engine.retryJob(dead.id);
      expect(replayed).toMatchObject({ status: 'queued', error: null, max_retries: 4 });
      const [done] = (await engine.listJobs({ status: 'completed' })).jobs;
      await expect(engine.retryJob(done.id)).rejects.toThrow('Only dead-lettered jobs');
      await expect(engine.retryJob('nope')).rejects.toThrow('not found');
    });

    it('updates queues and validates the values', async () => {
      const queue = (await engine.getQueues())[0];
      expect(await engine.updateQueue(queue.id, { concurrency: 7, max_retries: 4, is_paused: true })).toMatchObject({
        concurrency: 7,
        max_retries: 4,
        is_paused: true,
      });
      await expect(engine.updateQueue(queue.id, { concurrency: 0 })).rejects.toThrow('concurrency');
      await expect(engine.updateQueue(queue.id, { max_retries: 2.5 })).rejects.toThrow('max_retries');
      await expect(engine.updateQueue('nope', {})).rejects.toThrow('Queue not found');
    });

    it('reports metrics with the shared definitions', async () => {
      const m = await engine.getMetrics();
      expect(m).toMatchObject({ total_enqueued: 3, active_processing: 1, dlq_count: 2, completed_today: 6, failed_today: 6 });
      expect(m.avg_duration_ms).toBeGreaterThan(0);
    });

    it('sends test deliveries: the sample sink answers 200, the partner times out', async () => {
      const ok = await engine.triggerTestWebhook('sub_internal', 'job.completed');
      expect(ok).toMatchObject({ status_code: 200, event: 'job.completed' });
      expect(ok.signature).toBe(await hmacSha256(JSON.stringify(ok.payload), 'whsec_flowqueue_sample_secret_99'));
      expect((await engine.triggerTestWebhook('sub_partner', 'job.completed')).status_code).toBe(504);
      await expect(engine.triggerTestWebhook('nope', 'x')).rejects.toThrow('Subscription not found');
      expect((await engine.getWebhookDeliveries())[0].id).toBeDefined();
    });
  });
});

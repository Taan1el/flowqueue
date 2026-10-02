import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { AppContext } from '../src/app.js';
import { WebhookService } from '../src/services/webhook.service.js';
import { createTestApp, SentWebhook } from './helpers.js';

describe('Webhooks', () => {
  let ctx: AppContext;
  let sent: SentWebhook[];

  beforeEach(() => {
    ({ ctx, sent } = createTestApp());
  });

  const subscription = {
    name: 'Audit hook',
    url: 'https://audit.example.com/hooks',
    secret: 'whsec_secret_sample_key',
    events: ['job.completed', 'job.dlq'],
  };

  describe('subscriptions', () => {
    it('creates a subscription and never returns its secret', async () => {
      const res = await request(ctx.app).post('/api/webhooks/subscriptions').send(subscription);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ name: 'Audit hook', is_active: true, events: subscription.events });
      expect(res.body.data.secret).not.toContain('secret_sample_key');
      expect(res.body.data.secret.startsWith('whse')).toBe(true);

      const list = await request(ctx.app).get('/api/webhooks/subscriptions');
      expect(list.body.data).toHaveLength(3);
      expect(JSON.stringify(list.body)).not.toContain('whsec_secret_sample_key');
      expect(JSON.stringify(list.body)).not.toContain('flowqueue_sample_secret');
    });

    it.each([
      [{ ...subscription, name: '' }, 'name'],
      [{ ...subscription, secret: undefined }, 'secret'],
      [{ ...subscription, url: 'not a url' }, 'url'],
      [{ ...subscription, url: 'ftp://example.com/hook' }, 'url'],
      [{ ...subscription, events: [] }, 'events'],
      [{ ...subscription, events: 'job.completed' }, 'events'],
      [{ ...subscription, events: [1] }, 'events'],
    ])('rejects the invalid subscription %#', async (body, field) => {
      const res = await request(ctx.app).post('/api/webhooks/subscriptions').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(field);
    });
  });

  describe('signatures', () => {
    it('signs with HMAC-SHA256 and verifies in constant time', () => {
      const body = JSON.stringify({ event: 'job.completed', id: 'job_123' });
      const signature = ctx.webhookService.generateSignature(body, 'secret');
      expect(signature).toBe(`sha256=${crypto.createHmac('sha256', 'secret').update(body).digest('hex')}`);
      expect(ctx.webhookService.verifySignature(body, 'secret', signature)).toBe(true);
      expect(ctx.webhookService.verifySignature(body, 'other', signature)).toBe(false);
      expect(ctx.webhookService.verifySignature(body + ' ', 'secret', signature)).toBe(false);
    });

    it('rejects signatures of the wrong length without throwing', () => {
      expect(ctx.webhookService.verifySignature('{}', 'secret', 'sha256=short')).toBe(false);
      expect(ctx.webhookService.verifySignature('{}', 'secret', '')).toBe(false);
    });

    it('seeds a delivery whose stored signature really matches its body', async () => {
      const delivery = ctx.db.prepare('SELECT d.payload, d.signature, s.secret FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id = d.subscription_id').get() as any;
      expect(ctx.webhookService.verifySignature(delivery.payload, delivery.secret, delivery.signature)).toBe(true);
    });
  });

  describe('delivery', () => {
    it('POST /api/webhooks/test sends a signed request and records it', async () => {
      const [sub] = ctx.webhookRepo.listSubscriptions();
      const res = await request(ctx.app).post('/api/webhooks/test').send({ subscription_id: sub.id, event: 'job.completed' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status_code: 200, event: 'job.completed' });

      expect(sent).toHaveLength(1);
      const [request1] = sent;
      expect(request1.url).toBe(sub.url);
      expect(request1.headers['X-FlowQueue-Event']).toBe('job.completed');
      // the signature header covers the exact body that was sent
      expect(ctx.webhookService.verifySignature(request1.body, sub.secret, request1.headers['X-FlowQueue-Signature'])).toBe(true);
      expect(JSON.parse(request1.body)).toMatchObject({ event: 'job.completed', data: { ping: true } });

      const deliveries = (await request(ctx.app).get('/api/webhooks/deliveries')).body.data;
      expect(deliveries[0]).toMatchObject({ id: res.body.data.id, subscription_name: sub.name });
    });

    it('defaults the event to test.ping', async () => {
      const [sub] = ctx.webhookRepo.listSubscriptions();
      const res = await request(ctx.app).post('/api/webhooks/test').send({ subscription_id: sub.id });
      expect(res.body.data.event).toBe('test.ping');
    });

    it('validates the test request', async () => {
      expect((await request(ctx.app).post('/api/webhooks/test').send({})).status).toBe(400);
      expect((await request(ctx.app).post('/api/webhooks/test').send({ subscription_id: 'missing' })).status).toBe(404);
      const [sub] = ctx.webhookRepo.listSubscriptions();
      expect((await request(ctx.app).post('/api/webhooks/test').send({ subscription_id: sub.id, event: 5 })).status).toBe(400);
    });

    it('records the HTTP status of a failing endpoint', async () => {
      const failing = createTestApp({ status: 500 });
      const [sub] = failing.ctx.webhookRepo.listSubscriptions();
      const delivery = await failing.ctx.webhookService.deliver(sub, 'job.failed', {});
      expect(delivery.status_code).toBe(500);
      expect(delivery.response_body).toBe('ok');
    });

    it('records a network error as status 504 with the reason', async () => {
      const service = new WebhookService(ctx.webhookRepo, {
        fetchImpl: (async () => {
          throw new Error('connect ECONNREFUSED');
        }) as unknown as typeof fetch,
      });
      const [sub] = ctx.webhookRepo.listSubscriptions();
      const delivery = await service.deliver(sub, 'job.failed', {});
      expect(delivery.status_code).toBe(504);
      expect(delivery.response_body).toContain('ECONNREFUSED');
    });

    it('only dispatches job events to active subscriptions that listen for them', async () => {
      ctx.db.prepare("UPDATE webhook_subscriptions SET is_active = 0 WHERE name = 'Partner Logistics Hook'").run();
      await ctx.webhookService.dispatchJobEvent('job.completed', { jobId: 'a' });
      await ctx.webhookService.dispatchJobEvent('sync.completed', { jobId: 'a' });
      await ctx.webhookService.idle();
      expect(sent).toHaveLength(1);
      expect(sent[0].headers['X-FlowQueue-Event']).toBe('job.completed');
    });
  });

  describe('built-in receiver', () => {
    it('echoes the event and signature it received', async () => {
      const res = await request(ctx.app)
        .post('/api/webhooks/test-receiver')
        .set('X-FlowQueue-Event', 'job.completed')
        .set('X-FlowQueue-Signature', 'sha256=abc')
        .send({ test: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'received', event: 'job.completed', receivedSignature: 'sha256=abc', payloadSummary: ['test'] });
    });
  });
});

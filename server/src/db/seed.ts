import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';

export function seedDatabase(db: DatabaseSync): void {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM queues;');
  const result = countStmt.get() as { count: number };
  if (result.count > 0) {
    return; // Already seeded
  }

  const now = new Date().toISOString();
  const past5m = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const past2m = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  // 1. Seed Queues
  const insertQueue = db.prepare(`
    INSERT INTO queues (id, name, concurrency, max_retries, backoff_base_sec, is_paused, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);
  `);

  const queueNotifications = crypto.randomUUID();
  const queueBilling = crypto.randomUUID();
  const queueDataSync = crypto.randomUUID();
  const queueHeavyReports = crypto.randomUUID();

  insertQueue.run(queueNotifications, 'notifications', 5, 3, 2, 0, now);
  insertQueue.run(queueBilling, 'billing-webhooks', 10, 5, 3, 0, now);
  insertQueue.run(queueDataSync, 'data-sync', 3, 3, 5, 0, now);
  insertQueue.run(queueHeavyReports, 'heavy-reports', 1, 2, 10, 0, now);

  // 2. Seed Webhook Subscriptions
  const insertWebhook = db.prepare(`
    INSERT INTO webhook_subscriptions (id, name, url, secret, events, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?);
  `);

  const subInternal = crypto.randomUUID();
  const subPartner = crypto.randomUUID();

  const internalSecret = 'whsec_flowqueue_sample_secret_99';
  insertWebhook.run(
    subInternal,
    'Internal Event Sink',
    `http://localhost:${process.env.PORT || 4000}/api/webhooks/test-receiver`,
    internalSecret,
    JSON.stringify(['job.completed', 'job.failed', 'job.dlq']),
    1,
    now
  );

  insertWebhook.run(
    subPartner,
    'Partner Logistics Hook',
    'https://api.partner.example/v1/shipments/webhook',
    'whsec_partner_hmac_secret_4488',
    JSON.stringify(['shipment.dispatched', 'sync.completed']),
    1,
    now
  );

  // 3. Seed Sample Jobs
  const insertJob = db.prepare(`
    INSERT INTO jobs (
      id, queue_id, name, priority, status, payload, result, error, 
      idempotency_key, attempts, max_retries, run_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  const insertAttempt = db.prepare(`
    INSERT INTO job_attempts (
      id, job_id, attempt_number, status, worker_id, started_at, finished_at, duration_ms, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  // Job 1: Completed Welcome Email
  const job1Id = crypto.randomUUID();
  insertJob.run(
    job1Id,
    queueNotifications,
    'send_welcome_email',
    2,
    'completed',
    JSON.stringify({ userId: 'usr_8812', email: 'elena.v@example.ee', template: 'onboarding_v2' }),
    JSON.stringify({ messageId: 'msg_984102', provider: 'resend', delivered: true }),
    null,
    'idem_welcome_usr_8812',
    1,
    3,
    past5m,
    past5m,
    past5m
  );
  insertAttempt.run(
    crypto.randomUUID(),
    job1Id,
    1,
    'completed',
    'worker_node_1',
    past5m,
    new Date(Date.now() - 5 * 60 * 1000 + 412).toISOString(),
    412,
    null
  );

  // Job 2: Completed Stripe Invoice
  const job2Id = crypto.randomUUID();
  insertJob.run(
    job2Id,
    queueBilling,
    'reconcile_stripe_charge',
    1, // high priority
    'completed',
    JSON.stringify({ chargeId: 'ch_3Nxy82', amountCents: 14900, currency: 'EUR', customerId: 'cus_9981' }),
    JSON.stringify({ status: 'settled', invoiceNumber: 'INV-2026-091', taxPercent: 22 }),
    null,
    'idem_charge_ch_3Nxy82',
    1,
    5,
    past2m,
    past2m,
    past2m
  );
  insertAttempt.run(
    crypto.randomUUID(),
    job2Id,
    1,
    'completed',
    'worker_node_2',
    past2m,
    new Date(Date.now() - 2 * 60 * 1000 + 645).toISOString(),
    645,
    null
  );

  // Job 3: In DLQ (failed multiple attempts)
  const job3Id = crypto.randomUUID();
  insertJob.run(
    job3Id,
    queueDataSync,
    'sync_erp_inventory',
    3, // low priority
    'dlq',
    JSON.stringify({ warehouseId: 'wh_tallinn_01', batchId: 'batch_902', itemsCount: 450 }),
    null,
    'ConnectionTimeout: External ERP SOAP endpoint at 192.168.4.12:8443 failed to respond in 5000ms',
    'idem_erp_batch_902',
    3,
    3,
    past5m,
    past5m,
    past2m
  );
  insertAttempt.run(
    crypto.randomUUID(),
    job3Id,
    1,
    'failed',
    'worker_node_1',
    past5m,
    new Date(Date.now() - 5 * 60 * 1000 + 5000).toISOString(),
    5000,
    'ConnectionTimeout: External ERP SOAP endpoint timed out'
  );
  insertAttempt.run(
    crypto.randomUUID(),
    job3Id,
    2,
    'failed',
    'worker_node_2',
    new Date(Date.now() - 4 * 60 * 1000).toISOString(),
    new Date(Date.now() - 4 * 60 * 1000 + 5000).toISOString(),
    5000,
    'ConnectionTimeout: External ERP SOAP endpoint timed out (Retry 1)'
  );
  insertAttempt.run(
    crypto.randomUUID(),
    job3Id,
    3,
    'failed',
    'worker_node_1',
    past2m,
    new Date(Date.now() - 2 * 60 * 1000 + 5000).toISOString(),
    5000,
    'ConnectionTimeout: External ERP SOAP endpoint at 192.168.4.12:8443 failed to respond in 5000ms'
  );

  // Job 4: Queued ready to process
  const job4Id = crypto.randomUUID();
  insertJob.run(
    job4Id,
    queueHeavyReports,
    'generate_monthly_analytics_pdf',
    2,
    'queued',
    JSON.stringify({ tenantId: 'org_acme_corp', month: '2026-08', format: 'pdf', includeAudits: true }),
    null,
    null,
    'idem_report_org_acme_202608',
    0,
    2,
    now,
    now,
    now
  );

  // 4. Seed Webhook Delivery Sample
  const insertDelivery = db.prepare(`
    INSERT INTO webhook_deliveries (
      id, subscription_id, event, payload, status_code, signature, duration_ms, delivered_at, response_body
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
  `);

  // The stored signature is a genuine HMAC-SHA256 of the stored body, the
  // same construction WebhookService uses for live deliveries.
  const deliveryBody = JSON.stringify({
    id: crypto.randomUUID(),
    event: 'job.completed',
    created_at: past5m,
    data: { jobId: job1Id, name: 'send_welcome_email', queue: 'notifications' },
  });
  const deliverySignature = `sha256=${crypto.createHmac('sha256', internalSecret).update(deliveryBody, 'utf8').digest('hex')}`;

  insertDelivery.run(
    crypto.randomUUID(),
    subInternal,
    'job.completed',
    deliveryBody,
    200,
    deliverySignature,
    48,
    past5m,
    JSON.stringify({ status: 'received', timestamp: past5m })
  );
}

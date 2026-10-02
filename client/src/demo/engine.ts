// In-browser stand-in for the FlowQueue server, used by the GitHub Pages build.
// It keeps queues, jobs and webhook deliveries in memory and applies the same
// rules as the server by importing them from shared/queue-logic.ts: slot
// reservation, backoff, dead-lettering, replay and the metrics definitions.
import type {
  EnqueueJobDto,
  Job,
  JobAttempt,
  JobPriority,
  JobStatus,
  Queue,
  QueueMetrics,
  UpdateQueueDto,
  WebhookDelivery,
  WebhookSubscription,
} from '../../../shared/types.js';
import {
  computeBackoffSeconds,
  computeMetrics,
  maxAttemptsAfterReplay,
  selectClaimable,
  shouldDeadLetter,
  simulatedFailureMessage,
} from '../../../shared/queue-logic.js';

export interface DemoQueueStats extends Queue {
  active_jobs: number;
  queued_jobs: number;
  dlq_jobs: number;
}

export type DemoJob = Job & { attempts_list: JobAttempt[] };

interface RunningJob {
  finishAt: number;
  startedAt: string;
}

// Small seeded generator so a fresh page always plays out the same way.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function hmacSha256(payload: string, secret: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return 'sha256=unavailable-in-this-browser';
  const enc = new TextEncoder();
  const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await subtle.sign('HMAC', key, enc.encode(payload)));
  return `sha256=${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const SAMPLE_SINK_URL = 'https://hooks.example.com/flowqueue/events';
const SAMPLE_PARTNER_URL = 'https://api.partner.example/v1/shipments/webhook';

function maskSecret(secret: string): string {
  return secret.length <= 4 ? '****' : `${secret.slice(0, 4)}${'*'.repeat(8)}`;
}

export class DemoEngine {
  private queues: Queue[] = [];
  private jobs: DemoJob[] = [];
  private running = new Map<string, RunningJob>();
  private subscriptions: (WebhookSubscription & { raw_secret: string })[] = [];
  private deliveries: WebhookDelivery[] = [];
  private jobSeq = 0;
  private idSeq = 0;
  private rng = mulberry32(20261002);
  private pending = new Set<Promise<unknown>>();
  private readonly ready: Promise<void>;

  constructor(private now: () => number = Date.now) {
    this.seed();
    this.ready = this.seedDeliveries();
  }

  private iso(offsetMs = 0): string {
    return new Date(this.now() + offsetMs).toISOString();
  }

  private nextId(prefix: string): string {
    this.idSeq += 1;
    return `${prefix}_${String(this.idSeq).padStart(4, '0')}`;
  }

  // ---- seed data ---------------------------------------------------------

  private seed(): void {
    const created = this.iso(-60 * 60_000);
    const queue = (name: string, concurrency: number, max_retries: number, backoff_base_sec: number): Queue => ({
      id: `queue_${name}`,
      name,
      concurrency,
      max_retries,
      backoff_base_sec,
      is_paused: false,
      created_at: created,
    });
    this.queues = [
      queue('notifications', 5, 3, 2),
      queue('billing-webhooks', 10, 5, 3),
      queue('data-sync', 3, 3, 5),
      queue('heavy-reports', 1, 2, 10),
    ];

    const s = (name: string, qn: string, priority: JobPriority, status: JobStatus, minutesAgo: number, extra: Partial<DemoJob> = {}, attempts: [number, string | null][] = [[400, null]]) => {
      const queue = this.queues.find((q) => q.name === qn)!;
      const job = this.insertJob({
        queue,
        name,
        priority,
        payload: extra.payload ?? {},
        idempotency_key: extra.idempotency_key ?? null,
        max_retries: extra.max_retries ?? queue.max_retries,
        status,
        createdAt: this.iso(-minutesAgo * 60_000),
        runAt: extra.run_at,
      });
      attempts.forEach(([duration, error], i) => {
        const started = new Date(new Date(job.created_at).getTime() + i * 45_000).toISOString();
        const finished = new Date(new Date(started).getTime() + duration).toISOString();
        job.attempts_list.push({
          id: this.nextId('att'),
          job_id: job.id,
          attempt_number: i + 1,
          status: error ? 'failed' : 'completed',
          worker_id: i % 2 === 0 ? 'worker_node_1' : 'worker_node_2',
          started_at: started,
          finished_at: finished,
          duration_ms: duration,
          error,
        });
        job.attempts = i + 1;
        job.updated_at = finished;
      });
      if (status === 'completed') job.result = extra.result ?? { status: 'success' };
      if (status === 'dlq') job.error = extra.error ?? null;
      return job;
    };

    s('send_welcome_email', 'notifications', 'normal', 'completed', 5, {
      payload: { userId: 'usr_8812', email: 'elena.v@example.com', template: 'onboarding_v2' },
      idempotency_key: 'idem_welcome_usr_8812',
      result: { messageId: 'msg_984102', recipient: 'elena.v@example.com', status: 'delivered' },
    }, [[412, null]]);
    s('reconcile_stripe_charge', 'billing-webhooks', 'high', 'completed', 2, {
      payload: { chargeId: 'ch_3Nxy82', amountCents: 14900, currency: 'EUR' },
      idempotency_key: 'idem_charge_ch_3Nxy82',
      result: { reconciliationId: 'rec_a41c07', amount: 14900, currency: 'EUR', status: 'cleared' },
    }, [[645, null]]);
    s('send_password_reset_email', 'notifications', 'high', 'completed', 9, {
      payload: { userId: 'usr_7740', email: 'm.tamm@example.com' },
      result: { messageId: 'msg_984077', recipient: 'm.tamm@example.com', status: 'delivered' },
    }, [[388, null]]);
    s('send_invoice_email', 'notifications', 'normal', 'completed', 14, {
      payload: { invoice: 'INV-2026-088', email: 'accounts@example.com' },
      result: { messageId: 'msg_983911', recipient: 'accounts@example.com', status: 'delivered' },
    }, [[474, null]]);
    s('reconcile_stripe_charge', 'billing-webhooks', 'normal', 'completed', 20, {
      payload: { chargeId: 'ch_3Nxr10', amountCents: 4900, currency: 'EUR' },
      result: { reconciliationId: 'rec_a40e92', amount: 4900, currency: 'EUR', status: 'cleared' },
    }, [[702, null]]);
    s('generate_customer_report', 'heavy-reports', 'low', 'completed', 30, {
      payload: { orgId: 'org_551', month: '2026-08', format: 'pdf' },
      result: { fileKey: 'exports/report_5f21c0.pdf', rowsProcessed: 1420 },
    }, [[1950, null]]);
    s('sync_erp_inventory', 'data-sync', 'low', 'dlq', 18, {
      payload: { warehouseId: 'wh_tallinn_01', batchId: 'batch_902', itemsCount: 450 },
      idempotency_key: 'idem_erp_batch_902',
      error: 'ConnectionTimeout: ERP endpoint 192.168.4.12:8443 did not answer within 5000ms',
    }, [
      [5000, 'ConnectionTimeout: ERP endpoint timed out'],
      [5000, 'ConnectionTimeout: ERP endpoint timed out'],
      [5000, 'ConnectionTimeout: ERP endpoint 192.168.4.12:8443 did not answer within 5000ms'],
    ]);
    s('sync_crm_contacts', 'data-sync', 'normal', 'dlq', 12, {
      payload: { source: 'crm', cursor: 'c_40291' },
      error: 'HTTP 503 from CRM API: upstream unavailable',
    }, [
      [1200, 'HTTP 503 from CRM API: upstream unavailable'],
      [1100, 'HTTP 503 from CRM API: upstream unavailable'],
      [1300, 'HTTP 503 from CRM API: upstream unavailable'],
    ]);
    s('generate_monthly_analytics_pdf', 'heavy-reports', 'normal', 'queued', 0, {
      payload: { tenantId: 'org_acme', month: '2026-09', format: 'pdf' },
      idempotency_key: 'idem_report_org_acme_202609',
    }, []);
    s('process_refund', 'billing-webhooks', 'high', 'queued', 0, {
      payload: { chargeId: 'ch_3Nxz55', amountCents: 2500 },
      run_at: this.iso(45_000),
    }, []);
    s('send_digest_email', 'notifications', 'low', 'queued', 0, { payload: { segment: 'weekly', recipients: 320 } }, []);

    const running = s('sync_warehouse_stock', 'data-sync', 'normal', 'processing', 0, {
      payload: { warehouseId: 'wh_tartu_02', batchId: 'batch_911' },
    }, []);
    this.running.set(running.id, { finishAt: this.now() + 2500, startedAt: this.iso() });
  }

  private async seedDeliveries(): Promise<void> {
    const sinkSecret = 'whsec_flowqueue_sample_secret_99';
    const partnerSecret = 'whsec_partner_hmac_secret_4488';
    this.subscriptions = [
      {
        id: 'sub_internal',
        name: 'Internal Event Sink',
        url: SAMPLE_SINK_URL,
        secret: maskSecret(sinkSecret),
        raw_secret: sinkSecret,
        events: ['job.completed', 'job.failed', 'job.dlq'],
        is_active: true,
        created_at: this.iso(-60 * 60_000),
      },
      {
        id: 'sub_partner',
        name: 'Partner Logistics Hook',
        url: SAMPLE_PARTNER_URL,
        secret: maskSecret(partnerSecret),
        raw_secret: partnerSecret,
        events: ['shipment.dispatched', 'sync.completed'],
        is_active: true,
        created_at: this.iso(-60 * 60_000),
      },
    ];

    const entries: [string, string, number, number, number, string, Record<string, unknown>][] = [
      ['sub_internal', 'job.completed', 200, 48, 2, '{"status":"received"}', { jobName: 'reconcile_stripe_charge' }],
      ['sub_internal', 'job.completed', 200, 41, 5, '{"status":"received"}', { jobName: 'send_welcome_email' }],
      ['sub_internal', 'job.dlq', 200, 37, 12, '{"status":"received"}', { jobName: 'sync_crm_contacts' }],
      ['sub_partner', 'sync.completed', 504, 6000, 13, 'Delivery error: The operation was aborted due to timeout', { jobName: 'sync_catalog' }],
      ['sub_internal', 'job.dlq', 200, 44, 18, '{"status":"received"}', { jobName: 'sync_erp_inventory' }],
    ];
    for (const [subId, event, status, duration, minutesAgo, response, data] of entries) {
      await this.recordDelivery(subId, event, data, status, duration, response, this.iso(-minutesAgo * 60_000));
    }
  }

  private async recordDelivery(
    subscriptionId: string,
    event: string,
    data: Record<string, unknown>,
    statusCode: number,
    durationMs: number,
    responseBody: string,
    deliveredAt: string
  ): Promise<WebhookDelivery> {
    const sub = this.subscriptions.find((x) => x.id === subscriptionId)!;
    const id = this.nextId('del');
    const envelope = { id, event, created_at: deliveredAt, data };
    const signature = await hmacSha256(JSON.stringify(envelope), sub.raw_secret);
    const delivery: WebhookDelivery = {
      id,
      subscription_id: sub.id,
      subscription_name: sub.name,
      event,
      payload: envelope,
      status_code: statusCode,
      signature,
      duration_ms: durationMs,
      delivered_at: deliveredAt,
      response_body: responseBody,
    };
    this.deliveries.push(delivery);
    return delivery;
  }

  // ---- jobs ----------------------------------------------------------------

  private insertJob(input: {
    queue: Queue;
    name: string;
    priority: JobPriority;
    payload: Record<string, unknown>;
    idempotency_key: string | null;
    max_retries: number;
    status?: JobStatus;
    createdAt?: string;
    runAt?: string;
  }): DemoJob {
    this.jobSeq += 1;
    const created = input.createdAt ?? this.iso();
    const job: DemoJob = {
      id: `job_${String(this.jobSeq).padStart(4, '0')}`,
      queue_id: input.queue.id,
      queue_name: input.queue.name,
      name: input.name,
      priority: input.priority,
      status: input.status ?? 'queued',
      payload: input.payload,
      result: null,
      error: null,
      idempotency_key: input.idempotency_key,
      attempts: 0,
      max_retries: input.max_retries,
      run_at: input.runAt ?? created,
      created_at: created,
      updated_at: created,
      attempts_list: [],
    };
    this.jobs.push(job);
    return job;
  }

  private resultFor(job: DemoJob): Record<string, unknown> {
    const n = this.jobSeq + this.idSeq;
    const hex = (n * 2654435761 >>> 0).toString(16).padStart(8, '0');
    if (job.name.includes('email')) {
      return { messageId: `msg_${hex}`, recipient: job.payload.email ?? 'recipient@example.com', status: 'delivered' };
    }
    if (/invoice|charge|stripe|refund/.test(job.name)) {
      return { reconciliationId: `rec_${hex}`, amount: job.payload.amountCents ?? 9900, currency: job.payload.currency ?? 'EUR', status: 'cleared' };
    }
    if (/report|analytics/.test(job.name)) {
      return { fileKey: `exports/report_${hex}.pdf`, rowsProcessed: 1420 };
    }
    return { status: 'success' };
  }

  private publicQueue(q: Queue): DemoQueueStats {
    const mine = this.jobs.filter((j) => j.queue_id === q.id);
    const count = (s: JobStatus) => mine.filter((j) => j.status === s).length;
    return { ...q, active_jobs: count('processing'), queued_jobs: count('queued'), dlq_jobs: count('dlq') };
  }

  private publicJob(job: DemoJob, withAttempts: boolean): DemoJob {
    const copy = { ...job, attempts_list: withAttempts ? job.attempts_list.map((a) => ({ ...a })) : [] };
    if (!withAttempts) delete (copy as Partial<DemoJob>).attempts_list;
    return copy;
  }

  // ---- worker --------------------------------------------------------------

  /** One worker poll: finish jobs that are due, then reserve new ones. */
  tick(): void {
    const nowMs = this.now();
    for (const [id, run] of [...this.running]) {
      if (run.finishAt <= nowMs) {
        this.running.delete(id);
        this.finish(this.jobs.find((j) => j.id === id)!, run);
      }
    }

    const ids = selectClaimable(this.queues, this.jobs, new Date(nowMs).toISOString(), 5);
    for (const id of ids) {
      const job = this.jobs.find((j) => j.id === id)!;
      job.status = 'processing';
      job.updated_at = this.iso();
      this.running.set(id, { finishAt: nowMs + 900 + Math.floor(this.rng() * 1500), startedAt: this.iso() });
    }
  }

  private finish(job: DemoJob, run: RunningJob): void {
    const attemptNumber = job.attempts + 1;
    const finished = this.iso();
    const durationMs = Math.max(this.now() - new Date(run.startedAt).getTime(), 1);
    const failure = simulatedFailureMessage(job.name, job.payload);
    const attempt: JobAttempt = {
      id: this.nextId('att'),
      job_id: job.id,
      attempt_number: attemptNumber,
      status: failure ? 'failed' : 'completed',
      worker_id: 'demo_worker_1',
      started_at: run.startedAt,
      finished_at: finished,
      duration_ms: durationMs,
      error: failure,
    };
    job.attempts_list.push(attempt);
    job.attempts = attemptNumber;
    job.updated_at = finished;

    if (!failure) {
      job.status = 'completed';
      job.result = this.resultFor(job);
      job.error = null;
      this.dispatch('job.completed', { jobId: job.id, name: job.name, queue: job.queue_name, attempts: attemptNumber, result: job.result });
      return;
    }

    job.error = failure;
    if (shouldDeadLetter(attemptNumber, job.max_retries)) {
      job.status = 'dlq';
      this.dispatch('job.dlq', { jobId: job.id, name: job.name, queue: job.queue_name, attempts: attemptNumber, error: failure });
      return;
    }
    const queue = this.queues.find((q) => q.id === job.queue_id)!;
    const backoffSec = computeBackoffSeconds(queue.backoff_base_sec, attemptNumber, Math.floor(this.rng() * 2));
    job.status = 'queued';
    job.run_at = this.iso(backoffSec * 1000);
    this.dispatch('job.failed', { jobId: job.id, name: job.name, queue: job.queue_name, attempt: attemptNumber, nextRetryInSeconds: backoffSec, error: failure });
  }

  private dispatch(event: string, data: Record<string, unknown>): void {
    for (const sub of this.subscriptions.filter((x) => x.is_active && x.events.includes(event))) {
      const pending: Promise<unknown> = this.recordDelivery(sub.id, event, data, 200, 30 + Math.floor(this.rng() * 40), '{"status":"received"}', this.iso()).finally(() =>
        this.pending.delete(pending)
      );
      this.pending.add(pending);
    }
  }

  // ---- the API the dashboard calls -----------------------------------------

  async getMetrics(): Promise<QueueMetrics> {
    await this.ready;
    const attempts = this.jobs.flatMap((j) => j.attempts_list);
    return computeMetrics(this.jobs, attempts, new Date(this.now()));
  }

  async getQueues(): Promise<DemoQueueStats[]> {
    await this.ready;
    return [...this.queues].sort((a, b) => a.name.localeCompare(b.name)).map((q) => this.publicQueue(q));
  }

  async updateQueue(id: string, updates: UpdateQueueDto): Promise<Queue> {
    await this.ready;
    const queue = this.queues.find((q) => q.id === id);
    if (!queue) throw new Error('Queue not found');
    const whole = (v: number | undefined, field: string, min: number, max: number) => {
      if (v === undefined) return undefined;
      if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${field} must be a whole number from ${min} to ${max}`);
      return v;
    };
    const concurrency = whole(updates.concurrency, 'concurrency', 1, 100);
    const maxRetries = whole(updates.max_retries, 'max_retries', 1, 20);
    if (updates.is_paused !== undefined) queue.is_paused = updates.is_paused;
    if (concurrency !== undefined) queue.concurrency = concurrency;
    if (maxRetries !== undefined) queue.max_retries = maxRetries;
    return { ...queue };
  }

  async listJobs(params: { queue_id?: string; status?: JobStatus; priority?: JobPriority; search?: string } = {}): Promise<{ jobs: Job[]; total: number }> {
    await this.ready;
    const term = params.search?.toLowerCase();
    const matches = this.jobs
      .filter((j) => !params.queue_id || j.queue_id === params.queue_id)
      .filter((j) => !params.status || j.status === params.status)
      .filter((j) => !params.priority || j.priority === params.priority)
      .filter((j) => !term || j.name.toLowerCase().includes(term) || JSON.stringify(j.payload).toLowerCase().includes(term) || j.id.toLowerCase().includes(term))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : 1));
    return { jobs: matches.slice(0, 50).map((j) => this.publicJob(j, false)), total: matches.length };
  }

  async getJob(id: string): Promise<DemoJob> {
    await this.ready;
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found');
    return this.publicJob(job, true);
  }

  async enqueueJob(dto: EnqueueJobDto): Promise<{ job: Job; duplicate: boolean }> {
    await this.ready;
    if (!dto.queue_name || !dto.name) throw new Error('queue_name and name are required');
    const queue = this.queues.find((q) => q.name === dto.queue_name);
    if (!queue) throw new Error(`Queue '${dto.queue_name}' does not exist.`);
    if (dto.idempotency_key) {
      const existing = this.jobs.find((j) => j.idempotency_key === dto.idempotency_key);
      if (existing) return { job: this.publicJob(existing, false), duplicate: true };
    }
    const job = this.insertJob({
      queue,
      name: dto.name,
      priority: dto.priority ?? 'normal',
      payload: dto.payload ?? {},
      idempotency_key: dto.idempotency_key ?? null,
      max_retries: dto.max_retries ?? queue.max_retries,
      runAt: this.iso((dto.delay_seconds ?? 0) * 1000),
    });
    return { job: this.publicJob(job, false), duplicate: false };
  }

  async retryJob(id: string): Promise<Job> {
    await this.ready;
    const job = this.jobs.find((j) => j.id === id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (job.status !== 'dlq') throw new Error(`Only dead-lettered jobs can be replayed (current status: ${job.status})`);
    job.status = 'queued';
    job.error = null;
    job.run_at = this.iso();
    job.updated_at = this.iso();
    job.max_retries = maxAttemptsAfterReplay(job.attempts, job.max_retries);
    return this.publicJob(job, false);
  }

  async getWebhookSubscriptions(): Promise<WebhookSubscription[]> {
    await this.ready;
    return this.subscriptions.map(({ raw_secret: _raw, ...sub }) => ({ ...sub }));
  }

  async getWebhookDeliveries(): Promise<WebhookDelivery[]> {
    await this.ready;
    await Promise.all([...this.pending]);
    return [...this.deliveries]
      .sort((a, b) => (a.delivered_at < b.delivered_at ? 1 : a.delivered_at > b.delivered_at ? -1 : a.id < b.id ? 1 : -1))
      .slice(0, 50)
      .map((d) => ({ ...d }));
  }

  async triggerTestWebhook(subscriptionId: string, event: string): Promise<WebhookDelivery> {
    await this.ready;
    const sub = this.subscriptions.find((s) => s.id === subscriptionId);
    if (!sub) throw new Error('Subscription not found');
    const ok = sub.url === SAMPLE_SINK_URL;
    return this.recordDelivery(
      sub.id,
      event,
      { ping: true },
      ok ? 200 : 504,
      ok ? 52 : 6000,
      ok ? '{"status":"received"}' : 'Delivery error: sample endpoint, nothing is sent from the demo',
      this.iso()
    );
  }
}

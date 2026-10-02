import crypto from 'node:crypto';
import { JobRepository } from '../repositories/job.repository.js';
import { QueueRepository } from '../repositories/queue.repository.js';
import { WebhookService } from './webhook.service.js';
import { Job } from '../../../shared/types.js';
import { computeBackoffSeconds, shouldDeadLetter, simulatedFailureMessage } from '../../../shared/queue-logic.js';

export interface WorkerOptions {
  workerId?: string;
  /** Most jobs reserved per poll. */
  batchSize?: number;
  /** Pause inside the built-in handlers that stands in for real work. */
  handlerDelayMs?: number;
  /** Source of the 0..1 jitter draw; replaced in tests. */
  random?: () => number;
  /**
   * Real handlers keyed by job name. A job whose name has no handler runs the
   * built-in simulated one, which only fabricates a result.
   */
  handlers?: Record<string, JobHandler>;
}

export type JobHandler = (job: Job) => Promise<Record<string, unknown>> | Record<string, unknown>;

export class WorkerService {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  public readonly workerId: string;
  private readonly batchSize: number;
  private readonly handlerDelayMs: number;
  private readonly random: () => number;
  private readonly handlers: Record<string, JobHandler>;

  constructor(
    private jobRepo: JobRepository,
    private queueRepo: QueueRepository,
    private webhookService: WebhookService,
    options: WorkerOptions = {}
  ) {
    this.workerId = options.workerId || `worker_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    this.batchSize = options.batchSize ?? 5;
    this.handlerDelayMs = options.handlerDelayMs ?? 150;
    this.random = options.random ?? Math.random;
    this.handlers = options.handlers ?? {};
  }

  start(intervalMs = 800): void {
    if (this.isRunning) return;
    this.isRunning = true;

    const loop = async () => {
      if (!this.isRunning) return;
      try {
        await this.pollOnce();
      } catch (err) {
        console.error(`[Worker ${this.workerId}] Polling loop error:`, err);
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(loop, intervalMs);
        }
      }
    };

    this.timer = setTimeout(loop, 100);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }

  async pollOnce(): Promise<number> {
    const jobs = this.jobRepo.claimEligibleJobs(this.batchSize, this.workerId);
    if (jobs.length === 0) return 0;

    for (const job of jobs) {
      await this.processJob(job);
    }

    return jobs.length;
  }

  async processJob(job: Job): Promise<void> {
    const attemptNumber = job.attempts + 1;
    const startedAt = new Date().toISOString();
    const startTimeMs = Date.now();

    let result: Record<string, unknown>;
    try {
      result = await this.executeJobHandler(job);
    } catch (err: any) {
      this.handleFailure(job, attemptNumber, startedAt, startTimeMs, err?.message || 'Unknown processing failure');
      return;
    }

    const attempt = {
      job_id: job.id,
      attempt_number: attemptNumber,
      status: 'completed' as const,
      worker_id: this.workerId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTimeMs,
    };

    // False means the lease expired and another worker already took the job
    // over, so this late result is dropped.
    if (!this.jobRepo.completeWithAttempt(job.id, result, attempt)) return;

    this.webhookService.dispatchJobEvent('job.completed', {
      jobId: job.id,
      name: job.name,
      queue: job.queue_name,
      attempts: attemptNumber,
      result,
    });
  }

  private handleFailure(job: Job, attemptNumber: number, startedAt: string, startTimeMs: number, errorMessage: string): void {
    const attempt = {
      job_id: job.id,
      attempt_number: attemptNumber,
      status: 'failed' as const,
      worker_id: this.workerId,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTimeMs,
      error: errorMessage,
    };

    if (shouldDeadLetter(attemptNumber, job.max_retries)) {
      if (!this.jobRepo.failWithAttempt(job.id, errorMessage, null, true, attempt)) return;
      this.webhookService.dispatchJobEvent('job.dlq', {
        jobId: job.id,
        name: job.name,
        queue: job.queue_name,
        attempts: attemptNumber,
        error: errorMessage,
      });
      return;
    }

    const queue = this.queueRepo.getQueueById(job.queue_id);
    const jitterSec = Math.floor(this.random() * 2);
    const backoffSec = computeBackoffSeconds(queue?.backoff_base_sec ?? 2, attemptNumber, jitterSec);
    const nextRunAt = new Date(Date.now() + backoffSec * 1000).toISOString();

    if (!this.jobRepo.failWithAttempt(job.id, errorMessage, nextRunAt, false, attempt)) return;
    this.webhookService.dispatchJobEvent('job.failed', {
      jobId: job.id,
      name: job.name,
      queue: job.queue_name,
      attempt: attemptNumber,
      nextRetryInSeconds: backoffSec,
      error: errorMessage,
    });
  }

  private async executeJobHandler(job: Job): Promise<Record<string, unknown>> {
    const handler = Object.hasOwn(this.handlers, job.name) ? this.handlers[job.name] : undefined;
    if (handler) return handler(job);

    // Stand-in for real I/O
    if (this.handlerDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.handlerDelayMs));
    }

    const payload = job.payload || {};

    const failure = simulatedFailureMessage(job.name, payload);
    if (failure) throw new Error(failure);

    if (job.name.includes('email')) {
      return {
        messageId: `msg_${crypto.randomBytes(4).toString('hex')}`,
        recipient: payload.email || 'recipient@example.com',
        status: 'delivered',
        deliveredAt: new Date().toISOString(),
      };
    }

    if (job.name.includes('invoice') || job.name.includes('charge') || job.name.includes('stripe')) {
      return {
        reconciliationId: `rec_${crypto.randomBytes(4).toString('hex')}`,
        amount: payload.amountCents || 9900,
        currency: payload.currency || 'EUR',
        status: 'cleared',
      };
    }

    if (job.name.includes('report') || job.name.includes('analytics')) {
      return {
        fileKey: `exports/report_${crypto.randomBytes(6).toString('hex')}.pdf`,
        rowsProcessed: 1420,
        checksum: crypto.randomBytes(16).toString('hex'),
      };
    }

    return {
      status: 'success',
      processedAt: new Date().toISOString(),
      workerId: this.workerId,
    };
  }
}

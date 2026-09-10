import crypto from 'node:crypto';
import { JobRepository } from '../repositories/job.repository.js';
import { QueueRepository } from '../repositories/queue.repository.js';
import { WebhookService } from './webhook.service.js';
import { Job } from '../../../shared/types.js';

export class WorkerService {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  public readonly workerId: string;

  constructor(
    private jobRepo: JobRepository,
    private queueRepo: QueueRepository,
    private webhookService: WebhookService,
    workerId?: string
  ) {
    this.workerId = workerId || `worker_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
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
    const jobs = this.jobRepo.claimEligibleJobs(5);
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

    try {
      // Simulate real-world asynchronous workload
      const result = await this.executeJobHandler(job);
      const durationMs = Date.now() - startTimeMs;
      const finishedAt = new Date().toISOString();

      // Record successful attempt
      this.jobRepo.recordAttempt({
        job_id: job.id,
        attempt_number: attemptNumber,
        status: 'completed',
        worker_id: this.workerId,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: durationMs,
      });

      // Complete job
      this.jobRepo.completeJob(job.id, result);

      // Dispatch Webhook Notification
      this.webhookService.dispatchJobEvent('job.completed', {
        jobId: job.id,
        name: job.name,
        queue: job.queue_name,
        attempts: attemptNumber,
        result,
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTimeMs;
      const finishedAt = new Date().toISOString();
      const errorMessage = err.message || 'Unknown processing failure';

      // Record failed attempt
      this.jobRepo.recordAttempt({
        job_id: job.id,
        attempt_number: attemptNumber,
        status: 'failed',
        worker_id: this.workerId,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: durationMs,
        error: errorMessage,
      });

      const queue = this.queueRepo.getQueueById(job.queue_id);
      const baseSec = queue?.backoff_base_sec || 2;
      const willDlq = attemptNumber >= job.max_retries;

      if (willDlq) {
        // Exceeded max retries: send to Dead-Letter Queue (DLQ)
        this.jobRepo.failOrRetryJob(job.id, errorMessage, null, true);
        this.webhookService.dispatchJobEvent('job.dlq', {
          jobId: job.id,
          name: job.name,
          queue: job.queue_name,
          attempts: attemptNumber,
          error: errorMessage,
        });
      } else {
        // Calculate exponential backoff with jitter
        // delay = base * 2^(attempt - 1) + jitter(0..2s)
        const jitterSec = Math.floor(Math.random() * 2);
        const backoffSec = Math.floor(baseSec * Math.pow(2, attemptNumber - 1)) + jitterSec;
        const nextRunAt = new Date(Date.now() + backoffSec * 1000).toISOString();

        this.jobRepo.failOrRetryJob(job.id, errorMessage, nextRunAt, false);
        this.webhookService.dispatchJobEvent('job.failed', {
          jobId: job.id,
          name: job.name,
          queue: job.queue_name,
          attempt: attemptNumber,
          nextRetryInSeconds: backoffSec,
          error: errorMessage,
        });
      }
    }
  }

  private async executeJobHandler(job: Job): Promise<Record<string, unknown>> {
    // Artificial small delay to simulate I/O
    await new Promise((resolve) => setTimeout(resolve, 150));

    const payload = job.payload || {};

    if (payload.should_fail === true || payload.simulate_error === true || job.name.includes('simulate_fail')) {
      const errorMsg = (payload.error_message as string) || `Task '${job.name}' encountered unrecoverable downstream error`;
      throw new Error(errorMsg);
    }

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

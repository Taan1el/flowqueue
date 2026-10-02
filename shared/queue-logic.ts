import type { Job, JobPriority, QueueMetrics } from './types.js';
import { PRIORITY_WEIGHTS } from './types.js';

// Pure queue rules shared by the Express server and the in-browser demo.
// Nothing here touches a database, a clock or a random source: callers pass
// those in, which keeps both sides identical and easy to test.

export function priorityToWeight(priority: JobPriority): number {
  return PRIORITY_WEIGHTS[priority] ?? PRIORITY_WEIGHTS.normal;
}

export function weightToPriority(weight: number): JobPriority {
  if (weight === PRIORITY_WEIGHTS.high) return 'high';
  if (weight === PRIORITY_WEIGHTS.low) return 'low';
  return 'normal';
}

/**
 * Seconds to wait before the next try: base * 2^(attempt - 1) plus the jitter
 * the caller picked (the worker passes a whole number from 0 to 1).
 */
export function computeBackoffSeconds(baseSec: number, attemptNumber: number, jitterSec = 0): number {
  const base = baseSec > 0 ? baseSec : 2;
  return Math.floor(base * Math.pow(2, Math.max(attemptNumber, 1) - 1)) + jitterSec;
}

/**
 * `max_retries` is the total number of runs a job may use. After that many
 * failed runs it moves to the dead letters instead of being retried.
 */
export function shouldDeadLetter(attemptNumber: number, maxRetries: number): boolean {
  return attemptNumber >= maxRetries;
}

/**
 * Replaying a dead-lettered job grants exactly one more run. If that run
 * fails too, the job returns to the dead letters.
 */
export function maxAttemptsAfterReplay(attempts: number, maxRetries: number): number {
  return Math.max(maxRetries, attempts + 1);
}

/**
 * The built-in handlers fail on purpose when a payload asks for it or the job
 * name contains `simulate_fail`. Returns the error message, or null.
 */
export function simulatedFailureMessage(name: string, payload: Record<string, unknown>): string | null {
  if (payload.should_fail === true || payload.simulate_error === true || name.includes('simulate_fail')) {
    return typeof payload.error_message === 'string' && payload.error_message
      ? payload.error_message
      : `Task '${name}' encountered unrecoverable downstream error`;
  }
  return null;
}

export interface ClaimQueue {
  id: string;
  concurrency: number;
  is_paused: boolean;
}

export interface ClaimJob {
  id: string;
  queue_id: string;
  status: string;
  priority: JobPriority;
  run_at: string;
}

/**
 * Chooses which queued jobs a worker may reserve right now. Each queue offers
 * only `concurrency - processing` slots; the jobs inside a queue are ranked by
 * priority, due time and id, and the surviving candidates are ordered the same
 * way across queues before the batch limit is applied.
 */
export function selectClaimable(queues: ClaimQueue[], jobs: ClaimJob[], nowIso: string, limit: number): string[] {
  const queueById = new Map(queues.map((q) => [q.id, q]));
  const active = new Map<string, number>();
  for (const job of jobs) {
    if (job.status === 'processing') active.set(job.queue_id, (active.get(job.queue_id) ?? 0) + 1);
  }

  const order = (a: ClaimJob, b: ClaimJob) =>
    priorityToWeight(a.priority) - priorityToWeight(b.priority) ||
    (a.run_at < b.run_at ? -1 : a.run_at > b.run_at ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const perQueue = new Map<string, ClaimJob[]>();
  for (const job of jobs) {
    const queue = queueById.get(job.queue_id);
    if (!queue || queue.is_paused || job.status !== 'queued' || job.run_at > nowIso) continue;
    const list = perQueue.get(job.queue_id) ?? [];
    list.push(job);
    perQueue.set(job.queue_id, list);
  }

  const candidates: ClaimJob[] = [];
  for (const [queueId, list] of perQueue) {
    const slots = queueById.get(queueId)!.concurrency - (active.get(queueId) ?? 0);
    if (slots <= 0) continue;
    candidates.push(...list.sort(order).slice(0, slots));
  }

  return candidates
    .sort(order)
    .slice(0, Math.max(limit, 0))
    .map((job) => job.id);
}

export interface MetricsAttempt {
  status: string;
  duration_ms?: number | null;
}

/**
 * Dashboard numbers. "Today" means since 00:00 UTC of the day containing
 * `now`; throughput is jobs completed in the last ten minutes divided by ten.
 */
export function computeMetrics(
  jobs: Pick<Job, 'status' | 'updated_at'>[],
  attempts: (MetricsAttempt & { finished_at?: string | null; started_at: string })[],
  now: Date
): QueueMetrics {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

  let queued = 0;
  let processing = 0;
  let completedToday = 0;
  let dlq = 0;
  let recentlyCompleted = 0;
  for (const job of jobs) {
    if (job.status === 'queued') queued += 1;
    if (job.status === 'processing') processing += 1;
    if (job.status === 'dlq') dlq += 1;
    if (job.status === 'completed') {
      if (job.updated_at >= dayStart) completedToday += 1;
      if (job.updated_at >= tenMinutesAgo) recentlyCompleted += 1;
    }
  }

  let failedToday = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const attempt of attempts) {
    if (attempt.status === 'failed' && (attempt.finished_at ?? attempt.started_at) >= dayStart) failedToday += 1;
    if (attempt.status === 'completed' && typeof attempt.duration_ms === 'number') {
      durationSum += attempt.duration_ms;
      durationCount += 1;
    }
  }

  return {
    total_enqueued: queued,
    active_processing: processing,
    completed_today: completedToday,
    failed_today: failedToday,
    dlq_count: dlq,
    avg_duration_ms: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    throughput_per_minute: Math.round((recentlyCompleted / 10) * 10) / 10,
  };
}

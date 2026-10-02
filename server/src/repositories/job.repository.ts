import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Job, JobAttempt, JobPriority, JobStatus } from '../../../shared/types.js';
import {
  computeBackoffSeconds,
  maxAttemptsAfterReplay,
  priorityToWeight,
  shouldDeadLetter,
  weightToPriority,
} from '../../../shared/queue-logic.js';

export const DEFAULT_LEASE_MS = 60_000;

export interface AttemptRecord {
  job_id: string;
  attempt_number: number;
  status: 'processing' | 'completed' | 'failed';
  worker_id: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
}

export interface ListJobsFilter {
  queue_id?: string;
  status?: JobStatus;
  priority?: JobPriority;
  search?: string;
  limit?: number;
  offset?: number;
}

export class JobRepository {
  private readonly leaseMs: number;

  constructor(
    private db: DatabaseSync,
    options: { leaseMs?: number } = {}
  ) {
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  private rowToJob(row: any): Job {
    return {
      id: row.id,
      queue_id: row.queue_id,
      queue_name: row.queue_name,
      name: row.name,
      priority: weightToPriority(Number(row.priority)),
      status: row.status as JobStatus,
      payload: JSON.parse(row.payload),
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error,
      idempotency_key: row.idempotency_key,
      attempts: Number(row.attempts),
      max_retries: Number(row.max_retries),
      run_at: row.run_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private inTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  createJob(job: {
    queue_id: string;
    name: string;
    priority: JobPriority;
    payload: Record<string, unknown>;
    idempotency_key?: string | null;
    max_retries: number;
    delay_seconds?: number;
  }): Job {
    const id = crypto.randomUUID();
    const now = new Date();
    const runAt = new Date(now.getTime() + (job.delay_seconds || 0) * 1000).toISOString();
    const nowIso = now.toISOString();

    const priorityVal = priorityToWeight(job.priority);

    const stmt = this.db.prepare(`
      INSERT INTO jobs (
        id, queue_id, name, priority, status, payload, idempotency_key,
        attempts, max_retries, run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?);
    `);

    stmt.run(
      id,
      job.queue_id,
      job.name,
      priorityVal,
      JSON.stringify(job.payload),
      job.idempotency_key || null,
      job.max_retries,
      runAt,
      nowIso,
      nowIso
    );

    return this.getJobById(id)!;
  }

  getJobById(id: string): (Job & { attempts_list?: JobAttempt[] }) | null {
    const row = this.db
      .prepare(`
        SELECT j.*, q.name as queue_name
        FROM jobs j
        JOIN queues q ON j.queue_id = q.id
        WHERE j.id = ?;
      `)
      .get(id) as any;
    if (!row) return null;

    const attemptRows = this.db
      .prepare(`
        SELECT * FROM job_attempts
        WHERE job_id = ?
        ORDER BY attempt_number ASC;
      `)
      .all(id) as any[];

    return {
      ...this.rowToJob(row),
      attempts_list: attemptRows.map((att) => ({
        id: att.id,
        job_id: att.job_id,
        attempt_number: Number(att.attempt_number),
        status: att.status,
        worker_id: att.worker_id,
        started_at: att.started_at,
        finished_at: att.finished_at,
        duration_ms: att.duration_ms !== null ? Number(att.duration_ms) : null,
        error: att.error,
      })),
    };
  }

  getJobByIdempotencyKey(key: string): Job | null {
    const row = this.db
      .prepare(`
        SELECT j.*, q.name as queue_name
        FROM jobs j
        JOIN queues q ON j.queue_id = q.id
        WHERE j.idempotency_key = ?;
      `)
      .get(key) as any;
    return row ? this.rowToJob(row) : null;
  }

  listJobs(filters: ListJobsFilter): { jobs: Job[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.queue_id) {
      conditions.push('j.queue_id = ?');
      params.push(filters.queue_id);
    }
    if (filters.status) {
      conditions.push('j.status = ?');
      params.push(filters.status);
    }
    if (filters.priority) {
      conditions.push('j.priority = ?');
      params.push(priorityToWeight(filters.priority));
    }
    if (filters.search) {
      // Escape LIKE wildcards so a search for "100%" matches the literal text.
      conditions.push("(j.name LIKE ? ESCAPE '\\' OR j.payload LIKE ? ESCAPE '\\' OR j.id LIKE ? ESCAPE '\\')");
      const term = `%${filters.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(term, term, term);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = this.db
      .prepare(`SELECT COUNT(*) as total FROM jobs j ${whereClause};`)
      .get(...params) as { total: number };

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const rows = this.db
      .prepare(`
        SELECT j.*, q.name as queue_name
        FROM jobs j
        JOIN queues q ON j.queue_id = q.id
        ${whereClause}
        ORDER BY j.created_at DESC, j.id ASC
        LIMIT ? OFFSET ?;
      `)
      .all(...params, limit, offset) as any[];

    return { jobs: rows.map((row) => this.rowToJob(row)), total: countResult.total };
  }

  /**
   * Returns processing jobs whose lease ran out (their worker most likely
   * crashed) to the queue. The lost run counts as a failed attempt, so a job
   * that keeps killing its worker still ends up in the dead letters.
   */
  recoverExpiredLeases(nowIso: string = new Date().toISOString()): number {
    const expired = this.db
      .prepare(`
        SELECT j.id, j.attempts, j.max_retries, j.locked_by, j.updated_at, q.backoff_base_sec
        FROM jobs j
        JOIN queues q ON j.queue_id = q.id
        WHERE j.status = 'processing' AND j.locked_until IS NOT NULL AND j.locked_until < ?;
      `)
      .all(nowIso) as any[];

    for (const row of expired) {
      const attemptNumber = Number(row.attempts) + 1;
      const message = 'Worker lease expired before the job finished';
      this.db
        .prepare(`
          INSERT INTO job_attempts (
            id, job_id, attempt_number, status, worker_id, started_at, finished_at, duration_ms, error
          ) VALUES (?, ?, ?, 'failed', ?, ?, ?, NULL, ?);
        `)
        .run(crypto.randomUUID(), row.id, attemptNumber, row.locked_by || 'unknown', row.updated_at, nowIso, message);

      const dead = shouldDeadLetter(attemptNumber, Number(row.max_retries));
      const retryAt = new Date(
        new Date(nowIso).getTime() + computeBackoffSeconds(Number(row.backoff_base_sec), attemptNumber) * 1000
      ).toISOString();
      this.db
        .prepare(`
          UPDATE jobs
          SET status = ?, attempts = ?, error = ?, run_at = ?, locked_by = NULL, locked_until = NULL, updated_at = ?
          WHERE id = ?;
        `)
        .run(dead ? 'dlq' : 'queued', attemptNumber, message, dead ? row.updated_at : retryAt, nowIso, row.id);
    }
    return expired.length;
  }

  /**
   * Reserves up to `limit` due jobs. Each reservation holds a lease of
   * `leaseMs`; a worker that dies leaves it to expire and the job is
   * recovered by the next claim.
   */
  claimEligibleJobs(limit = 10, workerId = 'worker', now: Date = new Date()): Job[] {
    const nowIso = now.toISOString();
    const lockedUntil = new Date(now.getTime() + this.leaseMs).toISOString();

    // Select candidate jobs from unpaused queues respecting queue concurrency limits
    const candidateQuery = `
      WITH ActivePerQueue AS (
        SELECT queue_id, COUNT(*) as active_count
        FROM jobs
        WHERE status = 'processing'
        GROUP BY queue_id
      ), RankedJobs AS (
        SELECT j.id, j.priority, j.run_at,
          q.concurrency - COALESCE(apq.active_count, 0) AS available_slots,
          ROW_NUMBER() OVER (
            PARTITION BY j.queue_id ORDER BY j.priority ASC, j.run_at ASC, j.id ASC
          ) AS queue_rank
        FROM jobs j
        JOIN queues q ON j.queue_id = q.id
        LEFT JOIN ActivePerQueue apq ON q.id = apq.queue_id
        WHERE j.status = 'queued'
          AND j.run_at <= ?
          AND q.is_paused = 0
          AND COALESCE(apq.active_count, 0) < q.concurrency
      )
      SELECT id FROM RankedJobs
      WHERE queue_rank <= available_slots
      ORDER BY priority ASC, run_at ASC, id ASC
      LIMIT ?;
    `;

    // Reserve the writer lock before reading capacity so other workers cannot
    // select from the same free slots between selection and reservation.
    return this.inTransaction(() => {
      this.recoverExpiredLeases(nowIso);

      const candidates = this.db.prepare(candidateQuery).all(nowIso, limit) as { id: string }[];
      const claimedJobs: Job[] = [];
      const updateStmt = this.db.prepare(`
        UPDATE jobs
        SET status = 'processing', locked_by = ?, locked_until = ?, updated_at = ?
        WHERE id = ? AND status = 'queued';
      `);

      for (const cand of candidates) {
        const info = updateStmt.run(workerId, lockedUntil, nowIso, cand.id);
        if (info.changes > 0) {
          const fullJob = this.getJobById(cand.id);
          if (fullJob) claimedJobs.push(fullJob);
        }
      }
      return claimedJobs;
    });
  }

  /** Marks a processing job completed. Returns false if it is no longer processing. */
  completeJob(id: string, result: Record<string, unknown>): boolean {
    const info = this.db
      .prepare(`
        UPDATE jobs
        SET status = 'completed', result = ?, error = NULL, locked_by = NULL, locked_until = NULL, updated_at = ?
        WHERE id = ? AND status = 'processing';
      `)
      .run(JSON.stringify(result), new Date().toISOString(), id);
    return info.changes > 0;
  }

  /** Requeues (with `nextRunAt`) or dead-letters a processing job. Returns false if it is no longer processing. */
  failOrRetryJob(id: string, error: string, nextRunAt?: string | null, moveToDlq = false): boolean {
    const info = this.db
      .prepare(`
        UPDATE jobs
        SET status = ?, error = ?, run_at = COALESCE(?, run_at), locked_by = NULL, locked_until = NULL, updated_at = ?
        WHERE id = ? AND status = 'processing';
      `)
      .run(moveToDlq ? 'dlq' : 'queued', error, nextRunAt || null, new Date().toISOString(), id);
    return info.changes > 0;
  }

  /** Completes the job and records its attempt together; nothing is written if the lease was lost. */
  completeWithAttempt(id: string, result: Record<string, unknown>, attempt: AttemptRecord): boolean {
    return this.inTransaction(() => {
      if (!this.completeJob(id, result)) return false;
      this.recordAttempt(attempt);
      return true;
    });
  }

  /** Records a failed attempt and requeues or dead-letters the job together; nothing is written if the lease was lost. */
  failWithAttempt(
    id: string,
    error: string,
    nextRunAt: string | null,
    moveToDlq: boolean,
    attempt: AttemptRecord
  ): boolean {
    return this.inTransaction(() => {
      if (!this.failOrRetryJob(id, error, nextRunAt, moveToDlq)) return false;
      this.recordAttempt(attempt);
      return true;
    });
  }

  recordAttempt(attempt: AttemptRecord): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(`
        INSERT INTO job_attempts (
          id, job_id, attempt_number, status, worker_id, started_at, finished_at, duration_ms, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
      `)
      .run(
        id,
        attempt.job_id,
        attempt.attempt_number,
        attempt.status,
        attempt.worker_id,
        attempt.started_at,
        attempt.finished_at || null,
        attempt.duration_ms ?? null,
        attempt.error || null
      );

    this.db.prepare('UPDATE jobs SET attempts = attempts + 1 WHERE id = ?;').run(attempt.job_id);
    return id;
  }

  /** Requeues a dead-lettered job with one more run allowed. Returns null if the job is not dead-lettered. */
  replayDlqJob(id: string): Job | null {
    const job = this.getJobById(id);
    if (!job || job.status !== 'dlq') return null;

    const nowIso = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE jobs
        SET status = 'queued', run_at = ?, updated_at = ?, error = NULL, max_retries = ?
        WHERE id = ? AND status = 'dlq';
      `)
      .run(nowIso, nowIso, maxAttemptsAfterReplay(job.attempts, job.max_retries), id);

    return this.getJobById(id);
  }
}

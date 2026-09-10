import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { Job, JobAttempt, JobPriority, JobStatus } from '../../../shared/types.js';

export interface ListJobsFilter {
  queue_id?: string;
  status?: JobStatus;
  priority?: JobPriority;
  search?: string;
  limit?: number;
  offset?: number;
}

export class JobRepository {
  constructor(private db: DatabaseSync) {}

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

    const priorityVal = job.priority === 'high' ? 1 : job.priority === 'low' ? 3 : 2;

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
    const stmt = this.db.prepare(`
      SELECT j.*, q.name as queue_name
      FROM jobs j
      JOIN queues q ON j.queue_id = q.id
      WHERE j.id = ?;
    `);
    const row = stmt.get(id) as any;
    if (!row) return null;

    const attemptsStmt = this.db.prepare(`
      SELECT * FROM job_attempts
      WHERE job_id = ?
      ORDER BY attempt_number ASC;
    `);
    const attemptRows = attemptsStmt.all(id) as any[];

    return {
      id: row.id,
      queue_id: row.queue_id,
      queue_name: row.queue_name,
      name: row.name,
      priority: row.priority === 1 ? 'high' : row.priority === 3 ? 'low' : 'normal',
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
    const stmt = this.db.prepare(`
      SELECT j.*, q.name as queue_name
      FROM jobs j
      JOIN queues q ON j.queue_id = q.id
      WHERE j.idempotency_key = ?;
    `);
    const row = stmt.get(key) as any;
    if (!row) return null;

    return {
      id: row.id,
      queue_id: row.queue_id,
      queue_name: row.queue_name,
      name: row.name,
      priority: row.priority === 1 ? 'high' : row.priority === 3 ? 'low' : 'normal',
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
      const priorityNum = filters.priority === 'high' ? 1 : filters.priority === 'low' ? 3 : 2;
      conditions.push('j.priority = ?');
      params.push(priorityNum);
    }
    if (filters.search) {
      conditions.push('(j.name LIKE ? OR j.payload LIKE ? OR j.id LIKE ?)');
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as total FROM jobs j ${whereClause};
    `);
    const countResult = countStmt.get(...params) as { total: number };

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const listStmt = this.db.prepare(`
      SELECT j.*, q.name as queue_name
      FROM jobs j
      JOIN queues q ON j.queue_id = q.id
      ${whereClause}
      ORDER BY j.created_at DESC
      LIMIT ? OFFSET ?;
    `);

    const rows = listStmt.all(...params, limit, offset) as any[];

    const jobs: Job[] = rows.map((row) => ({
      id: row.id,
      queue_id: row.queue_id,
      queue_name: row.queue_name,
      name: row.name,
      priority: row.priority === 1 ? 'high' : row.priority === 3 ? 'low' : 'normal',
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
    }));

    return { jobs, total: countResult.total };
  }

  claimEligibleJobs(limit = 10): Job[] {
    const nowIso = new Date().toISOString();

    // Select candidate jobs from unpaused queues respecting queue concurrency limits
    const candidateQuery = `
      WITH ActivePerQueue AS (
        SELECT queue_id, COUNT(*) as active_count
        FROM jobs
        WHERE status = 'processing'
        GROUP BY queue_id
      )
      SELECT j.id
      FROM jobs j
      JOIN queues q ON j.queue_id = q.id
      LEFT JOIN ActivePerQueue apq ON q.id = apq.queue_id
      WHERE j.status = 'queued'
        AND j.run_at <= ?
        AND q.is_paused = 0
        AND COALESCE(apq.active_count, 0) < q.concurrency
      ORDER BY j.priority ASC, j.run_at ASC
      LIMIT ?;
    `;

    const candidates = this.db.prepare(candidateQuery).all(nowIso, limit) as { id: string }[];
    if (candidates.length === 0) return [];

    const claimedJobs: Job[] = [];
    const updateStmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'processing', updated_at = ?
      WHERE id = ? AND status = 'queued';
    `);

    for (const cand of candidates) {
      const info = updateStmt.run(nowIso, cand.id) as any;
      if (info.changes > 0) {
        const fullJob = this.getJobById(cand.id);
        if (fullJob) claimedJobs.push(fullJob);
      }
    }

    return claimedJobs;
  }

  completeJob(id: string, result: Record<string, unknown>): void {
    const nowIso = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = 'completed', result = ?, error = NULL, updated_at = ?
      WHERE id = ?;
    `);
    stmt.run(JSON.stringify(result), nowIso, id);
  }

  failOrRetryJob(id: string, error: string, nextRunAt?: string | null, moveToDlq = false): void {
    const nowIso = new Date().toISOString();
    const status: JobStatus = moveToDlq ? 'dlq' : 'queued';

    const stmt = this.db.prepare(`
      UPDATE jobs
      SET status = ?, error = ?, run_at = COALESCE(?, run_at), updated_at = ?
      WHERE id = ?;
    `);
    stmt.run(status, error, nextRunAt || null, nowIso, id);
  }

  recordAttempt(attempt: {
    job_id: string;
    attempt_number: number;
    status: 'processing' | 'completed' | 'failed';
    worker_id: string;
    started_at: string;
    finished_at?: string | null;
    duration_ms?: number | null;
    error?: string | null;
  }): string {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO job_attempts (
        id, job_id, attempt_number, status, worker_id, started_at, finished_at, duration_ms, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
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

    // Increment attempts count on job
    this.db.prepare(`
      UPDATE jobs SET attempts = attempts + 1 WHERE id = ?;
    `).run(attempt.job_id);

    return id;
  }

  replayDlqJob(id: string): Job | null {
    const job = this.getJobById(id);
    if (!job || job.status !== 'dlq') return null;

    const nowIso = new Date().toISOString();
    this.db.prepare(`
      UPDATE jobs
      SET status = 'queued', run_at = ?, updated_at = ?, error = NULL
      WHERE id = ?;
    `).run(nowIso, nowIso, id);

    return this.getJobById(id);
  }
}

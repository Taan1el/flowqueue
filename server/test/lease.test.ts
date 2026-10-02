import { describe, it, expect, beforeEach } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { initializeSchema } from '../src/db/schema.js';
import { JobRepository } from '../src/repositories/job.repository.js';

const T0 = new Date('2026-10-01T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('Worker leases', () => {
  let db: ReturnType<typeof createDatabase>;
  let repo: JobRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    initializeSchema(db);
    repo = new JobRepository(db, { leaseMs: 30_000 });
    db.prepare('INSERT INTO queues (id, name, concurrency, backoff_base_sec, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'q',
      'work',
      1,
      4,
      T0.toISOString()
    );
  });

  function enqueue(maxRetries = 3) {
    const job = repo.createJob({ queue_id: 'q', name: 'task', priority: 'normal', payload: {}, max_retries: maxRetries });
    db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', job.id);
    return job.id;
  }

  const row = (id: string) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;

  it('stamps a claim with the worker and an expiry', () => {
    const id = enqueue();
    const [claimed] = repo.claimEligibleJobs(5, 'worker-a', T0);
    expect(claimed.id).toBe(id);
    expect(row(id)).toMatchObject({ status: 'processing', locked_by: 'worker-a', locked_until: at(30).toISOString() });
  });

  it('keeps a live lease and its slot until it expires', () => {
    const a = enqueue();
    const b = enqueue();
    const [claimed] = repo.claimEligibleJobs(5, 'worker-a', T0);
    const waiting = claimed.id === a ? b : a;
    expect(repo.claimEligibleJobs(5, 'worker-b', at(29))).toEqual([]);
    expect(row(claimed.id).status).toBe('processing');
    expect(row(waiting).status).toBe('queued');
  });

  it('recovers a job whose lease expired and counts the lost run as a failed attempt', () => {
    const id = enqueue();
    repo.claimEligibleJobs(5, 'worker-a', T0);

    const reclaimed = repo.claimEligibleJobs(5, 'worker-b', at(31));
    // 4s base backoff after attempt 1: the job is not due yet at t+31
    expect(reclaimed).toEqual([]);
    expect(row(id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      locked_by: null,
      locked_until: null,
      error: 'Worker lease expired before the job finished',
      run_at: at(35).toISOString(),
    });
    const attempts = repo.getJobById(id)!.attempts_list!;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attempt_number: 1, status: 'failed', worker_id: 'worker-a' });

    const [again] = repo.claimEligibleJobs(5, 'worker-b', at(36));
    expect(again.id).toBe(id);
    expect(again.attempts).toBe(1);
  });

  it('dead-letters a job that keeps losing its worker', () => {
    const id = enqueue(2);
    repo.claimEligibleJobs(5, 'worker-a', T0);
    repo.claimEligibleJobs(5, 'worker-b', at(31));
    repo.claimEligibleJobs(5, 'worker-b', at(100));
    expect(row(id).status).toBe('processing');
    repo.claimEligibleJobs(5, 'worker-c', at(200));
    expect(row(id)).toMatchObject({ status: 'dlq', attempts: 2 });
    expect(repo.getJobById(id)!.attempts_list).toHaveLength(2);
  });

  it('drops the late result of a worker that lost its lease', () => {
    const id = enqueue();
    repo.claimEligibleJobs(5, 'worker-a', T0);
    repo.claimEligibleJobs(5, 'worker-b', at(31));

    const late = {
      job_id: id,
      attempt_number: 1,
      status: 'completed' as const,
      worker_id: 'worker-a',
      started_at: T0.toISOString(),
    };
    expect(repo.completeWithAttempt(id, { ok: true }, late)).toBe(false);
    expect(repo.failWithAttempt(id, 'late', null, true, { ...late, status: 'failed' })).toBe(false);
    expect(row(id)).toMatchObject({ status: 'queued', attempts: 1 });
    expect(repo.getJobById(id)!.attempts_list).toHaveLength(1);
  });

  it('clears the lease when a job finishes', () => {
    const id = enqueue();
    repo.claimEligibleJobs(5, 'worker-a', T0);
    const attempt = { job_id: id, attempt_number: 1, status: 'completed' as const, worker_id: 'worker-a', started_at: T0.toISOString() };
    expect(repo.completeWithAttempt(id, { ok: true }, attempt)).toBe(true);
    expect(row(id)).toMatchObject({ status: 'completed', locked_by: null, locked_until: null, attempts: 1 });
  });

  it('adds the lock columns to a database created before leases existed', () => {
    const old = createDatabase(':memory:');
    old.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, queue_id TEXT, name TEXT, priority INTEGER, status TEXT, payload TEXT,
      result TEXT, error TEXT, idempotency_key TEXT, attempts INTEGER, max_retries INTEGER, run_at TEXT, created_at TEXT, updated_at TEXT);`);
    initializeSchema(old);
    const columns = (old.prepare('PRAGMA table_info(jobs);').all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['locked_by', 'locked_until']));
    initializeSchema(old); // idempotent
  });
});

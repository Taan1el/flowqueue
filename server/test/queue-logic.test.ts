import { describe, it, expect } from 'vitest';
import {
  computeBackoffSeconds,
  computeMetrics,
  maxAttemptsAfterReplay,
  priorityToWeight,
  selectClaimable,
  shouldDeadLetter,
  simulatedFailureMessage,
  weightToPriority,
  ClaimJob,
} from '../../shared/queue-logic.js';
import { createDatabase } from '../src/db/database.js';
import { initializeSchema } from '../src/db/schema.js';
import { JobRepository } from '../src/repositories/job.repository.js';
import { MetricsService } from '../src/services/metrics.service.js';

describe('shared queue rules', () => {
  it('maps priorities to weights and back', () => {
    expect(['high', 'normal', 'low'].map((p) => priorityToWeight(p as any))).toEqual([1, 2, 3]);
    expect([1, 2, 3, 9].map(weightToPriority)).toEqual(['high', 'normal', 'low', 'normal']);
  });

  it('doubles the backoff per attempt and adds the jitter', () => {
    expect([1, 2, 3, 4].map((n) => computeBackoffSeconds(5, n))).toEqual([5, 10, 20, 40]);
    expect(computeBackoffSeconds(2, 1, 1)).toBe(3);
    expect(computeBackoffSeconds(0, 1)).toBe(2);
    expect(computeBackoffSeconds(3, 0)).toBe(3);
  });

  it('treats max_retries as the total number of runs', () => {
    expect(shouldDeadLetter(1, 3)).toBe(false);
    expect(shouldDeadLetter(2, 3)).toBe(false);
    expect(shouldDeadLetter(3, 3)).toBe(true);
    expect(shouldDeadLetter(1, 1)).toBe(true);
  });

  it('grants exactly one more run on replay', () => {
    expect(maxAttemptsAfterReplay(3, 3)).toBe(4);
    expect(maxAttemptsAfterReplay(4, 4)).toBe(5);
    expect(maxAttemptsAfterReplay(1, 5)).toBe(5);
  });

  it('detects simulated failures from the payload or the job name', () => {
    expect(simulatedFailureMessage('send', {})).toBeNull();
    expect(simulatedFailureMessage('send', { should_fail: true })).toContain("Task 'send'");
    expect(simulatedFailureMessage('send', { simulate_error: true, error_message: 'boom' })).toBe('boom');
    expect(simulatedFailureMessage('simulate_fail_sync', {})).toContain('simulate_fail_sync');
    expect(simulatedFailureMessage('send', { should_fail: 'true' })).toBeNull();
  });
});

describe('selectClaimable', () => {
  const now = '2026-10-01T12:00:00.000Z';
  const queues = [
    { id: 'a', concurrency: 1, is_paused: false },
    { id: 'b', concurrency: 2, is_paused: false },
    { id: 'p', concurrency: 5, is_paused: true },
  ];
  const job = (id: string, queue_id: string, extra: Partial<ClaimJob> = {}): ClaimJob => ({
    id,
    queue_id,
    status: 'queued',
    priority: 'normal',
    run_at: '2026-10-01T11:00:00.000Z',
    ...extra,
  });

  it('caps each queue before applying the batch limit', () => {
    const jobs = [job('a1', 'a'), job('a2', 'a'), job('b1', 'b'), job('b2', 'b'), job('b3', 'b')];
    expect(selectClaimable(queues, jobs, now, 10).sort()).toEqual(['a1', 'b1', 'b2']);
    expect(selectClaimable(queues, jobs, now, 2)).toHaveLength(2);
    expect(selectClaimable(queues, jobs, now, 0)).toEqual([]);
  });

  it('subtracts running jobs and ignores paused, delayed and unknown-queue jobs', () => {
    const jobs = [
      job('run', 'b', { status: 'processing' }),
      job('b1', 'b'),
      job('b2', 'b'),
      job('later', 'a', { run_at: '2026-10-01T12:00:01.000Z' }),
      job('paused', 'p'),
      job('ghost', 'zzz'),
    ];
    expect(selectClaimable(queues, jobs, now, 10)).toEqual(['b1']);
  });

  it('orders by priority, then due time, then id', () => {
    const jobs = [
      job('n-late', 'b', { run_at: '2026-10-01T11:30:00.000Z' }),
      job('low', 'b', { priority: 'low' }),
      job('high', 'b', { priority: 'high', run_at: '2026-10-01T11:45:00.000Z' }),
      job('n-early', 'b'),
    ];
    expect(selectClaimable([{ id: 'b', concurrency: 10, is_paused: false }], jobs, now, 10)).toEqual([
      'high',
      'n-early',
      'n-late',
      'low',
    ]);
  });

  it('picks the same jobs as the SQL reservation query', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);
    const repo = new JobRepository(db);
    const created = new Date().toISOString();
    for (const q of queues) {
      db.prepare('INSERT INTO queues (id, name, concurrency, is_paused, created_at) VALUES (?, ?, ?, ?, ?)').run(
        q.id,
        `queue-${q.id}`,
        q.concurrency,
        q.is_paused ? 1 : 0,
        created
      );
    }
    const plan: [string, 'high' | 'normal' | 'low'][] = [
      ['a', 'low'], ['a', 'high'], ['b', 'normal'], ['b', 'high'], ['b', 'low'], ['p', 'high'], ['a', 'normal'], ['b', 'normal'],
    ];
    const ids = plan.map(([queue, priority], i) => {
      const created1 = repo.createJob({ queue_id: queue, name: `j${i}`, priority, payload: {}, max_retries: 3 });
      db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run(`2020-01-01T00:00:0${i}.000Z`, created1.id);
      return created1.id;
    });
    db.prepare("UPDATE jobs SET status = 'processing' WHERE id = ?").run(ids[2]);

    const rows = db.prepare('SELECT id, queue_id, status, priority, run_at FROM jobs').all() as any[];
    const claimJobs: ClaimJob[] = rows.map((r) => ({ ...r, priority: weightToPriority(r.priority) }));
    const expected = selectClaimable(queues, claimJobs, new Date().toISOString(), 4);
    const actual = repo.claimEligibleJobs(4).map((j) => j.id);
    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(0);
  });
});

describe('computeMetrics', () => {
  it('matches the SQL metrics on the same rows', () => {
    const db = createDatabase(':memory:');
    initializeSchema(db);
    const now = new Date('2026-10-01T12:00:00.000Z');
    const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
    db.prepare('INSERT INTO queues (id, name, created_at) VALUES (?, ?, ?)').run('q', 'work', iso(0));

    const jobs = [
      ['completed', iso(2)],
      ['completed', iso(8)],
      ['completed', iso(60)],
      ['completed', iso(60 * 20)], // yesterday (UTC)
      ['queued', iso(1)],
      ['processing', iso(1)],
      ['dlq', iso(30)],
    ];
    jobs.forEach(([status, updated], i) => {
      db.prepare(
        `INSERT INTO jobs (id, queue_id, name, status, payload, attempts, max_retries, run_at, created_at, updated_at)
         VALUES (?, 'q', 'n', ?, '{}', 1, 3, ?, ?, ?)`
      ).run(`j${i}`, status, updated, updated, updated);
    });
    const attempts = [
      ['j0', 'completed', 100, iso(2)],
      ['j1', 'completed', 301, iso(8)],
      ['j2', 'failed', null, iso(60)],
      ['j3', 'failed', null, iso(60 * 20)],
      ['j6', 'failed', null, iso(30)],
    ];
    attempts.forEach(([jobId, status, duration, finished], i) => {
      db.prepare(
        `INSERT INTO job_attempts (id, job_id, attempt_number, status, worker_id, started_at, finished_at, duration_ms)
         VALUES (?, ?, 1, ?, 'w', ?, ?, ?)`
      ).run(`a${i}`, jobId, status, finished, finished, duration);
    });

    const fromSql = new MetricsService(db).getMetrics(now);
    const rows = db.prepare('SELECT status, updated_at FROM jobs').all() as any[];
    const attemptRows = db.prepare('SELECT status, duration_ms, started_at, finished_at FROM job_attempts').all() as any[];
    const fromShared = computeMetrics(rows, attemptRows, now);

    expect(fromShared).toEqual(fromSql);
    expect(fromSql).toEqual({
      total_enqueued: 1,
      active_processing: 1,
      completed_today: 3,
      failed_today: 2,
      dlq_count: 1,
      avg_duration_ms: 201,
      throughput_per_minute: 0.2,
    });
  });

  it('returns zeros for an empty system', () => {
    expect(computeMetrics([], [], new Date())).toEqual({
      total_enqueued: 0,
      active_processing: 0,
      completed_today: 0,
      failed_today: 0,
      dlq_count: 0,
      avg_duration_ms: 0,
      throughput_per_minute: 0,
    });
  });
});

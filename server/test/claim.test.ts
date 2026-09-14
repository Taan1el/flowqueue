import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/database.js';
import { initializeSchema } from '../src/db/schema.js';
import { JobRepository } from '../src/repositories/job.repository.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

describe('Queue slot reservations', () => {
  let db: ReturnType<typeof createDatabase>;
  let repo: JobRepository;

  beforeEach(() => {
    db = createDatabase(':memory:');
    initializeSchema(db);
    repo = new JobRepository(db);
    db.prepare('INSERT INTO queues (id, name, concurrency, created_at) VALUES (?, ?, ?, ?)')
      .run('a', 'notifications', 1, new Date().toISOString());
    db.prepare('INSERT INTO queues (id, name, concurrency, created_at) VALUES (?, ?, ?, ?)')
      .run('b', 'exports', 2, new Date().toISOString());
  });

  afterEach(() => db.close());

  function enqueue(queueId = 'a', priority: 'high' | 'normal' | 'low' = 'normal', delay = 0) {
    return repo.createJob({ queue_id: queueId, name: 'task', priority, payload: {}, max_retries: 3, delay_seconds: delay });
  }

  it('caps each queue before applying the overall batch limit', () => {
    const first = enqueue('a', 'high');
    db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', first.id);
    enqueue('a', 'high');
    enqueue('a', 'high');
    const second = enqueue('b');
    const third = enqueue('b');

    const claimed = repo.claimEligibleJobs(3);
    expect(new Set(claimed.map(job => job.id))).toEqual(new Set([first.id, second.id, third.id]));
    expect(claimed.every(job => job.status === 'processing')).toBe(true);
    expect(repo.claimEligibleJobs(3)).toEqual([]);
    repo.completeJob(first.id, {});
    expect(repo.claimEligibleJobs(3)).toHaveLength(1);
  });

  it('subtracts existing reservations and respects reduced concurrency', () => {
    const active = enqueue('b');
    db.prepare("UPDATE jobs SET status = 'processing' WHERE id = ?").run(active.id);
    enqueue('b');
    enqueue('b');
    expect(repo.claimEligibleJobs(10)).toHaveLength(1);
    db.prepare('UPDATE queues SET concurrency = 1 WHERE id = ?').run('b');
    expect(repo.claimEligibleJobs(10)).toEqual([]);
  });

  it('ignores paused and delayed work while preserving priority and due-time order', () => {
    db.prepare('UPDATE queues SET is_paused = 1 WHERE id = ?').run('a');
    enqueue('a', 'high');
    enqueue('b', 'high', 3600);
    enqueue('b', 'low');
    const normal = enqueue('b');
    const high = enqueue('b', 'high');
    expect(repo.claimEligibleJobs(1).map(job => job.id)).toEqual([high.id]);
    expect(repo.claimEligibleJobs(1).map(job => job.id)).toEqual([normal.id]);
  });

  it('selects earlier scheduled jobs first within a priority', () => {
    const later = enqueue('b');
    const earlier = enqueue('b');
    db.prepare('UPDATE jobs SET run_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', earlier.id);
    expect(repo.claimEligibleJobs(2).map(job => job.id)).toEqual([earlier.id, later.id]);
  });

  it('rolls back all reservations if a claim fails and permits a later poll', () => {
    const first = enqueue('b', 'high');
    const second = enqueue('b', 'low');
    db.exec(`CREATE TRIGGER reject_claim BEFORE UPDATE OF status ON jobs
      WHEN OLD.priority = 3 AND NEW.status = 'processing'
      BEGIN SELECT RAISE(ABORT, 'reservation rejected'); END;`);

    expect(() => repo.claimEligibleJobs(2)).toThrow('reservation rejected');
    expect(repo.getJobById(first.id)?.status).toBe('queued');
    expect(repo.getJobById(second.id)?.status).toBe('queued');
    db.exec('DROP TRIGGER reject_claim');
    expect(repo.claimEligibleJobs(2)).toHaveLength(2);
    expect(repo.claimEligibleJobs(2)).toEqual([]);
    repo.completeJob(first.id, {});
    enqueue('b');
    expect(repo.claimEligibleJobs(2)).toHaveLength(1);
  });

  it('shares capacity between database connections and respects a competing writer', () => {
    const directory = mkdtempSync(resolve('.claim-test-'));
    const firstDb = createDatabase(join(directory, 'queue.db'));
    const secondDb = createDatabase(join(directory, 'queue.db'));
    try {
      initializeSchema(firstDb);
      firstDb.prepare('INSERT INTO queues (id, name, concurrency, created_at) VALUES (?, ?, ?, ?)')
        .run('shared', 'shared', 1, new Date().toISOString());
      const firstRepo = new JobRepository(firstDb);
      const secondRepo = new JobRepository(secondDb);
      for (let index = 0; index < 3; index++) {
        firstRepo.createJob({ queue_id: 'shared', name: 'task', priority: 'normal', payload: {}, max_retries: 3 });
      }

      // A failed lock acquisition must not interfere with another connection's transaction.
      secondDb.exec('PRAGMA busy_timeout = 0');
      firstDb.exec('BEGIN IMMEDIATE');
      expect(() => secondRepo.claimEligibleJobs(5)).toThrow(/locked/);
      firstDb.exec('COMMIT');

      const firstClaim = firstRepo.claimEligibleJobs(5);
      expect(firstClaim).toHaveLength(1);
      expect(secondRepo.claimEligibleJobs(5)).toEqual([]);
      firstRepo.completeJob(firstClaim[0].id, {});
      const secondClaim = secondRepo.claimEligibleJobs(5);
      expect(secondClaim).toHaveLength(1);
      expect(secondClaim[0].id).not.toBe(firstClaim[0].id);
      expect(firstRepo.claimEligibleJobs(5)).toEqual([]);
    } finally {
      secondDb.close();
      firstDb.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

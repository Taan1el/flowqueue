import { DatabaseSync } from 'node:sqlite';
import { Queue, UpdateQueueDto } from '../../../shared/types.js';

export interface QueueWithStats extends Queue {
  active_jobs: number;
  queued_jobs: number;
  dlq_jobs: number;
}

export class QueueRepository {
  constructor(private db: DatabaseSync) {}

  getAllQueues(): QueueWithStats[] {
    const query = `
      SELECT 
        q.id,
        q.name,
        q.concurrency,
        q.max_retries,
        q.backoff_base_sec,
        q.is_paused,
        q.created_at,
        SUM(CASE WHEN j.status = 'processing' THEN 1 ELSE 0 END) as active_jobs,
        SUM(CASE WHEN j.status = 'queued' THEN 1 ELSE 0 END) as queued_jobs,
        SUM(CASE WHEN j.status = 'dlq' THEN 1 ELSE 0 END) as dlq_jobs
      FROM queues q
      LEFT JOIN jobs j ON q.id = j.queue_id
      GROUP BY q.id
      ORDER BY q.name ASC;
    `;
    const stmt = this.db.prepare(query);
    const rows = stmt.all() as any[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      concurrency: Number(row.concurrency),
      max_retries: Number(row.max_retries),
      backoff_base_sec: Number(row.backoff_base_sec),
      is_paused: Boolean(row.is_paused),
      created_at: row.created_at,
      active_jobs: Number(row.active_jobs || 0),
      queued_jobs: Number(row.queued_jobs || 0),
      dlq_jobs: Number(row.dlq_jobs || 0),
    }));
  }

  getQueueById(id: string): Queue | null {
    const stmt = this.db.prepare('SELECT * FROM queues WHERE id = ?;');
    const row = stmt.get(id) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      concurrency: Number(row.concurrency),
      max_retries: Number(row.max_retries),
      backoff_base_sec: Number(row.backoff_base_sec),
      is_paused: Boolean(row.is_paused),
      created_at: row.created_at,
    };
  }

  getQueueByName(name: string): Queue | null {
    const stmt = this.db.prepare('SELECT * FROM queues WHERE name = ?;');
    const row = stmt.get(name) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      concurrency: Number(row.concurrency),
      max_retries: Number(row.max_retries),
      backoff_base_sec: Number(row.backoff_base_sec),
      is_paused: Boolean(row.is_paused),
      created_at: row.created_at,
    };
  }

  updateQueue(id: string, updates: UpdateQueueDto): Queue | null {
    const queue = this.getQueueById(id);
    if (!queue) return null;

    const newPaused = updates.is_paused !== undefined ? (updates.is_paused ? 1 : 0) : (queue.is_paused ? 1 : 0);
    const newConcurrency = updates.concurrency ?? queue.concurrency;
    const newMaxRetries = updates.max_retries ?? queue.max_retries;

    const stmt = this.db.prepare(`
      UPDATE queues
      SET is_paused = ?, concurrency = ?, max_retries = ?
      WHERE id = ?;
    `);
    stmt.run(newPaused, newConcurrency, newMaxRetries, id);

    return this.getQueueById(id);
  }
}

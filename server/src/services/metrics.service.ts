import { DatabaseSync } from 'node:sqlite';
import { QueueMetrics } from '../../../shared/types.js';

export class MetricsService {
  constructor(private db: DatabaseSync) {}

  /**
   * Same definitions as computeMetrics in shared/queue-logic.ts: "today" runs
   * from 00:00 UTC, throughput counts jobs completed in the last ten minutes.
   */
  getMetrics(now: Date = new Date()): QueueMetrics {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();

    const jobStats = this.db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as total_enqueued,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as active_processing,
          SUM(CASE WHEN status = 'completed' AND updated_at >= ? THEN 1 ELSE 0 END) as completed_today,
          SUM(CASE WHEN status = 'dlq' THEN 1 ELSE 0 END) as dlq_count,
          SUM(CASE WHEN status = 'completed' AND updated_at >= ? THEN 1 ELSE 0 END) as recently_completed
        FROM jobs;
      `)
      .get(dayStart, tenMinutesAgo) as any;

    const attemptStats = this.db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'failed' AND COALESCE(finished_at, started_at) >= ? THEN 1 ELSE 0 END) as failed_today,
          AVG(CASE WHEN status = 'completed' THEN duration_ms ELSE NULL END) as avg_duration_ms
        FROM job_attempts;
      `)
      .get(dayStart) as any;

    return {
      total_enqueued: Number(jobStats?.total_enqueued || 0),
      active_processing: Number(jobStats?.active_processing || 0),
      completed_today: Number(jobStats?.completed_today || 0),
      failed_today: Number(attemptStats?.failed_today || 0),
      dlq_count: Number(jobStats?.dlq_count || 0),
      avg_duration_ms: Math.round(Number(attemptStats?.avg_duration_ms || 0)),
      throughput_per_minute: Math.round((Number(jobStats?.recently_completed || 0) / 10) * 10) / 10,
    };
  }
}

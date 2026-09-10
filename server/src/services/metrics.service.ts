import { DatabaseSync } from 'node:sqlite';
import { QueueMetrics } from '../../../shared/types.js';

export class MetricsService {
  constructor(private db: DatabaseSync) {}

  getMetrics(): QueueMetrics {
    const jobStatsStmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as total_enqueued,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as active_processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_today,
        SUM(CASE WHEN status = 'dlq' THEN 1 ELSE 0 END) as dlq_count
      FROM jobs;
    `);

    const jobStats = jobStatsStmt.get() as any;

    const attemptStatsStmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_today,
        AVG(CASE WHEN status = 'completed' THEN duration_ms ELSE NULL END) as avg_duration_ms
      FROM job_attempts;
    `);

    const attemptStats = attemptStatsStmt.get() as any;

    // Calculate throughput: completed jobs in last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const throughputStmt = this.db.prepare(`
      SELECT COUNT(*) as completed_count
      FROM jobs
      WHERE status = 'completed' AND updated_at >= ?;
    `);
    const throughputResult = throughputStmt.get(tenMinutesAgo) as { completed_count: number };
    const throughputPerMinute = Math.round(((throughputResult.completed_count || 0) / 10) * 10) / 10;

    return {
      total_enqueued: Number(jobStats?.total_enqueued || 0),
      active_processing: Number(jobStats?.active_processing || 0),
      completed_today: Number(jobStats?.completed_today || 0),
      failed_today: Number(attemptStats?.failed_today || 0),
      dlq_count: Number(jobStats?.dlq_count || 0),
      avg_duration_ms: Math.round(Number(attemptStats?.avg_duration_ms || 0)),
      throughput_per_minute: throughputPerMinute,
    };
  }
}

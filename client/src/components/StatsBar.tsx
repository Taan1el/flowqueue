import React from 'react';
import type { QueueMetrics } from '../../../shared/types.js';
import { formatCount } from '../utils/pluralize.js';

export const StatsBar: React.FC<{ metrics: QueueMetrics | null }> = ({ metrics }) => {
  if (!metrics) return <div className="stats-strip-loading">Loading telemetry.</div>;

  return (
    <div className="stats-strip">
      <div className="stat-cell">
        <span className="stat-label">Queued</span>
        <span className="stat-value">{metrics.total_enqueued}</span>
      </div>
      <div className="stat-cell">
        <span className="stat-label">In flight</span>
        <span className="stat-value">{metrics.active_processing}</span>
      </div>
      <div className="stat-cell">
        <span className="stat-label">Completed today</span>
        <span className="stat-value">{metrics.completed_today}</span>
        <span className="stat-note">{metrics.throughput_per_minute} per min</span>
      </div>
      <div className="stat-cell">
        <span className="stat-label">Dead letters</span>
        <span className={`stat-value${metrics.dlq_count > 0 ? ' is-bad' : ''}`}>{metrics.dlq_count}</span>
        <span className="stat-note">{formatCount(metrics.failed_today, 'failed attempt')} today</span>
      </div>
      <div className="stat-cell">
        <span className="stat-label">Average run time</span>
        <span className="stat-value">{`${metrics.avg_duration_ms} ms`}</span>
      </div>
    </div>
  );
};

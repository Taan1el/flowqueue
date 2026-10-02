import React from 'react';
import type { QueueMetrics } from '../../../shared/types.js';
import { formatCount } from '../utils/pluralize.js';

/** One mono telemetry line under the header: label and value pairs that wrap. */
export const StatsBar: React.FC<{ metrics: QueueMetrics | null }> = ({ metrics }) => {
  if (!metrics) {
    return (
      <div className="ticker">
        <div className="ticker-inner ticker-loading">Loading telemetry.</div>
      </div>
    );
  }

  return (
    <div className="ticker">
      <dl className="ticker-inner">
        <div className="tick">
          <dt>Queued</dt>
          <dd>{metrics.total_enqueued}</dd>
        </div>
        <div className="tick">
          <dt>In flight</dt>
          <dd>{metrics.active_processing}</dd>
        </div>
        <div className="tick">
          <dt>Completed today</dt>
          <dd>{metrics.completed_today}</dd>
          <dd className="tick-note">{metrics.throughput_per_minute} per min</dd>
        </div>
        <div className="tick">
          <dt>Dead letters</dt>
          <dd className={metrics.dlq_count > 0 ? 'is-bad' : undefined}>{metrics.dlq_count}</dd>
          <dd className="tick-note">{formatCount(metrics.failed_today, 'failed attempt')} today</dd>
        </div>
        <div className="tick">
          <dt>Average run time</dt>
          <dd>{`${metrics.avg_duration_ms} ms`}</dd>
        </div>
      </dl>
    </div>
  );
};

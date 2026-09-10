import React from 'react';
import { QueueMetrics } from '../../../shared/types';

interface MetricsBannerProps {
  metrics: QueueMetrics | null;
  loading: boolean;
  onRefresh: () => void;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
}

export const MetricsBanner: React.FC<MetricsBannerProps> = ({
  metrics,
  loading,
  onRefresh,
  autoRefresh,
  onToggleAutoRefresh,
}) => {
  return (
    <header className="metrics-banner">
      <div className="banner-top">
        <div className="brand-group">
          <div className="brand-icon">⚡</div>
          <div>
            <h1 className="brand-title">FlowQueue</h1>
            <p className="brand-subtitle">Distributed Background Task Engine & Webhook Dispatcher</p>
          </div>
        </div>

        <div className="banner-controls">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={onToggleAutoRefresh}
              aria-label="Toggle Live Polling"
            />
            <span className="live-indicator">
              <span className={`pulse-dot ${autoRefresh ? 'active' : ''}`}></span>
              Live Sync (3s)
            </span>
          </label>

          <button
            className="btn btn-secondary btn-sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh telemetry data"
          >
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="stat-cards-grid">
        <div className="stat-card">
          <span className="stat-label">Throughput</span>
          <div className="stat-value text-primary">
            {metrics ? `${metrics.throughput_per_minute}/m` : '--'}
          </div>
          <span className="stat-hint">Jobs completed / min</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Active Workers</span>
          <div className="stat-value text-warning">
            {metrics ? metrics.active_processing : '--'}
          </div>
          <span className="stat-hint">Currently executing</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Queued</span>
          <div className="stat-value text-info">
            {metrics ? metrics.total_enqueued : '--'}
          </div>
          <span className="stat-hint">Pending execution</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Completed</span>
          <div className="stat-value text-success">
            {metrics ? metrics.completed_today : '--'}
          </div>
          <span className="stat-hint">Total succeeded</span>
        </div>

        <div className={`stat-card ${metrics && metrics.dlq_count > 0 ? 'card-alert' : ''}`}>
          <span className="stat-label">Dead-Letter Queue</span>
          <div className={`stat-value ${metrics && metrics.dlq_count > 0 ? 'text-danger' : ''}`}>
            {metrics ? metrics.dlq_count : '--'}
          </div>
          <span className="stat-hint">Failed max attempts</span>
        </div>

        <div className="stat-card">
          <span className="stat-label">Avg Execution</span>
          <div className="stat-value">
            {metrics ? `${metrics.avg_duration_ms} ms` : '--'}
          </div>
          <span className="stat-hint">Latency per job</span>
        </div>
      </div>
    </header>
  );
};

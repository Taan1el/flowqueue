import React from 'react';
import { QueueWithStats } from '../services/api';

interface QueueCardProps {
  queue: QueueWithStats;
  onTogglePause: (queueId: string, currentPaused: boolean) => void;
  onSelectQueue: (queueId: string) => void;
  isSelected: boolean;
}

export const QueueCard: React.FC<QueueCardProps> = ({
  queue,
  onTogglePause,
  onSelectQueue,
  isSelected,
}) => {
  return (
    <div className={`queue-card ${isSelected ? 'selected' : ''} ${queue.is_paused ? 'paused' : ''}`}>
      <div className="queue-header">
        <div className="queue-title-wrap">
          <span className={`status-dot ${queue.is_paused ? 'dot-paused' : 'dot-active'}`} />
          <h3 className="queue-name">{queue.name}</h3>
        </div>
        <span className={`badge ${queue.is_paused ? 'badge-warning' : 'badge-success'}`}>
          {queue.is_paused ? 'Paused' : 'Active'}
        </span>
      </div>

      <div className="queue-specs">
        <span>⚡ Concurrency: <strong>{queue.concurrency}</strong></span>
        <span>↻ Retries: <strong>{queue.max_retries}x</strong></span>
        <span>⏱ Backoff: <strong>{queue.backoff_base_sec}s</strong></span>
      </div>

      <div className="queue-counts">
        <div className="count-pill">
          <span className="count-num text-warning">{queue.active_jobs}</span>
          <span className="count-name">Active</span>
        </div>
        <div className="count-pill">
          <span className="count-num text-info">{queue.queued_jobs}</span>
          <span className="count-name">Queued</span>
        </div>
        <div className="count-pill">
          <span className={`count-num ${queue.dlq_jobs > 0 ? 'text-danger font-bold' : ''}`}>
            {queue.dlq_jobs}
          </span>
          <span className="count-name">DLQ</span>
        </div>
      </div>

      <div className="queue-actions">
        <button
          className="btn btn-secondary btn-xs"
          onClick={() => onSelectQueue(queue.id)}
          aria-label={`Filter jobs by queue ${queue.name}`}
        >
          {isSelected ? 'Viewing Jobs' : 'View Jobs'}
        </button>
        <button
          className={`btn btn-xs ${queue.is_paused ? 'btn-success' : 'btn-outline-warning'}`}
          onClick={() => onTogglePause(queue.id, queue.is_paused)}
          aria-label={queue.is_paused ? `Resume queue ${queue.name}` : `Pause queue ${queue.name}`}
        >
          {queue.is_paused ? '▶ Resume' : '⏸ Pause'}
        </button>
      </div>
    </div>
  );
};

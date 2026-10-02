import React from 'react';
import { Pause, Play } from 'lucide-react';
import type { QueueWithStats } from '../services/index.js';

interface QueueTabsProps {
  queues: QueueWithStats[];
  selectedQueueId: string | null;
  onSelectQueue: (queueId: string) => void;
  onTogglePause: (queueId: string, currentPaused: boolean) => void;
}

/** Vertical queue tabs: name, depth and in-flight work, with pause next to each. */
export const QueueTabs: React.FC<QueueTabsProps> = ({ queues, selectedQueueId, onSelectQueue, onTogglePause }) => {
  if (queues.length === 0) return <p className="list-empty">No queues yet.</p>;

  return (
    <ul className="queue-tabs">
      {queues.map((q) => {
        const percent = q.concurrency > 0 ? Math.min(100, (q.active_jobs / q.concurrency) * 100) : 0;
        const selected = selectedQueueId === q.id;
        return (
          <li key={q.id} className={`queue-tab${selected ? ' is-selected' : ''}`}>
            <button
              className="queue-tab-main"
              onClick={() => onSelectQueue(q.id)}
              aria-pressed={selected}
              aria-label={`${selected ? 'Showing' : 'Show'} jobs of ${q.name}`}
            >
              <span className="queue-tab-name">{q.name}</span>
              <span className="queue-tab-line">
                <span className="status">
                  <span className={`dot ${q.is_paused ? 'dot-paused' : 'dot-active'}`} aria-hidden="true" />
                  {q.is_paused ? 'Paused' : 'Active'}
                </span>
                <span className="queue-tab-depth">{`${q.queued_jobs} queued`}</span>
              </span>
              <span className="meter-cell">
                <span className="mono">{`${q.active_jobs} / ${q.concurrency}`}</span>
                <span
                  className="meter"
                  role="meter"
                  aria-label={`${q.name} capacity in use`}
                  aria-valuenow={q.active_jobs}
                  aria-valuemin={0}
                  aria-valuemax={q.concurrency}
                >
                  <span className="meter-fill" style={{ width: `${percent}%` }} />
                </span>
              </span>
            </button>
            <div className="queue-tab-foot">
              <span className="queue-tab-facts">
                <span className={q.dlq_jobs > 0 ? 'text-bad' : undefined}>{`${q.dlq_jobs} dead`}</span>
                <span>{`${q.max_retries} tries, ${q.backoff_base_sec} s backoff`}</span>
              </span>
              <button
                className="btn btn-secondary btn-compact"
                onClick={() => onTogglePause(q.id, q.is_paused)}
                aria-label={q.is_paused ? `Resume queue ${q.name}` : `Pause queue ${q.name}`}
              >
                {q.is_paused ? (
                  <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <Pause size={14} strokeWidth={1.75} aria-hidden="true" />
                )}
                {q.is_paused ? 'Resume' : 'Pause'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

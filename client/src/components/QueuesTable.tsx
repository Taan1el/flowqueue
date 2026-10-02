import React from 'react';
import { Pause, Play } from 'lucide-react';
import type { QueueWithStats } from '../services/index.js';

interface QueuesTableProps {
  queues: QueueWithStats[];
  selectedQueueId: string | null;
  onSelectQueue: (queueId: string) => void;
  onTogglePause: (queueId: string, currentPaused: boolean) => void;
}

export const QueuesTable: React.FC<QueuesTableProps> = ({ queues, selectedQueueId, onSelectQueue, onTogglePause }) => (
  <div className="table-wrapper">
    <table className="data-table">
      <thead>
        <tr>
          <th>Queue</th>
          <th>In flight / capacity</th>
          <th>Queued</th>
          <th>Dead letters</th>
          <th>Max attempts</th>
          <th>Backoff base</th>
          <th className="actions">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {queues.length === 0 ? (
          <tr>
            <td colSpan={7} className="cell-empty">
              No queues yet.
            </td>
          </tr>
        ) : (
          queues.map((q) => {
            const percent = q.concurrency > 0 ? Math.min(100, (q.active_jobs / q.concurrency) * 100) : 0;
            const selected = selectedQueueId === q.id;
            return (
              <tr key={q.id} className={selected ? 'is-selected' : undefined}>
                <td>
                  <div className="cell-queue-state">
                    <span className="mono">{q.name}</span>
                    <span className="status">
                      <span className={`dot ${q.is_paused ? 'dot-paused' : 'dot-active'}`} aria-hidden="true" />
                      {q.is_paused ? 'Paused' : 'Active'}
                    </span>
                  </div>
                </td>
                <td>
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
                </td>
                <td className="num">{q.queued_jobs}</td>
                <td className={`num${q.dlq_jobs > 0 ? ' text-bad' : ''}`}>{q.dlq_jobs}</td>
                <td className="num">{q.max_retries}</td>
                <td className="num">{`${q.backoff_base_sec} s`}</td>
                <td className="actions">
                  <button
                    className="btn btn-secondary btn-compact"
                    onClick={() => onSelectQueue(q.id)}
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Showing' : 'Show'} jobs of ${q.name}`}
                  >
                    {selected ? 'Showing jobs' : 'Show jobs'}
                  </button>
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
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  </div>
);

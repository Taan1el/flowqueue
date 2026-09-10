import React from 'react';
import { Job, JobPriority, JobStatus } from '../../../shared/types';
import { QueueWithStats } from '../services/api';

interface JobListProps {
  jobs: Job[];
  queues: QueueWithStats[];
  selectedQueueId: string | null;
  onSelectQueueId: (queueId: string | null) => void;
  statusFilter: JobStatus | null;
  onSelectStatusFilter: (status: JobStatus | null) => void;
  priorityFilter: JobPriority | null;
  onSelectPriorityFilter: (priority: JobPriority | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onInspectJob: (jobId: string) => void;
  onReplayJob: (jobId: string) => void;
}

const STATUS_FILTERS: (JobStatus | null)[] = [null, 'queued', 'processing', 'completed', 'failed', 'dlq'];

export const JobList: React.FC<JobListProps> = ({
  jobs,
  queues,
  selectedQueueId,
  onSelectQueueId,
  statusFilter,
  onSelectStatusFilter,
  priorityFilter,
  onSelectPriorityFilter,
  searchQuery,
  onSearchChange,
  onInspectJob,
  onReplayJob,
}) => {
  return (
    <div className="job-list-section">
      <div className="list-toolbar">
        <div className="filter-group">
          <label htmlFor="filter-queue-select" className="sr-only">Filter by queue</label>
          <select
            id="filter-queue-select"
            value={selectedQueueId || ''}
            onChange={(e) => onSelectQueueId(e.target.value || null)}
            className="form-input select-sm"
          >
            <option value="">All Queues ({queues.length})</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name} ({q.queued_jobs + q.active_jobs + q.dlq_jobs} items)
              </option>
            ))}
          </select>

          <label htmlFor="filter-priority-select" className="sr-only">Filter by priority</label>
          <select
            id="filter-priority-select"
            value={priorityFilter || ''}
            onChange={(e) => onSelectPriorityFilter((e.target.value as JobPriority) || null)}
            className="form-input select-sm"
          >
            <option value="">All Priorities</option>
            <option value="high">🔴 High</option>
            <option value="normal">🟡 Normal</option>
            <option value="low">🟢 Low</option>
          </select>

          <input
            type="search"
            placeholder="Search by job name, payload, or ID..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="form-input search-input"
            aria-label="Search jobs"
          />
        </div>

        <div className="status-pills" role="tablist" aria-label="Filter jobs by status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s || 'all'}
              className={`pill-btn ${statusFilter === s ? 'active' : ''}`}
              onClick={() => onSelectStatusFilter(s)}
              role="tab"
              aria-selected={statusFilter === s}
            >
              {s ? s.toUpperCase() : 'ALL STATUS'}
            </button>
          ))}
        </div>
      </div>

      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Queue</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Scheduled / Run</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  No background jobs matching current filters. Click "Enqueue Task" to launch a new job!
                </td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => onInspectJob(job.id)}
                  className="clickable-row"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onInspectJob(job.id);
                  }}
                >
                  <td>
                    <div className="job-name-cell">
                      <span className="job-title">{job.name}</span>
                      <span className="job-subid font-mono">{job.id.substring(0, 8)}...</span>
                    </div>
                  </td>
                  <td>
                    <span className="queue-badge">{job.queue_name || 'default'}</span>
                  </td>
                  <td>
                    <span className={`priority-badge priority-${job.priority}`}>
                      {job.priority}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${job.status}`}>
                      {job.status === 'processing' && <span className="spinner-micro" />}
                      {job.status.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className="attempts-cell">
                      {job.attempts} / {job.max_retries}
                    </span>
                  </td>
                  <td className="text-xs text-muted">
                    {new Date(job.run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td>
                    <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-secondary btn-xs"
                        onClick={() => onInspectJob(job.id)}
                        aria-label={`Inspect job ${job.name}`}
                      >
                        Inspect
                      </button>
                      {job.status === 'dlq' && (
                        <button
                          className="btn btn-warning btn-xs"
                          onClick={() => onReplayJob(job.id)}
                          aria-label={`Replay DLQ job ${job.name}`}
                        >
                          ↻ Replay
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

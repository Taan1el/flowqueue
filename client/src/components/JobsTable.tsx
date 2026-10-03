import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { Job, JobPriority, JobStatus } from '../../../shared/types.js';
import type { QueueWithStats } from '../services/index.js';
import { StatusDot, STATUS_LABELS } from './StatusDot.js';
import { formatTime, shortId } from '../utils/format.js';

interface JobsTableProps {
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

const STATUS_FILTERS: (JobStatus | null)[] = [null, 'queued', 'processing', 'completed', 'dlq'];

export const JobsTable: React.FC<JobsTableProps> = ({
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
}) => (
  <div>
    <div className="toolbar">
      <div className="field">
        <label className="field-label" htmlFor="filter-queue">
          Queue
        </label>
        <select id="filter-queue" value={selectedQueueId || ''} onChange={(e) => onSelectQueueId(e.target.value || null)}>
          <option value="">All queues</option>
          {queues.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="filter-priority">
          Priority
        </label>
        <select
          id="filter-priority"
          value={priorityFilter || ''}
          onChange={(e) => onSelectPriorityFilter((e.target.value as JobPriority) || null)}
        >
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div className="field grow">
        <label className="field-label" htmlFor="search-jobs">
          Search
        </label>
        <input
          id="search-jobs"
          type="search"
          placeholder="Job name, payload or id"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>

    <div className="toolbar">
      <fieldset className="segmented">
        <legend className="sr-only">Filter jobs by status</legend>
        {STATUS_FILTERS.map((s) => (
          <button key={s || 'all'} type="button" aria-pressed={statusFilter === s} onClick={() => onSelectStatusFilter(s)}>
            {s ? STATUS_LABELS[s] : 'All'}
          </button>
        ))}
      </fieldset>
    </div>

    <div className="table-wrapper" role="region" tabIndex={0} aria-label="Jobs table">
      <table className="data-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Queue</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Runs at</th>
            <th className="actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={6} className="cell-empty">
                No jobs match these filters.
              </td>
            </tr>
          ) : (
            jobs.map((job) => (
              <tr key={job.id} onClick={() => onInspectJob(job.id)}>
                <td>
                  <button
                    className="name-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspectJob(job.id);
                    }}
                    aria-label={`Inspect job ${job.name}`}
                  >
                    <span className="primary">{job.name}</span>
                    <span className="secondary">{`${shortId(job.id)}, ${job.priority}`}</span>
                  </button>
                </td>
                <td className="num">{job.queue_name || '-'}</td>
                <td>
                  <StatusDot status={job.status} />
                </td>
                <td className="num">{`${job.attempts} / ${job.max_retries}`}</td>
                <td className="num">{formatTime(job.run_at)}</td>
                <td className="actions">
                  {job.status === 'dlq' && (
                    <button
                      className="btn btn-secondary btn-compact"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReplayJob(job.id);
                      }}
                      aria-label={`Replay dead letter ${job.name}`}
                    >
                      <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
                      Replay
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

import React from 'react';
import { RotateCcw } from 'lucide-react';
import type { Job } from '../../../shared/types.js';
import { formatTime } from '../utils/format.js';

interface DeadLettersProps {
  jobs: Job[];
  onInspectJob: (jobId: string) => void;
  onReplayJob: (jobId: string) => void;
}

export const DeadLetters: React.FC<DeadLettersProps> = ({ jobs, onInspectJob, onReplayJob }) => (
  <ul className="dense-list">
    {jobs.length === 0 && <li className="list-empty">No dead letters. Every job has finished or is still being retried.</li>}
    {jobs.map((job) => (
      <li key={job.id} className="dead-letter">
        <div className="dead-letter-head">
          <span className="dead-letter-name">{job.name}</span>
          <span className="dead-letter-meta">
            {`${job.queue_name || '-'} · ${job.attempts} / ${job.max_retries} attempts · ${formatTime(job.updated_at)}`}
          </span>
        </div>
        <p className="dead-letter-error">{job.error || 'No error recorded.'}</p>
        <div className="dead-letter-actions">
          <button
            className="btn btn-secondary btn-compact"
            onClick={() => onInspectJob(job.id)}
            aria-label={`Inspect dead letter ${job.name}`}
          >
            Inspect
          </button>
          <button
            className="btn btn-secondary btn-compact"
            onClick={() => onReplayJob(job.id)}
            aria-label={`Replay dead letter ${job.name} from the list`}
          >
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            Replay
          </button>
        </div>
      </li>
    ))}
  </ul>
);

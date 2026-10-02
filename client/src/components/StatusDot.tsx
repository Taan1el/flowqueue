import React from 'react';
import type { JobStatus } from '../../../shared/types.js';

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Queued',
  processing: 'Running',
  completed: 'Completed',
  dlq: 'Dead letter',
};

export const StatusDot: React.FC<{ status: JobStatus }> = ({ status }) => (
  <span className="status">
    <span className={`dot dot-${status}`} aria-hidden="true" />
    {STATUS_LABELS[status]}
  </span>
);

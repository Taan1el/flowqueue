import React from 'react';
import type { Job, WebhookDelivery } from '../../../shared/types.js';
import { formatTime } from '../utils/format.js';

interface EventLogProps {
  jobs: Job[];
  deliveries: WebhookDelivery[];
}

interface LogLine {
  id: string;
  at: string;
  kind: string;
  text: string;
  bad: boolean;
}

const JOB_VERBS: Record<Job['status'], string> = {
  queued: 'queued',
  processing: 'running',
  completed: 'done',
  dlq: 'dead',
};

export function buildLog(jobs: Job[], deliveries: WebhookDelivery[]): LogLine[] {
  const lines: LogLine[] = [
    ...jobs.map<LogLine>((j) => ({
      id: `job-${j.id}`,
      at: j.updated_at,
      kind: JOB_VERBS[j.status],
      text: `${j.name} on ${j.queue_name || 'unknown'}`,
      bad: j.status === 'dlq',
    })),
    ...deliveries.map<LogLine>((d) => ({
      id: `hook-${d.id}`,
      at: d.delivered_at,
      kind: 'hook',
      text: `${d.event} to ${d.subscription_name || 'endpoint'}, ${d.status_code}`,
      bad: d.status_code >= 400,
    })),
  ];
  return lines.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 40);
}

/** Newest-first event feed built from job state changes and webhook deliveries. */
export const EventLog: React.FC<EventLogProps> = ({ jobs, deliveries }) => {
  const lines = buildLog(jobs, deliveries);
  return (
    <ol className="event-log" tabIndex={0} aria-label="Event log, newest first">
      {lines.length === 0 && <li className="list-empty">No events yet.</li>}
      {lines.map((l) => (
        <li key={l.id} className={`event${l.bad ? ' is-bad' : ''}`}>
          <time>{formatTime(l.at)}</time>
          <span className="event-kind">{l.kind}</span>
          <span className="event-text">{l.text}</span>
        </li>
      ))}
    </ol>
  );
};

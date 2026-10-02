import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { api } from '../services/index.js';
import type { JobWithAttempts } from '../services/index.js';
import { Breakable } from './Breakable.js';
import { StatusDot } from './StatusDot.js';
import { formatDuration, formatTime } from '../utils/format.js';

interface JobInspectorProps {
  jobId: string | null;
  onClose: () => void;
  onJobUpdated: () => void;
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

export const JobInspector: React.FC<JobInspectorProps> = ({ jobId, onClose, onJobUpdated }) => {
  const [job, setJob] = useState<JobWithAttempts | null>(null);
  const [loading, setLoading] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    let current = true;
    setLoading(true);
    setError(null);
    api
      .getJob(jobId)
      .then((data) => {
        if (current) setJob(data);
      })
      .catch((err) => {
        if (current) setError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [jobId]);

  // Move focus into the dialog, give it back when it closes, close on Escape
  // and keep Tab inside the panel.
  useEffect(() => {
    if (!jobId) return;
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [jobId]);

  const replay = async () => {
    if (!job) return;
    setReplaying(true);
    setError(null);
    try {
      await api.retryJob(job.id);
      onJobUpdated();
      setJob(await api.getJob(job.id));
    } catch (err: any) {
      setError(`Replay failed: ${err.message}`);
    } finally {
      setReplaying(false);
    }
  };

  if (!jobId) return null;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inspector-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <h2 id="inspector-title" className="drawer-title">
            {job ? job.name : 'Loading job'}
          </h2>
          <button className="icon-btn" ref={closeRef} onClick={onClose} aria-label="Close job inspector">
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {loading && <p>Loading job.</p>}
        {error && <output className="form-feedback is-error">{error}</output>}

        {job && (
          <>
            <dl className="facts">
              <div className="wide">
                <dt>Job id</dt>
                <dd className="mono">
                  <Breakable text={job.id} />
                </dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd className="mono">{job.queue_name || job.queue_id}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusDot status={job.status} />
                </dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>{job.priority}</dd>
              </div>
              <div>
                <dt>Attempts</dt>
                <dd className="mono">{`${job.attempts} / ${job.max_retries}`}</dd>
              </div>
              <div>
                <dt>Runs at</dt>
                <dd className="mono">{formatTime(job.run_at)}</dd>
              </div>
              {job.idempotency_key && (
                <div>
                  <dt>Idempotency key</dt>
                  <dd className="mono">
                    <Breakable text={job.idempotency_key} />
                  </dd>
                </div>
              )}
            </dl>

            {job.error && (
              <div className="drawer-section">
                <h3>Last error</h3>
                <pre className="code-box mono">{job.error}</pre>
              </div>
            )}

            {job.status === 'dlq' && (
              <div className="notice-bad">
                <p>This job used all of its attempts. Replaying it grants one more run.</p>
                <button className="btn btn-primary" onClick={replay} disabled={replaying}>
                  <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                  {replaying ? 'Replaying' : 'Replay job'}
                </button>
              </div>
            )}

            <div className="drawer-section">
              <h3>Payload</h3>
              <pre className="code-box mono">{JSON.stringify(job.payload, null, 2)}</pre>
            </div>

            {job.result && (
              <div className="drawer-section">
                <h3>Result</h3>
                <pre className="code-box mono">{JSON.stringify(job.result, null, 2)}</pre>
              </div>
            )}

            <div className="drawer-section">
              <h3>{`Attempts (${job.attempts_list?.length || 0})`}</h3>
              {job.attempts_list && job.attempts_list.length > 0 ? (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Result</th>
                        <th>Worker</th>
                        <th>Started</th>
                        <th>Duration</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.attempts_list.map((att) => (
                        <tr key={att.id}>
                          <td className="num">{att.attempt_number}</td>
                          <td>{att.status === 'failed' ? 'Failed' : att.status === 'completed' ? 'Completed' : 'Running'}</td>
                          <td className="num">{att.worker_id}</td>
                          <td className="num">{formatTime(att.started_at)}</td>
                          <td className="num">{formatDuration(att.duration_ms)}</td>
                          <td>{att.error || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No attempts yet. The job is waiting for a worker.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

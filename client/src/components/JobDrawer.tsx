import React, { useEffect, useState } from 'react';
import { api, JobWithAttempts } from '../services/api';

interface JobDrawerProps {
  jobId: string | null;
  onClose: () => void;
  onJobUpdated: () => void;
}

export const JobDrawer: React.FC<JobDrawerProps> = ({ jobId, onClose, onJobUpdated }) => {
  const [job, setJob] = useState<JobWithAttempts | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    api
      .getJob(jobId)
      .then((data) => {
        if (isMounted) setJob(data);
      })
      .catch((err) => {
        if (isMounted) setError(err.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [jobId]);

  const handleRetry = async () => {
    if (!job) return;
    setRetrying(true);
    try {
      await api.retryJob(job.id);
      onJobUpdated();
      // Reload job details
      const refreshed = await api.getJob(job.id);
      setJob(refreshed);
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    } finally {
      setRetrying(false);
    }
  };

  if (!jobId) return null;

  return (
    <div className="drawer-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <span className="drawer-pretitle">Job Inspector</span>
            <h2 id="drawer-title" className="drawer-title">
              {job ? job.name : 'Loading...'}
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close Job Inspector">
            ✕
          </button>
        </div>

        {loading && <div className="loading-state">Loading job execution traces...</div>}
        {error && <div className="error-state">Failed to load job: {error}</div>}

        {job && (
          <div className="drawer-body">
            <div className="job-meta-grid">
              <div className="meta-item">
                <span className="meta-label">Job ID</span>
                <span className="meta-value font-mono">{job.id}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Queue</span>
                <span className="meta-value">{job.queue_name || job.queue_id}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Status</span>
                <span className={`badge badge-${job.status}`}>{job.status.toUpperCase()}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Priority</span>
                <span className={`priority-badge priority-${job.priority}`}>{job.priority.toUpperCase()}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Attempts</span>
                <span className="meta-value">
                  {job.attempts} / {job.max_retries}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Next Scheduled Run</span>
                <span className="meta-value">{new Date(job.run_at).toLocaleTimeString()}</span>
              </div>
            </div>

            {job.idempotency_key && (
              <div className="idempotency-box">
                <span className="meta-label">Idempotency Key:</span>
                <code className="font-mono">{job.idempotency_key}</code>
              </div>
            )}

            {job.error && (
              <div className="error-box">
                <span className="error-title">⚠️ Execution Error</span>
                <pre className="error-message">{job.error}</pre>
              </div>
            )}

            {job.status === 'dlq' && (
              <div className="dlq-banner">
                <div className="dlq-text">
                  <strong>Dead-Letter Queue Boundary Reached:</strong> This task exceeded max retries.
                  Inspect the payload or downstream dependencies and replay whenever ready.
                </div>
                <button
                  className="btn btn-warning"
                  onClick={handleRetry}
                  disabled={retrying}
                >
                  {retrying ? 'Replaying...' : '↻ Replay Job from DLQ'}
                </button>
              </div>
            )}

            <div className="section-title">Payload (JSON)</div>
            <pre className="code-box font-mono">{JSON.stringify(job.payload, null, 2)}</pre>

            {job.result && (
              <>
                <div className="section-title">Execution Result</div>
                <pre className="code-box font-mono result-box">{JSON.stringify(job.result, null, 2)}</pre>
              </>
            )}

            <div className="section-title">Execution Attempt History ({job.attempts_list?.length || 0})</div>
            {job.attempts_list && job.attempts_list.length > 0 ? (
              <div className="attempts-table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Status</th>
                      <th>Worker</th>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.attempts_list.map((att) => (
                      <tr key={att.id}>
                        <td><strong>#{att.attempt_number}</strong></td>
                        <td>
                          <span className={`badge badge-${att.status}`}>{att.status}</span>
                        </td>
                        <td className="font-mono text-xs">{att.worker_id}</td>
                        <td className="text-xs">{new Date(att.started_at).toLocaleTimeString()}</td>
                        <td>{att.duration_ms !== null ? `${att.duration_ms} ms` : '--'}</td>
                        <td className="text-xs text-danger">{att.error || 'None'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-subtext">No attempts executed yet. Job is awaiting worker pickup.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

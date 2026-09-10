import React, { useState } from 'react';
import { api, QueueWithStats } from '../services/api';
import { JobPriority } from '../../../shared/types';

interface EnqueueJobModalProps {
  queues: QueueWithStats[];
  isOpen: boolean;
  onClose: () => void;
  onJobEnqueued: () => void;
}

const PRESETS = [
  {
    label: '📧 Welcome Email',
    queue: 'notifications',
    name: 'send_welcome_email',
    priority: 'normal' as JobPriority,
    payload: { userId: 'usr_new_901', email: 'applicant@example.com', template: 'onboarding_v2' },
  },
  {
    label: '💳 Stripe Charge Sync',
    queue: 'billing-webhooks',
    name: 'reconcile_stripe_charge',
    priority: 'high' as JobPriority,
    payload: { chargeId: 'ch_4Nx992', amountCents: 19900, currency: 'EUR' },
  },
  {
    label: '📊 Analytics PDF Export',
    queue: 'heavy-reports',
    name: 'generate_monthly_analytics_pdf',
    priority: 'low' as JobPriority,
    payload: { orgId: 'org_881', month: '2026-09', format: 'pdf' },
  },
  {
    label: '💥 Simulated Failure & DLQ',
    queue: 'data-sync',
    name: 'sync_thirdparty_api',
    priority: 'normal' as JobPriority,
    payload: { should_fail: true, error_message: 'Gateway 504: Downstream vendor partner unreachable' },
  },
];

export const EnqueueJobModal: React.FC<EnqueueJobModalProps> = ({
  queues,
  isOpen,
  onClose,
  onJobEnqueued,
}) => {
  const [queueName, setQueueName] = useState(queues[0]?.name || 'notifications');
  const [jobName, setJobName] = useState('send_welcome_email');
  const [priority, setPriority] = useState<JobPriority>('normal');
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [payloadStr, setPayloadStr] = useState(
    JSON.stringify({ userId: 'usr_123', email: 'dev@example.com' }, null, 2)
  );
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleApplyPreset = (p: (typeof PRESETS)[0]) => {
    setQueueName(p.queue);
    setJobName(p.name);
    setPriority(p.priority);
    setPayloadStr(JSON.stringify(p.payload, null, 2));
  };

  const handleGenerateKey = () => {
    const randomKey = `idem_${Math.random().toString(36).substring(2, 11)}`;
    setIdempotencyKey(randomKey);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFeedback(null);

    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(payloadStr);
    } catch {
      setFeedback('Error: Payload must be valid JSON');
      setLoading(false);
      return;
    }

    try {
      const res = await api.enqueueJob({
        queue_name: queueName,
        name: jobName,
        priority,
        delay_seconds: delaySeconds > 0 ? delaySeconds : undefined,
        idempotency_key: idempotencyKey.trim() ? idempotencyKey.trim() : undefined,
        payload: parsedPayload,
      });

      if (res.duplicate) {
        setFeedback(`Notice: Job with idempotency key already existed. Returned existing Job (${res.job.id}).`);
      } else {
        setFeedback(`Success: Job enqueued with ID ${res.job.id}!`);
      }

      onJobEnqueued();
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setFeedback(`Failed to enqueue job: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">Enqueue Background Task</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close Enqueue Modal">✕</button>
        </div>

        <div className="presets-bar">
          <span className="preset-label">Quick Presets:</span>
          <div className="preset-buttons">
            {PRESETS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                className="btn btn-preset btn-xs"
                onClick={() => handleApplyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <div className="form-group flex-1">
              <label htmlFor="queue-select">Target Queue</label>
              <select
                id="queue-select"
                value={queueName}
                onChange={(e) => setQueueName(e.target.value)}
                className="form-input"
              >
                {queues.map((q) => (
                  <option key={q.id} value={q.name}>
                    {q.name} ({q.is_paused ? 'Paused' : 'Active'})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group flex-1">
              <label htmlFor="job-priority">Priority</label>
              <select
                id="job-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as JobPriority)}
                className="form-input"
              >
                <option value="high">🔴 High (Priority 1)</option>
                <option value="normal">🟡 Normal (Priority 2)</option>
                <option value="low">🟢 Low (Priority 3)</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="job-name">Task Name</label>
            <input
              id="job-name"
              type="text"
              value={jobName}
              onChange={(e) => setJobName(e.target.value)}
              required
              className="form-input"
              placeholder="e.g. send_welcome_email"
            />
          </div>

          <div className="form-row">
            <div className="form-group flex-1">
              <label htmlFor="delay-slider">
                Execution Delay: <strong>{delaySeconds}s</strong>
              </label>
              <input
                id="delay-slider"
                type="range"
                min="0"
                max="60"
                step="5"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(Number(e.target.value))}
                className="form-slider"
              />
            </div>

            <div className="form-group flex-1">
              <div className="label-with-action">
                <label htmlFor="idempotency-key">Idempotency Key (Optional)</label>
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleGenerateKey}
                >
                  Generate
                </button>
              </div>
              <input
                id="idempotency-key"
                type="text"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                className="form-input font-mono"
                placeholder="e.g. idem_user_992"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="job-payload">Payload (JSON)</label>
            <textarea
              id="job-payload"
              rows={4}
              value={payloadStr}
              onChange={(e) => setPayloadStr(e.target.value)}
              className="form-textarea font-mono"
              required
            />
          </div>

          {feedback && (
            <div className={`alert-box ${feedback.startsWith('Success') ? 'alert-success' : 'alert-warning'}`}>
              {feedback}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Submitting...' : '⚡ Enqueue Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

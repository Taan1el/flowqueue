import React, { forwardRef, useState } from 'react';
import { api } from '../services/index.js';
import type { QueueWithStats } from '../services/index.js';
import type { JobPriority } from '../../../shared/types.js';

interface EnqueueFormProps {
  queues: QueueWithStats[];
  onJobEnqueued: () => void;
}

export const PRESETS = [
  {
    label: 'Welcome email',
    queue: 'notifications',
    name: 'send_welcome_email',
    priority: 'normal' as JobPriority,
    payload: { userId: 'usr_new_901', email: 'new.user@example.com', template: 'onboarding_v2' },
  },
  {
    label: 'Stripe charge sync',
    queue: 'billing-webhooks',
    name: 'reconcile_stripe_charge',
    priority: 'high' as JobPriority,
    payload: { chargeId: 'ch_4Nx992', amountCents: 19900, currency: 'EUR' },
  },
  {
    label: 'Analytics PDF export',
    queue: 'heavy-reports',
    name: 'generate_monthly_analytics_pdf',
    priority: 'low' as JobPriority,
    payload: { orgId: 'org_881', month: '2026-09', format: 'pdf' },
  },
  {
    label: 'Failing job (ends in dead letters)',
    queue: 'data-sync',
    name: 'sync_thirdparty_api',
    priority: 'normal' as JobPriority,
    payload: { should_fail: true, error_message: 'Gateway 504: vendor endpoint unreachable' },
  },
];

export const EnqueueForm = forwardRef<HTMLSelectElement, EnqueueFormProps>(({ queues, onJobEnqueued }, queueRef) => {
  const [queueName, setQueueName] = useState('');
  const [jobName, setJobName] = useState('send_welcome_email');
  const [priority, setPriority] = useState<JobPriority>('normal');
  const [delaySeconds, setDelaySeconds] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [payloadStr, setPayloadStr] = useState(JSON.stringify({ userId: 'usr_123', email: 'dev@example.com' }, null, 2));
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // Until the user picks a queue, the first one in the list is the target.
  const targetQueue = queueName || queues[0]?.name || '';

  const applyPreset = (index: string) => {
    const p = PRESETS[Number(index)];
    if (!p) return;
    setQueueName(p.queue);
    setJobName(p.name);
    setPriority(p.priority);
    setPayloadStr(JSON.stringify(p.payload, null, 2));
  };

  const generateKey = () => setIdempotencyKey(`idem_${Math.random().toString(36).substring(2, 11)}`);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    let parsedPayload: Record<string, unknown>;
    try {
      parsedPayload = JSON.parse(payloadStr);
    } catch {
      setFeedback({ ok: false, text: 'Payload must be valid JSON.' });
      return;
    }

    setLoading(true);
    try {
      const res = await api.enqueueJob({
        queue_name: targetQueue,
        name: jobName,
        priority,
        delay_seconds: delaySeconds > 0 ? delaySeconds : undefined,
        idempotency_key: idempotencyKey.trim() ? idempotencyKey.trim() : undefined,
        payload: parsedPayload,
      });
      setFeedback({
        ok: true,
        text: res.duplicate
          ? `A job with this idempotency key already exists: ${res.job.id}. Nothing was added.`
          : `Enqueued job ${res.job.id}.`,
      });
      onJobEnqueued();
    } catch (err: any) {
      setFeedback({ ok: false, text: `Could not enqueue: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="stack-form" onSubmit={handleSubmit} id="enqueue-form" aria-labelledby="enqueue-heading">
      <h3 className="panel-heading" id="enqueue-heading">
        Enqueue a job
      </h3>

      <div className="field">
        <label className="field-label" htmlFor="preset">
          Start from
        </label>
        <select id="preset" defaultValue="" onChange={(e) => applyPreset(e.target.value)}>
          <option value="">Custom job</option>
          {PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="queue-select">
          Queue
        </label>
        <select id="queue-select" ref={queueRef} value={targetQueue} onChange={(e) => setQueueName(e.target.value)}>
          {queues.map((q) => (
            <option key={q.id} value={q.name}>
              {q.is_paused ? `${q.name} (paused)` : q.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="job-priority">
          Priority
        </label>
        <select id="job-priority" value={priority} onChange={(e) => setPriority(e.target.value as JobPriority)}>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="job-name">
          Job name
        </label>
        <input
          id="job-name"
          type="text"
          value={jobName}
          onChange={(e) => setJobName(e.target.value)}
          required
          placeholder="send_welcome_email"
        />
      </div>

      <div className="field">
        <div className="field-row">
          <label className="field-label" htmlFor="delay-slider">
            Delay
          </label>
          <span className="field-value">{`${delaySeconds} s`}</span>
        </div>
        <input
          id="delay-slider"
          type="range"
          min="0"
          max="60"
          step="5"
          value={delaySeconds}
          onChange={(e) => setDelaySeconds(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="idempotency-key">
          Idempotency key (optional)
        </label>
        <div className="input-group">
          <input
            id="idempotency-key"
            type="text"
            className="mono"
            value={idempotencyKey}
            onChange={(e) => setIdempotencyKey(e.target.value)}
            placeholder="idem_user_992"
          />
          <button type="button" className="btn btn-secondary btn-compact" onClick={generateKey}>
            Generate
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="job-payload">
          Payload (JSON)
        </label>
        <textarea id="job-payload" rows={5} value={payloadStr} onChange={(e) => setPayloadStr(e.target.value)} required />
      </div>

      {feedback && (
        <output className={`form-feedback${feedback.ok ? '' : ' is-error'}`}>{feedback.text}</output>
      )}

      <button type="submit" className="btn btn-primary" disabled={loading || !targetQueue}>
        {loading ? 'Enqueueing' : 'Enqueue job'}
      </button>
    </form>
  );
});

EnqueueForm.displayName = 'EnqueueForm';

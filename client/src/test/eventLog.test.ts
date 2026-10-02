import { describe, it, expect } from 'vitest';
import { buildLog } from '../components/EventLog.js';
import type { Job, WebhookDelivery } from '../../../shared/types.js';

const job = (over: Partial<Job>): Job => ({
  id: 'j1',
  queue_id: 'q1',
  queue_name: 'mail',
  name: 'send_email',
  priority: 'normal',
  status: 'completed',
  payload: {},
  attempts: 1,
  max_retries: 3,
  run_at: '2026-01-01T10:00:00Z',
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:05Z',
  ...over,
});

const delivery = (over: Partial<WebhookDelivery>): WebhookDelivery => ({
  id: 'd1',
  subscription_id: 's1',
  subscription_name: 'Sink',
  event: 'job.completed',
  payload: {},
  status_code: 200,
  signature: 'sha256=x',
  duration_ms: 10,
  delivered_at: '2026-01-01T10:00:09Z',
  ...over,
});

describe('buildLog', () => {
  it('merges jobs and deliveries newest first and flags failures', () => {
    const lines = buildLog(
      [job({}), job({ id: 'j2', status: 'dlq', updated_at: '2026-01-01T10:00:12Z' })],
      [delivery({}), delivery({ id: 'd2', status_code: 502, delivered_at: '2026-01-01T10:00:20Z' })]
    );
    expect(lines.map((l) => l.id)).toEqual(['hook-d2', 'job-j2', 'hook-d1', 'job-j1']);
    expect(lines.filter((l) => l.bad).map((l) => l.id)).toEqual(['hook-d2', 'job-j2']);
    expect(lines[3].text).toBe('send_email on mail');
  });

  it('keeps at most 40 lines', () => {
    const many = Array.from({ length: 60 }, (_, i) => job({ id: `j${i}` }));
    expect(buildLog(many, [])).toHaveLength(40);
  });
});

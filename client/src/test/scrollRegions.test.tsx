import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App.js';
import { api } from '../services/api.js';
import type { Job, QueueMetrics } from '../../../shared/types.js';

vi.mock('../services/api.js', () => ({
  api: {
    getMetrics: vi.fn(),
    getQueues: vi.fn(),
    listJobs: vi.fn(),
    getJob: vi.fn(),
    enqueueJob: vi.fn(),
    updateQueue: vi.fn(),
    retryJob: vi.fn(),
    getWebhookSubscriptions: vi.fn(),
    getWebhookDeliveries: vi.fn(),
    triggerTestWebhook: vi.fn(),
  },
}));

const iso = '2026-10-01T12:00:00.000Z';
const metrics: QueueMetrics = {
  total_enqueued: 4,
  active_processing: 2,
  completed_today: 18,
  failed_today: 1,
  dlq_count: 1,
  avg_duration_ms: 320,
  throughput_per_minute: 4.5,
};
const queues = [
  { id: 'q-1', name: 'notifications', concurrency: 5, max_retries: 3, backoff_base_sec: 2, is_paused: false, created_at: iso, active_jobs: 1, queued_jobs: 2, dlq_jobs: 0 },
  { id: 'q-2', name: 'data-sync', concurrency: 3, max_retries: 3, backoff_base_sec: 5, is_paused: true, created_at: iso, active_jobs: 0, queued_jobs: 0, dlq_jobs: 1 },
];
const job = (o: Partial<Job>): Job => ({
  id: 'job-0000', queue_id: 'q-1', queue_name: 'notifications', name: 'task', priority: 'normal', status: 'completed',
  payload: {}, result: null, error: null, idempotency_key: null, attempts: 1, max_retries: 3,
  run_at: iso, created_at: iso, updated_at: iso, ...o,
});
const welcome = job({ id: 'job-1111-2222', name: 'send_welcome_email', payload: { email: 'dev@test.ee' }, result: { delivered: true } });
const failing = job({
  id: 'job-3333-4444', queue_id: 'q-2', queue_name: 'data-sync', name: 'sync_erp_records', priority: 'high',
  status: 'dlq', attempts: 3, error: 'Timeout in upstream system', idempotency_key: 'idem_batch_1',
});
const subscription = {
  id: 'sub-1', name: 'Demo Sink', url: 'http://localhost:4000/api/webhooks/test-receiver', secret: 'whsec********',
  events: ['job.completed', 'job.dlq'], is_active: true, created_at: iso,
};
const delivery = {
  id: 'del-1', subscription_id: 'sub-1', subscription_name: 'Demo Sink', event: 'job.completed',
  payload: { jobId: 'job-1111-2222' }, status_code: 200, signature: 'sha256=abcdef987654321', duration_ms: 45,
  delivered_at: iso, response_body: '{"status":"ok"}',
};

const SCROLLERS = '.table-wrapper, .code-box, .event-log, .drawer, [class*="scroll"]';

function expectScrollersReachable(root: ParentNode) {
  const found = Array.from(root.querySelectorAll(SCROLLERS)).filter((el) => !el.classList.contains('drawer'));
  expect(found.length).toBeGreaterThan(0);
  for (const el of found) {
    const label = el.getAttribute('aria-label') ?? '';
    // The event log is a native ordered list, so it keeps its list role.
    if (el.tagName !== 'OL') expect(el.getAttribute('role'), el.className).toBe('region');
    expect(el.getAttribute('tabindex'), el.className).toBe('0');
    expect(label.trim().length, el.className).toBeGreaterThan(0);
  }
}

describe('scrollable regions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMetrics).mockResolvedValue(metrics);
    vi.mocked(api.getQueues).mockResolvedValue(queues);
    vi.mocked(api.listJobs).mockImplementation(((p?: { status?: string }) => {
      const all = [welcome, failing];
      const jobs = p?.status ? all.filter((j) => j.status === p.status) : all;
      return Promise.resolve({ jobs, total: jobs.length });
    }) as any);
    vi.mocked(api.getWebhookSubscriptions).mockResolvedValue([subscription]);
    vi.mocked(api.getWebhookDeliveries).mockResolvedValue([delivery]);
    vi.mocked(api.getJob).mockResolvedValue({
      ...failing,
      attempts_list: [
        { id: 'att-1', attempt_number: 1, status: 'failed', worker_id: 'w-1', started_at: iso, duration_ms: 12, error: 'Timeout' },
      ],
    });
  });

  it('makes every scrollable container keyboard reachable and named', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText('send_welcome_email');
    expectScrollersReachable(container);

    for (const name of [/Dead letters/, /Webhooks/, 'Enqueue']) {
      await user.click(screen.getByRole('tab', { name }));
      expectScrollersReachable(container);
    }

    await user.click(screen.getByRole('button', { name: 'Inspect job sync_erp_records' }));
    await screen.findByRole('button', { name: 'Close job inspector' });
    await waitFor(() => expect(document.body.textContent).toContain('Attempts (1)'));
    expectScrollersReachable(document.body);
  });
});

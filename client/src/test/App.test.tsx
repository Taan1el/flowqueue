import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../App.js';
import { api } from '../services/api.js';

// Mock API client
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

describe('FlowQueue Frontend Dashboard', () => {
  const mockMetrics = {
    total_enqueued: 4,
    active_processing: 2,
    completed_today: 18,
    failed_today: 1,
    dlq_count: 1,
    avg_duration_ms: 320,
    throughput_per_minute: 4.5,
  };

  const mockQueues = [
    {
      id: 'q-1',
      name: 'notifications',
      concurrency: 5,
      max_retries: 3,
      backoff_base_sec: 2,
      is_paused: false,
      created_at: new Date().toISOString(),
      active_jobs: 1,
      queued_jobs: 2,
      dlq_jobs: 0,
    },
    {
      id: 'q-2',
      name: 'data-sync',
      concurrency: 3,
      max_retries: 3,
      backoff_base_sec: 5,
      is_paused: false,
      created_at: new Date().toISOString(),
      active_jobs: 1,
      queued_jobs: 2,
      dlq_jobs: 1,
    },
  ];

  const mockJobs = [
    {
      id: 'job-1111-2222',
      queue_id: 'q-1',
      queue_name: 'notifications',
      name: 'send_welcome_email',
      priority: 'normal' as const,
      status: 'completed' as const,
      payload: { email: 'dev@test.ee' },
      result: { delivered: true },
      error: null,
      idempotency_key: null,
      attempts: 1,
      max_retries: 3,
      run_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'job-3333-4444',
      queue_id: 'q-2',
      queue_name: 'data-sync',
      name: 'sync_erp_records',
      priority: 'high' as const,
      status: 'dlq' as const,
      payload: { batch: 1 },
      result: null,
      error: 'Timeout in upstream system',
      idempotency_key: 'idem_batch_1',
      attempts: 3,
      max_retries: 3,
      run_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const mockWebhookSubs = [
    {
      id: 'sub-1',
      name: 'Demo Sink',
      url: 'http://localhost:4000/api/webhooks/test-receiver',
      secret: 'whsec_demo_secret_123',
      events: ['job.completed', 'job.dlq'],
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ];

  const mockWebhookDeliveries = [
    {
      id: 'del-1',
      subscription_id: 'sub-1',
      subscription_name: 'Demo Sink',
      event: 'job.completed',
      payload: { jobId: 'job-1111-2222' },
      status_code: 200,
      signature: 'sha256=abcdef987654321',
      duration_ms: 45,
      delivered_at: new Date().toISOString(),
      response_body: '{"status":"ok"}',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMetrics).mockResolvedValue(mockMetrics);
    vi.mocked(api.getQueues).mockResolvedValue(mockQueues);
    vi.mocked(api.listJobs).mockResolvedValue({ jobs: mockJobs, total: mockJobs.length });
    vi.mocked(api.getWebhookSubscriptions).mockResolvedValue(mockWebhookSubs);
    vi.mocked(api.getWebhookDeliveries).mockResolvedValue(mockWebhookDeliveries);
  });

  it('renders system telemetry cards and brand title', async () => {
    render(<App />);

    expect(screen.getByText('FlowQueue')).toBeInTheDocument();
    expect(screen.getByText('Distributed Background Task Engine & Webhook Dispatcher')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('4.5/m')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
    });
  });

  it('renders queue cards with active and DLQ counts', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('notifications').length).toBeGreaterThan(0);
      expect(screen.getAllByText('data-sync').length).toBeGreaterThan(0);
    });
  });

  it('renders job table with job rows and statuses', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('send_welcome_email')).toBeInTheDocument();
      expect(screen.getByText('sync_erp_records')).toBeInTheDocument();
      expect(screen.getAllByText('COMPLETED').length).toBeGreaterThan(0);
      expect(screen.getAllByText('DLQ').length).toBeGreaterThan(0);
    });
  });

  it('opens Enqueue Task modal and allows selecting quick presets', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('+ Enqueue Task')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+ Enqueue Task'));

    expect(screen.getByText('Enqueue Background Task')).toBeInTheDocument();
    expect(screen.getByText('💳 Stripe Charge Sync')).toBeInTheDocument();

    // Click preset
    fireEvent.click(screen.getByText('💳 Stripe Charge Sync'));

    const taskInput = screen.getByLabelText('Task Name') as HTMLInputElement;
    expect(taskInput.value).toBe('reconcile_stripe_charge');
  });

  it('switches to Webhooks tab and displays delivery audit logs', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Webhooks & Dispatches/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Webhooks & Dispatches/i));

    await waitFor(() => {
      expect(screen.getByText('Webhook Subscriptions & HMAC Dispatcher')).toBeInTheDocument();
      expect(screen.getAllByText('Demo Sink').length).toBeGreaterThan(0);
      expect(screen.getByText('sha256=abcdef987654321')).toBeInTheDocument();
    });
  });
});

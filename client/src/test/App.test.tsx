import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { App } from '../App.js';
import { api } from '../services/api.js';
import type { Job, JobStatus, QueueMetrics } from '../../../shared/types.js';

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

const job = (overrides: Partial<Job>): Job => ({
  id: 'job-0000',
  queue_id: 'q-1',
  queue_name: 'notifications',
  name: 'task',
  priority: 'normal',
  status: 'completed',
  payload: {},
  result: null,
  error: null,
  idempotency_key: null,
  attempts: 1,
  max_retries: 3,
  run_at: iso,
  created_at: iso,
  updated_at: iso,
  ...overrides,
});

const welcome = job({ id: 'job-1111-2222', name: 'send_welcome_email', payload: { email: 'dev@test.ee' }, result: { delivered: true } });
const failing = job({
  id: 'job-3333-4444',
  queue_id: 'q-2',
  queue_name: 'data-sync',
  name: 'sync_erp_records',
  priority: 'high',
  status: 'dlq',
  attempts: 3,
  error: 'Timeout in upstream system',
  idempotency_key: 'idem_batch_1',
});

const subscription = {
  id: 'sub-1',
  name: 'Demo Sink',
  url: 'http://localhost:4000/api/webhooks/test-receiver',
  secret: 'whsec********',
  events: ['job.completed', 'job.dlq'],
  is_active: true,
  created_at: iso,
};

const delivery = {
  id: 'del-1',
  subscription_id: 'sub-1',
  subscription_name: 'Demo Sink',
  event: 'job.completed',
  payload: { jobId: 'job-1111-2222' },
  status_code: 200,
  signature: 'sha256=abcdef987654321',
  duration_ms: 45,
  delivered_at: iso,
  response_body: '{"status":"ok"}',
};

function jobsFor(params?: { status?: JobStatus }) {
  const all = [welcome, failing];
  const jobs = params?.status ? all.filter((j) => j.status === params.status) : all;
  return Promise.resolve({ jobs, total: jobs.length });
}

describe('FlowQueue dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getMetrics).mockResolvedValue(metrics);
    vi.mocked(api.getQueues).mockResolvedValue(queues);
    vi.mocked(api.listJobs).mockImplementation(jobsFor as any);
    vi.mocked(api.getWebhookSubscriptions).mockResolvedValue([subscription]);
    vi.mocked(api.getWebhookDeliveries).mockResolvedValue([delivery]);
    vi.mocked(api.getJob).mockResolvedValue({ ...failing, attempts_list: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The dashboard also asks for the dead letters; this is the call that feeds the jobs table.
  const lastJobsQuery = () => vi.mocked(api.listJobs).mock.calls.map((c) => c[0]).filter((q) => q?.status !== 'dlq').at(-1);

  async function renderLoaded() {
    render(<App />);
    await screen.findByText('send_welcome_email');
  }

  const openTab = (name: string | RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

  it('shows the product name and the telemetry line', async () => {
    await renderLoaded();
    expect(screen.getByRole('heading', { level: 1, name: 'FlowQueue' })).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(screen.getByText('4.5 per min')).toBeInTheDocument();
    expect(screen.getByText('320 ms')).toBeInTheDocument();
    expect(screen.getByText('1 failed attempt today')).toBeInTheDocument();
  });

  it('lists queues as tabs with in-flight counts against capacity and the paused state', async () => {
    await renderLoaded();
    const notifications = screen.getByRole('button', { name: 'Show jobs of notifications' });
    expect(within(notifications).getByText('notifications')).toBeInTheDocument();
    expect(within(notifications).getByText('1 / 5')).toBeInTheDocument();
    expect(within(notifications).getByText('Active')).toBeInTheDocument();
    const dataSync = screen.getByRole('button', { name: 'Show jobs of data-sync' });
    expect(within(dataSync).getByText('Paused')).toBeInTheDocument();
    expect(within(dataSync).getByText('0 / 3')).toBeInTheDocument();
  });

  it('lists jobs with a status label and attempt counts', async () => {
    await renderLoaded();
    const jobsTable = screen.getAllByRole('table')[0];
    expect(within(jobsTable).getByText('sync_erp_records')).toBeInTheDocument();
    expect(within(jobsTable).getByText('Completed')).toBeInTheDocument();
    expect(within(jobsTable).getByText('Dead letter')).toBeInTheDocument();
    expect(within(jobsTable).getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('2 jobs match the filters, newest first.')).toBeInTheDocument();
  });

  it('shows dead letters with their error and replays one', async () => {
    vi.mocked(api.retryJob).mockResolvedValue({ ...failing, status: 'queued' });
    await renderLoaded();
    expect(screen.getByText('Timeout in upstream system')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Replay dead letter sync_erp_records from the list' }));
    await waitFor(() => expect(api.retryJob).toHaveBeenCalledWith('job-3333-4444'));
    await waitFor(() => expect(vi.mocked(api.getMetrics).mock.calls.length).toBeGreaterThan(1));
  });

  it('passes the status, queue, priority and search filters to the API', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(api.listJobs).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' })));

    fireEvent.change(screen.getByLabelText('Queue', { selector: '#filter-queue' }), { target: { value: 'q-2' } });
    await waitFor(() => expect(api.listJobs).toHaveBeenCalledWith(expect.objectContaining({ queue_id: 'q-2', status: 'completed' })));

    fireEvent.change(screen.getByLabelText('Priority', { selector: '#filter-priority' }), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: ' erp ' } });
    await waitFor(() =>
      expect(api.listJobs).toHaveBeenCalledWith({ queue_id: 'q-2', status: 'completed', priority: 'high', search: 'erp' })
    );

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(lastJobsQuery()?.status).toBeUndefined());
  });

  it('shows only the jobs of a queue after "Show jobs"', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Show jobs of data-sync' }));
    await waitFor(() => expect(api.listJobs).toHaveBeenCalledWith(expect.objectContaining({ queue_id: 'q-2' })));
    expect(screen.getByRole('button', { name: 'Showing jobs of data-sync' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Showing jobs of data-sync' }));
    await waitFor(() => expect(lastJobsQuery()?.queue_id).toBeUndefined());
  });

  it('pauses and resumes queues', async () => {
    vi.mocked(api.updateQueue).mockResolvedValue(queues[0]);
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Pause queue notifications' }));
    await waitFor(() => expect(api.updateQueue).toHaveBeenCalledWith('q-1', { is_paused: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume queue data-sync' }));
    await waitFor(() => expect(api.updateQueue).toHaveBeenCalledWith('q-2', { is_paused: false }));
  });

  it('reports a failed queue update and lets the user dismiss it', async () => {
    vi.mocked(api.updateQueue).mockRejectedValue(new Error('Queue not found'));
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Pause queue notifications' }));
    expect(await screen.findByText('Could not update the queue: Queue not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Could not update the queue/)).not.toBeInTheDocument();
  });

  it('shows an error when the data cannot be loaded', async () => {
    vi.mocked(api.getMetrics).mockRejectedValue(new Error('Network down'));
    render(<App />);
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });

  describe('enqueue form', () => {
    it('fills the form from a preset and enqueues the job', async () => {
      vi.mocked(api.enqueueJob).mockResolvedValue({ job: job({ id: 'job-new-1', status: 'queued' }), duplicate: false });
      await renderLoaded();
      openTab('Enqueue');

      fireEvent.change(screen.getByLabelText('Start from'), { target: { value: '1' } });
      expect(screen.getByLabelText('Job name')).toHaveValue('reconcile_stripe_charge');
      expect(screen.getByLabelText('Priority', { selector: '#job-priority' })).toHaveValue('high');

      fireEvent.change(screen.getByLabelText('Delay'), { target: { value: '15' } });
      expect(screen.getByText('15 s')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Idempotency key (optional)'), { target: { value: ' charge-1 ' } });
      fireEvent.submit(document.getElementById('enqueue-form')!);

      await waitFor(() =>
        expect(api.enqueueJob).toHaveBeenCalledWith({
          queue_name: 'billing-webhooks',
          name: 'reconcile_stripe_charge',
          priority: 'high',
          delay_seconds: 15,
          idempotency_key: 'charge-1',
          payload: { chargeId: 'ch_4Nx992', amountCents: 19900, currency: 'EUR' },
        })
      );
      expect(await screen.findByText('Enqueued job job-new-1.')).toBeInTheDocument();
    });

    it('targets the first queue by default and omits empty optional fields', async () => {
      vi.mocked(api.enqueueJob).mockResolvedValue({ job: job({ id: 'job-new-2' }), duplicate: false });
      await renderLoaded();
      openTab('Enqueue');
      expect(screen.getByLabelText('Queue', { selector: '#queue-select' })).toHaveValue('notifications');
      fireEvent.submit(document.getElementById('enqueue-form')!);
      await waitFor(() => expect(api.enqueueJob).toHaveBeenCalled());
      const dto = vi.mocked(api.enqueueJob).mock.calls[0][0];
      expect(dto.queue_name).toBe('notifications');
      expect(dto.delay_seconds).toBeUndefined();
      expect(dto.idempotency_key).toBeUndefined();
    });

    it('rejects a payload that is not valid JSON without calling the API', async () => {
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.change(screen.getByLabelText('Payload (JSON)'), { target: { value: '{nope' } });
      fireEvent.submit(document.getElementById('enqueue-form')!);
      expect(await screen.findByText('Payload must be valid JSON.')).toBeInTheDocument();
      expect(api.enqueueJob).not.toHaveBeenCalled();
    });

    it('explains an idempotent duplicate', async () => {
      vi.mocked(api.enqueueJob).mockResolvedValue({ job: job({ id: 'job-existing' }), duplicate: true });
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.submit(document.getElementById('enqueue-form')!);
      expect(await screen.findByText(/already exists: job-existing/)).toBeInTheDocument();
    });

    it('shows the server error when enqueueing fails', async () => {
      vi.mocked(api.enqueueJob).mockRejectedValue(new Error("Queue 'x' does not exist."));
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.submit(document.getElementById('enqueue-form')!);
      expect(await screen.findByText("Could not enqueue: Queue 'x' does not exist.")).toBeInTheDocument();
    });

    it('generates an idempotency key', async () => {
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
      expect((screen.getByLabelText('Idempotency key (optional)') as HTMLInputElement).value).toMatch(/^idem_/);
    });

    it('is reached from the header button', async () => {
      await renderLoaded();
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      expect(document.getElementById('enqueue-form')).toBeNull();
      fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Enqueue job' }));
      expect(screen.getByRole('tab', { name: 'Enqueue' })).toHaveAttribute('aria-selected', 'true');
      expect(scroll).toHaveBeenCalled();
      expect(screen.getByLabelText('Queue', { selector: '#queue-select' })).toHaveFocus();
    });
  });

  describe('job inspector', () => {
    it('opens from a job row, closes on Escape and returns focus', async () => {
      await renderLoaded();
      openTab('Enqueue');
      const opener = screen.getByRole('button', { name: 'Inspect job sync_erp_records' });
      opener.focus();
      fireEvent.click(opener);

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('Last error')).toBeInTheDocument();
      expect(within(dialog).getByText('Timeout in upstream system')).toBeInTheDocument();
      expect(within(dialog).getByText('No attempts yet. The job is waiting for a worker.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close job inspector' })).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    });

    it('closes from the close button and by clicking outside the panel', async () => {
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.click(screen.getByRole('button', { name: 'Inspect job send_welcome_email' }));
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: 'Close job inspector' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: 'Inspect job send_welcome_email' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(dialog.parentElement!);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('keeps Tab inside the panel', async () => {
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.click(screen.getByRole('button', { name: 'Inspect job sync_erp_records' }));
      await screen.findByText('Last error');
      const replay = screen.getByRole('button', { name: 'Replay job' });
      replay.focus();
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByRole('button', { name: 'Close job inspector' })).toHaveFocus();
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(replay).toHaveFocus();
    });

    it('lists attempts and replays a dead letter from the panel', async () => {
      vi.mocked(api.getJob).mockResolvedValue({
        ...failing,
        attempts_list: [
          { id: 'a1', attempt_number: 1, status: 'failed', worker_id: 'worker_1', started_at: iso, finished_at: iso, duration_ms: 5000, error: 'Timeout' },
        ],
      });
      vi.mocked(api.retryJob).mockResolvedValue({ ...failing, status: 'queued' });
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.click(screen.getByRole('button', { name: 'Inspect job sync_erp_records' }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('5.0 s')).toBeInTheDocument();
      expect(within(dialog).getByText('worker_1')).toBeInTheDocument();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Replay job' }));
      await waitFor(() => expect(api.retryJob).toHaveBeenCalledWith('job-3333-4444'));
      await waitFor(() => expect(vi.mocked(api.getJob).mock.calls.length).toBe(2));
    });

    it('shows a replay error inside the panel', async () => {
      vi.mocked(api.retryJob).mockRejectedValue(new Error('Only dead-lettered jobs can be replayed'));
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.click(screen.getByRole('button', { name: 'Inspect job sync_erp_records' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Replay job' }));
      expect(await screen.findByText('Replay failed: Only dead-lettered jobs can be replayed')).toBeInTheDocument();
    });

    it('shows a load error', async () => {
      vi.mocked(api.getJob).mockRejectedValue(new Error('Job not found'));
      await renderLoaded();
      openTab('Enqueue');
      fireEvent.click(screen.getByRole('button', { name: 'Inspect job send_welcome_email' }));
      expect(await screen.findByText('Job not found')).toBeInTheDocument();
    });
  });

  describe('webhooks', () => {
    it('lists deliveries with their signature and the subscriptions without secrets', async () => {
      await renderLoaded();
      openTab(/Webhooks/);
      expect(screen.getByText('sha256=abcdef987654321')).toBeInTheDocument();
      expect(screen.getByText('45 ms')).toBeInTheDocument();
      expect(screen.getByText('Response: {"status":"ok"}')).toBeInTheDocument();
      expect(screen.getByText('1 subscription')).toBeInTheDocument();
      expect(screen.getByText('Secret whsec********')).toBeInTheDocument();
    });

    it('sends a test delivery and reports the answer', async () => {
      vi.mocked(api.triggerTestWebhook).mockResolvedValue({ ...delivery, status_code: 502, duration_ms: 1500 });
      await renderLoaded();
      openTab(/Webhooks/);
      fireEvent.click(screen.getByRole('button', { name: 'Send test delivery to Demo Sink' }));
      expect(await screen.findByText('Demo Sink answered 502 in 1.5 s.')).toBeInTheDocument();
      expect(api.triggerTestWebhook).toHaveBeenCalledWith('sub-1', 'job.completed');
    });

    it('reports a failed test delivery', async () => {
      vi.mocked(api.triggerTestWebhook).mockRejectedValue(new Error('Subscription not found'));
      await renderLoaded();
      openTab(/Webhooks/);
      fireEvent.click(screen.getByRole('button', { name: 'Send test delivery to Demo Sink' }));
      expect(await screen.findByText('Test delivery failed: Subscription not found')).toBeInTheDocument();
    });

    it('shows empty states', async () => {
      vi.mocked(api.getWebhookDeliveries).mockResolvedValue([]);
      vi.mocked(api.listJobs).mockResolvedValue({ jobs: [], total: 0 });
      render(<App />);
      expect(await screen.findByText('No jobs match these filters.')).toBeInTheDocument();
      expect(screen.getByText(/No dead letters/)).toBeInTheDocument();
      expect(screen.getByText('No events yet.')).toBeInTheDocument();
      openTab(/Webhooks/);
      expect(screen.getByText('No webhook deliveries recorded yet.')).toBeInTheDocument();
    });
  });

  describe('live refresh', () => {
    it('polls every 3 seconds until switched off', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      render(<App />);
      await screen.findByText('send_welcome_email');
      const base = vi.mocked(api.getMetrics).mock.calls.length;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(vi.mocked(api.getMetrics).mock.calls.length).toBe(base + 1);

      fireEvent.click(screen.getByLabelText('Refresh every 3 s'));
      const after = vi.mocked(api.getMetrics).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });
      expect(vi.mocked(api.getMetrics).mock.calls.length).toBe(after);
    });

    it('refreshes on demand', async () => {
      await renderLoaded();
      openTab(/Webhooks/);
      const before = vi.mocked(api.getMetrics).mock.calls.length;
      fireEvent.click(screen.getByRole('button', { name: /^Refresh$/ }));
      await waitFor(() => expect(vi.mocked(api.getMetrics).mock.calls.length).toBe(before + 1));
    });
  });
});

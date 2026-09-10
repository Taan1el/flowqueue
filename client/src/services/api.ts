import {
  ApiResponse,
  EnqueueJobDto,
  Job,
  JobPriority,
  JobStatus,
  Queue,
  QueueMetrics,
  UpdateQueueDto,
  WebhookDelivery,
  WebhookSubscription,
} from '../../../shared/types';

export interface QueueWithStats extends Queue {
  active_jobs: number;
  queued_jobs: number;
  dlq_jobs: number;
}

export interface JobWithAttempts extends Job {
  attempts_list?: {
    id: string;
    attempt_number: number;
    status: 'processing' | 'completed' | 'failed';
    worker_id: string;
    started_at: string;
    finished_at?: string | null;
    duration_ms?: number | null;
    error?: string | null;
  }[];
}

const API_BASE = '/api';

export const api = {
  async getMetrics(): Promise<QueueMetrics> {
    const res = await fetch(`${API_BASE}/metrics`);
    const json: ApiResponse<QueueMetrics> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch metrics');
    return json.data;
  },

  async getQueues(): Promise<QueueWithStats[]> {
    const res = await fetch(`${API_BASE}/queues`);
    const json: ApiResponse<QueueWithStats[]> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch queues');
    return json.data;
  },

  async updateQueue(id: string, updates: UpdateQueueDto): Promise<Queue> {
    const res = await fetch(`${API_BASE}/queues/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const json: ApiResponse<Queue> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to update queue');
    return json.data;
  },

  async listJobs(params?: {
    queue_id?: string;
    status?: JobStatus;
    priority?: JobPriority;
    search?: string;
  }): Promise<{ jobs: Job[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.queue_id) searchParams.set('queue_id', params.queue_id);
    if (params?.status) searchParams.set('status', params.status);
    if (params?.priority) searchParams.set('priority', params.priority);
    if (params?.search) searchParams.set('search', params.search);

    const res = await fetch(`${API_BASE}/jobs?${searchParams.toString()}`);
    const json: ApiResponse<Job[]> & { meta?: { total: number } } = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch jobs');
    return { jobs: json.data, total: json.meta?.total ?? json.data.length };
  },

  async getJob(id: string): Promise<JobWithAttempts> {
    const res = await fetch(`${API_BASE}/jobs/${id}`);
    const json: ApiResponse<JobWithAttempts> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch job');
    return json.data;
  },

  async enqueueJob(dto: EnqueueJobDto): Promise<{ job: Job; duplicate: boolean }> {
    const res = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    });
    const json: ApiResponse<Job> & { meta?: { idempotent_duplicate?: boolean } } = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to enqueue job');
    return { job: json.data, duplicate: Boolean(json.meta?.idempotent_duplicate) };
  },

  async retryJob(id: string): Promise<Job> {
    const res = await fetch(`${API_BASE}/jobs/${id}/retry`, { method: 'POST' });
    const json: ApiResponse<Job> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to retry job');
    return json.data;
  },

  async getWebhookSubscriptions(): Promise<WebhookSubscription[]> {
    const res = await fetch(`${API_BASE}/webhooks/subscriptions`);
    const json: ApiResponse<WebhookSubscription[]> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch webhook subscriptions');
    return json.data;
  },

  async getWebhookDeliveries(): Promise<WebhookDelivery[]> {
    const res = await fetch(`${API_BASE}/webhooks/deliveries`);
    const json: ApiResponse<WebhookDelivery[]> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch webhook deliveries');
    return json.data;
  },

  async triggerTestWebhook(subscriptionId: string, event: string): Promise<WebhookDelivery> {
    const res = await fetch(`${API_BASE}/webhooks/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription_id: subscriptionId, event }),
    });
    const json: ApiResponse<WebhookDelivery> = await res.json();
    if (!json.success || !json.data) throw new Error(json.error || 'Failed to trigger test webhook');
    return json.data;
  },
};

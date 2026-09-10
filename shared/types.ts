export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'dlq';

export type JobPriority = 'high' | 'normal' | 'low';

export const PRIORITY_WEIGHTS: Record<JobPriority, number> = {
  high: 1,
  normal: 2,
  low: 3,
};

export interface Queue {
  id: string;
  name: string;
  concurrency: number;
  max_retries: number;
  backoff_base_sec: number;
  is_paused: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  queue_id: string;
  queue_name?: string;
  name: string;
  priority: JobPriority;
  status: JobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  idempotency_key?: string | null;
  attempts: number;
  max_retries: number;
  run_at: string;
  created_at: string;
  updated_at: string;
}

export interface JobAttempt {
  id: string;
  job_id: string;
  attempt_number: number;
  status: 'processing' | 'completed' | 'failed';
  worker_id: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
}

export interface WebhookSubscription {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  subscription_name?: string;
  event: string;
  payload: Record<string, unknown>;
  status_code: number;
  signature: string;
  duration_ms: number;
  delivered_at: string;
  response_body?: string | null;
}

export interface EnqueueJobDto {
  queue_name: string;
  name: string;
  payload: Record<string, unknown>;
  priority?: JobPriority;
  delay_seconds?: number;
  idempotency_key?: string;
  max_retries?: number;
}

export interface UpdateQueueDto {
  is_paused?: boolean;
  concurrency?: number;
  max_retries?: number;
}

export interface CreateWebhookSubscriptionDto {
  name: string;
  url: string;
  secret: string;
  events: string[];
}

export interface TestWebhookDto {
  subscription_id: string;
  event: string;
  payload?: Record<string, unknown>;
}

export interface QueueMetrics {
  total_enqueued: number;
  active_processing: number;
  completed_today: number;
  failed_today: number;
  dlq_count: number;
  avg_duration_ms: number;
  throughput_per_minute: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

import { HttpError } from './errors.js';
import type { EnqueueJobDto, JobPriority, JobStatus, UpdateQueueDto } from '../../../shared/types.js';

const PRIORITIES: JobPriority[] = ['high', 'normal', 'low'];
const STATUSES: JobStatus[] = ['queued', 'processing', 'completed', 'dlq'];

export const LIMITS = {
  maxDelaySeconds: 7 * 24 * 60 * 60,
  maxRetries: 20,
  maxConcurrency: 100,
  maxListLimit: 200,
  maxNameLength: 200,
  maxKeyLength: 200,
};

function bad(message: string): never {
  throw new HttpError(400, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerInRange(value: unknown, field: string, min: number, max: number): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    bad(`${field} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function nonEmptyString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim() === '') bad(`${field} is required`);
  if (value.length > maxLength) bad(`${field} must be at most ${maxLength} characters`);
  return value;
}

export function parseEnqueueBody(body: unknown): EnqueueJobDto {
  if (!isPlainObject(body)) bad('Request body must be a JSON object');
  const queue_name = nonEmptyString(body.queue_name, 'queue_name', LIMITS.maxNameLength);
  const name = nonEmptyString(body.name, 'name', LIMITS.maxNameLength);

  let payload: Record<string, unknown> = {};
  if (body.payload !== undefined && body.payload !== null) {
    if (!isPlainObject(body.payload)) bad('payload must be a JSON object');
    payload = body.payload;
  }

  const dto: EnqueueJobDto = { queue_name, name, payload };

  if (body.priority !== undefined && body.priority !== null && body.priority !== '') {
    if (!PRIORITIES.includes(body.priority as JobPriority)) bad(`priority must be one of ${PRIORITIES.join(', ')}`);
    dto.priority = body.priority as JobPriority;
  }
  if (body.delay_seconds !== undefined && body.delay_seconds !== null) {
    dto.delay_seconds = integerInRange(body.delay_seconds, 'delay_seconds', 0, LIMITS.maxDelaySeconds);
  }
  if (body.max_retries !== undefined && body.max_retries !== null) {
    dto.max_retries = integerInRange(body.max_retries, 'max_retries', 1, LIMITS.maxRetries);
  }
  if (body.idempotency_key !== undefined && body.idempotency_key !== null && body.idempotency_key !== '') {
    dto.idempotency_key = nonEmptyString(body.idempotency_key, 'idempotency_key', LIMITS.maxKeyLength);
  }
  return dto;
}

export function parseQueueUpdate(body: unknown): UpdateQueueDto {
  if (!isPlainObject(body)) bad('Request body must be a JSON object');
  const update: UpdateQueueDto = {};
  if (body.is_paused !== undefined) {
    if (typeof body.is_paused !== 'boolean') bad('is_paused must be true or false');
    update.is_paused = body.is_paused;
  }
  if (body.concurrency !== undefined) {
    update.concurrency = integerInRange(body.concurrency, 'concurrency', 1, LIMITS.maxConcurrency);
  }
  if (body.max_retries !== undefined) {
    update.max_retries = integerInRange(body.max_retries, 'max_retries', 1, LIMITS.maxRetries);
  }
  if (Object.keys(update).length === 0) bad('Provide is_paused, concurrency or max_retries');
  return update;
}

export interface JobListQuery {
  queue_id?: string;
  status?: JobStatus;
  priority?: JobPriority;
  search?: string;
  limit: number;
  offset: number;
}

function single(value: unknown, field: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') bad(`${field} must be a single value`);
  return value;
}

export function parseJobListQuery(query: Record<string, unknown>): JobListQuery {
  const status = single(query.status, 'status');
  if (status !== undefined && !STATUSES.includes(status as JobStatus)) bad(`status must be one of ${STATUSES.join(', ')}`);
  const priority = single(query.priority, 'priority');
  if (priority !== undefined && !PRIORITIES.includes(priority as JobPriority)) {
    bad(`priority must be one of ${PRIORITIES.join(', ')}`);
  }
  const limitRaw = single(query.limit, 'limit');
  const offsetRaw = single(query.offset, 'offset');
  return {
    queue_id: single(query.queue_id, 'queue_id'),
    status: status as JobStatus | undefined,
    priority: priority as JobPriority | undefined,
    search: single(query.search, 'search'),
    limit: limitRaw === undefined ? 50 : integerInRange(limitRaw, 'limit', 1, LIMITS.maxListLimit),
    offset: offsetRaw === undefined ? 0 : integerInRange(offsetRaw, 'offset', 0, Number.MAX_SAFE_INTEGER),
  };
}

export function parseSubscriptionBody(body: unknown): { name: string; url: string; secret: string; events: string[] } {
  if (!isPlainObject(body)) bad('Request body must be a JSON object');
  const name = nonEmptyString(body.name, 'name', LIMITS.maxNameLength);
  const secret = nonEmptyString(body.secret, 'secret', 500);
  const url = nonEmptyString(body.url, 'url', 2000);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    bad('url must be a valid http or https URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') bad('url must be a valid http or https URL');
  if (!Array.isArray(body.events) || body.events.length === 0 || !body.events.every((e) => typeof e === 'string' && e.trim())) {
    bad('events must be a non-empty array of event names');
  }
  return { name, url, secret, events: body.events as string[] };
}

export function maskSecret(secret: string): string {
  return secret.length <= 4 ? '****' : `${secret.slice(0, 4)}${'*'.repeat(8)}`;
}

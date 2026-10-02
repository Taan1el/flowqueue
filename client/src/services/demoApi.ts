// In-browser stand-in for services/api.ts on the GitHub Pages build. Every
// method matches the real client's name and signature and is backed by
// DemoEngine, which applies the same queue rules as the server.
import { DemoEngine } from '../demo/engine.js';
import type { FlowQueueApi } from './api.js';

const TICK_MS = 500;

let engine = new DemoEngine();
let timer: ReturnType<typeof setInterval> | null = null;

export function startDemoWorker(): void {
  if (timer) return;
  timer = setInterval(() => engine.tick(), TICK_MS);
}

export function stopDemoWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Rebuilds the sample queues, jobs and deliveries, as a fresh start would. */
export function resetDemoData(): void {
  engine = new DemoEngine();
}

export const demoApi: FlowQueueApi = {
  getMetrics: () => engine.getMetrics(),
  getQueues: () => engine.getQueues(),
  updateQueue: (id, updates) => engine.updateQueue(id, updates),
  listJobs: (params) => engine.listJobs(params),
  getJob: (id) => engine.getJob(id),
  enqueueJob: (dto) => engine.enqueueJob(dto),
  retryJob: (id) => engine.retryJob(id),
  getWebhookSubscriptions: () => engine.getWebhookSubscriptions(),
  getWebhookDeliveries: () => engine.getWebhookDeliveries(),
  triggerTestWebhook: (id, event) => engine.triggerTestWebhook(id, event),
};

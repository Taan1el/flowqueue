import express, { Express } from 'express';
import cors from 'cors';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './db/database.js';
import { initializeSchema } from './db/schema.js';
import { seedDatabase } from './db/seed.js';

import { QueueRepository } from './repositories/queue.repository.js';
import { JobRepository } from './repositories/job.repository.js';
import { WebhookRepository } from './repositories/webhook.repository.js';

import { QueueService } from './services/queue.service.js';
import { WebhookService } from './services/webhook.service.js';
import { WorkerService } from './services/worker.service.js';
import { MetricsService } from './services/metrics.service.js';

import { QueueController } from './controllers/queue.controller.js';
import { JobController } from './controllers/job.controller.js';
import { WebhookController } from './controllers/webhook.controller.js';
import { MetricsController } from './controllers/metrics.controller.js';

import { createHealthRoutes } from './routes/health.routes.js';
import { createQueueRoutes } from './routes/queue.routes.js';
import { createJobRoutes } from './routes/job.routes.js';
import { createWebhookRoutes } from './routes/webhook.routes.js';
import { createMetricsRoutes } from './routes/metrics.routes.js';
import { errorHandler } from './middleware/error.middleware.js';

export interface AppContext {
  app: Express;
  db: DatabaseSync;
  queueRepo: QueueRepository;
  jobRepo: JobRepository;
  webhookRepo: WebhookRepository;
  queueService: QueueService;
  webhookService: WebhookService;
  workerService: WorkerService;
  metricsService: MetricsService;
}

export function createApp(dbPath?: string, shouldSeed = true): AppContext {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Database initialization
  const db = createDatabase(dbPath);
  initializeSchema(db);
  if (shouldSeed) {
    seedDatabase(db);
  }

  // Repositories
  const queueRepo = new QueueRepository(db);
  const jobRepo = new JobRepository(db);
  const webhookRepo = new WebhookRepository(db);

  // Services
  const webhookService = new WebhookService(webhookRepo);
  const queueService = new QueueService(queueRepo, jobRepo);
  const workerService = new WorkerService(jobRepo, queueRepo, webhookService);
  const metricsService = new MetricsService(db);

  // Controllers
  const queueController = new QueueController(queueService);
  const jobController = new JobController(queueService);
  const webhookController = new WebhookController(webhookRepo, webhookService);
  const metricsController = new MetricsController(metricsService);

  // Mount API routes
  app.use('/api', createHealthRoutes());
  app.use('/api', createQueueRoutes(queueController));
  app.use('/api', createJobRoutes(jobController));
  app.use('/api', createWebhookRoutes(webhookController));
  app.use('/api', createMetricsRoutes(metricsController));

  // Error handling middleware
  app.use(errorHandler);

  return {
    app,
    db,
    queueRepo,
    jobRepo,
    webhookRepo,
    queueService,
    webhookService,
    workerService,
    metricsService,
  };
}

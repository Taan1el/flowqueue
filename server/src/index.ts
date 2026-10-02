import { createApp } from './app.js';

const PORT = Number(process.env.PORT) || 4000;
const DB_PATH = process.env.DB_PATH || './data/flowqueue.db';
const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS) || 1000;
const LEASE_SECONDS = Number(process.env.LEASE_SECONDS) || 60;
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE) || 5;

const { app, workerService, webhookService } = createApp(DB_PATH, true, {
  leaseSeconds: LEASE_SECONDS,
  worker: { batchSize: BATCH_SIZE },
});

workerService.start(POLL_INTERVAL_MS);
console.log(`[FlowQueue Worker] Background task worker started (${workerService.workerId})`);

const server = app.listen(PORT, () => {
  console.log(`[FlowQueue API] Server listening on http://localhost:${PORT}`);
});

function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  workerService.stop();
  server.close(() => {
    webhookService.idle().finally(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

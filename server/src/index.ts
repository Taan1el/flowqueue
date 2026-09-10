import { createApp } from './app.js';

const PORT = process.env.PORT || 4000;
const DB_PATH = process.env.DB_PATH || './data/flowqueue.db';

const { app, workerService } = createApp(DB_PATH, true);

// Start background task worker
workerService.start(1000);
console.log(`[FlowQueue Worker] Background task worker started (${workerService.workerId})`);

const server = app.listen(PORT, () => {
  console.log(`[FlowQueue API] Server listening on http://localhost:${PORT}`);
});

function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  workerService.stop();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

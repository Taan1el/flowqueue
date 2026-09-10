import { Router } from 'express';

export function createHealthRoutes(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'flowqueue-api',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

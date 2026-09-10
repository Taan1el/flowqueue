import { Router } from 'express';
import { MetricsController } from '../controllers/metrics.controller.js';

export function createMetricsRoutes(controller: MetricsController): Router {
  const router = Router();

  router.get('/metrics', controller.getOverview);

  return router;
}

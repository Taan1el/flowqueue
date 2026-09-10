import { Router } from 'express';
import { JobController } from '../controllers/job.controller.js';

export function createJobRoutes(controller: JobController): Router {
  const router = Router();

  router.post('/jobs', controller.enqueue);
  router.get('/jobs', controller.list);
  router.get('/jobs/:id', controller.getById);
  router.post('/jobs/:id/retry', controller.retry);

  return router;
}

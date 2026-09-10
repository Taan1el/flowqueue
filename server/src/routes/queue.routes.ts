import { Router } from 'express';
import { QueueController } from '../controllers/queue.controller.js';

export function createQueueRoutes(controller: QueueController): Router {
  const router = Router();

  router.get('/queues', controller.list);
  router.patch('/queues/:id', controller.update);

  return router;
}

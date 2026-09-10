import { Router } from 'express';
import { WebhookController } from '../controllers/webhook.controller.js';

export function createWebhookRoutes(controller: WebhookController): Router {
  const router = Router();

  router.get('/webhooks/subscriptions', controller.listSubscriptions);
  router.post('/webhooks/subscriptions', controller.createSubscription);
  router.get('/webhooks/deliveries', controller.listDeliveries);
  router.post('/webhooks/test', controller.testTrigger);
  router.post('/webhooks/test-receiver', controller.testReceiver);

  return router;
}

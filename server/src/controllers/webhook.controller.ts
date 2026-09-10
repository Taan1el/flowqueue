import { Request, Response, NextFunction } from 'express';
import { WebhookRepository } from '../repositories/webhook.repository.js';
import { WebhookService } from '../services/webhook.service.js';

export class WebhookController {
  constructor(
    private webhookRepo: WebhookRepository,
    private webhookService: WebhookService
  ) {}

  listSubscriptions = (_req: Request, res: Response, next: NextFunction) => {
    try {
      const subs = this.webhookRepo.listSubscriptions();
      res.json({ success: true, data: subs });
    } catch (err) {
      next(err);
    }
  };

  createSubscription = (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, url, secret, events } = req.body;
      if (!name || !url || !secret || !Array.isArray(events)) {
        res.status(400).json({ success: false, error: 'name, url, secret, and events array are required' });
        return;
      }

      const sub = this.webhookRepo.createSubscription({ name, url, secret, events });
      res.status(201).json({ success: true, data: sub });
    } catch (err) {
      next(err);
    }
  };

  listDeliveries = (_req: Request, res: Response, next: NextFunction) => {
    try {
      const deliveries = this.webhookRepo.listDeliveries(50);
      res.json({ success: true, data: deliveries });
    } catch (err) {
      next(err);
    }
  };

  testTrigger = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { subscription_id, event, payload } = req.body;
      const sub = this.webhookRepo.getSubscriptionById(subscription_id);
      if (!sub) {
        res.status(404).json({ success: false, error: 'Subscription not found' });
        return;
      }

      const delivery = await this.webhookService.deliver(sub, event || 'test.ping', payload || { ping: true, timestamp: Date.now() });
      res.json({ success: true, data: delivery });
    } catch (err) {
      next(err);
    }
  };

  testReceiver = (req: Request, res: Response) => {
    // Built-in sink endpoint for testing HMAC verification live
    const signature = req.headers['x-flowqueue-signature'] as string;
    const event = req.headers['x-flowqueue-event'] as string;
    const payload = req.body;

    res.status(200).json({
      status: 'received',
      event,
      receivedSignature: signature,
      timestamp: new Date().toISOString(),
      payloadSummary: typeof payload === 'object' ? Object.keys(payload) : 'raw',
    });
  };
}

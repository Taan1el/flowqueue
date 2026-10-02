import { Request, Response, NextFunction } from 'express';
import { WebhookRepository } from '../repositories/webhook.repository.js';
import { WebhookService } from '../services/webhook.service.js';
import { WebhookSubscription } from '../../../shared/types.js';
import { HttpError } from '../lib/errors.js';
import { maskSecret, parseSubscriptionBody } from '../lib/validation.js';

// The signing secret is write-only: the API never sends it back.
const publicSubscription = (sub: WebhookSubscription): WebhookSubscription => ({ ...sub, secret: maskSecret(sub.secret) });

export class WebhookController {
  constructor(
    private webhookRepo: WebhookRepository,
    private webhookService: WebhookService
  ) {}

  listSubscriptions = (_req: Request, res: Response, next: NextFunction) => {
    try {
      const subs = this.webhookRepo.listSubscriptions();
      res.json({ success: true, data: subs.map(publicSubscription) });
    } catch (err) {
      next(err);
    }
  };

  createSubscription = (req: Request, res: Response, next: NextFunction) => {
    try {
      const sub = this.webhookRepo.createSubscription(parseSubscriptionBody(req.body));
      res.status(201).json({ success: true, data: publicSubscription(sub) });
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
      const { subscription_id, event, payload } = req.body ?? {};
      if (typeof subscription_id !== 'string' || !subscription_id) {
        throw new HttpError(400, 'subscription_id is required');
      }
      if (event !== undefined && (typeof event !== 'string' || !event.trim())) {
        throw new HttpError(400, 'event must be a non-empty string');
      }
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

    // The sink does not hold any subscription secret, so it echoes the
    // signature it received instead of verifying it.
    res.status(200).json({
      status: 'received',
      event,
      receivedSignature: signature,
      timestamp: new Date().toISOString(),
      payloadSummary: typeof payload === 'object' && payload !== null ? Object.keys(payload) : 'raw',
    });
  };
}

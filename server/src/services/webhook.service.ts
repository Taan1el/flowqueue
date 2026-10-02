import crypto from 'node:crypto';
import { WebhookRepository } from '../repositories/webhook.repository.js';
import { WebhookDelivery, WebhookSubscription } from '../../../shared/types.js';

export interface WebhookServiceOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class WebhookService {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private pending = new Set<Promise<unknown>>();

  constructor(
    private webhookRepo: WebhookRepository,
    options: WebhookServiceOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 6000;
  }

  /** Resolves once every delivery started by dispatchJobEvent has been recorded. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  generateSignature(payloadString: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadString, 'utf8');
    return `sha256=${hmac.digest('hex')}`;
  }

  verifySignature(payloadString: string, secret: string, headerSignature: string): boolean {
    const expected = this.generateSignature(payloadString, secret);
    const a = Buffer.from(expected);
    const b = Buffer.from(headerSignature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async deliver(subscription: WebhookSubscription, event: string, payload: Record<string, unknown>): Promise<WebhookDelivery> {
    const payloadString = JSON.stringify({
      id: crypto.randomUUID(),
      event,
      created_at: new Date().toISOString(),
      data: payload,
    });

    const signature = this.generateSignature(payloadString, subscription.secret);
    const startTime = Date.now();
    let statusCode = 500;
    let responseBody = '';

    try {
      const response = await this.fetchImpl(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FlowQueue-WebhookDispatcher/1.0',
          'X-FlowQueue-Event': event,
          'X-FlowQueue-Signature': signature,
          'X-FlowQueue-Delivery': crypto.randomUUID(),
        },
        body: payloadString,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      statusCode = response.status;
      responseBody = (await response.text()).slice(0, 500);
    } catch (err: any) {
      statusCode = 504;
      responseBody = `Delivery error: ${err.message || String(err)}`;
    }

    const durationMs = Date.now() - startTime;

    return this.webhookRepo.recordDelivery({
      subscription_id: subscription.id,
      event,
      payload: JSON.parse(payloadString),
      status_code: statusCode,
      signature,
      duration_ms: durationMs,
      response_body: responseBody,
    });
  }

  async dispatchJobEvent(event: string, jobData: Record<string, unknown>): Promise<void> {
    const subscriptions = this.webhookRepo.listSubscriptions().filter((sub) => sub.is_active && sub.events.includes(event));

    for (const sub of subscriptions) {
      // Single attempt, fired in the background. The outcome is logged in
      // webhook_deliveries; a failed delivery is not retried.
      const delivery = this.deliver(sub, event, jobData)
        .catch((e) => {
          console.error(`[Webhook Dispatch Error] Failed to deliver to ${sub.url}:`, e);
        })
        .finally(() => this.pending.delete(delivery));
      this.pending.add(delivery);
    }
  }
}

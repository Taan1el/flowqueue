import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { WebhookSubscription, WebhookDelivery, CreateWebhookSubscriptionDto } from '../../../shared/types.js';

export class WebhookRepository {
  constructor(private db: DatabaseSync) {}

  listSubscriptions(): WebhookSubscription[] {
    const stmt = this.db.prepare('SELECT * FROM webhook_subscriptions ORDER BY created_at DESC;');
    const rows = stmt.all() as any[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.url,
      secret: r.secret,
      events: JSON.parse(r.events),
      is_active: Boolean(r.is_active),
      created_at: r.created_at,
    }));
  }

  getSubscriptionById(id: string): WebhookSubscription | null {
    const stmt = this.db.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?;');
    const r = stmt.get(id) as any;
    if (!r) return null;

    return {
      id: r.id,
      name: r.name,
      url: r.url,
      secret: r.secret,
      events: JSON.parse(r.events),
      is_active: Boolean(r.is_active),
      created_at: r.created_at,
    };
  }

  createSubscription(dto: CreateWebhookSubscriptionDto): WebhookSubscription {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO webhook_subscriptions (id, name, url, secret, events, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?);
    `);
    stmt.run(id, dto.name, dto.url, dto.secret, JSON.stringify(dto.events), nowIso);

    return this.getSubscriptionById(id)!;
  }

  listDeliveries(limit = 50): WebhookDelivery[] {
    const stmt = this.db.prepare(`
      SELECT wd.*, ws.name as subscription_name
      FROM webhook_deliveries wd
      JOIN webhook_subscriptions ws ON wd.subscription_id = ws.id
      ORDER BY wd.delivered_at DESC
      LIMIT ?;
    `);
    const rows = stmt.all(limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      subscription_id: r.subscription_id,
      subscription_name: r.subscription_name,
      event: r.event,
      payload: JSON.parse(r.payload),
      status_code: Number(r.status_code),
      signature: r.signature,
      duration_ms: Number(r.duration_ms),
      delivered_at: r.delivered_at,
      response_body: r.response_body,
    }));
  }

  recordDelivery(delivery: {
    subscription_id: string;
    event: string;
    payload: Record<string, unknown>;
    status_code: number;
    signature: string;
    duration_ms: number;
    response_body?: string | null;
  }): WebhookDelivery {
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO webhook_deliveries (
        id, subscription_id, event, payload, status_code, signature, duration_ms, delivered_at, response_body
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    stmt.run(
      id,
      delivery.subscription_id,
      delivery.event,
      JSON.stringify(delivery.payload),
      delivery.status_code,
      delivery.signature,
      delivery.duration_ms,
      nowIso,
      delivery.response_body || null
    );

    return {
      id,
      subscription_id: delivery.subscription_id,
      event: delivery.event,
      payload: delivery.payload,
      status_code: delivery.status_code,
      signature: delivery.signature,
      duration_ms: delivery.duration_ms,
      delivered_at: nowIso,
      response_body: delivery.response_body,
    };
  }
}

import { createApp, AppContext } from '../src/app.js';

export interface SentWebhook {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * App on an in-memory database with no real sleeps and no real network:
 * handlers finish instantly and webhook requests go to a recording fake.
 */
export function createTestApp(options: { seed?: boolean; status?: number; leaseSeconds?: number } = {}): {
  ctx: AppContext;
  sent: SentWebhook[];
} {
  const sent: SentWebhook[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response('ok', { status: options.status ?? 200 });
  }) as unknown as typeof fetch;

  const ctx = createApp(':memory:', options.seed ?? true, {
    leaseSeconds: options.leaseSeconds,
    clientDistDir: null,
    worker: { handlerDelayMs: 0, random: () => 0 },
    webhooks: { fetchImpl },
  });
  return { ctx, sent };
}

import { DatabaseSync } from 'node:sqlite';

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queues (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      concurrency INTEGER NOT NULL DEFAULT 5,
      max_retries INTEGER NOT NULL DEFAULT 3,
      backoff_base_sec INTEGER NOT NULL DEFAULT 2,
      is_paused INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      queue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'queued',
      payload TEXT NOT NULL,
      result TEXT,
      error TEXT,
      idempotency_key TEXT UNIQUE,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      run_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      locked_by TEXT,
      locked_until TEXT,
      FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_polling 
      ON jobs(queue_id, status, run_at, priority);

    CREATE INDEX IF NOT EXISTS idx_jobs_status 
      ON jobs(status);

    CREATE INDEX IF NOT EXISTS idx_jobs_created_at 
      ON jobs(created_at DESC);

    CREATE TABLE IF NOT EXISTS job_attempts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      error TEXT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_job_attempts_job 
      ON job_attempts(job_id, attempt_number);

    CREATE TABLE IF NOT EXISTS webhook_subscriptions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      subscription_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      signature TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      delivered_at TEXT NOT NULL,
      response_body TEXT,
      FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub 
      ON webhook_deliveries(subscription_id, delivered_at DESC);
  `);

  // Databases created before worker leases existed lack the lock columns.
  const columns = (db.prepare('PRAGMA table_info(jobs);').all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes('locked_by')) db.exec('ALTER TABLE jobs ADD COLUMN locked_by TEXT;');
  if (!columns.includes('locked_until')) db.exec('ALTER TABLE jobs ADD COLUMN locked_until TEXT;');
}

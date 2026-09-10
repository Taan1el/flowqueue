# ADR-001: Relational Database-backed Task Queue Architecture

## Status
Accepted

## Context
Background job systems frequently rely on in-memory brokers like Redis (BullMQ, Sidekiq) or cloud-hosted message queues (AWS SQS, RabbitMQ). While these excel at pure sub-millisecond throughput, they introduce critical friction for developer onboarding, local testing, and quick evaluations:
1. They require external daemons and cloud credentials before any code can run.
2. They do not natively support ACID transactions alongside business logic tables (e.g. creating an order and enqueuing its receipt email in a single atomic database commit — the transactional outbox pattern).
3. Historical audit trails of failed job attempts and stack traces are typically purged quickly to save memory.

## Decision
We implemented an ACID relational task queue engine directly on top of SQLite using Node.js v24 native `node:sqlite` (`DatabaseSync`):
- **WAL Mode & Foreign Keys**: `PRAGMA journal_mode = WAL;` enables concurrent readers and writers without lock contention. `PRAGMA foreign_keys = ON;` guarantees cascading integrity across jobs and attempts.
- **Atomic Polling**: Workers claim jobs in a transaction via `UPDATE jobs SET status = 'processing' WHERE id IN (...)` respecting queue concurrency limits and `run_at` scheduling.
- **Index Optimization**: Polling queries utilize a composite index on `(queue_id, status, run_at, priority)` to achieve sub-millisecond selection even under thousands of stored records.

## Consequences
- **Zero-Config Local Development**: Reviewers and developers can run `npm install && npm run dev` instantly without installing Redis, Docker, or external tools.
- **Complete Auditability**: Every attempt, worker ID, execution duration, and stack trace is permanently stored in `job_attempts` for debugging.
- **Trade-off**: Higher disk I/O compared to purely in-memory Redis queues. For extreme throughput scenarios (>50,000 jobs/sec), this architecture can be adapted to partitioned PostgreSQL or dedicated brokers.

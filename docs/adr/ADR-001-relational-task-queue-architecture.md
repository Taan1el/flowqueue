# ADR-001: Relational Database-backed Task Queue Architecture

## Status
Accepted

## Context
Background job systems frequently rely on in-memory brokers like Redis (BullMQ, Sidekiq) or cloud-hosted message queues (AWS SQS, RabbitMQ). While these excel at pure sub-millisecond throughput, they introduce critical friction for developer onboarding and local testing:
1. They require external daemons and cloud credentials before any code can run.
2. They do not natively support ACID transactions alongside business logic tables (e.g. creating an order and enqueuing its receipt email in a single atomic database commit — the transactional outbox pattern).
3. Historical audit trails of failed job attempts and stack traces are typically purged quickly to save memory.

## Decision
We implemented an ACID relational task queue engine directly on top of SQLite using Node.js v24 native `node:sqlite` (`DatabaseSync`):
- **WAL Mode & Foreign Keys**: `PRAGMA journal_mode = WAL;` allows readers alongside a writer; SQLite still serializes writers. `PRAGMA foreign_keys = ON;` guarantees cascading integrity across jobs and attempts.
- **Atomic Polling**: `BEGIN IMMEDIATE` protects capacity calculation and job reservations in one transaction. Due jobs in unpaused queues are ranked by priority, scheduled time, and ID within each queue. Only the remaining slots (concurrency minus processing jobs) enter the globally ordered batch. Reservations commit together or roll back on failure; separate worker connections observe the committed capacity before claiming more work.
- **Index Optimization**: Polling queries utilize a composite index on `(queue_id, status, run_at, priority)` to achieve sub-millisecond selection even under thousands of stored records.

## Consequences
- **Reservation limits**: Processing jobs consume queue slots until completion or retry. Lowering concurrency below the active count stops new claims without cancelling current work. Claim transactions briefly hold the database writer lock; handlers run after commit. Worker crash recovery still requires a separate lease mechanism.
- **Zero-Config Local Development**: Developers can run `npm install && npm run dev` instantly without installing Redis, Docker, or external tools.
- **Complete Auditability**: Every attempt, worker ID, execution duration, and stack trace is permanently stored in `job_attempts` for debugging.
- **Trade-off**: Higher disk I/O compared to purely in-memory Redis queues. For extreme throughput scenarios (>50,000 jobs/sec), this architecture can be adapted to partitioned PostgreSQL or dedicated brokers.

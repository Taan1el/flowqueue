# ADR-001: Relational Database-backed Task Queue Architecture

## Status
Accepted

## Context
Background job systems often rely on in-memory brokers such as Redis (BullMQ, Sidekiq) or hosted message queues (SQS, RabbitMQ). They bring their own operational cost for small deployments and local development:
1. They need an external daemon or cloud credentials before any code can run.
2. They cannot commit a job in the same transaction as the business data that caused it (the transactional outbox pattern), unless the application database is the queue.
3. Failed attempts and their errors are usually expired quickly to save memory.

## Decision
The queue is built on SQLite through Node's built-in `node:sqlite` (`DatabaseSync`):
- **WAL mode and foreign keys**: `PRAGMA journal_mode = WAL;` lets readers run alongside a writer; SQLite still serializes writers. `PRAGMA foreign_keys = ON;` cascades deletes from queues to jobs and from jobs to attempts.
- **Atomic reservation**: `BEGIN IMMEDIATE` covers the capacity calculation and the reservations in one transaction. Due jobs in unpaused queues are ranked by priority, scheduled time and id within each queue. Only the remaining slots (concurrency minus processing jobs) enter the globally ordered batch. Reservations commit together or roll back together, and separate connections see the committed capacity before they reserve more work.
- **Leases**: every reservation stamps `locked_by` and `locked_until` (`LEASE_SECONDS`, default 60). Each poll first returns jobs whose lease expired to the queue. The lost run is recorded as a failed attempt and counts against `max_retries`, so a job that keeps killing its worker ends in the dead letters. A worker that finishes after losing its lease cannot overwrite the result: completion and failure updates only apply while the job is still `processing`.
- **Index**: polling reads use a composite index on `(queue_id, status, run_at, priority)`.

## Consequences
- **Capacity**: processing jobs hold their queue slot until they finish, fail or lose their lease. Lowering concurrency below the number of running jobs stops new starts without cancelling the running ones. Claim transactions briefly hold the database writer lock; handlers run after the commit.
- **Lease length**: there is no heartbeat. A handler that runs longer than the lease can be started a second time by another worker, so keep `LEASE_SECONDS` above the slowest handler. Lease recovery does not send `job.dlq` or `job.failed` webhooks.
- **Zero-config development**: `npm install && npm run dev` needs no Redis, Docker or external service.
- **Auditability**: every attempt keeps its worker id, duration and error message in `job_attempts`.
- **Trade-off**: every state change is a disk write, and one SQLite file means one host. This design is meant for modest throughput; no throughput figures have been measured, and a job volume that outgrows one SQLite writer would call for a different store.

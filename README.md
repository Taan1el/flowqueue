# FlowQueue ⚡

> **Distributed Background Task Queue & Webhook Dispatcher Platform**  
> Built with React 19, TypeScript, Node.js, Express, Relational SQLite (WAL Mode), Docker, and Vitest.

[![CI Pipeline](https://github.com/Taan1el/flowqueue/actions/workflows/ci.yml/badge.svg)](https://github.com/Taan1el/flowqueue/actions)
![Node Version](https://img.shields.io/badge/node-%3E%3D24.0.0-blue)
![TypeScript](https://img.shields.io/badge/typescript-5.8-blue)
![Tests](https://img.shields.io/badge/tests-18%20passing-brightgreen)

---

## 2-Minute Product Summary

FlowQueue is a production-grade asynchronous job queue and webhook delivery engine paired with an observable frontend operations dashboard.

### Core Capabilities:
1. **Asynchronous Background Processing & Queues**:
   - Priority scheduling (`high`, `normal`, `low`), delayed execution (`delay_seconds`), configurable concurrency per queue, and transactional task claiming.
   - Exponential backoff with random jitter to protect downstream systems from retry storms.
   - **Dead-Letter Queue (DLQ)**: Poisoned jobs that exceed max retries are safely quarantined with full execution attempts and can be replayed with 1 click.
2. **Webhook Dispatcher & Cryptographic Security**:
   - Outbound webhook engine with `X-FlowQueue-Signature` computed using **HMAC-SHA256**.
   - Verified in constant time via `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
   - Built-in test sink receiver for instant zero-dependency demonstration of delivery and signature verification.
3. **Relational Database Modeling & ACID Transactions**:
   - Normalized relational schema in SQLite using Node.js v24 native C++ `node:sqlite` (`DatabaseSync`).
   - WAL (`Write-Ahead Logging`) mode enabled for concurrent reads/writes; composite indexes on `(queue_id, status, run_at, priority)` for sub-millisecond worker polling.
   - Idempotency key deduplication ensuring duplicate webhook deliveries or API calls never cause double-execution.
4. **Modern React 19 Dashboard**:
   - Real-time telemetry (throughput jobs/min, active workers, queue depth, average execution latency).
   - Task Inspector drawer showing JSON payload, output, and attempt-by-attempt audit trail.
   - Interactive Enqueue modal with instant presets (Welcome Email, Stripe Charge Sync, Heavy Analytics Export, Simulated Failure).
5. **DevOps, Testing & Standards**:
   - 18 automated integration and component tests (`vitest`, `supertest`, React Testing Library).
   - Multi-stage `Dockerfile` and `docker-compose.yml` with separate Web and Worker services.
   - GitHub Actions CI pipeline running lint, test, and production builds.
   - 3 Architecture Decision Records (`docs/adr/`).

---

## Architecture Diagram

```
                       +-----------------------------------+
                       |    React 19 Dashboard (Vite)     |
                       |  - Live Telemetry & Queue Cards  |
                       |  - Task Inspector & Presets      |
                       |  - Webhook Dispatcher Audit      |
                       +-----------------+-----------------+
                                         | REST / JSON
                                         v
+-------------------------------------------------------------------------+
|                         FlowQueue Node.js Service                       |
|                                                                         |
|  +------------------------+             +----------------------------+  |
|  |   Express REST API     |             |  Background Worker Poller  |  |
|  | - /api/queues          |             | - Atomic job claiming      |  |
|  | - /api/jobs (enqueue)  |             | - Concurrency enforcement  |  |
|  | - /api/webhooks        |             | - Exponential backoff      |  |
|  | - /api/metrics         |             | - DLQ quarantine & replay  |  |
|  +-----------+------------+             +--------------+-------------+  |
|              |                                         |                |
|              +-------------------+   +-----------------+                |
|                                  v   v                                  |
|                 +--------------------------------+                      |
|                 |   Relational Database (SQLite) |                      |
|                 |   - queues & jobs              |                      |
|                 |   - job_attempts (audit trail) |                      |
|                 |   - webhook_deliveries (logs)  |                      |
|                 +----------------+---------------+                      |
|                                  |                                      |
+----------------------------------|--------------------------------------+
                                   v
             +-------------------------------------------+
             |    Outbound HMAC-SHA256 Webhook Engine    |
             |   - Signed with X-FlowQueue-Signature     |
             |   - Dispatched to subscribers / sinks     |
             +-------------------------------------------+
```

---

## Quickstart (Zero External Dependencies)

### 1. Local Development
Requirements: Node.js 24+ (npm).

```bash
# Clone the repository
git clone https://github.com/Taan1el/flowqueue.git
cd flowqueue

# Install all workspace dependencies
npm install

# Run automated tests (18 passed)
npm test

# Typecheck and lint
npm run lint

# Start server (port 4000) and client (port 5173) concurrently
npm run dev
```

Visit **http://localhost:5173** to view the live dashboard!

### 2. Run via Docker Compose

```bash
docker compose up --build
```
This orchestrates the application container and dedicated worker process on `http://localhost:4000`.

---

## REST API Specification

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health status and uptime |
| `GET` | `/api/metrics` | System throughput, queue depths, and execution latencies |
| `GET` | `/api/queues` | List all queues with active/queued/DLQ statistics |
| `PATCH` | `/api/queues/:id` | Pause/resume queue or update concurrency |
| `POST` | `/api/jobs` | Enqueue background job (supports priority, delay, idempotency) |
| `GET` | `/api/jobs` | Filter jobs by queue, status, priority, or search query |
| `GET` | `/api/jobs/:id` | Get job details including full attempt execution history |
| `POST` | `/api/jobs/:id/retry` | Replay a poisoned job from the Dead-Letter Queue (DLQ) |
| `GET` | `/api/webhooks/subscriptions` | List registered webhook subscriptions |
| `POST` | `/api/webhooks/subscriptions` | Register new webhook target with events and secret |
| `GET` | `/api/webhooks/deliveries` | Audit log of dispatched webhooks, HTTP codes, and HMAC headers |
| `POST` | `/api/webhooks/test` | Trigger a test webhook dispatch |
| `POST` | `/api/webhooks/test-receiver` | Built-in test sink verifying incoming HMAC signatures |

---

## Architecture Decision Records (ADRs)

1. [ADR-001: Relational Task Queue Architecture](docs/adr/ADR-001-relational-task-queue-architecture.md)
2. [ADR-002: Exponential Backoff with Jitter and DLQ Strategy](docs/adr/ADR-002-exponential-backoff-and-dlq-strategy.md)
3. [ADR-003: Webhook HMAC-SHA256 Signatures and Delivery Guarantees](docs/adr/ADR-003-webhook-hmac-signatures-and-delivery-guarantees.md)

---

## License
MIT

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- New visual identity: the dashboard is now an operator console. Queues are vertical tabs on the left, the selected queue's jobs fill the middle, and a newest-first event log runs down the right. Dead letters, webhook deliveries and the enqueue form moved into tabs under the jobs table, and the stats strip became a single telemetry line. Text is set in JetBrains Mono and Lexend on a pale green-grey page with square corners, hairline rules and square status marks.

## [1.0.0] - 2026-10-02

### Added
- Job queue on SQLite (`node:sqlite`, WAL mode) with named queues, per-queue concurrency, priorities (`high`, `normal`, `low`), delayed jobs and idempotency keys.
- Worker that reserves due jobs in one `BEGIN IMMEDIATE` transaction and only takes the free slots of each queue, so a queue never runs more jobs than its capacity, even across several connections.
- Retries with exponential backoff and a small jitter, a dead-letter list with replay, and a full attempt history per job.
- Worker leases: a job whose worker died is returned to the queue when its lease expires, and the lost run counts as a failed attempt. A late result from a worker that lost its lease is discarded. `LEASE_SECONDS` sets the lease length.
- `handlers` option on `WorkerService` for registering real job handlers by job name.
- Signed webhooks for `job.completed`, `job.failed` and `job.dlq` with an `X-FlowQueue-Signature` HMAC-SHA256 header, a delivery log, a test-delivery endpoint and a sample receiver endpoint.
- Input validation on every write endpoint, with 400, 404 and 409 responses instead of generic errors.
- `shared/queue-logic.ts` with the pure queue rules (priority weights, backoff, dead-lettering, replay budget, reservation order, metrics) used by both the server and the browser demo.
- React dashboard: stats strip, queues table, jobs table with filters and search, enqueue form, dead letters, webhook deliveries and a job inspector.
- In-browser demo mode for GitHub Pages with deterministic sample data, served under `/flowqueue/`, with a demo bar and a reset action.
- Docker image and Compose file, GitHub Actions CI (lint, tests, build, Pages build and a Docker smoke test on Node 22 and 24) and a Pages workflow.
- Server and client test suites, including fake-clock tests for retries, leases and the demo engine.
- MIT license, `.env.example` files for the server and the client, and architecture decision records.

### Changed
- Redesigned the dashboard with a light paper theme and one teal accent, Sora, Geist and Geist Mono fonts, tables with status dots instead of cards, a single stats strip, and an enqueue form beside the jobs table instead of a modal. Emoji, gradients and shadows were removed.
- Job and queue API errors now carry the right HTTP status: unknown queue 404, replay of a job that is not dead-lettered 409, malformed input 400.
- `GET /api/webhooks/subscriptions` and subscription creation no longer return the signing secret, only its first characters.

### Fixed
- The `start` script and the Docker entry point pointed at `dist/index.js`, but the build writes `dist/server/src/index.js`.
- The Docker image did not contain a server route for the dashboard, so `/` returned 404. The server now serves `client/dist` when it exists.
- `.gitignore` started with a byte order mark and only matched a top-level `data/` folder, so the SQLite file written to `server/data/` was not ignored.
- "Completed today" counted every completed job ever, and "failed today" counted every failed attempt ever. Both now count from 00:00 UTC.
- Replaying a dead-lettered job left it with no runs to spare, so it failed once and went straight back to the dead letters. A replay now grants one more run.
- Replay accepted a `failed` status that no code ever sets; only dead-lettered jobs can be replayed.
- Searching for `%` or `_` matched every job because LIKE wildcards were not escaped.
- Invalid enqueue bodies (negative delay, unknown priority, non-object payload) and unknown queues produced 500 responses or stored bad values.
- Signature verification now compares lengths before `timingSafeEqual`.
- The seeded webhook delivery carried a made-up signature; it is now a real HMAC of its body.
- The enqueue form sent the default queue name instead of the queue shown first in the list until the user touched the field.
- Removed claims the code could not back: sub-millisecond polling, "zero lost tasks", at-least-once webhook delivery and signature verification in the sample receiver.

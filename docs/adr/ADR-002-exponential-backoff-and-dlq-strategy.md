# ADR-002: Exponential Backoff with Jitter and Dead-Letter Containment

## Status
Accepted

## Context
Downstream systems (payment gateways, logistics APIs, email providers) fail in transient ways: timeouts, HTTP 429, short outages. Immediate or fixed-interval retries from many jobs at once add load to a service that is already struggling. Jobs with a permanent problem (a malformed payload, a removed resource) should not be retried forever either.

## Decision
1. **Exponential backoff with a small jitter**:
   after the n-th failed run the next run is scheduled `backoff_base_sec * 2^(n - 1)` seconds ahead, plus a random 0 or 1 second. `backoff_base_sec` is set per queue (for example 2 s for notifications, 5 s for data sync). The jitter is small on purpose; it spreads retries only slightly.
2. **Dead letters**:
   `max_retries` is the total number of runs a job may use, not the number of extra tries. When run number `max_retries` fails, the job moves to status `dlq` and a `job.dlq` event is sent to subscribed webhooks.
3. **Replay**:
   a dead-lettered job keeps its payload, error and attempt history. `POST /api/jobs/:id/retry` (or the dashboard) queues it again with exactly one more run allowed; if that run fails too, the job returns to the dead letters.

## Consequences
- Retry load on a failing dependency falls off exponentially, with only a little desynchronization between jobs.
- A job is never dropped silently after a handler failure: it either completes or stays inspectable in the dead letters. A job whose worker dies is recovered through leases (ADR-001), not through this mechanism.
- Transient failures and permanent ones are separated by the attempt budget only; the queue does not classify errors.

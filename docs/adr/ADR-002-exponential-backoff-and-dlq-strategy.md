# ADR-002: Exponential Backoff with Jitter and Dead-Letter Queue (DLQ) Containment

## Status
Accepted

## Context
External downstream systems (payment gateways, third-party logistics APIs, email providers) frequently suffer transient network timeouts, rate limiting (HTTP 429), or temporary outages. Immediate retries or fixed-interval retries create "thundering herd" spikes that further degrade downstream services. Additionally, persistently malformed payloads (poison pills) can crash worker processes repeatedly if not isolated.

## Decision
1. **Exponential Backoff with Full Jitter**:
   Each failed attempt schedules the next retry according to:
   $$\text{delaySeconds} = \text{baseSec} \times 2^{\text{attempt} - 1} + \text{jitter}(0..2\text{s})$$
   where `baseSec` is configured per queue (e.g. 2s for notifications, 5s for data sync). The random jitter prevents concurrent retrying workers from hitting external endpoints simultaneously.
2. **Dead-Letter Queue (DLQ) Containment**:
   When `attempt >= max_retries`, the job transitions to status `dlq` instead of being retried.
   A `job.dlq` webhook notification is dispatched to notify engineers.
3. **Replay Capabilities**:
   Jobs in the DLQ remain inspectable with all failed attempts and errors preserved. Operators can trigger a replay via `POST /api/jobs/:id/retry` or the dashboard UI once the underlying issue is resolved.

## Consequences
- Protects downstream services from retry storms.
- Guarantees zero lost tasks while maintaining clean queue throughput.
- Clear separation between transient glitches and permanent bugs.

# ADR-003: Webhook HMAC-SHA256 Signatures and At-Least-Once Delivery

## Status
Accepted

## Context
When FlowQueue notifies subscriber endpoints of state transitions (`job.completed`, `job.failed`, `job.dlq`), recipient servers must verify:
1. The message originated from FlowQueue and not an attacker.
2. The payload was not intercepted or tampered with in transit.
3. The signature comparison itself is not vulnerable to timing attacks.

## Decision
1. **Cryptographic Signatures**:
   Every webhook request includes an `X-FlowQueue-Signature` header computed as:
   $$\text{Signature} = \text{"sha256="} + \text{HMAC-SHA256}(\text{rawPayload}, \text{sharedSecret})$$
2. **Timing-Safe Verification**:
   Signature validation utilizes `crypto.timingSafeEqual()` in constant time to eliminate side-channel timing vulnerabilities.
3. **Delivery Audit Logs**:
   Every delivery attempt records target URL, HTTP status code, latency (ms), full signature header, and response preview in `webhook_deliveries`.
4. **Built-in Receiver Sink**:
   A dedicated mock endpoint (`POST /api/webhooks/test-receiver`) is embedded in the platform to allow local developers to test end-to-end dispatch and cryptographic verification with zero external dependencies.

## Consequences
- Conforms to industry security standards established by Stripe, GitHub, and Shopify.
- Provides developers with a reliable audit trail of webhook latency and delivery failures.

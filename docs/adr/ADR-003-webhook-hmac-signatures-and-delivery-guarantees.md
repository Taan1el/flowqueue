# ADR-003: Webhook HMAC-SHA256 Signatures and Single-Attempt Delivery

## Status
Accepted

## Context
FlowQueue notifies subscriber endpoints of job state changes (`job.completed`, `job.failed`, `job.dlq`). A recipient needs to check that:
1. the message was sent by a holder of the shared secret,
2. the body was not altered in transit,
3. the comparison of signatures does not leak timing information.

## Decision
1. **Signature**:
   every request carries `X-FlowQueue-Signature: sha256=<hex>`, the HMAC-SHA256 of the exact request body keyed with the subscription secret. The body is a JSON envelope with `id`, `event`, `created_at` and `data`.
2. **Verification helper**:
   `WebhookService.verifySignature` compares with `crypto.timingSafeEqual` after checking the lengths match.
3. **Delivery log**:
   every delivery attempt records the target subscription, HTTP status, duration, the signature header and the first 500 characters of the response in `webhook_deliveries`. A network error or a timeout (6 s) is stored as status 504 with the error text.
4. **Single attempt**:
   a job event is posted once per subscribed endpoint, in the background. A failed delivery is logged and not retried, so delivery is at most once per event.
5. **Secrets are write-only**:
   the API returns only the first characters of a secret.
6. **Built-in receiver**:
   `POST /api/webhooks/test-receiver` accepts a delivery and echoes the event and signature it received. It does not hold any subscription secret and does not verify the signature.

## Consequences
- Receivers must verify the signature themselves with the shared secret; the signature does not include a timestamp check, so a captured request can be replayed unless the receiver tracks the envelope `id`.
- A receiver that is down when an event happens does not get that event later. The delivery log shows what failed. Retrying deliveries is on the roadmap.
- Subscription URLs are not restricted beyond requiring http or https, so a deployment must keep the API away from untrusted users (see the README limitations).

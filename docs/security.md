# Security

## Current posture

This project has some deliberate guardrails, but it is not a hardened multi-tenant system.

## Present controls

### Inbound media-server webhook verification

`/api/webhooks/media-server/progress` requires:

- `x-cap-timestamp`
- `x-cap-signature`
- `x-cap-delivery-id`

The API:

- verifies HMAC SHA-256 using `MEDIA_SERVER_WEBHOOK_SECRET`
- enforces timestamp skew
- uses timing-safe comparison
- records accepted/rejected events

### Idempotency on mutations

Mutation endpoints use `Idempotency-Key` + request-hash matching to prevent duplicate side effects.

### Rate limiting

Global rate limiting is enabled in `web-api`:

- 100 requests/minute per client key
- webhook routes are allowlisted from that limiter

### Webhook URL restrictions on create

User-supplied `webhookUrl` is validated to block obvious internal targets such as:

- `localhost`
- loopback
- Docker service names
- `.internal`
- `.local`

This reduces simple SSRF mistakes.

## Important gaps

### No auth

There is no user authentication or authorization layer.

### Outbound webhooks are unsigned

`deliver_webhook` sends plain JSON POST requests without a signature header.

### Single-tenant assumptions

The codebase is built around one trusted tenant/environment, not tenant isolation.

### Storage exposure depends on deployment

The default compose stack exposes MinIO API on a host port. That may be fine for local/dev but should be reviewed carefully for real deployments.

## Recommendations

Highest-priority improvements:

1. add auth
2. sign outbound webhooks
3. tighten object-storage exposure and bucket policy
4. add structured audit logging for destructive actions
5. formalize SSRF protections for all outbound fetches, not just create-time webhook validation

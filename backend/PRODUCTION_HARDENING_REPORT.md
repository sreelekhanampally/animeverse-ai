# AnimeVerse Production Hardening

## Scope

This patch hardens the current AnimeVerse backend without changing the public product behavior or adding runtime dependencies.

### 1. Structured request logging

- JSON logs with timestamp, level, service, environment and event name.
- Every request receives a request ID.
- A safe inbound `X-Request-ID` is preserved; otherwise the backend generates a UUID.
- `X-Request-ID` is returned in the response and included in error bodies.
- Request logs include method, path, status, duration and response size.
- Request bodies and query strings are not logged.
- Common secret fields, bearer tokens and MongoDB URI credentials are redacted.
- Health-probe request logs are quiet by default.

### 2. Central error handling

A dedicated error middleware now normalizes:

- `ApiError`
- Mongoose validation errors
- invalid ObjectIds / cast errors
- duplicate-key conflicts
- Multer upload errors
- JWT errors
- oversized JSON/form bodies
- unknown server failures

Production responses hide unknown 5xx internals while server logs retain structured diagnostics. Every error response includes its request ID.

### 3. Liveness and readiness

Endpoints:

- `GET /api/v1/healthcheck` keeps the original health endpoint working.
- `GET /api/v1/healthcheck/live` is the liveness probe.
- `GET /api/v1/healthcheck/ready` is the readiness probe.

Readiness returns HTTP 200 only when:

- MongoDB is connected,
- startup environment validation passes, and
- the process is not shutting down.

It returns HTTP 503 otherwise. Health probes are outside the global rate limiter.

For Render or another orchestrator, use `/api/v1/healthcheck/ready` as the health/readiness path.

### 4. Timeout handling

Default application deadlines:

- regular API requests: 30s
- AI requests: 90s
- multipart uploads: 10m
- Node HTTP request timeout: 11m
- shutdown grace period: 20s

MongoDB also has explicit server-selection, connect and socket timeouts.

The request middleware exposes an `AbortSignal` on `req.abortSignal` so downstream work can adopt cooperative cancellation over time.

### 5. Gemini circuit breaker

Gemini keeps its existing per-model timeout and model failover. On top of that, this patch adds a circuit breaker around a complete Gemini turn:

- default failure threshold: 3 consecutive full-provider failures
- default cooldown: 30s
- states: `closed`, `open`, `half_open`
- while open, AnimeVerse skips outbound Gemini HTTP calls and immediately follows its existing fallback path
- after cooldown, one half-open probe is allowed
- a successful probe closes the circuit
- authentication and bad-request errors do not count as provider-outage failures

The current circuit state is exposed through existing safe assistant diagnostics and is shown on the AI Evaluation page as `Provider circuit`.

### 6. Graceful shutdown

`SIGTERM` and `SIGINT` now:

1. mark the instance as not-ready,
2. stop accepting new HTTP connections,
3. allow in-flight work to drain within the configured grace period,
4. close idle/remaining connections when needed,
5. disconnect Mongoose,
6. finish with a structured shutdown log.

Unhandled rejections and uncaught exceptions use the same controlled shutdown path.

### 7. Environment validation

Startup now validates core configuration before opening the server.

Production checks include:

- MongoDB URI presence/shape
- JWT secrets and expiries
- minimum production JWT-secret length
- no placeholder JWT secrets
- non-wildcard production CORS
- valid chat/embedding provider values
- positive timeout values
- OpenAI key when OpenAI embeddings are explicitly selected

Optional Gemini and YouTube keys remain optional because AnimeVerse already has fallback behavior and YouTube ingestion is an internal command.

### 8. Deployment checks

New commands:

```powershell
npm run deploy:check
npm run deploy:check:db
```

`deploy:check` performs a production-readiness configuration check without printing secrets.

`deploy:check:db` performs the same checks and also connects to MongoDB and sends an admin ping.

The deployment check treats Cloudinary as required because creator upload is a production feature. Gemini and YouTube are reported as optional/fallback capabilities.

## New environment settings

```env
LOG_LEVEL=info
LOG_HEALTH_REQUESTS=false
TRUST_PROXY=1

APP_REQUEST_TIMEOUT_MS=30000
AI_REQUEST_TIMEOUT_MS=90000
UPLOAD_REQUEST_TIMEOUT_MS=600000
SERVER_REQUEST_TIMEOUT_MS=660000
SERVER_HEADERS_TIMEOUT_MS=65000
SERVER_KEEP_ALIVE_TIMEOUT_MS=5000
SHUTDOWN_GRACE_MS=20000

MONGODB_SERVER_SELECTION_TIMEOUT_MS=10000
MONGODB_CONNECT_TIMEOUT_MS=10000
MONGODB_SOCKET_TIMEOUT_MS=45000
MONGODB_MAX_POOL_SIZE=10

GEMINI_CIRCUIT_FAILURE_THRESHOLD=3
GEMINI_CIRCUIT_COOLDOWN_MS=30000
```

These are already documented in `backend/.env.sample`.

## Verification

Focused production-hardening tests:

- 7 passed
- 0 failed

Full backend test suite after the patch:

- 199 discovered
- 192 passed
- 0 failed
- 7 skipped optional/live-model tests

Additional checks:

- all changed backend JavaScript passed `node --check`
- changed AI Evaluation JSX parsed successfully with Babel
- deployment checker passed with a production-shaped test environment
- Gemini circuit test verifies that an open circuit makes zero additional outbound provider calls
- readiness test verifies HTTP 503 when MongoDB is unavailable

A few older assertions were updated to match the UI copy cleanup already applied in the previous patch. Those test-only changes do not alter ranking or product behavior.

## Apply

Extract this ZIP directly into the AnimeVerse repository root:

```text
C:\Users\nsree\Desktop\animeverse-ai
```

Preserve the paths inside the archive and do not create a nested `animeverse-ai\animeverse-ai` folder.

Then run:

```powershell
cd C:\Users\nsree\Desktop\animeverse-ai\backend
npm test
npm run deploy:check
npm run dev
```

For a real production environment, after the deployment secrets are configured:

```powershell
npm run deploy:check:db
```

Then verify:

```text
/api/v1/healthcheck/live
/api/v1/healthcheck/ready
/api/v1/ai/evaluation
```

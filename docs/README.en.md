# CS2 Trade-Up Price Worker

## Overview

`cs2-tradeup-price-worker` is a standalone Node.js worker responsible for keeping CS2 skin prices up to date.

Its core responsibilities are:

- reading `collections` and `skins` from MongoDB
- running pricing sync jobs
- fetching market prices from Steam
- writing normalized price data to MongoDB
- tracking pricing sync job progress and resumable state in MongoDB
- notifying the backend after a successful full pricing sync

The worker does not calculate rankings or trade-up opportunities. That business logic stays in the backend.

## Architecture Role

The worker sits between Steam and the backend.

### Worker -> MongoDB

The worker uses MongoDB as both its source catalog and its state store.

It reads:

- `collections`
- `skins`

It writes:

- `pricings`
- `pricingsyncjobs`
- `refreshstates`

### Worker -> Steam API

The worker calls Steam Community Market endpoints to fetch item pricing information.

It uses:

- `priceoverview` for direct price lookups
- `market/search/render` for search-based price discovery

Steam is the external source of truth for raw market prices.

### Worker -> Backend

The worker does not rebuild rankings itself. After a pricing sync job completes successfully, it sends a best-effort notification to the backend internal endpoint so the backend can rebuild ranking or opportunity-scan results using its own business rules.

## Setup and Run

### Requirements

- Node.js 20+ recommended
- npm
- MongoDB

### Install

```bash
npm install
cp .env.example .env
```

### Development

```bash
npm run dev
```

Default development behavior is safe:

- the worker starts
- MongoDB connection is established
- the dispatcher runs
- manually created jobs can be processed
- paused jobs can auto-resume after Steam `429`
- scheduled full refresh cycles do not start unless `AUTO_REFRESH_ENABLED=true`

### Production

```bash
npm start
```

Typical production behavior:

- `NODE_ENV=production`
- `AUTO_REFRESH_ENABLED=true`

In that mode the worker also starts the automatic refresh scheduler.

## Environment Variables

The worker currently uses the following environment variables.

### Core runtime

- `MONGODB_URI`: MongoDB connection string used by both the worker and the backend.
- `NODE_ENV`: runtime environment. Defaults to `development`.
- `LOG_LEVEL`: structured logger level. Supported levels are `debug`, `info`, `warn`, `error`.

### Automatic refresh control

- `AUTO_REFRESH_ENABLED`: main switch for automatic full refresh cycles. In development the default is effectively `false`. In production the default is effectively `true` unless explicitly overridden.
- `AUTO_REFRESH_INTERVAL_MS`: interval between automatic refresh cycles. Default is 6 hours.

### Progress logging

- `WORKER_VERBOSE_PROGRESS`: when `true`, the worker logs progress for every processed skin.
- `WORKER_PROGRESS_EVERY_N_SKINS`: in normal mode, periodic progress logging interval. Default is `100`.

### Backend notification

- `BACKEND_INTERNAL_URL`: backend base URL used for the internal completion notification.
- `BACKEND_INTERNAL_TOKEN`: optional bearer token for the internal backend endpoint. Some backend environments may document this as an internal token or simply `INTERNAL_TOKEN`; in this worker the env name is `BACKEND_INTERNAL_TOKEN`.

### Steam configuration

- `STEAM_MARKET_APP_ID`: Steam app id. Default is `730` for CS2.

### Pricing cache and request behavior

- `PRICE_CACHE_TTL_MINUTES`: TTL written into price cache documents.
- `PRICE_REQUEST_DELAY_MS`: fixed delay used between retry attempts and between certain follow-up requests.
- `PRICE_REQUEST_RETRIES`: retry count for Steam requests that fail.

### Rate limiting and delays

The worker also has built-in internal timing behavior that is not currently exposed as env variables:

- random pre-request Steam delay between 3 and 10 seconds
- exponential backoff for Steam request retries
- base pause of 10 minutes when a full pricing sync is paused due to Steam `429`

## Pricing Sync Flow

The main pricing sync flow is implemented in the pricing sync runner.

### 1. Job start

The worker starts or resumes a `PricingSyncJob` document in MongoDB. The job stores state such as:

- status
- current collection
- current skin
- processed counters
- failed and partial items
- `resumeAfter`
- observability fields such as `lastHeartbeatAt`

### 2. Collection iteration

The runner loads collections in a stable order and then loads skins for each collection in a stable order.

This guarantees deterministic progress and allows the worker to resume from checkpoints.

### 3. Price fetching

For each skin, the worker:

1. loads the current cached price map from MongoDB
2. requests Steam market data
3. normalizes the resulting exterior price map
4. writes the updated `Pricing` document to MongoDB

### 4. Progress persistence

During execution, the worker periodically updates the `PricingSyncJob` document with:

- processed collections
- processed skins
- current collection and current skin
- partial and failed items
- observability fields such as `lastProgressMessage`

### 5. Handle Steam `429`

If Steam rate limits the sync:

1. the worker updates the job progress
2. sets `last429At`
3. increments `consecutiveRateLimitPauses`
4. calculates `resumeAfter`
5. changes the job status to `paused`
6. schedules automatic resume

### 6. Resume

When `resumeAfter` is reached, the dispatcher or the timer resumes the paused job and the runner continues from the saved checkpoint instead of starting over.

### 7. Completion

When all collections have been processed successfully:

- the job status becomes `completed`
- `finishedAt` is saved
- active checkpoint fields are cleared
- the worker logs completion
- the worker sends a best-effort backend notification

The worker does not notify the backend for paused or failed jobs.

## Rate Limiting Behavior

Steam `429` handling is a core worker feature.

### What happens on `429`

If pricing fetches hit rate limiting:

- the current full pricing sync job is paused
- checkpoint data is preserved
- `resumeAfter` is set
- the worker records observability fields
- a local auto-resume timer is scheduled

### `resumeAfter` logic

The pause delay uses a base pause window and increases with consecutive rate-limit pauses.

This means:

- first pause -> base delay
- repeated pauses -> larger delay

The dispatcher also checks MongoDB for paused jobs whose `resumeAfter` has already passed. That allows recovery after worker restarts.

## Currency Conversion

### Current worker behavior

The worker currently requests Steam data in USD-oriented mode:

- Steam `currency=1`
- Steam `country=US`

The worker stores normalized price maps in MongoDB as the values returned from those requests. In practice, the pricing pipeline is implemented as a USD-based flow.

### USD -> UAH logic

There is currently no USD -> UAH conversion logic in this worker repository.

That means:

- the worker does not fetch FX rates
- the worker does not convert stored prices to UAH
- the worker does not implement backend-side display or ranking currency logic

If UAH conversion exists in the overall system, it belongs outside this worker, typically in the backend or another dedicated service.

### Source skin selection

There is also no separate “source skin selection” or fallback ranking-selection algorithm in this worker beyond the existing Steam search and exterior matching logic.

The worker only:

- finds Steam search results
- matches results to supported exteriors
- writes normalized price maps

Any higher-level logic about which price source should drive ranking calculations belongs in the backend.

## Backend Notification

After a pricing sync job is fully completed and saved as `completed`, the worker calls:

- `POST /api/internal/rankings/rebuild-after-pricing`

Payload shape:

```json
{
  "pricingSyncJobId": "<job id>",
  "completedAt": "<ISO date>",
  "source": "price-worker"
}
```

Purpose:

- tell the backend that fresh pricing data is available
- let the backend rebuild rankings or opportunity scans using backend-owned business logic

Important details:

- notification is best-effort
- notification failure does not crash the worker
- notification is only sent after successful completion
- no notification is sent for paused or failed jobs

## Main Modules

### `pricing-sync`

Main pricing sync orchestration lives in:

- `pricing-sync.dispatcher.js`
- `pricing-sync.runner.js`
- `pricing-sync.service.js`
- `pricing-sync.model.js`

### `pricing-sync.dispatcher.js`

The dispatcher wakes up every few seconds and decides what to do next:

- continue a running job
- resume a resumable paused job
- ensure an already-paused job has an auto-resume timer

### `pricing-sync.runner.js`

The runner executes the actual sync loop:

- iterates collections
- iterates skins
- fetches prices
- updates checkpoints
- pauses on `429`
- resumes from checkpoints
- marks jobs completed or failed

### `pricing-sync.service.js`

The service layer manages job persistence in MongoDB:

- start
- pause
- resume
- complete
- fail
- checkpoint updates

### `pricing.steam.service.js`

This module owns Steam communication:

- builds Steam URLs
- performs fetches
- retries failed requests
- parses Steam price payloads
- detects rate limiting

## Important Behaviors

### One job at a time

The worker is intentionally conservative. Only one pricing sync runner can execute at a time in the process.

This reduces race conditions around:

- MongoDB checkpoints
- Steam rate limiting
- cache invalidation

### Resume logic

The worker is designed to resume instead of restarting expensive syncs from scratch.

It stores enough checkpoint information in MongoDB to resume from:

- the current collection
- the current skin
- processed counters
- scheduled resume time

### External state control

During execution, the runner periodically re-reads the latest job state from MongoDB. If an external actor changes the job to `paused` or `cancelled`, the runner stops safely and preserves checkpoint state.

### Why the worker is separated

The worker is separated from the backend because price synchronization is:

- long-running
- rate-limit sensitive
- operationally noisy
- easier to observe and restart independently

This keeps the backend focused on reading data and serving application logic, while the worker focuses on data collection and synchronization.

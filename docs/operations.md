# Price Worker Operations

## What this service does

- reads `collections` and `skins`
- writes `Pricing`
- writes `PricingSyncJob`
- writes `RefreshState`
- retries and resumes sync jobs after rate limits

## What this service does not do

- does not expose HTTP API
- does not seed catalog data
- does not serve frontend requests
- does not run opportunity scan jobs

## Startup checklist

1. MongoDB is running
2. Backend import/seed already populated `skins` and `collections`
3. `.env` exists
4. `npm install` completed
5. `npm start` or `npm run dev` is running

## Shared MongoDB requirement

`cs2-tradeup-price-worker` and `cs2-tradeup-backend` must use the same `MONGODB_URI`.

If they point to different databases, backend will not see refreshed prices.

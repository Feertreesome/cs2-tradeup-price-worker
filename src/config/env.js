import dotenv from 'dotenv';

dotenv.config();

export const env = {
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cs2-tradeup-mvp',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  autoRefreshEnabled:
    process.env.AUTO_REFRESH_ENABLED !== undefined
      ? process.env.AUTO_REFRESH_ENABLED === 'true'
      : (process.env.NODE_ENV || 'development') === 'production',
  autoRefreshIntervalMs: Number(process.env.AUTO_REFRESH_INTERVAL_MS) || 6 * 60 * 60 * 1000,
  workerVerboseProgress: process.env.WORKER_VERBOSE_PROGRESS === 'true',
  workerProgressEveryNSkins: Math.max(Number(process.env.WORKER_PROGRESS_EVERY_N_SKINS) || 100, 1),
  workerRunningJobStaleAfterMs: Math.max(Number(process.env.WORKER_RUNNING_JOB_STALE_AFTER_MS) || 30 * 60 * 1000, 1),
  backendInternalUrl: process.env.BACKEND_INTERNAL_URL || '',
  backendInternalToken: process.env.BACKEND_INTERNAL_TOKEN || '',
  steamMarketAppId: Number(process.env.STEAM_MARKET_APP_ID) || 730,
  priceCacheTtlMinutes: Number(process.env.PRICE_CACHE_TTL_MINUTES) || 360,
  priceRequestDelayMs: Number(process.env.PRICE_REQUEST_DELAY_MS) || 400,
  priceRequestRetries: Number(process.env.PRICE_REQUEST_RETRIES) || 2
};

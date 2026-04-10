import { env } from '../../config/env.js';
import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('pricing-sync-backend-notifier');
const RANKING_REBUILD_PATH = '/api/internal/rankings/rebuild-after-pricing';
const REQUEST_TIMEOUT_MS = 5_000;

const buildNotificationUrl = () => {
  if (!env.backendInternalUrl) {
    return null;
  }

  return new URL(RANKING_REBUILD_PATH, env.backendInternalUrl).toString();
};

export const notifyRankingRebuildAfterPricing = async (job) => {
  const notificationUrl = buildNotificationUrl();

  if (!notificationUrl) {
    logger.warn('ranking rebuild notification failed', {
      jobId: job?._id?.toString?.() || null,
      reason: 'BACKEND_INTERNAL_URL is not configured'
    });
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const payload = {
    pricingSyncJobId: job._id.toString(),
    completedAt: job.finishedAt instanceof Date ? job.finishedAt.toISOString() : new Date().toISOString(),
    source: 'price-worker'
  };

  logger.info('ranking rebuild notification started', {
    jobId: payload.pricingSyncJobId,
    url: notificationUrl
  });

  try {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (env.backendInternalToken) {
      headers.Authorization = `Bearer ${env.backendInternalToken}`;
    }

    const response = await fetch(notificationUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Backend notification failed with status ${response.status}`);
    }

    logger.info('ranking rebuild notification accepted', {
      jobId: payload.pricingSyncJobId,
      status: response.status
    });

    return true;
  } catch (error) {
    logger.error('ranking rebuild notification failed', {
      jobId: payload.pricingSyncJobId,
      error: error instanceof Error ? error.message : String(error)
    });

    return false;
  } finally {
    clearTimeout(timeout);
  }
};

import { env } from '../../config/env.js';
import { createLogger } from '../../shared/utils/logger.js';

const logger = createLogger('pricing-sync-backend-notifier');
const REQUEST_TIMEOUT_MS = 5_000;
const GITHUB_API_URL = 'https://api.github.com';

const getDispatchConfig = () => {
  if (
    !env.githubBackendRepoOwner ||
    !env.githubBackendRepoName ||
    !env.githubBackendRepoDispatchToken ||
    !env.githubBackendRepoDispatchEvent
  ) {
    return null;
  }

  return {
    owner: env.githubBackendRepoOwner,
    repo: env.githubBackendRepoName,
    token: env.githubBackendRepoDispatchToken,
    eventType: env.githubBackendRepoDispatchEvent
  };
};

export const notifyRankingRebuildAfterPricing = async (job) => {
  const dispatchConfig = getDispatchConfig();

  if (!dispatchConfig) {
    logger.warn('backend opportunity scan dispatch failed', {
      jobId: job?._id?.toString?.() || null,
      reason: 'GitHub backend dispatch env vars are not fully configured'
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
  const dispatchUrl = `${GITHUB_API_URL}/repos/${dispatchConfig.owner}/${dispatchConfig.repo}/dispatches`;

  logger.info('backend opportunity scan dispatch started', {
    jobId: payload.pricingSyncJobId,
    owner: dispatchConfig.owner,
    repo: dispatchConfig.repo,
    eventType: dispatchConfig.eventType
  });

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${dispatchConfig.token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    const response = await fetch(dispatchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event_type: dispatchConfig.eventType,
        client_payload: payload
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub dispatch failed with status ${response.status}${errorText ? `: ${errorText}` : ''}`);
    }

    logger.info('backend opportunity scan dispatch accepted', {
      jobId: payload.pricingSyncJobId,
      owner: dispatchConfig.owner,
      repo: dispatchConfig.repo,
      eventType: dispatchConfig.eventType,
      status: response.status
    });

    return true;
  } catch (error) {
    logger.error('backend opportunity scan dispatch failed', {
      jobId: payload.pricingSyncJobId,
      error: error instanceof Error ? error.message : String(error)
    });

    return false;
  } finally {
    clearTimeout(timeout);
  }
};

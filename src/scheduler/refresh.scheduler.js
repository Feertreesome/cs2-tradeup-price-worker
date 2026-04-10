import { env } from '../config/env.js';
import { pricingSyncJobStatuses } from '../modules/pricing-sync/pricing-sync.constants.js';
import { resumePricingSyncJob, runPricingSyncJob } from '../modules/pricing-sync/pricing-sync.runner.js';
import { getResumablePausedSyncJob } from '../modules/pricing-sync/pricing-sync.service.js';
import { RefreshState } from './refresh-state.model.js';

const REFRESH_STATE_KEY = 'production-refresh';

let refreshSchedulerTimer = null;
let isRefreshing = false;

const upsertRefreshState = async (updates = {}) =>
  RefreshState.findOneAndUpdate(
    { key: REFRESH_STATE_KEY },
    {
      $set: {
        key: REFRESH_STATE_KEY,
        ...updates
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

export const getRefreshState = async () => RefreshState.findOne({ key: REFRESH_STATE_KEY }).lean();

const runAutomaticRefreshCycle = async () => {
  if (isRefreshing) {
    return null;
  }

  isRefreshing = true;

  try {
    const startedAt = new Date();
    await upsertRefreshState({
      status: 'running',
      lastStartedAt: startedAt,
      lastFinishedAt: null,
      lastError: null
    });

    const resumablePricingJob = await getResumablePausedSyncJob();
    const pricingJob = resumablePricingJob
      ? await resumePricingSyncJob(resumablePricingJob._id.toString())
      : await runPricingSyncJob();

    if (!pricingJob || pricingJob.status !== pricingSyncJobStatuses.completed) {
      await upsertRefreshState({
        status: 'waiting',
        lastFinishedAt: new Date(),
        lastError: pricingJob ? `Pricing sync ended with status ${pricingJob.status}` : 'Pricing sync did not return a job',
        lastPricingSyncJobId: pricingJob?._id || null
      });
      return pricingJob;
    }

    await upsertRefreshState({
      status: 'idle',
      lastFinishedAt: new Date(),
      lastSuccessfulAt: new Date(),
      lastError: null,
      lastPricingSyncJobId: pricingJob._id
    });

    return pricingJob;
  } catch (error) {
    await upsertRefreshState({
      status: 'failed',
      lastFinishedAt: new Date(),
      lastError: error instanceof Error ? error.message : String(error || 'Automatic refresh failed')
    });

    return null;
  } finally {
    isRefreshing = false;
  }
};

export const startRefreshScheduler = (intervalMs = env.autoRefreshIntervalMs) => {
  if (!env.autoRefreshEnabled || refreshSchedulerTimer) {
    return refreshSchedulerTimer;
  }

  refreshSchedulerTimer = setInterval(() => {
    void runAutomaticRefreshCycle();
  }, intervalMs);

  if (typeof refreshSchedulerTimer.unref === 'function') {
    refreshSchedulerTimer.unref();
  }

  void runAutomaticRefreshCycle();

  return refreshSchedulerTimer;
};

export const stopRefreshScheduler = () => {
  if (!refreshSchedulerTimer) {
    return;
  }

  clearInterval(refreshSchedulerTimer);
  refreshSchedulerTimer = null;
};

export const isRefreshSchedulerRunning = () => isRefreshing;

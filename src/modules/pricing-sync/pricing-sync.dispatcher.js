import { getActiveSyncJob, getLatestSyncJob, getResumablePausedSyncJob } from './pricing-sync.service.js';
import {
  ensurePricingSyncResumeTimer,
  isPricingSyncRunnerActive,
  resumePricingSyncInBackground,
  runPricingSyncJob
} from './pricing-sync.runner.js';
import { pricingSyncJobStatuses } from './pricing-sync.constants.js';

const PRICING_SYNC_DISPATCH_INTERVAL_MS = 5_000;

let pricingSyncDispatchTimer = null;
let isDispatchingPricingSync = false;

const dispatchPricingSyncWork = async () => {
  if (isDispatchingPricingSync || isPricingSyncRunnerActive()) {
    return null;
  }

  isDispatchingPricingSync = true;

  try {
    const activeJob = await getActiveSyncJob();

    if (activeJob) {
      return runPricingSyncJob();
    }

    const resumablePausedJob = await getResumablePausedSyncJob();

    if (resumablePausedJob) {
      return resumePricingSyncInBackground(resumablePausedJob._id.toString());
    }

    const latestJob = await getLatestSyncJob();

    if (latestJob?.status === pricingSyncJobStatuses.paused) {
      await ensurePricingSyncResumeTimer(latestJob._id.toString());
    }

    return latestJob;
  } finally {
    isDispatchingPricingSync = false;
  }
};

export const startPricingSyncDispatcher = (intervalMs = PRICING_SYNC_DISPATCH_INTERVAL_MS) => {
  if (pricingSyncDispatchTimer) {
    return pricingSyncDispatchTimer;
  }

  pricingSyncDispatchTimer = setInterval(() => {
    void dispatchPricingSyncWork();
  }, intervalMs);

  if (typeof pricingSyncDispatchTimer.unref === 'function') {
    pricingSyncDispatchTimer.unref();
  }

  void dispatchPricingSyncWork();

  return pricingSyncDispatchTimer;
};

export const stopPricingSyncDispatcher = () => {
  if (!pricingSyncDispatchTimer) {
    return;
  }

  clearInterval(pricingSyncDispatchTimer);
  pricingSyncDispatchTimer = null;
};

import { Collection } from '../collections/collection.model.js';
import { Skin } from '../skins/skin.model.js';
import { refreshPriceMapForSkin } from '../pricing/pricing.refresh.service.js';
import { env } from '../../config/env.js';
import { createLogger } from '../../shared/utils/logger.js';
import { notifyRankingRebuildAfterPricing } from './pricing-sync.backend-notifier.js';
import { pricingSyncJobStatuses } from './pricing-sync.constants.js';
import { getRecoverableErrorMessage, isRecoverablePricingSyncError } from './pricing-sync.error-utils.js';
import {
  getJobById,
  getLatestSyncJob,
  markJobCompleted,
  markJobFailed,
  pauseSyncJob,
  resumeSyncJob,
  startSyncJob,
  updateSyncProgress
} from './pricing-sync.service.js';

const RATE_LIMIT_PAUSE_BASE_MS = 10 * 60 * 1000;
const RECOVERABLE_ERROR_PAUSE_MS = 15 * 60 * 1000;
let activeRunnerJobId = null;
const scheduledResumeTimers = new Map();
const logger = createLogger('pricing-sync');

const dedupeStrings = (items = []) => [...new Set(items.filter(Boolean))];

const clearScheduledResumeTimer = (jobId = null) => {
  const normalizedJobId = jobId ? String(jobId) : null;

  if (!normalizedJobId) {
    return;
  }

  const timer = scheduledResumeTimers.get(normalizedJobId);

  if (!timer) {
    return;
  }

  clearTimeout(timer);
  scheduledResumeTimers.delete(normalizedJobId);
};

const scheduleResumeTimer = (jobId, resumeAfter) => {
  const normalizedJobId = jobId ? String(jobId) : null;

  if (!normalizedJobId || !resumeAfter) {
    return;
  }

  clearScheduledResumeTimer(normalizedJobId);

  const delayMs = Math.max(new Date(resumeAfter).getTime() - Date.now(), 0);
  logger.info('auto resume after resumeAfter', {
    jobId: normalizedJobId,
    resumeAfter: new Date(resumeAfter).toISOString(),
    delayMs
  });
  const timer = setTimeout(() => {
    scheduledResumeTimers.delete(normalizedJobId);
    void resumePricingSyncInBackground(normalizedJobId);
  }, delayMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  scheduledResumeTimers.set(normalizedJobId, timer);
};

const getStableCollections = async () => Collection.find({}).sort({ name: 1, _id: 1 }).lean();

const getStableCollectionSkins = async (collectionName) =>
  Skin.find({
    collectionName,
    marketHashName: { $ne: null }
  })
    .sort({ marketHashName: 1, name: 1, _id: 1 })
    .lean();

const canResumeFromJob = (job) => {
  if (!job?.resumeAfter) {
    return true;
  }

  return new Date(job.resumeAfter).getTime() <= Date.now();
};

const buildProgressMessage = ({ collectionName, processedSkins, totalSkins, skinMarketHashName = null }) => {
  const location = skinMarketHashName ? `${collectionName} :: ${skinMarketHashName}` : collectionName;
  return `Processing ${location} (${processedSkins}/${totalSkins} skins)`;
};

const shouldPersistProgressObservation = (processedSkins) =>
  env.workerVerboseProgress || (processedSkins > 0 && processedSkins % env.workerProgressEveryNSkins === 0);

const stopForExternalJobState = async (jobId, latestJob, progress = {}) => {
  if (!latestJob || latestJob.status === pricingSyncJobStatuses.running) {
    return null;
  }

  if (
    latestJob.status === pricingSyncJobStatuses.paused ||
    latestJob.status === pricingSyncJobStatuses.cancelled
  ) {
    await updateSyncProgress(jobId, {
      ...progress,
      lastHeartbeatAt: new Date(),
      lastProgressMessage: `Pricing sync stopped because job is ${latestJob.status}`
    });
  }

  if (latestJob.status === pricingSyncJobStatuses.cancelled) {
    clearScheduledResumeTimer(jobId.toString());
  }

  logger.info('pricing sync stopped by external state', {
    jobId: jobId.toString(),
    status: latestJob.status
  });

  return getJobById(jobId);
};

const logProgress = ({ jobId, collectionName, skinMarketHashName, processedSkins, totalSkins }) => {
  if (env.workerVerboseProgress) {
    logger.info('pricing sync progress', {
      jobId,
      collectionName,
      skinMarketHashName,
      processedSkins,
      totalSkins
    });
    return;
  }

  if (processedSkins > 0 && processedSkins % env.workerProgressEveryNSkins === 0) {
    logger.info('pricing sync progress', {
      jobId,
      collectionName,
      processedSkins,
      totalSkins
    });
  }
};

export const ensurePricingSyncResumeTimer = async (jobId = null) => {
  const job = jobId ? await getJobById(jobId) : await getLatestSyncJob();

  if (!job) {
    return null;
  }

  if (job.status !== pricingSyncJobStatuses.paused) {
    clearScheduledResumeTimer(job._id.toString());
    return job;
  }

  if (!job.resumeAfter) {
    return resumePricingSyncInBackground(job._id.toString());
  }

  if (canResumeFromJob(job)) {
    return resumePricingSyncInBackground(job._id.toString());
  }

  scheduleResumeTimer(job._id.toString(), job.resumeAfter);
  return job;
};

const getResumeCollectionIndex = (collections, job) => {
  if (!job?.currentCollectionName) {
    return Math.max(job?.processedCollections || 0, 0);
  }

  const checkpointIndex = collections.findIndex((collection) => collection.name === job.currentCollectionName);

  if (checkpointIndex >= 0) {
    return checkpointIndex;
  }

  return Math.max(job?.processedCollections || 0, 0);
};

const syncOneSkin = async ({ skin, failedItems, partialItems }) => {
  const pricingResult = await refreshPriceMapForSkin(skin);
  const nextFailedItems = failedItems.filter((item) => item !== skin.marketHashName);
  const nextPartialItems = partialItems.filter((item) => item !== skin.marketHashName);

  if (pricingResult.isPartial) {
    nextPartialItems.push(skin.marketHashName);
  }

  if (pricingResult.hasFailures) {
    nextFailedItems.push(skin.marketHashName);
  }

  return {
    pricingResult,
    failedItems: dedupeStrings(nextFailedItems),
    partialItems: dedupeStrings(nextPartialItems)
  };
};

const handleRateLimitPause = async (job, progress) => {
  const nextPauseCount = Math.max((job.consecutiveRateLimitPauses || 0) + 1, 1);
  const now = new Date();
  const resumeAfter = new Date(now.getTime() + RATE_LIMIT_PAUSE_BASE_MS * nextPauseCount);

  logger.warn('Steam 429 pause', {
    jobId: job._id.toString(),
    collectionName: progress.currentCollectionName,
    skinMarketHashName: progress.currentSkinMarketHashName,
    processedSkins: progress.processedSkins,
    totalSkins: progress.totalSkins,
    consecutiveRateLimitPauses: nextPauseCount,
    resumeAfter: resumeAfter.toISOString()
  });

  await updateSyncProgress(job._id, {
    ...progress,
    last429At: now,
    consecutiveRateLimitPauses: nextPauseCount,
    resumeAfter,
    lastHeartbeatAt: now,
    lastProgressMessage: `Paused after Steam 429 at ${progress.currentCollectionName} :: ${progress.currentSkinMarketHashName}`,
    lastErrorMessage: 'Steam returned 429; pricing sync paused'
  });

  const pausedJob = await pauseSyncJob(job._id);
  scheduleResumeTimer(pausedJob._id.toString(), resumeAfter);

  return pausedJob;
};

const pauseJobAfterRecoverableError = async (job, latestJob, error) => {
  const resumeAfter = new Date(Date.now() + RECOVERABLE_ERROR_PAUSE_MS);
  const errorMessage = getRecoverableErrorMessage(error);

  logger.warn('recoverable error detected', {
    jobId: job._id.toString(),
    error: errorMessage,
    code: error?.code || error?.cause?.code || null
  });

  await updateSyncProgress(job._id, {
    currentCollectionName: latestJob.currentCollectionName,
    currentSkinMarketHashName: latestJob.currentSkinMarketHashName,
    processedCollections: latestJob.processedCollections,
    processedSkins: latestJob.processedSkins,
    failedItems: latestJob.failedItems,
    partialItems: latestJob.partialItems,
    processedCollectionNames: latestJob.processedCollectionNames,
    consecutiveRateLimitPauses: latestJob.consecutiveRateLimitPauses,
    totalCollections: latestJob.totalCollections,
    totalSkins: latestJob.totalSkins,
    lastError: errorMessage,
    lastHeartbeatAt: new Date(),
    lastProgressMessage: `Pricing sync paused after recoverable error at ${latestJob.currentCollectionName || 'unknown collection'}`,
    lastErrorMessage: errorMessage,
    resumeAfter
  });

  const refreshedJob = await getJobById(job._id);

  if (refreshedJob.status === pricingSyncJobStatuses.running) {
    await pauseSyncJob(job._id);
  }

  scheduleResumeTimer(job._id.toString(), resumeAfter);

  logger.warn('pausing job after recoverable error', {
    jobId: job._id.toString(),
    resumeAfter: resumeAfter.toISOString()
  });

  return getJobById(job._id);
};

const runJobLoop = async (job) => {
  const collections = await getStableCollections();
  const totalCollections = collections.length;
  const totalSkins = await Skin.countDocuments({ marketHashName: { $ne: null } });
  let processedCollections = job.processedCollections || 0;
  let processedSkins = job.processedSkins || 0;
  let failedItems = dedupeStrings(job.failedItems || []);
  let partialItems = dedupeStrings(job.partialItems || []);
  let processedCollectionNames = dedupeStrings(job.processedCollectionNames || []);
  let consecutiveRateLimitPauses = Math.max(job.consecutiveRateLimitPauses || 0, 0);
  const startCollectionIndex = getResumeCollectionIndex(collections, job);

  await updateSyncProgress(job._id, {
    totalCollections,
    totalSkins,
    processedCollections,
    processedSkins,
    failedItems,
    partialItems,
    processedCollectionNames,
    consecutiveRateLimitPauses,
    lastHeartbeatAt: new Date(),
    lastProgressMessage: `Pricing sync running (${processedSkins}/${totalSkins} skins)`
  });

  for (let collectionIndex = startCollectionIndex; collectionIndex < collections.length; collectionIndex += 1) {
    const collection = collections[collectionIndex];

    if (processedCollectionNames.includes(collection.name)) {
      continue;
    }

    const skins = await getStableCollectionSkins(collection.name);
    let shouldResumeSkin = job.currentCollectionName === collection.name && Boolean(job.currentSkinMarketHashName);

    logger.info('collection start', {
      jobId: job._id.toString(),
      collectionName: collection.name,
      collectionIndex: collectionIndex + 1,
      totalCollections,
      processedSkins,
      totalSkins
    });

    await updateSyncProgress(job._id, {
      currentCollectionName: collection.name,
      currentSkinMarketHashName: shouldResumeSkin ? job.currentSkinMarketHashName : null,
      processedCollections,
      processedSkins,
      failedItems,
      partialItems,
      processedCollectionNames,
      consecutiveRateLimitPauses,
      totalCollections,
      totalSkins,
      lastHeartbeatAt: new Date(),
      lastProgressMessage: `Starting collection ${collection.name}`
    });

    const collectionStateJob = await getJobById(job._id);
    const stoppedAtCollectionStart = await stopForExternalJobState(job._id, collectionStateJob, {
      currentCollectionName: collection.name,
      currentSkinMarketHashName: shouldResumeSkin ? job.currentSkinMarketHashName : null,
      processedCollections,
      processedSkins,
      failedItems,
      partialItems,
      processedCollectionNames,
      consecutiveRateLimitPauses,
      totalCollections,
      totalSkins
    });

    if (stoppedAtCollectionStart) {
      return stoppedAtCollectionStart;
    }

    for (const skin of skins) {
      if (shouldResumeSkin) {
        if (skin.marketHashName !== job.currentSkinMarketHashName) {
          continue;
        }

        shouldResumeSkin = false;
      }

      await updateSyncProgress(job._id, {
        currentCollectionName: collection.name,
        currentSkinMarketHashName: skin.marketHashName,
        processedCollections,
        processedSkins,
        failedItems,
        partialItems,
        processedCollectionNames,
        consecutiveRateLimitPauses,
        totalCollections,
        totalSkins
      });

      const preSkinStateJob = await getJobById(job._id);
      const stoppedBeforeSkin = await stopForExternalJobState(job._id, preSkinStateJob, {
        currentCollectionName: collection.name,
        currentSkinMarketHashName: skin.marketHashName,
        processedCollections,
        processedSkins,
        failedItems,
        partialItems,
        processedCollectionNames,
        consecutiveRateLimitPauses,
        totalCollections,
        totalSkins
      });

      if (stoppedBeforeSkin) {
        return stoppedBeforeSkin;
      }

      const { pricingResult, failedItems: nextFailedItems, partialItems: nextPartialItems } = await syncOneSkin({
        skin,
        failedItems,
        partialItems
      });

      failedItems = nextFailedItems;
      partialItems = nextPartialItems;
      processedSkins += 1;
      logProgress({
        jobId: job._id.toString(),
        collectionName: collection.name,
        skinMarketHashName: skin.marketHashName,
        processedSkins,
        totalSkins
      });

      if (!pricingResult.wasRateLimited && consecutiveRateLimitPauses > 0) {
        consecutiveRateLimitPauses = 0;
      }

      const shouldPersistProgress = shouldPersistProgressObservation(processedSkins);

      await updateSyncProgress(job._id, {
        currentCollectionName: collection.name,
        currentSkinMarketHashName: skin.marketHashName,
        processedCollections,
        processedSkins,
        failedItems,
        partialItems,
        processedCollectionNames,
        consecutiveRateLimitPauses,
        totalCollections,
        totalSkins,
        ...(shouldPersistProgress
          ? {
              lastHeartbeatAt: new Date(),
              lastProgressMessage: buildProgressMessage({
                collectionName: collection.name,
                skinMarketHashName: env.workerVerboseProgress ? skin.marketHashName : null,
                processedSkins,
                totalSkins
              })
            }
          : {})
      });

      if (pricingResult.wasRateLimited) {
        return handleRateLimitPause(job, {
          currentCollectionName: collection.name,
          currentSkinMarketHashName: skin.marketHashName,
          processedCollections,
          processedSkins,
          failedItems,
          partialItems,
          processedCollectionNames,
          consecutiveRateLimitPauses,
          totalCollections,
          totalSkins
        });
      }

      const latestJob = await getJobById(job._id);
      const stoppedAfterSkin = await stopForExternalJobState(job._id, latestJob, {
        currentCollectionName: collection.name,
        currentSkinMarketHashName: skin.marketHashName,
        processedCollections,
        processedSkins,
        failedItems,
        partialItems,
        processedCollectionNames,
        consecutiveRateLimitPauses,
        totalCollections,
        totalSkins
      });

      if (stoppedAfterSkin) {
        return stoppedAfterSkin;
      }
    }

    processedCollections += 1;
    processedCollectionNames = dedupeStrings([...processedCollectionNames, collection.name]);

    await updateSyncProgress(job._id, {
      currentCollectionName: collection.name,
      currentSkinMarketHashName: null,
      processedCollections,
      processedSkins,
      failedItems,
      partialItems,
      processedCollectionNames,
      consecutiveRateLimitPauses,
      totalCollections,
      totalSkins
    });
  }

  clearScheduledResumeTimer(job._id.toString());

  const completedJob = await markJobCompleted(job._id, {
    processedCollections,
    processedSkins,
    failedItems,
    partialItems,
    processedCollectionNames,
    consecutiveRateLimitPauses,
    totalCollections,
    totalSkins,
    lastHeartbeatAt: new Date(),
    lastProgressMessage: `Pricing sync completed (${processedSkins}/${totalSkins} skins)`
  });

  logger.info('pricing sync completed', {
    jobId: job._id.toString(),
    processedCollections,
    totalCollections,
    processedSkins,
    totalSkins,
    failedItemsCount: failedItems.length,
    partialItemsCount: partialItems.length
  });

  await notifyRankingRebuildAfterPricing(completedJob);

  return completedJob;
};

const runWithLock = async (job) => {
  if (activeRunnerJobId) {
    return getJobById(activeRunnerJobId);
  }

  activeRunnerJobId = job._id.toString();
  clearScheduledResumeTimer(activeRunnerJobId);

  try {
    return await runJobLoop(job);
  } catch (error) {
    const latestJob = await getJobById(job._id);
    clearScheduledResumeTimer(job._id.toString());

    if (latestJob.status !== pricingSyncJobStatuses.running) {
      return latestJob;
    }

    if (isRecoverablePricingSyncError(error)) {
      return pauseJobAfterRecoverableError(job, latestJob, error);
    }

    logger.error('fatal error detected', {
      jobId: job._id.toString(),
      error: error instanceof Error ? error.message : String(error)
    });

    const failedJob = await markJobFailed(job._id, error, {
      currentCollectionName: latestJob.currentCollectionName,
      currentSkinMarketHashName: latestJob.currentSkinMarketHashName,
      processedCollections: latestJob.processedCollections,
      processedSkins: latestJob.processedSkins,
      failedItems: latestJob.failedItems,
      partialItems: latestJob.partialItems,
      processedCollectionNames: latestJob.processedCollectionNames,
      consecutiveRateLimitPauses: latestJob.consecutiveRateLimitPauses,
      totalCollections: latestJob.totalCollections,
      totalSkins: latestJob.totalSkins,
      lastHeartbeatAt: new Date(),
      lastProgressMessage: `Pricing sync failed at ${latestJob.currentCollectionName || 'unknown collection'}`,
      lastErrorMessage: error instanceof Error ? error.message : String(error)
    });

    logger.error('pricing sync failed', {
      jobId: job._id.toString(),
      collectionName: latestJob.currentCollectionName,
      skinMarketHashName: latestJob.currentSkinMarketHashName,
      processedCollections: latestJob.processedCollections,
      totalCollections: latestJob.totalCollections,
      processedSkins: latestJob.processedSkins,
      totalSkins: latestJob.totalSkins,
      error: error instanceof Error ? error.message : String(error)
    });

    return failedJob;
  } finally {
    activeRunnerJobId = null;
  }
};

export const runPricingSyncJob = async (payload = {}) => {
  const job = await startSyncJob(payload);

  logger.info('pricing sync job picked up', {
    jobId: job._id.toString(),
    isFresh: Boolean(job?.$locals?.wasStartedFresh)
  });

  if (job?.$locals?.wasStartedFresh) {
    logger.info('fresh sync no longer clears Pricing collection', {
      jobId: job._id.toString()
    });
  }

  return runWithLock(job);
};

export const resumePricingSyncJob = async (jobId = null, { ignoreResumeAfter = false } = {}) => {
  const existingJob = jobId ? await getJobById(jobId) : await getLatestSyncJob();

  if (!existingJob) {
    return null;
  }

  if (existingJob.status !== pricingSyncJobStatuses.paused) {
    return existingJob;
  }

  if (!ignoreResumeAfter && !canResumeFromJob(existingJob)) {
    return existingJob;
  }

  clearScheduledResumeTimer(existingJob._id.toString());
  const job = await resumeSyncJob(jobId);
  logger.info('pricing sync job resumed', {
    jobId: job._id.toString(),
    resumeAfter: job.resumeAfter ? new Date(job.resumeAfter).toISOString() : null
  });
  return runWithLock(job);
};

export const isPricingSyncRunnerActive = () => Boolean(activeRunnerJobId);

export const startPricingSyncInBackground = async (payload = {}) => {
  const job = await startSyncJob(payload);

  if (job?.$locals?.wasStartedFresh) {
    logger.info('fresh sync no longer clears Pricing collection', {
      jobId: job._id.toString()
    });
  }

  if (!isPricingSyncRunnerActive()) {
    void runWithLock(job);
  }

  return job;
};

export const resumePricingSyncInBackground = async (jobId = null, { ignoreResumeAfter = false } = {}) => {
  const existingJob = jobId ? await getJobById(jobId) : await getLatestSyncJob();

  if (!existingJob) {
    return null;
  }

  if (existingJob.status !== pricingSyncJobStatuses.paused) {
    clearScheduledResumeTimer(existingJob._id.toString());
    return existingJob;
  }

  if (!ignoreResumeAfter && !canResumeFromJob(existingJob)) {
    return existingJob;
  }

  clearScheduledResumeTimer(existingJob._id.toString());
  const job = await resumeSyncJob(jobId);
  logger.info('pricing sync job resumed', {
    jobId: job._id.toString(),
    resumeAfter: job.resumeAfter ? new Date(job.resumeAfter).toISOString() : null
  });

  if (!isPricingSyncRunnerActive()) {
    void runWithLock(job);
  }

  return job;
};

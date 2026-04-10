import { ApiError } from '../../shared/utils/ApiError.js';
import { PricingSyncJob } from './pricing-sync.model.js';
import { pricingSyncJobStatuses, pricingSyncJobType } from './pricing-sync.constants.js';

const dedupeStrings = (items = []) => [...new Set(items.filter(Boolean))];
const normalizeMessage = (value) => (value ? String(value) : null);

const buildCheckpointUpdate = (updates = {}) => {
  const nextUpdates = {};

  if (Object.hasOwn(updates, 'currentCollectionName')) {
    nextUpdates.currentCollectionName = updates.currentCollectionName || null;
  }

  if (Object.hasOwn(updates, 'currentSkinMarketHashName')) {
    nextUpdates.currentSkinMarketHashName = updates.currentSkinMarketHashName || null;
  }

  if (Object.hasOwn(updates, 'processedCollections')) {
    nextUpdates.processedCollections = updates.processedCollections;
  }

  if (Object.hasOwn(updates, 'totalCollections')) {
    nextUpdates.totalCollections = updates.totalCollections;
  }

  if (Object.hasOwn(updates, 'processedSkins')) {
    nextUpdates.processedSkins = updates.processedSkins;
  }

  if (Object.hasOwn(updates, 'totalSkins')) {
    nextUpdates.totalSkins = updates.totalSkins;
  }

  if (Object.hasOwn(updates, 'failedItems')) {
    nextUpdates.failedItems = dedupeStrings(updates.failedItems);
  }

  if (Object.hasOwn(updates, 'partialItems')) {
    nextUpdates.partialItems = dedupeStrings(updates.partialItems);
  }

  if (Object.hasOwn(updates, 'processedCollectionNames')) {
    nextUpdates.processedCollectionNames = dedupeStrings(updates.processedCollectionNames);
  }

  if (Object.hasOwn(updates, 'lastError')) {
    nextUpdates.lastError = updates.lastError || null;
  }

  if (Object.hasOwn(updates, 'lastHeartbeatAt')) {
    nextUpdates.lastHeartbeatAt = updates.lastHeartbeatAt || null;
  }

  if (Object.hasOwn(updates, 'lastProgressMessage')) {
    nextUpdates.lastProgressMessage = normalizeMessage(updates.lastProgressMessage);
  }

  if (Object.hasOwn(updates, 'lastErrorMessage')) {
    nextUpdates.lastErrorMessage = normalizeMessage(updates.lastErrorMessage);
  }

  if (Object.hasOwn(updates, 'last429At')) {
    nextUpdates.last429At = updates.last429At || null;
  }

  if (Object.hasOwn(updates, 'consecutiveRateLimitPauses')) {
    nextUpdates.consecutiveRateLimitPauses = Math.max(Number(updates.consecutiveRateLimitPauses) || 0, 0);
  }

  if (Object.hasOwn(updates, 'resumeAfter')) {
    nextUpdates.resumeAfter = updates.resumeAfter || null;
  }

  return nextUpdates;
};

export const getJobById = async (jobId) => {
  const job = await PricingSyncJob.findById(jobId);

  if (!job) {
    throw new ApiError(404, 'Pricing sync job not found');
  }

  return job;
};

export const getActiveSyncJob = async () =>
  PricingSyncJob.findOne({
    type: pricingSyncJobType,
    status: pricingSyncJobStatuses.running
  }).sort({ updatedAt: -1 });

export const getLatestSyncJob = async () =>
  PricingSyncJob.findOne({ type: pricingSyncJobType }).sort({ createdAt: -1 });

export const getResumablePausedSyncJob = async (now = new Date()) =>
  PricingSyncJob.findOne({
    type: pricingSyncJobType,
    status: pricingSyncJobStatuses.paused,
    $or: [{ resumeAfter: null }, { resumeAfter: { $lte: now } }]
  }).sort({ updatedAt: 1 });

export const createSyncJob = async (payload = {}) => {
  const activeJob = await getActiveSyncJob();

  if (activeJob) {
    return activeJob;
  }

  return PricingSyncJob.create({
    type: pricingSyncJobType,
    ...buildCheckpointUpdate(payload)
  });
};

export const startSyncJob = async (payload = {}) => {
  const activeJob = await getActiveSyncJob();

  if (activeJob) {
    activeJob.$locals = activeJob.$locals || {};
    activeJob.$locals.wasStartedFresh = false;
    return activeJob;
  }

  const job = await createSyncJob(payload);

  job.status = pricingSyncJobStatuses.running;
  job.startedAt = job.startedAt || new Date();
  job.finishedAt = null;
  job.lastError = null;
  job.lastErrorMessage = null;
  job.lastHeartbeatAt = new Date();
  job.lastProgressMessage = 'Pricing sync started';

  if (Object.hasOwn(payload, 'resumeAfter')) {
    job.resumeAfter = payload.resumeAfter || null;
  } else {
    job.resumeAfter = null;
  }

  Object.assign(job, buildCheckpointUpdate(payload));

  await job.save();
  job.$locals = job.$locals || {};
  job.$locals.wasStartedFresh = true;

  return job;
};

export const pauseSyncJob = async (jobId = null) => {
  const job = jobId ? await getJobById(jobId) : await getActiveSyncJob();

  if (!job) {
    throw new ApiError(404, 'No running pricing sync job found');
  }

  job.status = pricingSyncJobStatuses.paused;
  await job.save();

  return job;
};

export const resumeSyncJob = async (jobId = null) => {
  const activeJob = await getActiveSyncJob();

  if (activeJob && (!jobId || activeJob._id.toString() !== jobId)) {
    return activeJob;
  }

  const job = jobId
    ? await getJobById(jobId)
    : await PricingSyncJob.findOne({
        type: pricingSyncJobType,
        status: pricingSyncJobStatuses.paused
      }).sort({ updatedAt: -1 });

  if (!job) {
    throw new ApiError(404, 'No paused pricing sync job found');
  }

  job.status = pricingSyncJobStatuses.running;
  job.finishedAt = null;
  job.lastError = null;
  job.lastErrorMessage = null;
  job.lastHeartbeatAt = new Date();
  job.lastProgressMessage = 'Pricing sync resumed';
  await job.save();

  return job;
};

export const getSyncJobStatus = async (jobId = null) => {
  if (jobId) {
    return getJobById(jobId);
  }

  const activeJob = await getActiveSyncJob();

  if (activeJob) {
    return activeJob;
  }

  return getLatestSyncJob();
};

export const markJobCompleted = async (jobId, updates = {}) => {
  const job = await getJobById(jobId);

  Object.assign(job, buildCheckpointUpdate(updates));
  job.status = pricingSyncJobStatuses.completed;
  job.finishedAt = new Date();
  job.currentCollectionName = null;
  job.currentSkinMarketHashName = null;
  job.consecutiveRateLimitPauses = 0;
  job.resumeAfter = null;
  job.lastError = null;
  job.lastErrorMessage = null;
  job.lastHeartbeatAt = new Date();
  job.lastProgressMessage = updates.lastProgressMessage || 'Pricing sync completed';

  await job.save();

  return job;
};

export const markJobFailed = async (jobId, error, updates = {}) => {
  const job = await getJobById(jobId);
  const errorMessage = error instanceof Error ? error.message : String(error || 'Pricing sync job failed');

  Object.assign(job, buildCheckpointUpdate(updates));
  job.status = pricingSyncJobStatuses.failed;
  job.finishedAt = new Date();
  job.consecutiveRateLimitPauses = 0;
  job.lastError = errorMessage;
  job.lastErrorMessage = errorMessage;
  job.lastHeartbeatAt = new Date();
  job.lastProgressMessage = updates.lastProgressMessage || 'Pricing sync failed';

  await job.save();

  return job;
};

export const updateSyncProgress = async (jobId, updates = {}) => {
  const job = await getJobById(jobId);

  Object.assign(job, buildCheckpointUpdate(updates));
  await job.save();

  return job;
};

import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { pricingSyncJobStatuses } from '../modules/pricing-sync/pricing-sync.constants.js';
import { resumePricingSyncJob, runPricingSyncJob } from '../modules/pricing-sync/pricing-sync.runner.js';
import { getLatestSyncJob, pauseSyncJob, updateSyncProgress } from '../modules/pricing-sync/pricing-sync.service.js';
import { createLogger } from '../shared/utils/logger.js';

const logger = createLogger('pricing-sync-once');

const canResumeNow = (job) => {
  if (!job?.resumeAfter) {
    return true;
  }

  return new Date(job.resumeAfter).getTime() <= Date.now();
};

const isRunningJobStale = (job, now = new Date()) => {
  if (!job?.lastHeartbeatAt) {
    return true;
  }

  return now.getTime() - new Date(job.lastHeartbeatAt).getTime() > env.workerRunningJobStaleAfterMs;
};

const runOnce = async () => {
  await connectToDatabase();

  try {
    const latestJob = await getLatestSyncJob();

    if (latestJob?.status === pricingSyncJobStatuses.running) {
      if (!isRunningJobStale(latestJob)) {
        logger.info('running job already exists', {
          jobId: latestJob._id.toString()
        });
        logger.info('one-shot exit due to active fresh running job', {
          jobId: latestJob._id.toString()
        });
        logger.info('one-shot execution completed');
        return;
      }

      logger.warn('stale running job detected', {
        jobId: latestJob._id.toString()
      });

      const staleJobMessage = 'Stale running job detected during one-shot execution';

      await updateSyncProgress(latestJob._id, {
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
        lastError: staleJobMessage,
        lastHeartbeatAt: new Date(),
        lastProgressMessage: 'Stale running job converted to paused for recovery',
        lastErrorMessage: staleJobMessage,
        resumeAfter: new Date()
      });

      await pauseSyncJob(latestJob._id);

      logger.warn('stale running job converted to paused', {
        jobId: latestJob._id.toString()
      });
      logger.info('resuming stale paused job', {
        jobId: latestJob._id.toString()
      });
      await resumePricingSyncJob(latestJob._id.toString());
      logger.info('one-shot execution completed', {
        jobId: latestJob._id.toString()
      });
      return;
    }

    if (latestJob?.status === pricingSyncJobStatuses.paused) {
      if (!canResumeNow(latestJob)) {
        logger.info('paused job not ready yet', {
          jobId: latestJob._id.toString(),
          resumeAfter: latestJob.resumeAfter ? new Date(latestJob.resumeAfter).toISOString() : null
        });
        logger.info('one-shot execution completed');
        return;
      }

      logger.info('resuming paused job', {
        jobId: latestJob._id.toString(),
        resumeAfter: latestJob.resumeAfter ? new Date(latestJob.resumeAfter).toISOString() : null
      });
      await resumePricingSyncJob(latestJob._id.toString());
      logger.info('one-shot execution completed', {
        jobId: latestJob._id.toString()
      });
      return;
    }

    logger.info('starting fresh job');
    const job = await runPricingSyncJob();
    logger.info('one-shot execution completed', {
      jobId: job?._id?.toString?.() || null,
      status: job?.status || null
    });
  } finally {
    await mongoose.disconnect();
  }
};

runOnce().catch((error) => {
  logger.error('one-shot execution failed', {
    error: error instanceof Error ? error.message : String(error)
  });
  void mongoose.disconnect().finally(() => {
    process.exit(1);
  });
});

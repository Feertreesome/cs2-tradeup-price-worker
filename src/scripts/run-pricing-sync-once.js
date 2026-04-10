import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';
import { pricingSyncJobStatuses } from '../modules/pricing-sync/pricing-sync.constants.js';
import { resumePricingSyncJob, runPricingSyncJob } from '../modules/pricing-sync/pricing-sync.runner.js';
import { getLatestSyncJob } from '../modules/pricing-sync/pricing-sync.service.js';
import { createLogger } from '../shared/utils/logger.js';

const logger = createLogger('pricing-sync-once');

const canResumeNow = (job) => {
  if (!job?.resumeAfter) {
    return true;
  }

  return new Date(job.resumeAfter).getTime() <= Date.now();
};

const runOnce = async () => {
  await connectToDatabase();

  try {
    const latestJob = await getLatestSyncJob();

    if (latestJob?.status === pricingSyncJobStatuses.running) {
      logger.info('running job already exists', {
        jobId: latestJob._id.toString()
      });
      logger.info('one-shot execution completed');
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

import mongoose from 'mongoose';
import { connectToDatabase } from '../config/db.js';
import { notifyRankingRebuildAfterPricing } from '../modules/pricing-sync/pricing-sync.backend-notifier.js';
import { PricingSyncJob } from '../modules/pricing-sync/pricing-sync.model.js';
import { pricingSyncJobStatuses } from '../modules/pricing-sync/pricing-sync.constants.js';

const main = async () => {
  await connectToDatabase();

  try {
    const job = await PricingSyncJob.findOne({ status: pricingSyncJobStatuses.completed })
      .sort({ finishedAt: -1, updatedAt: -1 })
      .select({ _id: 1, finishedAt: 1, status: 1 });

    if (!job) {
      console.error('No completed pricing sync job found');
      process.exitCode = 1;
      return;
    }

    const notified = await notifyRankingRebuildAfterPricing(job);

    if (!notified) {
      process.exitCode = 1;
      return;
    }

    console.log(`Ranking rebuild notification sent for pricing sync job ${job._id.toString()}`);
  } finally {
    await mongoose.disconnect();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

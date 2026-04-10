import { connectToDatabase } from './config/db.js';
import { env } from './config/env.js';
import { startPricingSyncDispatcher } from './modules/pricing-sync/pricing-sync.dispatcher.js';
import { startRefreshScheduler } from './scheduler/refresh.scheduler.js';
import { createLogger } from './shared/utils/logger.js';

const logger = createLogger('startup');

const startPriceWorker = async () => {
  logger.info('worker starting');
  logger.info('auto refresh enabled', { enabled: env.autoRefreshEnabled });

  try {
    await connectToDatabase();
    logger.info('Mongo connection success');
  } catch (error) {
    logger.error('Mongo connection failure', {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  logger.info('dispatcher starting');
  startPricingSyncDispatcher();

  if (env.autoRefreshEnabled) {
    logger.info('scheduler starting');
    startRefreshScheduler();
    return;
  }

  logger.info('scheduler disabled', {
    enabled: env.autoRefreshEnabled,
    nodeEnv: env.nodeEnv
  });
};

startPriceWorker().catch((error) => {
  logger.error('worker startup failure', {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

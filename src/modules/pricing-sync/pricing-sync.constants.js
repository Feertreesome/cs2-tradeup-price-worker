export const pricingSyncJobStatuses = {
  idle: 'idle',
  running: 'running',
  paused: 'paused',
  cancelled: 'cancelled',
  completed: 'completed',
  failed: 'failed'
};

export const pricingSyncJobStatusList = Object.values(pricingSyncJobStatuses);
export const pricingSyncJobType = 'full-price-sync';

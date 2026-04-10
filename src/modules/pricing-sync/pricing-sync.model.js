import mongoose from 'mongoose';
import { pricingSyncJobStatusList, pricingSyncJobStatuses, pricingSyncJobType } from './pricing-sync.constants.js';

const pricingSyncJobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      default: pricingSyncJobType
    },
    status: {
      type: String,
      required: true,
      enum: pricingSyncJobStatusList,
      default: pricingSyncJobStatuses.idle
    },
    currentCollectionName: {
      type: String,
      trim: true,
      default: null
    },
    currentSkinMarketHashName: {
      type: String,
      trim: true,
      default: null
    },
    processedCollections: {
      type: Number,
      default: 0
    },
    totalCollections: {
      type: Number,
      default: 0
    },
    processedSkins: {
      type: Number,
      default: 0
    },
    totalSkins: {
      type: Number,
      default: 0
    },
    failedItems: {
      type: [String],
      default: []
    },
    partialItems: {
      type: [String],
      default: []
    },
    processedCollectionNames: {
      type: [String],
      default: []
    },
    lastError: {
      type: String,
      default: null
    },
    lastHeartbeatAt: {
      type: Date,
      default: null
    },
    lastProgressMessage: {
      type: String,
      trim: true,
      default: null
    },
    lastErrorMessage: {
      type: String,
      trim: true,
      default: null
    },
    last429At: {
      type: Date,
      default: null
    },
    consecutiveRateLimitPauses: {
      type: Number,
      default: 0
    },
    resumeAfter: {
      type: Date,
      default: null
    },
    startedAt: {
      type: Date,
      default: null
    },
    finishedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

pricingSyncJobSchema.index({ status: 1 });
pricingSyncJobSchema.index({ type: 1 });
pricingSyncJobSchema.index({ updatedAt: 1 });

export const PricingSyncJob = mongoose.model('PricingSyncJob', pricingSyncJobSchema);

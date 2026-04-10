import mongoose from 'mongoose';

const refreshStateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    status: {
      type: String,
      required: true,
      default: 'idle'
    },
    lastStartedAt: {
      type: Date,
      default: null
    },
    lastFinishedAt: {
      type: Date,
      default: null
    },
    lastSuccessfulAt: {
      type: Date,
      default: null
    },
    lastError: {
      type: String,
      default: null
    },
    lastPricingSyncJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PricingSyncJob',
      default: null
    },
    lastOpportunityScanJobIds: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

export const RefreshState = mongoose.model('RefreshState', refreshStateSchema);

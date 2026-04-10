import mongoose from 'mongoose';

const skinSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    marketHashName: {
      type: String,
      trim: true,
      default: null
    },
    weapon: {
      type: String,
      trim: true,
      default: null
    },
    collectionName: {
      type: String,
      trim: true,
      default: null
    },
    normalizedCollectionName: {
      type: String,
      trim: true,
      default: null
    },
    collectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Collection',
      default: null
    },
    rarity: {
      type: String,
      required: true,
      trim: true
    },
    floatMin: {
      type: Number,
      default: null
    },
    floatMax: {
      type: Number,
      default: null
    },
    floatLastSyncedAt: {
      type: Date,
      default: null
    },
    possibleExteriors: {
      type: [String],
      default: []
    },
    imageUrl: {
      type: String,
      default: null
    },
    prices: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

skinSchema.index({ collectionName: 1, rarity: 1, name: 1 });
skinSchema.index({ marketHashName: 1 });

export const Skin = mongoose.model('Skin', skinSchema);

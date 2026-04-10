import mongoose from 'mongoose';
import { getDefaultPriceMap, normalizePriceMap } from './pricing.utils.js';

const priceValueSchema = new mongoose.Schema(
  {
    'Factory New': { type: Number, default: null },
    'Minimal Wear': { type: Number, default: null },
    'Field-Tested': { type: Number, default: null },
    'Well-Worn': { type: Number, default: null },
    'Battle-Scarred': { type: Number, default: null }
  },
  {
    _id: false
  }
);

const pricingSchema = new mongoose.Schema(
  {
    marketHashName: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    prices: {
      type: priceValueSchema,
      default: () => getDefaultPriceMap(),
      set: (value) => normalizePriceMap(value)
    },
    source: {
      type: String,
      required: true,
      trim: true,
      default: 'steam'
    },
    fetchedAt: {
      type: Date,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    isComplete: {
      type: Boolean,
      required: true,
      default: true
    }
  },
  {
    timestamps: true
  }
);

pricingSchema.index({ expiresAt: 1 });

export const Pricing = mongoose.model('Pricing', pricingSchema);

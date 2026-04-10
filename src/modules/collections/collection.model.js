import mongoose from 'mongoose';

const collectionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    normalizedName: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    steamTag: {
      type: String,
      trim: true,
      default: null
    },
    isWeaponCollection: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

export const Collection = mongoose.model('Collection', collectionSchema);

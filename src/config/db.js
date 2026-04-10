import mongoose from 'mongoose';
import { env } from './env.js';

export const connectToDatabase = async () => {
  await mongoose.connect(env.mongodbUri);
};

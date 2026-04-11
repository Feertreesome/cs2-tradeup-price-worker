import { createLogger } from '../../shared/utils/logger.js';
import { Pricing } from './pricing.model.js';
import { normalizePriceMap } from './pricing.utils.js';

const STEAM_PRICE_SOURCE = 'steam';
const logger = createLogger('pricing-cache');

const normalizeCachedPricingEntry = (cacheEntry) => {
  if (!cacheEntry) {
    return null;
  }

  return {
    ...cacheEntry,
    prices: normalizePriceMap(cacheEntry.prices)
  };
};

export const upsertPriceCache = async ({ marketHashName, prices, fetchedAt, isComplete }) => {
  const normalizedPrices = normalizePriceMap(prices);
  const existingEntry = await Pricing.findOne({ marketHashName }).select({ _id: 1 }).lean();

  const pricingEntry = await Pricing.findOneAndUpdate(
    { marketHashName },
    {
      marketHashName,
      prices: normalizedPrices,
      source: STEAM_PRICE_SOURCE,
      fetchedAt,
      isComplete
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    }
  )
    .lean()
    .then(normalizeCachedPricingEntry);

  logger.info(existingEntry ? 'pricing doc updated' : 'pricing doc created when missing', {
    marketHashName,
    isComplete
  });

  if (Object.values(normalizedPrices).every((value) => value === null)) {
    logger.info('missing prices persisted as nulls', {
      marketHashName
    });
  }

  return pricingEntry;
};

export const getCachedPricingEntry = async (marketHashName) => {
  if (!marketHashName) {
    return null;
  }

  return Pricing.findOne({ marketHashName }).lean().then(normalizeCachedPricingEntry);
};

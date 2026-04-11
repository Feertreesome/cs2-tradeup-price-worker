import { env } from '../../config/env.js';
import { createLogger } from '../../shared/utils/logger.js';
import { Pricing } from './pricing.model.js';
import { createExpirationDate, isPriceCacheFresh, normalizePriceMap } from './pricing.utils.js';

const STEAM_PRICE_SOURCE = 'steam';
const PRICE_CACHE_TTL_MS = env.priceCacheTtlMinutes * 60 * 1000;
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
      expiresAt: createExpirationDate(PRICE_CACHE_TTL_MS, fetchedAt),
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

export const getCachedPriceMap = async (marketHashName) => {
  const cachedEntry = await getCachedPricingEntry(marketHashName);

  if (!cachedEntry || cachedEntry.isComplete === false || !isPriceCacheFresh(cachedEntry)) {
    return null;
  }

  return normalizePriceMap(cachedEntry.prices);
};

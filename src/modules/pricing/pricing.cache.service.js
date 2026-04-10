import { env } from '../../config/env.js';
import { Pricing } from './pricing.model.js';
import { createExpirationDate, isPriceCacheFresh, normalizePriceMap } from './pricing.utils.js';

const STEAM_PRICE_SOURCE = 'steam';
const PRICE_CACHE_TTL_MS = env.priceCacheTtlMinutes * 60 * 1000;

const normalizeCachedPricingEntry = (cacheEntry) => {
  if (!cacheEntry) {
    return null;
  }

  return {
    ...cacheEntry,
    prices: normalizePriceMap(cacheEntry.prices)
  };
};

export const upsertPriceCache = async ({ marketHashName, prices, fetchedAt, isComplete }) =>
  Pricing.findOneAndUpdate(
    { marketHashName },
    {
      marketHashName,
      prices: normalizePriceMap(prices),
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

export const getCachedPricingEntry = async (marketHashName) => {
  if (!marketHashName) {
    return null;
  }

  return Pricing.findOne({ marketHashName }).lean().then(normalizeCachedPricingEntry);
};

export const clearPriceCache = async () => Pricing.deleteMany({});

export const getCachedPriceMap = async (marketHashName) => {
  const cachedEntry = await getCachedPricingEntry(marketHashName);

  if (!cachedEntry || cachedEntry.isComplete === false || !isPriceCacheFresh(cachedEntry)) {
    return null;
  }

  return normalizePriceMap(cachedEntry.prices);
};

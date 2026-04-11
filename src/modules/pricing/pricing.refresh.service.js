import { upsertPriceCache } from './pricing.cache.service.js';
import { fetchPriceMapFromSteam } from './pricing.steam.service.js';
import { getDefaultPriceMap, normalizePriceMap } from './pricing.utils.js';

const refreshUsdPriceMap = async ({ skin, initialPriceMap }) => {
  try {
    const result = await fetchPriceMapFromSteam(skin, initialPriceMap);

    return {
      priceMap: result.priceMap,
      isPartial: result.isPartial,
      hasFailures: result.hasFailures,
      wasRateLimited: result.wasRateLimited
    };
  } catch (error) {
    return {
      priceMap: initialPriceMap,
      isPartial: true,
      hasFailures: true,
      wasRateLimited: error?.statusCode === 429
    };
  }
};

export const refreshPriceMapForSkin = async (skin) => {
  if (!skin?.marketHashName) {
    return {
      prices: getDefaultPriceMap(),
      isPartial: false,
      hasFailures: false,
      failedItems: [],
      wasRateLimited: false,
      refreshed: false
    };
  }

  const usdResult = await refreshUsdPriceMap({
    skin,
    initialPriceMap: getDefaultPriceMap()
  });

  const nextPrices = normalizePriceMap(usdResult.priceMap);

  await upsertPriceCache({
    marketHashName: skin.marketHashName,
    prices: nextPrices,
    fetchedAt: new Date(),
    isComplete: !usdResult.isPartial
  });

  return {
    prices: nextPrices,
    isPartial: usdResult.isPartial,
    hasFailures: usdResult.hasFailures,
    failedItems: usdResult.hasFailures ? [skin.marketHashName] : [],
    wasRateLimited: usdResult.wasRateLimited,
    refreshed: true
  };
};

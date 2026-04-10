import { env } from '../../config/env.js';
import { Collection } from '../collections/collection.model.js';
import {
  buildExteriorMarketHashName,
  delay,
  getDefaultPriceMap,
  getExteriorFromMarketHashName,
  isValidPriceValue,
  normalizePriceMap,
  parseSteamPrice,
  parseSteamSearchResultPrice
} from './pricing.utils.js';

const REQUEST_DELAY_MS = env.priceRequestDelayMs;
const RETRY_ATTEMPTS = env.priceRequestRetries;
const MAX_RETRY_DELAY_MS = 30_000;
const STEAM_REQUEST_MIN_DELAY_MS = 3_000;
const STEAM_REQUEST_MAX_DELAY_MS = 10_000;
const collectionSteamTagCache = new Map();
const STEAM_USD_CURRENCY_ID = 1;
const STEAM_USD_COUNTRY_CODE = 'US';

const getRandomSteamRequestDelayMs = () =>
  Math.floor(Math.random() * (STEAM_REQUEST_MAX_DELAY_MS - STEAM_REQUEST_MIN_DELAY_MS + 1)) + STEAM_REQUEST_MIN_DELAY_MS;

const delayBeforeSteamRequest = async () => {
  await delay(getRandomSteamRequestDelayMs());
};

const getSimplifiedSearchQuery = (marketHashName) => {
  if (typeof marketHashName !== 'string') {
    return '';
  }

  const parts = marketHashName.split('|');

  if (parts.length < 2) {
    return marketHashName.trim();
  }

  return parts[1].trim();
};

export const getSteamPriceOverviewUrl = (marketHashName) => {
  const url = new URL('https://steamcommunity.com/market/priceoverview/');

  url.searchParams.set('appid', String(env.steamMarketAppId));
  url.searchParams.set('currency', String(STEAM_USD_CURRENCY_ID));
  url.searchParams.set('country', STEAM_USD_COUNTRY_CODE);
  url.searchParams.set('market_hash_name', marketHashName);

  return url;
};

export const getSteamMarketSearchUrl = (marketHashName, steamTag = null) => {
  const url = new URL('https://steamcommunity.com/market/search/render/');

  url.searchParams.set('appid', String(env.steamMarketAppId));
  url.searchParams.set('norender', '1');
  url.searchParams.set('query', marketHashName);
  url.searchParams.set('count', '10');
  url.searchParams.set('start', '0');
  url.searchParams.set('search_descriptions', '0');
  url.searchParams.set('sort_column', 'name');
  url.searchParams.set('sort_dir', 'asc');
  url.searchParams.set('category_730_Quality[]', 'tag_normal');
  url.searchParams.set('currency', String(STEAM_USD_CURRENCY_ID));
  url.searchParams.set('country', STEAM_USD_COUNTRY_CODE);

  if (steamTag) {
    url.searchParams.set('category_730_ItemSet[]', steamTag);
  }

  return url;
};

const getCollectionSteamTag = async (collectionName) => {
  if (!collectionName) {
    return null;
  }

  if (collectionSteamTagCache.has(collectionName)) {
    return collectionSteamTagCache.get(collectionName);
  }

  const collection = await Collection.findOne({ name: collectionName }).select({ steamTag: 1 }).lean();
  const steamTag = collection?.steamTag || null;

  collectionSteamTagCache.set(collectionName, steamTag);

  return steamTag;
};

const getRetryDelayMs = (attempt, statusCode) => {
  if (statusCode === 429) {
    return Math.min(REQUEST_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  }

  return REQUEST_DELAY_MS;
};

export const requestSteamPrice = async (marketHashName) => {
  const requestUrl = getSteamPriceOverviewUrl(marketHashName);
  await delayBeforeSteamRequest();

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const error = new Error(`Steam price request failed with status ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();

  if (!payload?.success) {
    return null;
  }

  return parseSteamPrice(payload.lowest_price || payload.median_price);
};

export const requestSteamSearchResults = async (marketHashName, steamTag = null) => {
  const requestUrl = getSteamMarketSearchUrl(marketHashName, steamTag);
  await delayBeforeSteamRequest();

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const error = new Error(`Steam market search failed with status ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
};

export const fetchPriceWithRetry = async (marketHashName) => {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await requestSteamPrice(marketHashName);
    } catch (error) {
      lastError = error;

      if (attempt === RETRY_ATTEMPTS) {
        break;
      }

      await delay(getRetryDelayMs(attempt, error?.statusCode));
    }
  }

  throw lastError;
};

export const fetchSearchResultsWithRetry = async (marketHashName, steamTag = null) => {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await requestSteamSearchResults(marketHashName, steamTag);
    } catch (error) {
      lastError = error;

      if (attempt === RETRY_ATTEMPTS) {
        break;
      }

      await delay(getRetryDelayMs(attempt, error?.statusCode));
    }
  }

  throw lastError;
};

export const fetchPriceMapFromSearch = async (skin) => {
  const nextPriceMap = getDefaultPriceMap();
  const availableExteriors = Array.isArray(skin?.possibleExteriors) ? skin.possibleExteriors : [];
  const steamTag = await getCollectionSteamTag(skin.collectionName);
  const searchQueries = [skin.marketHashName, getSimplifiedSearchQuery(skin.marketHashName)].filter(
    (query, index, queries) => query && queries.indexOf(query) === index
  );
  let searchResults = [];

  for (const searchQuery of searchQueries) {
    searchResults = await fetchSearchResultsWithRetry(searchQuery, steamTag);

    const hasValidResults = searchResults.some((searchResult) => {
      const marketHashName = searchResult.hash_name || searchResult.name || '';
      return getExteriorFromMarketHashName(marketHashName, skin.marketHashName, availableExteriors) !== null;
    });

    if (hasValidResults) {
      break;
    }
  }

  for (const searchResult of searchResults) {
    const marketHashName = searchResult.hash_name || searchResult.name || '';
    const exterior = getExteriorFromMarketHashName(marketHashName, skin.marketHashName, availableExteriors);

    if (!exterior) {
      continue;
    }

    nextPriceMap[exterior] = parseSteamSearchResultPrice(searchResult);
  }

  const missingExteriors = availableExteriors.filter((exterior) => nextPriceMap[exterior] === null);

  return {
    priceMap: nextPriceMap,
    missingExteriors
  };
};

export const fetchMissingExteriorPrices = async (skin, priceMap, missingExteriors) => {
  const nextPriceMap = { ...priceMap };
  let isPartial = false;
  let hasFailures = false;
  let wasRateLimited = false;

  for (const exterior of missingExteriors) {
    const exteriorMarketHashName = buildExteriorMarketHashName(skin.marketHashName, exterior);

    try {
      const price = await fetchPriceWithRetry(exteriorMarketHashName);
      nextPriceMap[exterior] = price;

      if (price === null) {
        isPartial = true;
      }
    } catch (error) {
      hasFailures = true;
      isPartial = true;

      if (error?.statusCode === 429) {
        wasRateLimited = true;
      }
    }

    await delay(REQUEST_DELAY_MS);
  }

  return {
    priceMap: nextPriceMap,
    isPartial,
    hasFailures,
    wasRateLimited
  };
};

const getMissingExteriors = (priceMap, availableExteriors) =>
  availableExteriors.filter((exterior) => priceMap?.[exterior] === null);

export const fetchPriceMapFromSteam = async (skin, initialPriceMap = null) => {
  const availableExteriors = Array.isArray(skin?.possibleExteriors) ? skin.possibleExteriors : [];
  let nextPriceMap = normalizePriceMap(initialPriceMap || getDefaultPriceMap());
  let hasFailures = false;
  let wasRateLimited = false;
  const hasCompletePriceMap = (priceMap) => availableExteriors.every((exterior) => isValidPriceValue(priceMap[exterior]));

  try {
    if (!hasCompletePriceMap(nextPriceMap)) {
      const searchResult = await fetchPriceMapFromSearch(skin);
      nextPriceMap = normalizePriceMap({
        ...nextPriceMap,
        ...searchResult.priceMap
      });

      // const missingExteriors = getMissingExteriors(nextPriceMap, availableExteriors);
      //
      // if (missingExteriors.length > 0) {
      //   const missingResult = await fetchMissingExteriorPrices(skin, nextPriceMap, missingExteriors);
      //   nextPriceMap = missingResult.priceMap;
      //   hasFailures = missingResult.hasFailures;
      //   wasRateLimited = missingResult.wasRateLimited;
      // }
    }
  } catch (error) {
    if (error?.statusCode === 429) {
      wasRateLimited = true;
    }

    // const missingExteriors = getMissingExteriors(nextPriceMap, availableExteriors);
    //
    // if (missingExteriors.length > 0) {
    //   const missingResult = await fetchMissingExteriorPrices(skin, nextPriceMap, missingExteriors);
    //   nextPriceMap = missingResult.priceMap;
    //   hasFailures = missingResult.hasFailures;
    //   wasRateLimited = wasRateLimited || missingResult.wasRateLimited;
    // }
  }

  const isPartial = !hasCompletePriceMap(nextPriceMap);

  if (!isPartial) {
    hasFailures = false;
  }

  return {
    priceMap: normalizePriceMap(nextPriceMap),
    isPartial,
    hasFailures,
    wasRateLimited
  };
};

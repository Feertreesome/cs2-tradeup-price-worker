const SUPPORTED_EXTERIORS = [
  'Factory New',
  'Minimal Wear',
  'Field-Tested',
  'Well-Worn',
  'Battle-Scarred'
];

const roundMoney = (value) => Number(value.toFixed(2));

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const getDefaultPriceMap = () =>
  SUPPORTED_EXTERIORS.reduce((accumulator, exterior) => {
    accumulator[exterior] = null;
    return accumulator;
  }, {});

export const normalizePriceMap = (prices = {}) => {
  const sourcePriceMap = isPlainObject(prices) ? prices : {};

  return SUPPORTED_EXTERIORS.reduce((accumulator, exterior) => {
    const rawPrice = sourcePriceMap?.[exterior];
    const hasEmptyValue =
      rawPrice === null ||
      rawPrice === undefined ||
      (typeof rawPrice === 'string' && rawPrice.trim() === '');
    const parsedPrice = hasEmptyValue ? null : Number(rawPrice);

    accumulator[exterior] = Number.isFinite(parsedPrice) && parsedPrice > 0 ? roundMoney(parsedPrice) : null;
    return accumulator;
  }, getDefaultPriceMap());
};

export const isValidPriceValue = (value) => {
  const parsedPrice = Number(value);
  return Number.isFinite(parsedPrice) && parsedPrice > 0;
};

export const buildExteriorMarketHashName = (marketHashName, exterior) => {
  if (!marketHashName || !exterior) {
    return marketHashName || null;
  }

  const suffix = `(${exterior})`;

  if (marketHashName.endsWith(suffix)) {
    return marketHashName;
  }

  return `${marketHashName} ${suffix}`;
};

export const parseSteamPrice = (rawPrice) => {
  if (typeof rawPrice !== 'string' || !rawPrice.trim()) {
    return null;
  }

  const cleaned = rawPrice.replace(/[^0-9,.-]/g, '').trim();

  if (!cleaned) {
    return null;
  }

  let normalized = cleaned;

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/,/g, '');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : null;
};

export const parseSteamSearchResultPrice = (searchResult = {}) => {
  const listingCount = Number(
    searchResult.sell_listings ??
      searchResult.sell_listings_count ??
      searchResult.sale_listings ??
      searchResult.sale_listings_count
  );

  if (Number.isFinite(listingCount) && listingCount <= 0) {
    return null;
  }

  const textPrice =
    searchResult.sell_price_text ||
    searchResult.sale_price_text ||
    searchResult.median_price_text ||
    null;

  if (textPrice) {
    return parseSteamPrice(textPrice);
  }

  const numericPrice = Number(searchResult.sell_price ?? searchResult.sale_price ?? searchResult.median_price);

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return null;
  }

  return roundMoney(numericPrice / 100);
};

export const getExteriorFromMarketHashName = (marketHashName, baseMarketHashName, supportedExteriors = SUPPORTED_EXTERIORS) => {
  if (typeof marketHashName !== 'string' || typeof baseMarketHashName !== 'string') {
    return null;
  }

  for (const exterior of supportedExteriors) {
    if (marketHashName === `${baseMarketHashName} (${exterior})`) {
      return exterior;
    }
  }

  return null;
};

export const isPriceCacheFresh = (cacheEntry, now = new Date()) => {
  if (!cacheEntry?.expiresAt) {
    return false;
  }

  return new Date(cacheEntry.expiresAt).getTime() > now.getTime();
};

export const createExpirationDate = (ttlMs, now = new Date()) => new Date(now.getTime() + ttlMs);

export const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const SUPPORTED_PRICE_EXTERIORS = SUPPORTED_EXTERIORS;

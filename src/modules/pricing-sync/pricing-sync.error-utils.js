const RECOVERABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET'
]);

const RECOVERABLE_ERROR_MESSAGES = [
  'fetch failed',
  'network error',
  'socket hang up',
  'timed out',
  'temporarily unavailable',
  'connection reset'
];

const FATAL_ERROR_MESSAGES = ['invalid mongodb uri', 'authentication failed', 'bad auth', 'uri malformed'];

const getErrorText = (error) => {
  if (!error) {
    return '';
  }

  return String(error.message || error).toLowerCase();
};

export const getRecoverableErrorMessage = (error) =>
  error instanceof Error ? error.message : String(error || 'Recoverable pricing sync error');

export const isRecoverablePricingSyncError = (error) => {
  if (!error) {
    return false;
  }

  if (error.statusCode === 429) {
    return true;
  }

  if (error.name === 'AbortError') {
    return true;
  }

  const errorCode = error.code || error.cause?.code || null;

  if (errorCode && RECOVERABLE_ERROR_CODES.has(errorCode)) {
    return true;
  }

  const errorText = getErrorText(error);

  if (FATAL_ERROR_MESSAGES.some((message) => errorText.includes(message))) {
    return false;
  }

  if (error.name === 'TypeError' && errorText.includes('fetch failed')) {
    return true;
  }

  return RECOVERABLE_ERROR_MESSAGES.some((message) => errorText.includes(message));
};

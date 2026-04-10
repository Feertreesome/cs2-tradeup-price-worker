import { env } from '../../config/env.js';

const LOG_LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const getThreshold = () => LOG_LEVELS[env.logLevel] || LOG_LEVELS.info;

const writeLog = (level, scope, message, metadata = {}) => {
  if ((LOG_LEVELS[level] || LOG_LEVELS.info) < getThreshold()) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...metadata
  };

  const output = JSON.stringify(entry);

  if (level === 'error') {
    console.error(output);
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  console.log(output);
};

export const createLogger = (scope) => ({
  info: (message, metadata) => writeLog('info', scope, message, metadata),
  warn: (message, metadata) => writeLog('warn', scope, message, metadata),
  error: (message, metadata) => writeLog('error', scope, message, metadata),
  debug: (message, metadata) => writeLog('debug', scope, message, metadata)
});

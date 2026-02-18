/* eslint-disable no-console */

const logger: {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
} = {
  info: (...args: unknown[]): void => {
    console.info(...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};

export default logger;

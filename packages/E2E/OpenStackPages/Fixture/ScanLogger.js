/*
 * What the snapshot scan logs to when it runs in the fixture's page. The scan only
 * logs a timestamp it could not read, and these recordings' timestamps are the
 * fixture's own, so nothing here is lost.
 */
export default {
  warn: () => {},
  error: () => {},
  info: () => {},
  debug: () => {},
};

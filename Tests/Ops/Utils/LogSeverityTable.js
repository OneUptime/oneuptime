"use strict";

/**
 * The one table of level words (issue #11228), as the agents' suites read
 * it: LOG_SEVERITY_NUMBER_BY_TEXT, loaded from packages/Common itself, and
 * the reader tokens the agents' readers lift that are no word of it.
 *
 * LogSeverityOneTable.test.js holds every copy of the level words to this,
 * and agent-log-severity-behaviour.sh (through LogSeverityBehaviour.js)
 * holds what the real collector exports to it: a record's severityText is
 * the text the chain lifted, and its severityNumber must be the number this
 * table names for that text.
 */

const { loadCommonModule } = require("./AgentLogSeverityConfigs.js");

const { LOG_SEVERITY_NUMBER_BY_TEXT, logSeverityFromNumber } = loadCommonModule(
  "Types/Log/LogSeverity.ts",
);

/**
 * The texts only the agents' readers lift: no word a sender writes in a
 * level field, only a mark in one format's own position. Each with the
 * number it names and the reader that lifts it. Upper-cased, as the table is
 * keyed.
 */
const READER_TOKENS = new Map([
  // klog and glog's first letter (MongoDB's "s" and Gitea's [X] use them too).
  ["I", { number: 9, reader: "parse-klog-severity" }],
  ["W", { number: 13, reader: "parse-klog-severity" }],
  ["E", { number: 17, reader: "parse-klog-severity" }],
  ["F", { number: 21, reader: "parse-klog-severity" }],
  // Gitea's trace and debug letters.
  ["T", { number: 1, reader: "parse-gitea-severity" }],
  ["D", { number: 5, reader: "parse-gitea-severity" }],
  // MongoDB's debug verbosities, all DEBUG (CloudWatch reads PostgreSQL's
  // DEBUG1 to DEBUG5 so too).
  ["D1", { number: 5, reader: "parse-mongodb-severity" }],
  ["D2", { number: 5, reader: "parse-mongodb-severity" }],
  ["D3", { number: 5, reader: "parse-mongodb-severity" }],
  ["D4", { number: 5, reader: "parse-mongodb-severity" }],
  ["D5", { number: 5, reader: "parse-mongodb-severity" }],
  // Redis's and Valkey's symbols, in their order: debug, verbose (above its
  // debug), notice (syslog's INFO2), warning.
  [".", { number: 5, reader: "parse-redis-severity" }],
  ["-", { number: 6, reader: "parse-redis-severity" }],
  ["*", { number: 10, reader: "parse-redis-severity" }],
  ["#", { number: 13, reader: "parse-redis-severity" }],
  // MySQL 8's [System]: startup and shutdown, informational.
  ["SYSTEM", { number: 9, reader: "parse-mysql-severity" }],
  // PHP's error types: a fatal or parse error stops the script; a
  // deprecation is a warning, as Python's and Node's are.
  ["FATAL ERROR", { number: 21, reader: "parse-php-severity" }],
  ["PARSE ERROR", { number: 21, reader: "parse-php-severity" }],
  ["RECOVERABLE FATAL ERROR", { number: 17, reader: "parse-php-severity" }],
  ["DEPRECATED", { number: 13, reader: "parse-php-severity" }],
  // pino and bunyan's numbers.
  ["10", { number: 1, reader: "parse-numeric-severity" }],
  ["20", { number: 5, reader: "parse-numeric-severity" }],
  ["30", { number: 9, reader: "parse-numeric-severity" }],
  ["40", { number: 13, reader: "parse-numeric-severity" }],
  ["50", { number: 17, reader: "parse-numeric-severity" }],
  ["60", { number: 21, reader: "parse-numeric-severity" }],
  // PostgreSQL's (and NestJS's) informational level, in capitals only: as a
  // level field's value "log" is console.log's word, which the table leaves
  // unread.
  ["LOG", { number: 9, reader: "parse-severity-from-body" }],
]);

/** The number a text names: the table's, or a reader token's; undefined else. */
function namedNumber(text) {
  const key = String(text).trim().toUpperCase();

  if (LOG_SEVERITY_NUMBER_BY_TEXT.has(key)) {
    return LOG_SEVERITY_NUMBER_BY_TEXT.get(key);
  }

  return READER_TOKENS.has(key) ? READER_TOKENS.get(key).number : undefined;
}

module.exports = {
  LOG_SEVERITY_NUMBER_BY_TEXT,
  READER_TOKENS,
  logSeverityFromNumber,
  namedNumber,
};

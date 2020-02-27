/**
 * @fileoverview Default message and error logger service.
 * @author HackerBay, Inc.
 * @module logger
 */

const pino = require('pino');

/** The logger service. */
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

module.exports = logger;

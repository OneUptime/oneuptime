/**
 * @fileoverview Default message and error logger service.
 * @author HackerBay, Inc.
 * @module logger
 */

import pino from 'pino';

/** The logger service. */
const logger: $TSFixMe = pino({
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: { colorize: true, translateTime: true },
});

export default logger;

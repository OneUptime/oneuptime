"use strict";

/**
 * @fileoverview Default message and error logger service.
 * @author HackerBay, Inc.
 * @module logger
 */
var pino = require('pino');
/** The logger service. */


var logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  prettyPrint: {
    colorize: true,
    translateTime: true
  }
});
module.exports = logger;
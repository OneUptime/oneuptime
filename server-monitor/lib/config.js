/**
 * @fileoverview Main application config module.
 * @author HackerBay, Inc.
 * @module config
 */

'use strict';

/** The api url to send server information. */
const API_URL = process.env.API_URL ||
  process.env.NODE_ENV === 'development' ? 'http://localhost:3002' : 'https://api.fyipe.com';

module.exports = { API_URL };

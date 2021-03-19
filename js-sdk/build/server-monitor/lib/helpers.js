/**
 * @fileoverview HTTP wrapper functions module.
 * @author HackerBay, Inc.
 * @module helpers
 * @see module:config
 * @see module:logger
 */
'use strict';

var axios = require('axios');

var _require = require('./config'),
    API_URL = _require.API_URL;

var logger = require('./logger');
/** The request headers. */


var headers = {
  'Content-Type': 'application/json'
};
/** Handle request error.
 * @param {Object} - The error object of the request.
 * @default
 */

var defaultErrorHandler = function defaultErrorHandler(error) {
  logger.debug(error.config);

  if (error.response) {
    logger.debug(error.response.data);
    logger.debug(error.response.status);
    logger.debug(error.response.headers);
    throw error.response.data;
  } else {
    if (error.request) {
      logger.debug(error.request);
    } else {
      logger.debug('Error', error.message);
    }
  }

  throw error;
};
/**
 * Get request data with axios.
 * @param {string} apiUrl - The url of the api.
 * @param {string} url - The endpoint of the request.
 * @param {string} key - The api key of the endpoint.
 * @param {Function} success - The request success callback.
 * @param {Function} error - The request error callback.
 * @return {Promise} The request promise.
 */


var get = function get(apiUrl, url, key, success) {
  var error = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : defaultErrorHandler;
  headers['apiKey'] = key;
  return axios({
    method: 'get',
    url: "".concat(apiUrl || API_URL, "/").concat(url),
    headers: headers
  }).then(success, error);
};
/**
 * Post request data with axios.
 * @param {string} apiUrl - The url of the api.
 * @param {string} url - The endpoint of the request.
 * @param {Object} data - The data of endpoint.
 * @param {string} key - The api key of the endpoint.
 * @param {Function} success - The request success callback.
 * @param {Function} error - The request error callback.
 * @return {Promise} The request promise.
 */


var post = function post(apiUrl, url, data, key, success) {
  var error = arguments.length > 5 && arguments[5] !== undefined ? arguments[5] : defaultErrorHandler;
  headers['apiKey'] = key;
  return axios({
    method: 'post',
    url: "".concat(apiUrl || API_URL, "/").concat(url),
    headers: headers,
    data: data
  }).then(success, error);
};

module.exports = {
  get: get,
  post: post,
  defaultErrorHandler: defaultErrorHandler
};
/**
 * @fileoverview HTTP wrapper functions module.
 * @author HackerBay, Inc.
 * @module helpers
 * @see module:config
 * @see module:logger
 */

'use strict';

import axios from 'axios';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./config"' has no exported member 'API_UR... Remove this comment to see the full error message
import { API_URL } from './config';
import logger from './logger';

/** The request headers. */
const headers = {
    'Content-Type': 'application/json',
};

/** Handle request error.
 * @param {Object} - The error object of the request.
 * @default
 */
const defaultErrorHandler = (error: $TSFixMe) => {
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
const get = (
    apiUrl: $TSFixMe,
    url: $TSFixMe,
    key: $TSFixMe,
    success: $TSFixMe,
    error = defaultErrorHandler
) => {
    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    headers['apiKey'] = key;

    return axios({
        method: 'get',
        url: `${apiUrl || API_URL}/${url}`,
        headers,
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
const post = (
    apiUrl: $TSFixMe,
    url: $TSFixMe,
    data: $TSFixMe,
    key: $TSFixMe,
    success: $TSFixMe,
    error = defaultErrorHandler
) => {
    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    headers['apiKey'] = key;

    return axios({
        method: 'post',
        url: `${apiUrl || API_URL}/${url}`,
        headers,
        data,
    }).then(success, error);
};

export default {
    get,
    post,
    defaultErrorHandler,
};

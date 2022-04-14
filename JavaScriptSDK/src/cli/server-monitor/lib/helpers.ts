/**
 * @fileoverview HTTP wrapper functions module.
 * @author HackerBay, Inc.
 * @module helpers
 * @see module:config
 * @see module:logger
 */

import axios from 'axios';

import { API_URL } from './config';
import logger from './logger';

/** The request headers. */
const headers: $TSFixMe = {
    'Content-Type': 'application/json',
};

/** Handle request error.
 * @param {Object} - The error object of the request.
 * @default
 */
const defaultErrorHandler: Function = (error: $TSFixMe): void => {
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
const get: Function = (
    apiUrl: URL,
    url: URL,
    key: $TSFixMe,
    success: $TSFixMe,
    error = defaultErrorHandler
): void => {
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
const post: Function = (
    apiUrl: URL,
    url: URL,
    data: $TSFixMe,
    key: $TSFixMe,
    success: $TSFixMe,
    error = defaultErrorHandler
): void => {
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

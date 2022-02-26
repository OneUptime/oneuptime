/**
 * @fileoverview Main API to authenticate user, start and stop server monitoring.
 * @author HackerBay, Inc.
 * @module api
 * @see module:helpers
 * @see module:logger
 */

'use strict';

import dotenv from 'dotenv'
dotenv.config();

import Promise from 'promise'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'cron... Remove this comment to see the full error message
import cron from 'cron'
import si from 'systeminformation'
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./helpers"' has no exported member 'get'.... Remove this comment to see the full error message
import { get, post } from './helpers'
import logger from './logger'
const {
    onlineTestData,
    degradedTestData,
    offlineTestData,
} = require('./config');

/**
 * Get system information at interval and upload to server.
 * @param {string} projectId - The project id of the project.
 * @param {string} monitorId - The monitor id of the server monitor.
 * @param {string} apiUrl - The url of the api.
 * @param {string} apiKey - The api key of the project.
 * @param {string} interval - The interval of the cron job, must ba a valid cron format.
 * @return {Object} The ping server cron job.
 */
const ping = (
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    apiUrl: $TSFixMe,
    apiKey: $TSFixMe,
    interval = '* * * * *',
    simulate: $TSFixMe,
    simulateData: $TSFixMe
) => {
    return new cron.CronJob(
        interval,
        () => {
            if (typeof simulateData !== 'object') simulateData = null;
            switch (simulate) {
                case 'online':
                    try {
                        post(
                            apiUrl,
                            `monitor/${projectId}/log/${monitorId}`,
                            simulateData || onlineTestData,
                            apiKey,
                            (log: $TSFixMe) => {
                                logger.debug(log.data);
                                logger.info(
                                    `${monitorId} - System Information uploaded`
                                );
                            }
                        );
                    } catch (error) {
                        logger.error(error);
                    }
                    break;
                case 'degraded':
                    try {
                        post(
                            apiUrl,
                            `monitor/${projectId}/log/${monitorId}`,
                            simulateData || degradedTestData,
                            apiKey,
                            (log: $TSFixMe) => {
                                logger.debug(log.data);
                                logger.info(
                                    `${monitorId} - System Information uploaded`
                                );
                            }
                        );
                    } catch (error) {
                        logger.error(error);
                    }
                    break;
                case 'offline':
                    try {
                        post(
                            apiUrl,
                            `monitor/${projectId}/log/${monitorId}`,
                            simulateData || offlineTestData,
                            apiKey,
                            (log: $TSFixMe) => {
                                logger.debug(log.data);
                                logger.info(
                                    `${monitorId} - System Information uploaded`
                                );
                            }
                        );
                    } catch (error) {
                        logger.error(error);
                    }
                    break;
                default:
                    Promise.all([
                        si.currentLoad(),
                        si.mem(),
                        si.fsSize(),
                        si.cpuTemperature(),
                        si.cpu(),
                    ])
                        .then(data => {
                            const storage =
                                data[2] && data[2].length > 0
                                    ? data[2].filter(
                                          partition =>
                                              partition.size === data[2][0].size
                                      )
                                    : data[2];
                            return {
                                cpuLoad: data[0].currentLoad,
                                avgCpuLoad: data[0].avgLoad * 100,
                                cpuCores: data[4].physicalCores,
                                memoryUsed: data[1].active,
                                totalMemory: data[1].total,
                                swapUsed: data[1].swapused,
                                storageUsed:
                                    storage && storage.length > 0
                                        ? storage
                                              .map(partition => partition.used)
                                              .reduce(
                                                  (used, partitionUsed) =>
                                                      used + partitionUsed
                                              )
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'used' does not exist on type 'FsSizeData... Remove this comment to see the full error message
                                        : storage.used,
                                totalStorage:
                                    storage && storage.length > 0
                                        ? storage[0].size
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'size' does not exist on type 'FsSizeData... Remove this comment to see the full error message
                                        : storage.size,
                                storageUsage:
                                    storage && storage.length > 0
                                        ? storage
                                              .map(partition => partition.use)
                                              .reduce(
                                                  (use, partitionUse) =>
                                                      use + partitionUse
                                              )
                                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'use' does not exist on type 'FsSizeData[... Remove this comment to see the full error message
                                        : storage.use,
                                mainTemp: data[3].main,
                                maxTemp: data[3].max,
                            };
                        })
                        .then(data => {
                            post(
                                apiUrl,
                                `monitor/${projectId}/log/${monitorId}`,
                                data,
                                apiKey,
                                (log: $TSFixMe) => {
                                    logger.debug(log.data);
                                    logger.info(
                                        `${monitorId} - System Information uploaded`
                                    );
                                },
                                (error: $TSFixMe) => logger.error(error)
                            );
                        })
                        .catch(error => {
                            logger.error(error);
                        });
            }
        },
        null,
        false
    );
};

/**
 * Authenticate user and get list of server monitors if monitor id not provided.
 * @param {(string | Object)} config - The project id or config of the project.
 * @param {string} apiUrl - The url of the api.
 * @param {string} apiKey - The api key of the project.
 * @param {(string | Function)} monitorId - The monitor id or function to resolve monitor id of the server monitor.
 * @return {Object} The server monitor handlers.
 */

export default function(config: $TSFixMe, apiUrl: $TSFixMe, apiKey: $TSFixMe, monitorId: $TSFixMe) {
    let pingServer: $TSFixMe,
        projectId = config,
        interval: $TSFixMe,
        timeout: $TSFixMe,
        simulate: $TSFixMe,
        simulateData: $TSFixMe;

    if (typeof config === 'object') {
        projectId = config.projectId;
        apiUrl = config.apiUrl;
        apiKey = config.apiKey;
        monitorId = config.monitorId;
        interval = config.interval;
        timeout = config.timeout;
        simulate = config.simulate;
        simulateData = config.simulateData;
    }

    return {
        /**
         * Start server monitor.
         * @param {string} id - The monitor id of the server monitor.
         * @return {(Object | number)} The ping server cron job or the error code.
         */
        start: (id = monitorId) => {
            const url = `monitor/${projectId}/monitor/${
                id && typeof id === 'string' ? `${id}/` : ''
            }?type=server-monitor`;

            return get(apiUrl, url, apiKey, (response: $TSFixMe) => {
                return new Promise((resolve, reject) => {
                    const data = response.data;

                    if (data && data !== null) {
                        if (id && typeof id === 'string') {
                            resolve(data._id);
                        } else {
                            if (data.data !== null && data.data.length > 0) {
                                if (data.count === 1) {
                                    logger.info(
                                        'Using default Server Monitor...'
                                    );
                                    resolve(data.data[0]._id);
                                } else {
                                    if (id && typeof id === 'function') {
                                        resolve(id(data.data));
                                    } else {
                                        logger.error(
                                            'Server Monitor ID is required'
                                        );
                                        reject(1);
                                    }
                                }
                            } else {
                                logger.error('No Server Monitor found');
                                reject(0);
                            }
                        }
                    } else {
                        logger.error('No Server Monitor found');
                        reject(0);
                    }
                });
            })
                .then((monitorId: $TSFixMe) => {
                    return new Promise((resolve, reject) => {
                        if (monitorId) {
                            logger.info('Starting Server Monitor...');
                            pingServer = ping(
                                projectId,
                                monitorId,
                                apiUrl,
                                apiKey,
                                interval,
                                simulate,
                                simulateData
                            );
                            pingServer.start();

                            if (timeout) {
                                setTimeout(() => {
                                    logger.info('Stopping Server Monitor...');
                                    pingServer.stop();
                                }, timeout);
                            }

                            resolve(pingServer);
                        } else {
                            logger.error('Server Monitor ID is required');
                            reject(1);
                        }
                    });
                })
                .catch((error: $TSFixMe) => {
                    if (typeof error !== 'number') logger.error(error);

                    const errorCode = typeof error === 'number' ? error : 1;
                    process.exitCode = errorCode;

                    return error;
                });
        },
        /** Stop server monitor.
         * @return {Object} The ping server cron job.
         */
        stop: () => {
            if (pingServer) {
                logger.info('Stopping Server Monitor...');
                pingServer.stop();
            }

            return pingServer;
        },
    };
};

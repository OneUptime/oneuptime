/**
 * @fileoverview Main API to authenticate user, start and stop server monitoring.
 * @author HackerBay, Inc.
 * @module api
 * @see module:helpers
 * @see module:logger
 */

import Promise from 'promise';
import ObjectID from 'Common/Types/ObjectID';
import cron from 'cron';
import si from 'systeminformation';

import { get, post } from './helpers';
import logger from './logger';
import { onlineTestData, degradedTestData, offlineTestData } from './config';

/**
 * Get system information at interval and upload to server.
 * @param {string} projectId - The project id of the project.
 * @param {string} monitorId - The monitor id of the server monitor.
 * @param {string} apiUrl - The url of the api.
 * @param {string} apiKey - The api key of the project.
 * @param {string} interval - The interval of the cron job, must ba a valid cron format.
 * @return {Object} The ping server cron job.
 */
const ping: Function = (
    projectId: ObjectID,
    monitorId: $TSFixMe,
    apiUrl: URL,
    apiKey: string,
    interval = '* * * * *',
    simulate: $TSFixMe,
    simulateData: $TSFixMe
): void => {
    return new cron.CronJob(
        interval,
        () => {
            if (typeof simulateData !== 'object') {
                simulateData = null;
            }
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
                            const storage: $TSFixMe =
                                data[2] && data[2].length > 0
                                    ? data[2].filter(partition => {
                                          return (
                                              partition.size === data[2][0].size
                                          );
                                      })
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
                                              .map((partition: $TSFixMe) => {
                                                  return partition.used;
                                              })
                                              .reduce((used, partitionUsed) => {
                                                  return used + partitionUsed;
                                              })
                                        : storage.used,
                                totalStorage:
                                    storage && storage.length > 0
                                        ? storage[0].size
                                        : storage.size,
                                storageUsage:
                                    storage && storage.length > 0
                                        ? storage
                                              .map((partition: $TSFixMe) => {
                                                  return partition.use;
                                              })
                                              .reduce((use, partitionUse) => {
                                                  return use + partitionUse;
                                              })
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
                                (error: $TSFixMe) => {
                                    return logger.error(error);
                                }
                            );
                        })
                        .catch((error: Error) => {
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

export default function (
    config: $TSFixMe,
    apiUrl: URL,
    apiKey: string,
    monitorId: $TSFixMe
): void {
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
            const url: string = `monitor/${projectId}/monitor/${
                id && typeof id === 'string' ? `${id}/` : ''
            }?type=server-monitor`;

            return get(apiUrl, url, apiKey, (response: $TSFixMe) => {
                return new Promise((resolve: Function, reject: Function) => {
                    const data: $TSFixMe = response.data;

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
                    return new Promise(
                        (resolve: Function, reject: Function) => {
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
                                        logger.info(
                                            'Stopping Server Monitor...'
                                        );
                                        pingServer.stop();
                                    }, timeout);
                                }

                                resolve(pingServer);
                            } else {
                                logger.error('Server Monitor ID is required');
                                reject(1);
                            }
                        }
                    );
                })
                .catch((error: $TSFixMe) => {
                    if (typeof error !== 'number') {
                        logger.error(error);
                    }

                    const errorCode: $TSFixMe =
                        typeof error === 'number' ? error : 1;
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
}

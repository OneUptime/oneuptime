/**
 * @fileoverview Main API to authenticate user, start and stop server monitoring.
 * @author HackerBay, Inc.
 * @module api
 * @see module:helpers
 * @see module:logger
 */

'use strict';

const dotenv = require('dotenv');
dotenv.config();

const Promise = require('promise');
const cron = require('cron');
const si = require('systeminformation');
const { get, post } = require('./helpers');
const logger = require('./logger');

/**
 * Get system information at interval and upload to server.
 * @param {string} projectId - The project id of the project.
 * @param {string} monitorId - The monitor id of the server monitor.
 * @param {string} apiKey - The api key of the project.
 * @param {string} interval - The interval of the cron job, must ba a valid cron format.
 * @return {Object} The ping server cron job.
 */
const ping = (projectId, monitorId, apiKey, interval = '* * * * *') => {
  return new cron.CronJob(interval, () => {
    Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.cpuTemperature()
    ])
      .then(data => ({
        cpuLoad: data[0].currentload,
        avgCpuLoad: data[0].avgload,
        cpuCores: data[0].cpus.length,
        memoryUsed: data[1].used,
        totalMemory: data[1].total,
        swapUsed: data[1].swapused,
        storageUsed: data[2] && data[2].length > 0 ? data[2][0].used : data[2].used,
        totalStorage: data[2] && data[2].length > 0 ? data[2][0].size : data[2].size,
        storageUsage: data[2] && data[2].length > 0 ? data[2][0].use : data[2].use,
        mainTemp: data[3].main,
        maxTemp: data[3].max,
      }))
      .then(data => {
        post(`monitor/${projectId}/log/${monitorId}`, data, apiKey, () => {
          logger.info(`${monitorId} - System Information uploaded`);
        });
      })
      .catch(error => { logger.debug(error) });
  }, null, false);
};

/**
 * Authenticate user and get list of server monitors if monitor id not provided.
 * @param {(string | Object)} config - The project id or config of the project.
 * @param {string} apiKey - The api key of the project.
 * @param {(string | Function)} monitorId - The monitor id or function to resolve monitor id of the server monitor.
 * @return {Object} The server monitor handlers.
 */
module.exports = (config, apiKey, monitorId) => {
  let pingServer, projectId = config;

  if (typeof config === 'object') {
    projectId = config.projectId;
    apiKey = config.apiKey;
    monitorId = config.monitorId;
  }

  return {
    /**
     * Start server monitor.
     * @param {string} id - The monitor id of the server monitor.
     * @return {(Object | number)} The ping server cron job or the error code.
     */
    start: (id = monitorId) => {
      const url = `monitor/${projectId}/monitor/${id && typeof id === 'string' ? `${id}/` : ''}?type=server-monitor`;

      return get(url, apiKey, response => {
        return new Promise((resolve, reject) => {
          const data = response.data;

          if (data !== null) {
            if (id && typeof id === 'string') {
              resolve(data._id);
            } else {
              if (data.data !== null && data.data.length > 0) {
                if (data.count === 1) {
                  logger.info('Using default Server Monitor...');
                  resolve(data.data[0]._id);
                } else {
                  if (id && typeof id === 'function') {
                    resolve(id(data.data));
                  } else {
                    logger.info('Server Monitor ID is required');
                    reject(1)
                  }
                }
              } else {
                logger.info('No Server Monitor found');
                reject(0)
              }
            }
          } else {
            logger.info('No Server Monitor found');
            reject(0)
          }
        });
      }).then(monitorId => {
        if (monitorId) {
          logger.info('Starting Server Monitor...');
          pingServer = ping(projectId, monitorId, apiKey, config.interval);
          pingServer.start();

          if (config.timeout) {
            setTimeout(() => {
              logger.info('Stopping Server Monitor...');
              pingServer.stop()
            }, config.timeout);
          }

          return pingServer;
        } else {
          logger.info('Server Monitor ID is required');
          throw new Error(1);
        }
      }).catch(error => {
        const errorCode = typeof error === 'number' ? error : 1;
        process.exitCode = errorCode;

        return errorCode;
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
    }
  }
};

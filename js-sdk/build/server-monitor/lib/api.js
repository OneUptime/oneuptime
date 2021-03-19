/**
 * @fileoverview Main API to authenticate user, start and stop server monitoring.
 * @author HackerBay, Inc.
 * @module api
 * @see module:helpers
 * @see module:logger
 */
'use strict';

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

var _typeof2 = _interopRequireDefault(require("@babel/runtime/helpers/typeof"));

var dotenv = require('dotenv');

dotenv.config();

var Promise = require('promise');

var cron = require('cron');

var si = require('systeminformation');

var _require = require('./helpers'),
    get = _require.get,
    post = _require.post;

var logger = require('./logger');

var _require2 = require('./config'),
    onlineTestData = _require2.onlineTestData,
    degradedTestData = _require2.degradedTestData,
    offlineTestData = _require2.offlineTestData;
/**
 * Get system information at interval and upload to server.
 * @param {string} projectId - The project id of the project.
 * @param {string} monitorId - The monitor id of the server monitor.
 * @param {string} apiUrl - The url of the api.
 * @param {string} apiKey - The api key of the project.
 * @param {string} interval - The interval of the cron job, must ba a valid cron format.
 * @return {Object} The ping server cron job.
 */


var ping = function ping(projectId, monitorId, apiUrl, apiKey) {
  var interval = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : '* * * * *';
  var simulate = arguments.length > 5 ? arguments[5] : undefined;
  var simulateData = arguments.length > 6 ? arguments[6] : undefined;
  return new cron.CronJob(interval, function () {
    if ((0, _typeof2["default"])(simulateData) !== 'object') simulateData = null;

    switch (simulate) {
      case 'online':
        try {
          post(apiUrl, "monitor/".concat(projectId, "/log/").concat(monitorId), simulateData || onlineTestData, apiKey, function (log) {
            logger.debug(log.data);
            logger.info("".concat(monitorId, " - System Information uploaded"));
          });
        } catch (error) {
          logger.error(error);
        }

        break;

      case 'degraded':
        try {
          post(apiUrl, "monitor/".concat(projectId, "/log/").concat(monitorId), simulateData || degradedTestData, apiKey, function (log) {
            logger.debug(log.data);
            logger.info("".concat(monitorId, " - System Information uploaded"));
          });
        } catch (error) {
          logger.error(error);
        }

        break;

      case 'offline':
        try {
          post(apiUrl, "monitor/".concat(projectId, "/log/").concat(monitorId), simulateData || offlineTestData, apiKey, function (log) {
            logger.debug(log.data);
            logger.info("".concat(monitorId, " - System Information uploaded"));
          });
        } catch (error) {
          logger.error(error);
        }

        break;

      default:
        Promise.all([si.currentLoad(), si.mem(), si.fsSize(), si.cpuTemperature(), si.cpu()]).then(function (data) {
          var storage = data[2] && data[2].length > 0 ? data[2].filter(function (partition) {
            return partition.size === data[2][0].size;
          }) : data[2];
          return {
            cpuLoad: data[0].currentLoad,
            avgCpuLoad: data[0].avgLoad * 100,
            cpuCores: data[4].physicalCores,
            memoryUsed: data[1].active,
            totalMemory: data[1].total,
            swapUsed: data[1].swapused,
            storageUsed: storage && storage.length > 0 ? storage.map(function (partition) {
              return partition.used;
            }).reduce(function (used, partitionUsed) {
              return used + partitionUsed;
            }) : storage.used,
            totalStorage: storage && storage.length > 0 ? storage[0].size : storage.size,
            storageUsage: storage && storage.length > 0 ? storage.map(function (partition) {
              return partition.use;
            }).reduce(function (use, partitionUse) {
              return use + partitionUse;
            }) : storage.use,
            mainTemp: data[3].main,
            maxTemp: data[3].max
          };
        }).then(function (data) {
          post(apiUrl, "monitor/".concat(projectId, "/log/").concat(monitorId), data, apiKey, function (log) {
            logger.debug(log.data);
            logger.info("".concat(monitorId, " - System Information uploaded"));
          }, function (error) {
            return logger.error(error);
          });
        })["catch"](function (error) {
          logger.error(error);
        });
    }
  }, null, false);
};
/**
 * Authenticate user and get list of server monitors if monitor id not provided.
 * @param {(string | Object)} config - The project id or config of the project.
 * @param {string} apiUrl - The url of the api.
 * @param {string} apiKey - The api key of the project.
 * @param {(string | Function)} monitorId - The monitor id or function to resolve monitor id of the server monitor.
 * @return {Object} The server monitor handlers.
 */


module.exports = function (config, apiUrl, apiKey, monitorId) {
  var pingServer,
      projectId = config,
      interval,
      timeout,
      simulate,
      simulateData;

  if ((0, _typeof2["default"])(config) === 'object') {
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
    start: function start() {
      var id = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : monitorId;
      var url = "monitor/".concat(projectId, "/monitor/").concat(id && typeof id === 'string' ? "".concat(id, "/") : '', "?type=server-monitor");
      return get(apiUrl, url, apiKey, function (response) {
        return new Promise(function (resolve, reject) {
          var data = response.data;

          if (data && data !== null) {
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
                    logger.error('Server Monitor ID is required');
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
      }).then(function (monitorId) {
        return new Promise(function (resolve, reject) {
          if (monitorId) {
            logger.info('Starting Server Monitor...');
            pingServer = ping(projectId, monitorId, apiUrl, apiKey, interval, simulate, simulateData);
            pingServer.start();

            if (timeout) {
              setTimeout(function () {
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
      })["catch"](function (error) {
        if (typeof error !== 'number') logger.error(error);
        var errorCode = typeof error === 'number' ? error : 1;
        process.exitCode = errorCode;
        return error;
      });
    },

    /** Stop server monitor.
     * @return {Object} The ping server cron job.
     */
    stop: function stop() {
      if (pingServer) {
        logger.info('Stopping Server Monitor...');
        pingServer.stop();
      }

      return pingServer;
    }
  };
};
/**
 * @fileoverview Main application config module.
 * @author HackerBay, Inc.
 * @module config
 */

'use strict';

const path = require('path');

/** The api url to send server information. */
const API_URL =
    process.env.API_URL ||
    (process.env.NODE_ENV === 'development'
        ? 'http://localhost:3002'
        : 'https://oneuptime.com/api');

const onlineTestData = {
    cpuLoad: 10.451510774011686,
    avgCpuLoad: 27,
    cpuCores: 4,
    memoryUsed: 2513182720,
    totalMemory: 8589934592,
    swapUsed: 1800142848,
    storageUsed: 183032516608,
    totalStorage: 250685575168,
    storageUsage: 73.00999999999999,
    mainTemp: 59.5,
    maxTemp: 60,
};
const degradedTestData = {
    cpuLoad: 11.577671931143978,
    avgCpuLoad: 27,
    cpuCores: 4,
    memoryUsed: 2829381632,
    totalMemory: 8589934592,
    swapUsed: 2446589952,
    storageUsed: 243169382400,
    totalStorage: 250685575168,
    storageUsage: 97.0017450095,
    mainTemp: 62,
    maxTemp: 63,
};
const offlineTestData = {
    cpuLoad: 0,
    avgCpuLoad: 0,
    cpuCores: 0,
    memoryUsed: 0,
    totalMemory: 0,
    swapUsed: 0,
    storageUsed: 0,
    totalStorage: 0,
    storageUsage: 0,
    mainTemp: 0,
    maxTemp: 0,
};

const LOG_PATH = {
    linux: {
        log: '/var/log/OneUptime Server Monitor/oneuptimeservermonitor.log',
        error: '/var/log/OneUptime Server Monitor/oneuptimeservermonitor_error.log',
    },
    darwin: {
        log: '/Library/Logs/OneUptime Server Monitor/oneuptimeservermonitor.log',
        error:
            '/Library/Logs/OneUptime Server Monitor/oneuptimeservermonitor_error.log',
    },
    win32: {
        log: path.join(__dirname, 'oneuptimeservermonitor.out.log'),
        error: path.join(__dirname, 'oneuptimeservermonitor.err.log'),
    },
};

module.exports = {
    API_URL,
    LOG_PATH,
    onlineTestData,
    degradedTestData,
    offlineTestData,
};

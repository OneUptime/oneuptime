/**
 * @fileoverview Main application config module.
 * @author HackerBay, Inc.
 * @module config
 */

'use strict';

/** The api url to send server information. */
const API_URL =
    process.env.API_URL ||
    (process.env.NODE_ENV === 'development'
        ? 'http://localhost:3002'
        : 'https://fyipe.com/api');

const onlineTestData = {
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
const degradedTestData = {
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

module.exports = { API_URL, onlineTestData, degradedTestData, offlineTestData };

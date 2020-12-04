/**
 * @fileoverview HTTP wrapper functions module.
 * @author HackerBay, Inc.
 * @module helpers
 * @see module:config
 * @see module:logger
 */

'use strict';

const axios = require('axios');
const { NodeSSH } = require('node-ssh');
const { API_URL, COMMAND } = require('./config');
const logger = require('./logger');

/** The request headers. */
const headers = {
    'Content-Type': 'application/json',
};

/** Handle request error.
 * @param {Object} - The error object of the request.
 * @default
 */
const defaultErrorHandler = error => {
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
const get = (apiUrl, url, key, success, error = defaultErrorHandler) => {
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
const post = (apiUrl, url, data, key, success, error = defaultErrorHandler) => {
    headers['apiKey'] = key;

    return axios({
        method: 'post',
        url: `${apiUrl || API_URL}/${url}`,
        headers,
        data,
    }).then(success, error);
};

/**
 * Execute commands.
 * @param {Function} exec - The execution method.
 * @param {string} os - The OS to execute commands.
 * @return {Promise} The request promise.
 */
const execCommands = async (exec, os) => {
    try {
        const isSSH = exec instanceof NodeSSH;

        // TODO: complete commands and make platform specific
        let cpuLoad,
            avgCpuLoad,
            cpuCores,
            memoryUsed,
            totalMemory,
            swapUsed,
            storageUsed,
            totalStorage,
            storageUsage,
            mainTemp,
            maxTemp;

        if (os === 'Linux') {
            const { stdout: load } = await (isSSH
                ? exec.execCommand(COMMAND.linux.load)
                : exec(COMMAND.linux.load));
            const { stdout: cpu } = await (isSSH
                ? exec.execCommand(COMMAND.linux.cpu)
                : exec(COMMAND.linux.cpu));
            const { stdout: mem } = await (isSSH
                ? exec.execCommand(COMMAND.linux.mem)
                : exec(COMMAND.linux.mem));
            const { stdout: disk } = await (isSSH
                ? exec.execCommand(COMMAND.linux.disk)
                : exec(COMMAND.linux.disk));
            const { stdout: temp } = await (isSSH
                ? exec.execCommand(COMMAND.linux.temp)
                : exec(COMMAND.linux.temp));

            const loadLines = load
                .replace(/\t|:|,|-/gi, '')
                .trim()
                .split('\n')
                .map(line => {
                    const words = line
                        .replace(/\s+/g, ' ')
                        .trim()
                        .split(' ');
                    return words;
                });
            const cpuLines = cpu
                .replace(/\t|:/gi, '')
                .trim()
                .split('\n')
                .map(line => line.replace(/\s+/g, ' ').trim());
            const memLines = mem
                .replace(/\t|:/gi, '')
                .trim()
                .split('\n')
                .map(line => {
                    const words = line
                        .replace(/\s+/g, ' ')
                        .trim()
                        .split(' ');
                    return words[words.length - 2];
                });
            const diskLines = disk
                .replace(/\t|:|M|G|%/gi, '')
                .trim()
                .split('\n')
                .map(line => {
                    const words = line
                        .replace(/\s+/g, ' ')
                        .trim()
                        .split(' ');
                    return {
                        storageUsed: words[2],
                        totalStorage: words[1],
                        storageUsage: words[4],
                    };
                })
                .reduce((disks, disk) => {
                    return {
                        storageUsed: disks.storageUsed + disk.storageUsed,
                        totalStorage: disks.totalStorage + disk.totalStorage,
                        storageUsage: disks.storageUsage + disk.storageUsage,
                    };
                });
            const tempLines = temp
                .replace(/\t|:|\+|°|C/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');

            cpuLoad = loadLines[3][1];
            avgCpuLoad = loadLines[2][10];
            cpuCores = cpuLines.length / 2;
            memoryUsed =
                (parseFloat(memLines[0]) - parseFloat(memLines[1])) * 1024;
            totalMemory = memLines[0] * 1024;
            swapUsed =
                (parseFloat(memLines[4]) - parseFloat(memLines[5])) * 1024;
            storageUsed = diskLines.storageUsed * 1024 * 1024 * 1024;
            totalStorage = diskLines.totalStorage * 1024 * 1024 * 1024;
            storageUsage = diskLines.storageUsage;
            mainTemp = tempLines[1];
            maxTemp = tempLines[1];
        } else if (os === 'Darwin') {
            const { stdout: load } = await (isSSH
                ? exec.execCommand(COMMAND.darwin.load)
                : exec(COMMAND.darwin.load));
            const { stdout: cpu } = await (isSSH
                ? exec.execCommand(COMMAND.darwin.cpu)
                : exec(COMMAND.darwin.cpu));
            const { stdout: usedMem } = await (isSSH
                ? exec.execCommand(COMMAND.darwin.mem.used)
                : exec(COMMAND.darwin.mem.used));
            const { stdout: totalMem } = await (isSSH
                ? exec.execCommand(COMMAND.darwin.mem.total)
                : exec(COMMAND.darwin.mem.total));
            const { stdout: swapMem } = await (isSSH
                ? exec.execCommand(COMMAND.darwin.mem.swap)
                : exec(COMMAND.darwin.mem.swap));
            const { stdout: disk } = await (isSSH
                ? exec.execCommand(COMMAND.darwin.disk)
                : exec(COMMAND.darwin.disk));
            const { stdout: temp } = await (isSSH
                ? exec.execCommand(COMMAND.darwin.temp)
                : exec(COMMAND.darwin.temp));

            const loadLines = load
                .replace(/\t|:|,|-|%/gi, '')
                .trim()
                .split('\n')
                .map(line => {
                    const words = line
                        .replace(/\s+/g, ' ')
                        .trim()
                        .split(' ');
                    return words;
                });
            const memLines = usedMem
                .replace(/\t|:|M|G|\(|\)/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const swapLines = swapMem
                .replace(/\t|:|M|G|\(|\)|=/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const diskLines = disk
                .replace(/\t|:|Mi|Gi|%/gi, '')
                .trim()
                .split('\n')
                .map(line => {
                    const words = line
                        .replace(/\s+/g, ' ')
                        .trim()
                        .split(' ');
                    return {
                        storageUsed: words[2],
                        totalStorage: words[1],
                        storageUsage: words[4],
                    };
                })
                .reduce((disks, disk) => {
                    return {
                        storageUsed: disks.storageUsed + disk.storageUsed,
                        totalStorage: disks.totalStorage + disk.totalStorage,
                        storageUsage: disks.storageUsage + disk.storageUsage,
                    };
                });

            cpuLoad = loadLines[1][2];
            avgCpuLoad = loadLines[0][3];
            cpuCores = cpu;
            memoryUsed =
                (parseFloat(memLines[1]) - parseFloat(memLines[3])) *
                1024 *
                1024;
            totalMemory = totalMem;
            swapUsed = swapLines[3] * 1024 * 1024;
            storageUsed = diskLines.storageUsed * 1024 * 1024 * 1024;
            totalStorage = diskLines.totalStorage * 1024 * 1024 * 1024;
            storageUsage = diskLines.storageUsage;
            mainTemp = temp;
            maxTemp = temp;
        } else if (os === 'Windows') {
            const { stdout: load } = await (isSSH
                ? exec.execCommand(COMMAND.win.load)
                : exec(COMMAND.win.load));
            const { stdout: cpu } = await (isSSH
                ? exec.execCommand(COMMAND.win.cpu)
                : exec(COMMAND.win.cpu));
            const { stdout: freeMem } = await (isSSH
                ? exec.execCommand(COMMAND.win.mem.free)
                : exec(COMMAND.win.mem.free));
            const { stdout: totalMem } = await (isSSH
                ? exec.execCommand(COMMAND.win.mem.total)
                : exec(COMMAND.win.mem.total));
            const { stdout: totalSwapMem } = await (isSSH
                ? exec.execCommand(COMMAND.win.mem.totalSwap)
                : exec(COMMAND.win.mem.totalSwap));
            const { stdout: freeSwapMem } = await (isSSH
                ? exec.execCommand(COMMAND.win.mem.freeSwap)
                : exec(COMMAND.win.mem.freeSwap));
            const { stdout: freeDisk } = await (isSSH
                ? exec.execCommand(COMMAND.win.disk.free)
                : exec(COMMAND.win.disk.free));
            const { stdout: totalDisk } = await (isSSH
                ? exec.execCommand(COMMAND.win.disk.total)
                : exec(COMMAND.win.disk.total));
            const { stdout: temp } = await (isSSH
                ? exec.execCommand(COMMAND.win.temp)
                : exec(COMMAND.win.temp));

            const loadLines = load
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const cpuLines = cpu
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const freeMemLines = freeMem
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const totalMemLines = totalMem
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const totalSwapMemLines = totalSwapMem
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const freeSwapMemLines = freeSwapMem
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const freeDiskLines = freeDisk
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const totalDiskLines = totalDisk
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');
            const tempLines = temp
                .replace(/\s+/g, ' ')
                .trim()
                .split(' ');

            cpuLoad = loadLines[1];
            avgCpuLoad = loadLines[1];
            cpuCores = cpuLines[1];
            memoryUsed =
                parseFloat(totalMemLines[1]) -
                parseFloat(freeMemLines[1]) * 1024;
            totalMemory = totalMemLines[1];
            swapUsed =
                parseFloat(totalSwapMemLines[1]) -
                parseFloat(freeSwapMemLines[1]);
            storageUsed =
                parseFloat(totalDiskLines[1]) - parseFloat(freeDiskLines[1]);
            totalStorage = totalDiskLines[1];
            storageUsage = (storageUsed / parseFloat(totalDiskLines[1])) * 100;
            mainTemp = tempLines[1];
            maxTemp = tempLines[1];
        }

        return {
            cpuLoad,
            avgCpuLoad,
            cpuCores,
            memoryUsed,
            totalMemory,
            swapUsed,
            storageUsed,
            totalStorage,
            storageUsage,
            mainTemp,
            maxTemp,
        };
    } catch (error) {
        logger.error(error);
        throw error;
    }
};

module.exports = {
    get,
    post,
    defaultErrorHandler,
    execCommands,
};

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

/** The platform commands for server information. */
const COMMAND = {
    linux: {
        load: "top -b -n 2 | egrep --color 'load average|%Cpu'",
        cpu: "egrep --color 'processor|cores' /proc/cpuinfo",
        mem: "egrep --color 'Mem|Swap' /proc/meminfo",
        disk: "df -h | egrep --color '/dev/xvda1|/dev/sda7'",
        temp: "sensors | egrep --color 'CPU'",
    },
    darwin: {
        load: "top -l 1 | egrep --color 'Load Avg|CPU usage'",
        cpu: 'sysctl -n machdep.cpu.core_count',
        mem: {
            used: "top -l 1 | egrep --color 'PhysMem'",
            total: 'sysctl -n hw.memsize',
            swap: 'sysctl -n vm.swapusage',
        },
        disk: "df -h | egrep --color '/dev/disk1s2'",
        temp: 'sysctl -n machdep.xcpm.cpu_thermal_level',
    },
    win: {
        load: 'wmic cpu get loadpercentage',
        cpu: 'wmic cpu get numberofcores',
        mem: {
            free: 'wmic os get freephysicalmemory',
            total: 'wmic computersystem get totalphysicalmemory',
            totalSwap: 'wmic os get totalvirtualmemorySize',
            freeSwap: 'wmic os get freevirtualmemory',
        },
        disk: {
            total: 'wmic logicaldisk get size',
            free: 'wmic logicaldisk get freespace',
        },
        temp: 'wmic computersystem get thermalstate',
    },
};

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

module.exports = {
    API_URL,
    COMMAND,
    onlineTestData,
    degradedTestData,
    offlineTestData,
};

module.exports = {
    create: async function (data) {
        try {
            let Log = new MonitorLogModel();

            Log.monitorId = data.monitorId;
            Log.probeId = data.probeId;
            Log.status = data.status;
            Log.responseTime = data.responseTime;
            Log.responseStatus = data.responseStatus;

            if (data.data) {
                Log.cpuLoad = data.data.load.currentload;
                Log.avgCpuLoad = data.data.load.avgload;
                Log.cpuCores = data.data.load.cpus.length;
                Log.memoryUsed = data.data.memory.used;
                Log.totalMemory = data.data.memory.total;
                Log.swapUsed = data.data.memory.swapused;
                Log.storageUsed = data.data.disk.used;
                Log.totalStorage = data.data.disk.size;
                Log.storageUsage = data.data.disk.use;
                Log.mainTemp = data.data.temperature.main;
                Log.maxTemp = data.data.temperature.max;
            }

            var savedLog = await Log.save();

            var now = new Date();

            var intervalHourDate = moment(now).format('MMM Do YYYY, h A');
            var intervalDayDate = moment(now).format('MMM Do YYYY');
            var intervalWeekDate = moment(now).format('wo [week of] YYYY');

            var logByHour = await MonitorLogByHourService.findOneBy({
                probeId: data.probeId,
                monitorId: data.monitorId,
                intervalDate: intervalHourDate
            });
            var logByDay = await MonitorLogByDayService.findOneBy({
                probeId: data.probeId,
                monitorId: data.monitorId,
                intervalDate: intervalDayDate
            });
            var logByWeek = await MonitorLogByWeekService.findOneBy({
                probeId: data.probeId,
                monitorId: data.monitorId,
                intervalDate: intervalWeekDate
            });

            if (logByHour) {
                let hourData = {
                    status: data.status,
                    responseTime: data.responseTime,
                    responseStatus: data.responseStatus,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByHour.maxResponseTime ? data.responseTime : logByHour.maxResponseTime,
                };
                if (data.data) {
                    hourData.cpuLoad = data.data.load.currentload;
                    hourData.avgCpuLoad = data.data.load.avgload;
                    hourData.cpuCores = data.data.load.cpus.length;
                    hourData.memoryUsed = data.data.memory.used;
                    hourData.totalMemory = data.data.memory.total;
                    hourData.swapUsed = data.data.memory.swapused;
                    hourData.storageUsed = data.data.disk.used;
                    hourData.totalStorage = data.data.disk.size;
                    hourData.storageUsage = data.data.disk.use;
                    hourData.mainTemp = data.data.temperature.main;
                    hourData.maxTemp = data.data.temperature.max;
                    hourData.maxCpuLoad = data.data.load.currentload > logByHour.maxCpuLoad ? data.data.load.currentload : logByHour.maxCpuLoad;
                    hourData.maxMemoryUsed = data.data.memory.used > logByHour.maxMemoryUsed ? data.data.memory.used : logByHour.maxMemoryUsed;
                    hourData.maxStorageUsed = data.data.disk.used > logByHour.maxStorageUsed ? data.data.disk.used : logByHour.maxStorageUsed;
                    hourData.maxMainTemp = data.data.temperature.main > logByHour.maxMainTemp ? data.data.temperature.main : logByHour.maxMainTemp;
                }

                await MonitorLogByHourService.updateOneBy({ _id: logByHour._id }, hourData);
            } else {
                MonitorLogByHourService.create({ ...data, intervalDate: intervalHourDate });
            }
            if (logByDay) {
                let dayData = {
                    status: data.status,
                    responseTime: data.responseTime,
                    responseStatus: data.responseStatus,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByDay.maxResponseTime ? data.responseTime : logByDay.maxResponseTime,
                };
                if (data.data) {
                    dayData.cpuLoad = data.data.load.currentload;
                    dayData.avgCpuLoad = data.data.load.avgload;
                    dayData.cpuCores = data.data.load.cpus.length;
                    dayData.memoryUsed = data.data.memory.used;
                    dayData.totalMemory = data.data.memory.total;
                    dayData.swapUsed = data.data.memory.swapused;
                    dayData.storageUsed = data.data.disk.used;
                    dayData.totalStorage = data.data.disk.size;
                    dayData.storageUsage = data.data.disk.use;
                    dayData.mainTemp = data.data.temperature.main;
                    dayData.maxTemp = data.data.temperature.max;
                    dayData.maxCpuLoad = data.data.load.currentload > logByDay.maxCpuLoad ? data.data.load.currentload : logByDay.maxCpuLoad;
                    dayData.maxMemoryUsed = data.data.memory.used > logByDay.maxMemoryUsed ? data.data.memory.used : logByDay.maxMemoryUsed;
                    dayData.maxStorageUsed = data.data.disk.used > logByDay.maxStorageUsed ? data.data.disk.used : logByDay.maxStorageUsed;
                    dayData.maxMainTemp = data.data.temperature.main > logByDay.maxMainTemp ? data.data.temperature.main : logByDay.maxMainTemp;
                }

                await MonitorLogByDayService.updateOneBy({ _id: logByDay._id }, dayData);
            } else {
                MonitorLogByDayService.create({ ...data, intervalDate: intervalDayDate });
            }
            if (logByWeek) {
                let weekData = {
                    status: data.status,
                    responseTime: data.responseTime,
                    responseStatus: data.responseStatus,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByWeek.maxResponseTime ? data.responseTime : logByWeek.maxResponseTime,
                };
                if (data.data) {
                    weekData.cpuLoad = data.data.load.currentload;
                    weekData.avgCpuLoad = data.data.load.avgload;
                    weekData.cpuCores = data.data.load.cpus.length;
                    weekData.memoryUsed = data.data.memory.used;
                    weekData.totalMemory = data.data.memory.total;
                    weekData.swapUsed = data.data.memory.swapused;
                    weekData.storageUsed = data.data.disk.used;
                    weekData.totalStorage = data.data.disk.size;
                    weekData.storageUsage = data.data.disk.use;
                    weekData.mainTemp = data.data.temperature.main;
                    weekData.maxTemp = data.data.temperature.max;
                    weekData.maxCpuLoad = data.data.load.currentload > logByWeek.maxCpuLoad ? data.data.load.currentload : logByWeek.maxCpuLoad;
                    weekData.maxMemoryUsed = data.data.memory.used > logByWeek.maxMemoryUsed ? data.data.memory.used : logByWeek.maxMemoryUsed;
                    weekData.maxStorageUsed = data.data.disk.used > logByWeek.maxStorageUsed ? data.data.disk.used : logByWeek.maxStorageUsed;
                    weekData.maxMainTemp = data.data.temperature.main > logByWeek.maxMainTemp ? data.data.temperature.main : logByWeek.maxMainTemp;
                }

                await MonitorLogByWeekService.updateOneBy({ _id: logByWeek._id }, weekData);
            } else {
                MonitorLogByWeekService.create({ ...data, intervalDate: intervalWeekDate });
            }

            await MonitorService.sendResponseTime(savedLog);
            await MonitorService.sendMonitorLog(savedLog);

            if (data.probeId && data.monitorId) await probeService.sendProbe(data.probeId, data.monitorId);

            return savedLog;
        } catch (error) {
            ErrorService.log('monitorLogService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLog = await MonitorLogModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                });

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogService.updateOneBy', error);
            throw error;
        }
    },

    async findBy(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof (skip) === 'string') {
                skip = parseInt(skip);
            }

            if (typeof (limit) === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            var monitorLogs = await MonitorLogModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('probeId');

            return monitorLogs;
        } catch (error) {
            ErrorService.log('monitorLogService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLog = await MonitorLogModel.findOne(query)
                .populate('probeId');

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogService.findOneBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var count = await MonitorLogModel.count(query);

            return count;
        } catch (error) {
            ErrorService.log('monitorLogService.countBy', error);
            throw error;
        }
    }
};

var MonitorLogModel = require('../models/monitorLog');
var MonitorLogByHourService = require('../services/monitorLogByHourService');
var MonitorLogByDayService = require('../services/monitorLogByDayService');
var MonitorLogByWeekService = require('../services/monitorLogByWeekService');
var MonitorService = require('../services/monitorService');
var probeService = require('../services/probeService');
var ErrorService = require('../services/errorService');
var moment = require('moment');
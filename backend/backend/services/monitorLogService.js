module.exports = {
    create: async function (data) {
        try {
            let Log = new MonitorLogModel();

            Log.monitorId = data.monitorId;
            Log.probeId = data.probeId;
            Log.status = data.status;
            Log.responseTime = data.responseTime;
            Log.responseStatus = data.responseStatus;
            Log.cpuLoad = data.cpuLoad;
            Log.avgCpuLoad = data.avgCpuLoad;
            Log.cpuCores = data.cpuCores;
            Log.memoryUsed = data.memoryUsed;
            Log.totalMemory = data.totalMemory;
            Log.swapUsed = data.swapUsed;
            Log.storageUsed = data.storageUsed;
            Log.totalStorage = data.totalStorage;
            Log.storageUsage = data.storageUsage;
            Log.mainTemp = data.mainTemp;
            Log.maxTemp = data.maxTemp;

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
                await MonitorLogByHourService.updateOneBy({ _id: logByHour._id }, {
                    ...data,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByHour.maxResponseTime ? data.responseTime : logByHour.maxResponseTime,
                    maxCpuLoad: data.cpuLoad > logByHour.maxCpuLoad ? data.cpuLoad : logByHour.maxCpuLoad,
                    maxMemoryUsed: data.memoryUsed > logByHour.maxMemoryUsed ? data.memoryUsed : logByHour.maxMemoryUsed,
                    maxStorageUsed: data.storageUsed > logByHour.maxStorageUsed ? data.storageUsed : logByHour.maxStorageUsed,
                    maxMainTemp: data.mainTemp > logByHour.maxMainTemp ? data.mainTemp : logByHour.maxMainTemp
                });
            } else {
                MonitorLogByHourService.create({ ...data, intervalDate: intervalHourDate });
            }
            if (logByDay) {
                await MonitorLogByDayService.updateOneBy({ _id: logByDay._id }, {
                    ...data,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByDay.maxResponseTime ? data.responseTime : logByDay.maxResponseTime,
                    maxCpuLoad: data.cpuLoad > logByDay.maxCpuLoad ? data.cpuLoad : logByDay.maxCpuLoad,
                    maxMemoryUsed: data.memoryUsed > logByDay.maxMemoryUsed ? data.memoryUsed : logByDay.maxMemoryUsed,
                    maxStorageUsed: data.storageUsed > logByDay.maxStorageUsed ? data.storageUsed : logByDay.maxStorageUsed,
                    maxMainTemp: data.mainTemp > logByDay.maxMainTemp ? data.mainTemp : logByDay.maxMainTemp
                });
            } else {
                MonitorLogByDayService.create({ ...data, intervalDate: intervalDayDate });
            }
            if (logByWeek) {
                await MonitorLogByWeekService.updateOneBy({ _id: logByWeek._id }, {
                    ...data,
                    createdAt: Date.now(),
                    maxResponseTime: data.responseTime > logByWeek.maxResponseTime ? data.responseTime : logByWeek.maxResponseTime,
                    maxCpuLoad: data.cpuLoad > logByWeek.maxCpuLoad ? data.cpuLoad : logByWeek.maxCpuLoad,
                    maxMemoryUsed: data.memoryUsed > logByWeek.maxMemoryUsed ? data.memoryUsed : logByWeek.maxMemoryUsed,
                    maxStorageUsed: data.storageUsed > logByWeek.maxStorageUsed ? data.storageUsed : logByWeek.maxStorageUsed,
                    maxMainTemp: data.mainTemp > logByWeek.maxMainTemp ? data.mainTemp : logByWeek.maxMainTemp
                });
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
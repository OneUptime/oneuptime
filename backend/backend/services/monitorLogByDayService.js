module.exports = {
    create: async function (data) {
        try {
            var LogDay = new MonitorLogByDayModel();

            LogDay.monitorId = data.monitorId;
            LogDay.probeId = data.probeId;
            LogDay.status = data.status;
            LogDay.responseTime = data.responseTime;
            LogDay.responseStatus = data.responseStatus;
            LogDay.cpuLoad = data.cpuLoad;
            LogDay.avgCpuLoad = data.avgCpuLoad;
            LogDay.cpuCores = data.cpuCores;
            LogDay.memoryUsed = data.memoryUsed;
            LogDay.totalMemory = data.totalMemory;
            LogDay.swapUsed = data.swapUsed;
            LogDay.storageUsed = data.storageUsed;
            LogDay.totalStorage = data.totalStorage;
            LogDay.storageUsage = data.storageUsage;
            LogDay.mainTemp = data.mainTemp;
            LogDay.maxTemp = data.maxTemp;
            LogDay.maxResponseTime = data.responseTime;
            LogDay.maxCpuLoad = data.cpuLoad;
            LogDay.maxMemoryUsed = data.memoryUsed;
            LogDay.maxStorageUsed = data.storageUsed;
            LogDay.maxMainTemp = data.mainTemp;
            LogDay.intervalDate = data.intervalDate;

            var savedLogDay = await LogDay.save();

            return savedLogDay;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLogByDay = await MonitorLogByDayModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                });

            return monitorLogByDay;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.updateOneBy', error);
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

            var monitorLogsByDay = await MonitorLogByDayModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            return monitorLogsByDay;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLog = await MonitorLogByDayModel.findOne(query);

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.findOneBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var count = await MonitorLogByDayModel.count(query);

            return count;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.countBy', error);
            throw error;
        }
    }
};

var MonitorLogByDayModel = require('../models/monitorLogByDay');
var ErrorService = require('../services/errorService');
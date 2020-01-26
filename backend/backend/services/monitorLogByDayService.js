module.exports = {
    create: async function (data) {
        try {
            var LogDay = new MonitorLogByDayModel();

            LogDay.monitorId = data.monitorId;
            LogDay.probeId = data.probeId;
            LogDay.status = data.status;
            LogDay.responseTime = data.responseTime;
            LogDay.responseStatus = data.responseStatus;

            if (data.data) {
                LogDay.cpuLoad = data.data.load.currentload;
                LogDay.avgCpuLoad = data.data.load.avgload;
                LogDay.cpuCores = data.data.load.cpus.length;
                LogDay.memoryUsed = data.data.memory.used;
                LogDay.totalMemory = data.data.memory.total;
                LogDay.swapUsed = data.data.memory.swapused;
                LogDay.storageUsed = data.data.disk.used;
                LogDay.totalStorage = data.data.disk.size;
                LogDay.storageUsage = data.data.disk.use;
                LogDay.mainTemp = data.data.temperature.main;
                LogDay.maxTemp = data.data.temperature.max;
                LogDay.maxCpuLoad = data.data.load.currentload;
                LogDay.maxMemoryUsed = data.data.memory.used;
                LogDay.maxStorageUsed = data.data.disk.used;
                LogDay.maxMainTemp = data.data.temperature.main;
            }

            LogDay.maxResponseTime = data.responseTime;
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
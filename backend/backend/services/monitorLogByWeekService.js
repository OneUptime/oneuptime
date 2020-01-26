module.exports = {
    create: async function (data) {
        try {
            var LogWeek = new MonitorLogByWeekModel();

            LogWeek.monitorId = data.monitorId;
            LogWeek.probeId = data.probeId;
            LogWeek.status = data.status;
            LogWeek.responseTime = data.responseTime;
            LogWeek.responseStatus = data.responseStatus;

            if (data.data) {
                LogWeek.cpuLoad = data.data.load.currentload;
                LogWeek.avgCpuLoad = data.data.load.avgload;
                LogWeek.cpuCores = data.data.load.cpus.length;
                LogWeek.memoryUsed = data.data.memory.used;
                LogWeek.totalMemory = data.data.memory.total;
                LogWeek.swapUsed = data.data.memory.swapused;
                LogWeek.storageUsed = data.data.disk.used;
                LogWeek.totalStorage = data.data.disk.size;
                LogWeek.storageUsage = data.data.disk.use;
                LogWeek.mainTemp = data.data.temperature.main;
                LogWeek.maxTemp = data.data.temperature.max;
                LogWeek.maxCpuLoad = data.data.load.currentload;
                LogWeek.maxMemoryUsed = data.data.memory.used;
                LogWeek.maxStorageUsed = data.data.disk.used;
                LogWeek.maxMainTemp = data.data.temperature.main;
            }

            LogWeek.maxResponseTime = data.responseTime;
            LogWeek.intervalDate = data.intervalDate;

            var savedLogWeek = await LogWeek.save();

            return savedLogWeek;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLogByWeek = await MonitorLogByWeekModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                });

            return monitorLogByWeek;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.updateOneBy', error);
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

            var monitorLogsByWeek = await MonitorLogByWeekModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            return monitorLogsByWeek;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLog = await MonitorLogByWeekModel.findOne(query);

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.findOneBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var count = await MonitorLogByWeekModel.count(query);

            return count;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.countBy', error);
            throw error;
        }
    }
};

var MonitorLogByWeekModel = require('../models/monitorLogByWeek');
var ErrorService = require('../services/errorService');
module.exports = {
    create: async function (data) {
        try {
            var LogHour = new MonitorLogByHourModel();

            LogHour.monitorId = data.monitorId;
            LogHour.probeId = data.probeId;
            LogHour.status = data.status;
            LogHour.responseTime = data.responseTime;
            LogHour.responseStatus = data.responseStatus;

            if (data.data) {
                LogHour.cpuLoad = data.data.load.currentload;
                LogHour.avgCpuLoad = data.data.load.avgload;
                LogHour.cpuCores = data.data.load.cpus.length;
                LogHour.memoryUsed = data.data.memory.used;
                LogHour.totalMemory = data.data.memory.total;
                LogHour.swapUsed = data.data.memory.swapused;
                LogHour.storageUsed = data.data.disk.used;
                LogHour.totalStorage = data.data.disk.size;
                LogHour.storageUsage = data.data.disk.use;
                LogHour.mainTemp = data.data.temperature.main;
                LogHour.maxTemp = data.data.temperature.max;
                LogHour.maxCpuLoad = data.data.load.currentload;
                LogHour.maxMemoryUsed = data.data.memory.used;
                LogHour.maxStorageUsed = data.data.disk.used;
                LogHour.maxMainTemp = data.data.temperature.main;
            }

            LogHour.maxResponseTime = data.responseTime;
            LogHour.intervalDate = data.intervalDate;

            var savedLogHour = await LogHour.save();

            return savedLogHour;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.create', error);
            throw error;
        }
    },

    updateOneBy: async function (query, data) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLogByHour = await MonitorLogByHourModel.findOneAndUpdate(query,
                { $set: data },
                {
                    new: true
                });

            return monitorLogByHour;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.updateOneBy', error);
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

            var monitorLogsByHour = await MonitorLogByHourModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);

            return monitorLogsByHour;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var monitorLog = await MonitorLogByHourModel.findOne(query);

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.findOneBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            var count = await MonitorLogByHourModel.count(query);

            return count;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.countBy', error);
            throw error;
        }
    }
};

var MonitorLogByHourModel = require('../models/monitorLogByHour');
var ErrorService = require('../services/errorService');
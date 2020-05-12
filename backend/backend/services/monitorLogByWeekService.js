module.exports = {
    create: async function(data) {
        try {
            const LogWeek = new MonitorLogByWeekModel();

            LogWeek.monitorId = data.monitorId;
            LogWeek.probeId = data.probeId;
            LogWeek.status = data.status;
            LogWeek.responseTime = data.responseTime;
            LogWeek.responseStatus = data.responseStatus;
            LogWeek.cpuLoad = data.cpuLoad;
            LogWeek.avgCpuLoad = data.avgCpuLoad;
            LogWeek.cpuCores = data.cpuCores;
            LogWeek.memoryUsed = data.memoryUsed;
            LogWeek.totalMemory = data.totalMemory;
            LogWeek.swapUsed = data.swapUsed;
            LogWeek.storageUsed = data.storageUsed;
            LogWeek.totalStorage = data.totalStorage;
            LogWeek.storageUsage = data.storageUsage;
            LogWeek.mainTemp = data.mainTemp;
            LogWeek.maxTemp = data.maxTemp;
            LogWeek.maxResponseTime = data.responseTime;
            LogWeek.maxCpuLoad = data.cpuLoad;
            LogWeek.maxMemoryUsed = data.memoryUsed;
            LogWeek.maxStorageUsed = data.storageUsed;
            LogWeek.maxMainTemp = data.mainTemp;
            LogWeek.intervalDate = data.intervalDate;
            LogWeek.sslCertificate = data.sslCertificate;

            const savedLogWeek = await LogWeek.save();

            return savedLogWeek;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            const monitorLogByWeek = await MonitorLogByWeekModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

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

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            const monitorLogsByWeek = await MonitorLogByWeekModel.find(query)
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

            const monitorLog = await MonitorLogByWeekModel.findOne(query);

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

            const count = await MonitorLogByWeekModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.countBy', error);
            throw error;
        }
    },
};

const MonitorLogByWeekModel = require('../models/monitorLogByWeek');
const ErrorService = require('../services/errorService');

module.exports = {
    create: async function(data) {
        try {
            const LogDay = new MonitorLogByDayModel();

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
            LogDay.sslCertificate = data.sslCertificate;

            const savedLogDay = await LogDay.save();

            return savedLogDay;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            const monitorLogByDay = await MonitorLogByDayModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            return monitorLogByDay;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.updateOneBy', error);
            throw error;
        }
    },

    async findBy(query, limit, skip, filter) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (!filter) filter = {};

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            const monitorLogsByDay = await MonitorLogByDayModel.find(
                query,
                filter
            )
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

            const monitorLog = await MonitorLogByDayModel.findOne(query);

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

            const count = await MonitorLogByDayModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.countBy', error);
            throw error;
        }
    },
};

const MonitorLogByDayModel = require('../models/monitorLogByDay');
const ErrorService = require('../services/errorService');

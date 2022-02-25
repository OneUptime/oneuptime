export default {
    create: async function(data) {
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
        LogWeek.kubernetesLog = data.kubernetesData || {};

        const savedLogWeek = await LogWeek.save();

        return savedLogWeek;
    },

    updateOneBy: async function(query, data) {
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
    },

    async findBy({ query, limit, skip, select, populate }) {
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

        let monitorLogsByWeekQuery = MonitorLogByWeekModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        monitorLogsByWeekQuery = handleSelect(select, monitorLogsByWeekQuery);
        monitorLogsByWeekQuery = handlePopulate(
            populate,
            monitorLogsByWeekQuery
        );

        const monitorLogsByWeek = await monitorLogsByWeekQuery;

        return monitorLogsByWeek;
    },

    async findOneBy({ query, select, populate }) {
        if (!query) {
            query = {};
        }

        let monitorLogQuery = MonitorLogByWeekModel.findOne(query).lean();

        monitorLogQuery = handleSelect(select, monitorLogQuery);
        monitorLogQuery = handlePopulate(populate, monitorLogQuery);

        const monitorLog = await monitorLogQuery;
        return monitorLog;
    },

    async countBy(query) {
        if (!query) {
            query = {};
        }

        const count = await MonitorLogByWeekModel.countDocuments(query);

        return count;
    },
};

import MonitorLogByWeekModel from '../models/monitorLogByWeek'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

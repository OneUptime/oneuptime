export default {
    create: async function (data: $TSFixMe) {
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

        LogDay.kubernetesLog = data.kubernetesData || {};

        const savedLogDay = await LogDay.save();

        return savedLogDay;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe) {
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
    },

    async findBy({ query, limit, skip, filter, select, populate }: $TSFixMe) {
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

        const monitorLogsByDayQuery = MonitorLogByDayModel.find(query, filter)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        monitorLogsByDayQuery.select(select);
        monitorLogsByDayQuery.populate(populate);

        const monitorLogsByDay = await monitorLogsByDayQuery;
        return monitorLogsByDay;
    },

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        const monitorLogQuery = MonitorLogByDayModel.findOne(query)
            .sort(sort)
            .lean();

        monitorLogQuery.select(select);
        monitorLogQuery.populate(populate);

        const monitorLog = await monitorLogQuery;

        return monitorLog;
    },

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        const count = await MonitorLogByDayModel.countDocuments(query);

        return count;
    },
};

import MonitorLogByDayModel from '../models/monitorLogByDay';

import FindOneBy from '../types/db/FindOneBy';
import Query from '../types/db/Query';

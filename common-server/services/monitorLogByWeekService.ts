export default class Service {
    async create(data: $TSFixMe) {
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
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
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
    }

    async findBy({ query, limit, skip, select, populate, sort }: FindBy) {
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

        const monitorLogsByWeekQuery = MonitorLogByWeekModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        monitorLogsByWeekQuery.select(select);
        monitorLogsByWeekQuery.populate(populate);

        const monitorLogsByWeek = await monitorLogsByWeekQuery;

        return monitorLogsByWeek;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }

        const monitorLogQuery = MonitorLogByWeekModel.findOne(query)
            .sort(sort)
            .lean();

        monitorLogQuery.select(select);
        monitorLogQuery.populate(populate);

        const monitorLog = await monitorLogQuery;
        return monitorLog;
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        const count = await MonitorLogByWeekModel.countDocuments(query);

        return count;
    }
}

import MonitorLogByWeekModel from '../models/monitorLogByWeek';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';

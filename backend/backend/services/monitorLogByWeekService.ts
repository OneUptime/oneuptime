export default {
    create: async function(data: $TSFixMe) {
        const LogWeek = new MonitorLogByWeekModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        LogWeek.monitorId = data.monitorId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type 'Documen... Remove this comment to see the full error message
        LogWeek.probeId = data.probeId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Document... Remove this comment to see the full error message
        LogWeek.status = data.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type 'Do... Remove this comment to see the full error message
        LogWeek.responseTime = data.responseTime;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
        LogWeek.responseStatus = data.responseStatus;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type 'Documen... Remove this comment to see the full error message
        LogWeek.cpuLoad = data.cpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type 'Docu... Remove this comment to see the full error message
        LogWeek.avgCpuLoad = data.avgCpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type 'Docume... Remove this comment to see the full error message
        LogWeek.cpuCores = data.cpuCores;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type 'Docu... Remove this comment to see the full error message
        LogWeek.memoryUsed = data.memoryUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type 'Doc... Remove this comment to see the full error message
        LogWeek.totalMemory = data.totalMemory;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type 'Docume... Remove this comment to see the full error message
        LogWeek.swapUsed = data.swapUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type 'Doc... Remove this comment to see the full error message
        LogWeek.storageUsed = data.storageUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type 'Do... Remove this comment to see the full error message
        LogWeek.totalStorage = data.totalStorage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type 'Do... Remove this comment to see the full error message
        LogWeek.storageUsage = data.storageUsage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type 'Docume... Remove this comment to see the full error message
        LogWeek.mainTemp = data.mainTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type 'Documen... Remove this comment to see the full error message
        LogWeek.maxTemp = data.maxTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxResponseTime' does not exist on type ... Remove this comment to see the full error message
        LogWeek.maxResponseTime = data.responseTime;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxCpuLoad' does not exist on type 'Docu... Remove this comment to see the full error message
        LogWeek.maxCpuLoad = data.cpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMemoryUsed' does not exist on type 'D... Remove this comment to see the full error message
        LogWeek.maxMemoryUsed = data.memoryUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxStorageUsed' does not exist on type '... Remove this comment to see the full error message
        LogWeek.maxStorageUsed = data.storageUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMainTemp' does not exist on type 'Doc... Remove this comment to see the full error message
        LogWeek.maxMainTemp = data.mainTemp;
        // @ts-expect-error ts-migrate(2551) FIXME: Property 'intervalDate' does not exist on type 'Do... Remove this comment to see the full error message
        LogWeek.intervalDate = data.intervalDate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
        LogWeek.sslCertificate = data.sslCertificate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type 'D... Remove this comment to see the full error message
        LogWeek.kubernetesLog = data.kubernetesData || {};

        const savedLogWeek = await LogWeek.save();

        return savedLogWeek;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
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

    async findBy({
        query,
        limit,
        skip,
        select,
        populate
    }: $TSFixMe) {
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

    async findOneBy({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let monitorLogQuery = MonitorLogByWeekModel.findOne(query).lean();

        monitorLogQuery = handleSelect(select, monitorLogQuery);
        monitorLogQuery = handlePopulate(populate, monitorLogQuery);

        const monitorLog = await monitorLogQuery;
        return monitorLog;
    },

    async countBy(query: $TSFixMe) {
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

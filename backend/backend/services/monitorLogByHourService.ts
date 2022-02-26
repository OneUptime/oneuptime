export default {
    create: async function(data: $TSFixMe) {
        const LogHour = new MonitorLogByHourModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        LogHour.monitorId = data.monitorId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type 'Documen... Remove this comment to see the full error message
        LogHour.probeId = data.probeId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Document... Remove this comment to see the full error message
        LogHour.status = data.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type 'Do... Remove this comment to see the full error message
        LogHour.responseTime = data.responseTime;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
        LogHour.responseStatus = data.responseStatus;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type 'Documen... Remove this comment to see the full error message
        LogHour.cpuLoad = data.cpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type 'Docu... Remove this comment to see the full error message
        LogHour.avgCpuLoad = data.avgCpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type 'Docume... Remove this comment to see the full error message
        LogHour.cpuCores = data.cpuCores;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type 'Docu... Remove this comment to see the full error message
        LogHour.memoryUsed = data.memoryUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type 'Doc... Remove this comment to see the full error message
        LogHour.totalMemory = data.totalMemory;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type 'Docume... Remove this comment to see the full error message
        LogHour.swapUsed = data.swapUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type 'Doc... Remove this comment to see the full error message
        LogHour.storageUsed = data.storageUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type 'Do... Remove this comment to see the full error message
        LogHour.totalStorage = data.totalStorage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type 'Do... Remove this comment to see the full error message
        LogHour.storageUsage = data.storageUsage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type 'Docume... Remove this comment to see the full error message
        LogHour.mainTemp = data.mainTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type 'Documen... Remove this comment to see the full error message
        LogHour.maxTemp = data.maxTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxResponseTime' does not exist on type ... Remove this comment to see the full error message
        LogHour.maxResponseTime = data.responseTime;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxCpuLoad' does not exist on type 'Docu... Remove this comment to see the full error message
        LogHour.maxCpuLoad = data.cpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMemoryUsed' does not exist on type 'D... Remove this comment to see the full error message
        LogHour.maxMemoryUsed = data.memoryUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxStorageUsed' does not exist on type '... Remove this comment to see the full error message
        LogHour.maxStorageUsed = data.storageUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMainTemp' does not exist on type 'Doc... Remove this comment to see the full error message
        LogHour.maxMainTemp = data.mainTemp;
        // @ts-expect-error ts-migrate(2551) FIXME: Property 'intervalDate' does not exist on type 'Do... Remove this comment to see the full error message
        LogHour.intervalDate = data.intervalDate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
        LogHour.sslCertificate = data.sslCertificate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type 'D... Remove this comment to see the full error message
        LogHour.kubernetesLog = data.kubernetesData || {};

        const savedLogHour = await LogHour.save();

        return savedLogHour;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const monitorLogByHour = await MonitorLogByHourModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        return monitorLogByHour;
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

        let monitorLogsByHourQuery = MonitorLogByHourModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        monitorLogsByHourQuery = handleSelect(select, monitorLogsByHourQuery);
        monitorLogsByHourQuery = handlePopulate(
            populate,
            monitorLogsByHourQuery
        );

        const monitorLogsByHour = await monitorLogsByHourQuery;

        return monitorLogsByHour;
    },

    async findOneBy({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let monitorLogQuery = MonitorLogByHourModel.findOne(query).lean();

        monitorLogQuery = handleSelect(select, monitorLogQuery);
        monitorLogQuery = handlePopulate(populate, monitorLogQuery);

        const monitorLog = await monitorLogQuery;
        return monitorLog;
    },

    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const count = await MonitorLogByHourModel.countDocuments(query);

        return count;
    },
};

import MonitorLogByHourModel from '../models/monitorLogByHour'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

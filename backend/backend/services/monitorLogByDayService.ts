export default {
    create: async function(data: $TSFixMe) {
        const LogDay = new MonitorLogByDayModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        LogDay.monitorId = data.monitorId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type 'Documen... Remove this comment to see the full error message
        LogDay.probeId = data.probeId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Document... Remove this comment to see the full error message
        LogDay.status = data.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type 'Do... Remove this comment to see the full error message
        LogDay.responseTime = data.responseTime;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
        LogDay.responseStatus = data.responseStatus;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type 'Documen... Remove this comment to see the full error message
        LogDay.cpuLoad = data.cpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type 'Docu... Remove this comment to see the full error message
        LogDay.avgCpuLoad = data.avgCpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type 'Docume... Remove this comment to see the full error message
        LogDay.cpuCores = data.cpuCores;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type 'Docu... Remove this comment to see the full error message
        LogDay.memoryUsed = data.memoryUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type 'Doc... Remove this comment to see the full error message
        LogDay.totalMemory = data.totalMemory;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type 'Docume... Remove this comment to see the full error message
        LogDay.swapUsed = data.swapUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type 'Doc... Remove this comment to see the full error message
        LogDay.storageUsed = data.storageUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type 'Do... Remove this comment to see the full error message
        LogDay.totalStorage = data.totalStorage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type 'Do... Remove this comment to see the full error message
        LogDay.storageUsage = data.storageUsage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type 'Docume... Remove this comment to see the full error message
        LogDay.mainTemp = data.mainTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type 'Documen... Remove this comment to see the full error message
        LogDay.maxTemp = data.maxTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxResponseTime' does not exist on type ... Remove this comment to see the full error message
        LogDay.maxResponseTime = data.responseTime;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxCpuLoad' does not exist on type 'Docu... Remove this comment to see the full error message
        LogDay.maxCpuLoad = data.cpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMemoryUsed' does not exist on type 'D... Remove this comment to see the full error message
        LogDay.maxMemoryUsed = data.memoryUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxStorageUsed' does not exist on type '... Remove this comment to see the full error message
        LogDay.maxStorageUsed = data.storageUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMainTemp' does not exist on type 'Doc... Remove this comment to see the full error message
        LogDay.maxMainTemp = data.mainTemp;
        // @ts-expect-error ts-migrate(2551) FIXME: Property 'intervalDate' does not exist on type 'Do... Remove this comment to see the full error message
        LogDay.intervalDate = data.intervalDate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
        LogDay.sslCertificate = data.sslCertificate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type 'D... Remove this comment to see the full error message
        LogDay.kubernetesLog = data.kubernetesData || {};

        const savedLogDay = await LogDay.save();

        return savedLogDay;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
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

        let monitorLogsByDayQuery = MonitorLogByDayModel.find(query, filter)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        monitorLogsByDayQuery = handleSelect(select, monitorLogsByDayQuery);
        monitorLogsByDayQuery = handlePopulate(populate, monitorLogsByDayQuery);

        const monitorLogsByDay = await monitorLogsByDayQuery;
        return monitorLogsByDay;
    },

    async findOneBy({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let monitorLogQuery = MonitorLogByDayModel.findOne(query).lean();

        monitorLogQuery = handleSelect(select, monitorLogQuery);
        monitorLogQuery = handlePopulate(populate, monitorLogQuery);

        const monitorLog = await monitorLogQuery;

        return monitorLog;
    },

    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const count = await MonitorLogByDayModel.countDocuments(query);

        return count;
    },
};

import MonitorLogByDayModel from '../models/monitorLogByDay';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

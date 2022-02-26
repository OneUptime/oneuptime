export default {
    create: async function(data: $TSFixMe) {
        const Log = new MonitorLogModel();
        let responseBody = '';
        if (data.resp && data.resp.body) {
            if (typeof data.resp.body === 'object') {
                responseBody = JSON.stringify(data.resp.body);
            } else {
                responseBody = data.resp.body;
            }
        } else {
            responseBody = '';
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        Log.monitorId = data.monitorId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type 'Documen... Remove this comment to see the full error message
        Log.probeId = data.probeId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type 'Document... Remove this comment to see the full error message
        Log.status = data.status;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type 'Do... Remove this comment to see the full error message
        Log.responseTime = data.responseTime;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
        Log.responseStatus = data.responseStatus;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseBody' does not exist on type 'Do... Remove this comment to see the full error message
        Log.responseBody = responseBody;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseHeader' does not exist on type '... Remove this comment to see the full error message
        Log.responseHeader =
            data.rawResp && data.rawResp.headers ? data.rawResp.headers : {};
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type 'Documen... Remove this comment to see the full error message
        Log.cpuLoad = data.cpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type 'Docu... Remove this comment to see the full error message
        Log.avgCpuLoad = data.avgCpuLoad;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type 'Docume... Remove this comment to see the full error message
        Log.cpuCores = data.cpuCores;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type 'Docu... Remove this comment to see the full error message
        Log.memoryUsed = data.memoryUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type 'Doc... Remove this comment to see the full error message
        Log.totalMemory = data.totalMemory;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type 'Docume... Remove this comment to see the full error message
        Log.swapUsed = data.swapUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type 'Doc... Remove this comment to see the full error message
        Log.storageUsed = data.storageUsed;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type 'Do... Remove this comment to see the full error message
        Log.totalStorage = data.totalStorage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type 'Do... Remove this comment to see the full error message
        Log.storageUsage = data.storageUsage;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type 'Docume... Remove this comment to see the full error message
        Log.mainTemp = data.mainTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type 'Documen... Remove this comment to see the full error message
        Log.maxTemp = data.maxTemp;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
        Log.sslCertificate = data.sslCertificate;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type 'D... Remove this comment to see the full error message
        Log.kubernetesLog = data.kubernetesData || {};

        // script log details
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scriptMetadata' does not exist on type '... Remove this comment to see the full error message
        Log.scriptMetadata = data.scriptMetadata;

        const savedLog = await Log.save();

        // run these in background.
        this.updateAggregateLogs(data);
        this.sendMonitorLog(savedLog);

        return savedLog;
    },

    updateAggregateLogs: async function(data: $TSFixMe) {
        const now = new Date();

        const intervalHourDate = moment(now).format('MMM Do YYYY, h A');
        const intervalDayDate = moment(now).format('MMM Do YYYY');
        const intervalWeekDate = moment(now).format('wo [week of] YYYY');

        const selectMonitorLogBy =
            'monitorId probeId status responseTime responseStatus cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp createdAt intervalDate maxResponseTime maxCpuLoad maxMemoryUsed maxStorageUsed maxMainTemp sslCertificate kubernetesLog';

        const [logByHour, logByDay, logByWeek] = await Promise.all([
            MonitorLogByHourService.findOneBy({
                query: {
                    probeId: data.probeId,
                    monitorId: data.monitorId,
                    intervalDate: intervalHourDate,
                },
                select: selectMonitorLogBy,
            }),
            MonitorLogByDayService.findOneBy({
                query: {
                    probeId: data.probeId,
                    monitorId: data.monitorId,
                    intervalDate: intervalDayDate,
                },
                select: selectMonitorLogBy,
            }),
            MonitorLogByWeekService.findOneBy({
                query: {
                    probeId: data.probeId,
                    monitorId: data.monitorId,
                    intervalDate: intervalWeekDate,
                },
                select: selectMonitorLogBy,
            }),
        ]);

        if (logByHour) {
            await MonitorLogByHourService.updateOneBy(
                { _id: logByHour._id },
                {
                    ...data,
                    createdAt: Date.now(),
                    maxResponseTime:
                        data.responseTime > logByHour.maxResponseTime
                            ? data.responseTime
                            : logByHour.maxResponseTime,
                    maxCpuLoad:
                        data.cpuLoad > logByHour.maxCpuLoad
                            ? data.cpuLoad
                            : logByHour.maxCpuLoad,
                    maxMemoryUsed:
                        data.memoryUsed > logByHour.maxMemoryUsed
                            ? data.memoryUsed
                            : logByHour.maxMemoryUsed,
                    maxStorageUsed:
                        data.storageUsed > logByHour.maxStorageUsed
                            ? data.storageUsed
                            : logByHour.maxStorageUsed,
                    maxMainTemp:
                        data.mainTemp > logByHour.maxMainTemp
                            ? data.mainTemp
                            : logByHour.maxMainTemp,
                }
            );
        } else {
            await MonitorLogByHourService.create({
                ...data,
                intervalDate: intervalHourDate,
            });
        }
        if (logByDay) {
            await MonitorLogByDayService.updateOneBy(
                { _id: logByDay._id },
                {
                    ...data,
                    createdAt: Date.now(),
                    maxResponseTime:
                        data.responseTime > logByDay.maxResponseTime
                            ? data.responseTime
                            : logByDay.maxResponseTime,
                    maxCpuLoad:
                        data.cpuLoad > logByDay.maxCpuLoad
                            ? data.cpuLoad
                            : logByDay.maxCpuLoad,
                    maxMemoryUsed:
                        data.memoryUsed > logByDay.maxMemoryUsed
                            ? data.memoryUsed
                            : logByDay.maxMemoryUsed,
                    maxStorageUsed:
                        data.storageUsed > logByDay.maxStorageUsed
                            ? data.storageUsed
                            : logByDay.maxStorageUsed,
                    maxMainTemp:
                        data.mainTemp > logByDay.maxMainTemp
                            ? data.mainTemp
                            : logByDay.maxMainTemp,
                }
            );
        } else {
            await MonitorLogByDayService.create({
                ...data,
                intervalDate: intervalDayDate,
            });
        }
        if (logByWeek) {
            await MonitorLogByWeekService.updateOneBy(
                { _id: logByWeek._id },
                {
                    ...data,
                    createdAt: Date.now(),
                    maxResponseTime:
                        data.responseTime > logByWeek.maxResponseTime
                            ? data.responseTime
                            : logByWeek.maxResponseTime,
                    maxCpuLoad:
                        data.cpuLoad > logByWeek.maxCpuLoad
                            ? data.cpuLoad
                            : logByWeek.maxCpuLoad,
                    maxMemoryUsed:
                        data.memoryUsed > logByWeek.maxMemoryUsed
                            ? data.memoryUsed
                            : logByWeek.maxMemoryUsed,
                    maxStorageUsed:
                        data.storageUsed > logByWeek.maxStorageUsed
                            ? data.storageUsed
                            : logByWeek.maxStorageUsed,
                    maxMainTemp:
                        data.mainTemp > logByWeek.maxMainTemp
                            ? data.mainTemp
                            : logByWeek.maxMainTemp,
                }
            );
        } else {
            await MonitorLogByWeekService.create({
                ...data,
                intervalDate: intervalWeekDate,
            });
        }
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const monitorLog = await MonitorLogModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        return monitorLog;
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

        let monitorLogsQuery = MonitorLogModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);
        monitorLogsQuery = handleSelect(select, monitorLogsQuery);
        monitorLogsQuery = handlePopulate(populate, monitorLogsQuery);

        const monitorLogs = await monitorLogsQuery;
        return monitorLogs;
    },

    async findOneBy({
        query,
        select,
        populate
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let monitorLogQuery = MonitorLogModel.findOne(query).lean();
        monitorLogQuery = handleSelect(select, monitorLogQuery);
        monitorLogQuery = handlePopulate(populate, monitorLogQuery);

        const monitorLog = await monitorLogQuery;
        return monitorLog;
    },

    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const count = await MonitorLogModel.countDocuments(query);

        return count;
    },

    async sendMonitorLog(data: $TSFixMe) {
        const selectMonitorLog =
            'monitorId probeId status responseTime responseStatus responseBody responseHeader cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp incidentIds createdAt sslCertificate  kubernetesLog scriptMetadata';

        const populateMonitorLog = [
            {
                path: 'probeId',
                select:
                    'createdAt lastAlive probeKey probeName version probeImage deleted',
            },
        ];
        const [monitor, logData] = await Promise.all([
            MonitorService.findOneBy({
                query: { _id: data.monitorId },
                select: 'projectId',
                populate: [{ path: 'projectId', select: '_id' }],
            }),

            this.findOneBy({
                query: { _id: data._id },
                select: selectMonitorLog,
                populate: populateMonitorLog,
            }),
        ]);
        if (monitor && monitor.projectId && monitor.projectId._id) {
            try {
                // run in the background
                RealTimeService.updateMonitorLog(
                    data,
                    logData,
                    monitor.projectId._id
                );
            } catch (error) {
                ErrorService.log('realtimeService.updateMonitorLog', error);
            }
        }
    },
};

import MonitorLogModel from '../models/monitorLog'
import MonitorLogByHourService from '../services/monitorLogByHourService'
import MonitorLogByDayService from '../services/monitorLogByDayService'
import MonitorLogByWeekService from '../services/monitorLogByWeekService'
import MonitorService from '../services/monitorService'
import RealTimeService from './realTimeService'
import ErrorService from 'common-server/utils/error'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'
import moment from 'moment'

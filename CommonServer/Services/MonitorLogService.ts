import MonitorLogModel from '../Models/monitorLog';
import MonitorLogByHourService from './MonitorLogByHourService';
import MonitorLogByDayService from './MonitorLogByDayService';
import MonitorLogByWeekService from './MonitorLogByWeekService';
import MonitorService from './MonitorService';
import RealTimeService from './realTimeService';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';
import moment from 'moment';

export default class Service {
    async create(data: $TSFixMe): void {
        const Log: $TSFixMe = new MonitorLogModel();
        let responseBody: $TSFixMe = '';
        if (data.resp && data.resp.body) {
            if (typeof data.resp.body === 'object') {
                responseBody = JSON.stringify(data.resp.body);
            } else {
                responseBody = data.resp.body;
            }
        } else {
            responseBody = '';
        }

        Log.monitorId = data.monitorId;

        Log.probeId = data.probeId;

        Log.status = data.status;

        Log.responseTime = data.responseTime;

        Log.responseStatus = data.responseStatus;

        Log.responseBody = responseBody;

        Log.responseHeader =
            data.rawResp && data.rawResp.headers ? data.rawResp.headers : {};

        Log.cpuLoad = data.cpuLoad;

        Log.avgCpuLoad = data.avgCpuLoad;

        Log.cpuCores = data.cpuCores;

        Log.memoryUsed = data.memoryUsed;

        Log.totalMemory = data.totalMemory;

        Log.swapUsed = data.swapUsed;

        Log.storageUsed = data.storageUsed;

        Log.totalStorage = data.totalStorage;

        Log.storageUsage = data.storageUsage;

        Log.mainTemp = data.mainTemp;

        Log.maxTemp = data.maxTemp;

        Log.sslCertificate = data.sslCertificate;

        Log.kubernetesLog = data.kubernetesData || {};

        // script log details

        Log.scriptMetadata = data.scriptMetadata;

        const savedLog: $TSFixMe = await Log.save();

        // run these in background.
        this.updateAggregateLogs(data);
        this.sendMonitorLog(savedLog);

        return savedLog;
    }

    async updateAggregateLogs(data: $TSFixMe): void {
        const now: $TSFixMe = new Date();

        const intervalHourDate: $TSFixMe =
            moment(now).format('MMM Do YYYY, h A');
        const intervalDayDate: $TSFixMe = moment(now).format('MMM Do YYYY');
        const intervalWeekDate: $TSFixMe =
            moment(now).format('wo [week of] YYYY');

        const selectMonitorLogBy: $TSFixMe =
            'monitorId probeId status responseTime responseStatus cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp createdAt intervalDate maxResponseTime maxCpuLoad maxMemoryUsed maxStorageUsed maxMainTemp sslCertificate kubernetesLog';

        const [logByHour, logByDay, logByWeek]: $TSFixMe = await Promise.all([
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
    }

    async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        const monitorLog: $TSFixMe = await MonitorLogModel.findOneAndUpdate(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        return monitorLog;
    }

    async findBy({ query, limit, skip, select, populate, sort }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        const monitorLogsQuery: $TSFixMe = MonitorLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());
        monitorLogsQuery.select(select);
        monitorLogsQuery.populate(populate);

        const monitorLogs: $TSFixMe = await monitorLogsQuery;
        return monitorLogs;
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        const monitorLogQuery: $TSFixMe = MonitorLogModel.findOne(query)
            .sort(sort)
            .lean();
        monitorLogQuery.select(select);
        monitorLogQuery.populate(populate);

        const monitorLog: $TSFixMe = await monitorLogQuery;
        return monitorLog;
    }

    async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        const count: $TSFixMe = await MonitorLogModel.countDocuments(query);

        return count;
    }

    async sendMonitorLog(data: $TSFixMe): void {
        const selectMonitorLog: $TSFixMe =
            'monitorId probeId status responseTime responseStatus responseBody responseHeader cpuLoad avgCpuLoad cpuCores memoryUsed totalMemory swapUsed storageUsed totalStorage storageUsage mainTemp maxTemp incidentIds createdAt sslCertificate  kubernetesLog scriptMetadata';

        const populateMonitorLog: $TSFixMe = [
            {
                path: 'probeId',
                select: 'createdAt lastAlive probeKey probeName version probeImage deleted',
            },
        ];
        const [monitor, logData]: $TSFixMe = await Promise.all([
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
            // run in the background
            RealTimeService.updateMonitorLog(
                data,
                logData,
                monitor.projectId._id
            );
        }
    }
}

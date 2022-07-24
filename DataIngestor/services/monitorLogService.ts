import MonitorLogByHourService from './monitorLogByHourService';
import MonitorLogByDayService from './monitorLogByDayService';
import MonitorLogByWeekService from './monitorLogByWeekService';
import MonitorService from './monitorService';
import Query from 'CommonServer/types/db/Query';
import moment from 'moment';

const monitorLogCollection: $TSFixMe = global.db.collection('monitorlogs');
import { ObjectId } from 'mongodb';

import { post } from '../Utils/api';

import { realtimeUrl } from '../Config';
import ProjectService from './projectService';

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

export default {
    create: async function (data: $TSFixMe): void {
        const Log: $TSFixMe = {};
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

        Log.createdAt = new Date(moment().format());

        // Script log details

        Log.scriptMetadata = data.scriptMetadata;

        const result: $TSFixMe = await monitorLogCollection.insertOne(Log);
        const savedLog: $TSFixMe = this.findOneBy({
            _id: ObjectId(result.insertedId),
        });

        // Run these in background.
        this.updateAggregateLogs(data);
        this.sendMonitorLog(savedLog);

        return savedLog;
    },

    updateAggregateLogs: async function (data: $TSFixMe): void {
        const now: $TSFixMe = new Date();
        const intervalHourDate: $TSFixMe =
            moment(now).format('MMM Do YYYY, h A');
        const intervalDayDate: $TSFixMe = moment(now).format('MMM Do YYYY');
        const intervalWeekDate: $TSFixMe =
            moment(now).format('wo [week of] YYYY');

        const [logByHour, logByDay, logByWeek]: $TSFixMe = await Promise.all([
            MonitorLogByHourService.findOneBy({
                probeId: data.probeId,
                monitorId: data.monitorId,
                intervalDate: intervalHourDate,
            }),
            MonitorLogByDayService.findOneBy({
                probeId: data.probeId,
                monitorId: data.monitorId,
                intervalDate: intervalDayDate,
            }),
            MonitorLogByWeekService.findOneBy({
                probeId: data.probeId,
                monitorId: data.monitorId,
                intervalDate: intervalWeekDate,
            }),
        ]);

        if (logByHour) {
            MonitorLogByHourService.updateOneBy(
                { _id: ObjectId(logByHour._id) },
                {
                    ...data,
                    createdAt: new Date(moment().format()),
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
            MonitorLogByHourService.create({
                ...data,
                intervalDate: intervalHourDate,
            });
        }
        if (logByDay) {
            MonitorLogByDayService.updateOneBy(
                { _id: ObjectId(logByDay._id) },
                {
                    ...data,
                    createdAt: new Date(moment().format()),
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
            MonitorLogByDayService.create({
                ...data,
                intervalDate: intervalDayDate,
            });
        }
        if (logByWeek) {
            MonitorLogByWeekService.updateOneBy(
                { _id: ObjectId(logByWeek._id) },
                {
                    ...data,
                    createdAt: new Date(moment().format()),
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
            MonitorLogByWeekService.create({
                ...data,
                intervalDate: intervalWeekDate,
            });
        }
    },

    updateOneBy: async function (query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        await monitorLogCollection.updateOne(query, {
            $set: data,
        });
        const monitorLog: $TSFixMe = this.findOneBy(query);

        return monitorLog;
    },

    async findOneBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        let monitorLog: $TSFixMe = await monitorLogCollection
            .aggregate([
                { $match: query },
                { $addFields: { probeId: { $toObjectId: '$probeId' } } },
                {
                    $lookup: {
                        from: 'probes',
                        localField: 'probeId',
                        foreignField: '_id',
                        as: 'probeId',
                    },
                },
            ])
            .toArray();
        monitorLog = monitorLog[0]; // We are only concerned with the first item
        if (monitorLog.probeId && Array.isArray(monitorLog.probeId)) {
            monitorLog.probeId = monitorLog.probeId[0];
        }

        return monitorLog;
    },

    async sendMonitorLog(data: $TSFixMe): void {
        const [monitor, logData]: $TSFixMe = await Promise.all([
            MonitorService.findOneBy({
                query: { _id: ObjectId(data.monitorId) },
                /*
                 * Select: 'projectId',
                 * Populate: [{ path: 'projectId', select: '_id' }],
                 */
            }),

            this.findOneBy({ _id: ObjectId(data._id) }),
        ]);

        if (monitor && monitor.projectId) {
            const project: $TSFixMe = ProjectService.findOneBy({
                query: {
                    _id: ObjectId(monitor.projectId._id || monitor.projectId),
                },
            });
            const parentProjectId: $TSFixMe = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId._id || monitor.projectId;

            // Realtime update
            post(
                `${realtimeBaseUrl}/update-monitor-log`,
                {
                    data,
                    monitorId: data.monitorId,
                    logData,
                    parentProjectId,
                    projectId: monitor.projectId._id || monitor.projectId,
                },
                true
            );
        }
    },
};

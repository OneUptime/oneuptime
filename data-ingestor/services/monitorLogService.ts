import MonitorLogByHourService from '../services/monitorLogByHourService';
import MonitorLogByDayService from '../services/monitorLogByDayService';
import MonitorLogByWeekService from '../services/monitorLogByWeekService';
import MonitorService from '../services/monitorService';
import ErrorService from '../services/errorService';
import moment from 'moment';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const monitorLogCollection = global.db.collection('monitorlogs');
import { ObjectId } from 'mongodb';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { realtimeUrl } from '../utils/config';
import ProjectService from './projectService';

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

export default {
    create: async function(data: $TSFixMe) {
        try {
            const Log = {};
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
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            Log.monitorId = data.monitorId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
            Log.probeId = data.probeId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
            Log.status = data.status;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type '{}... Remove this comment to see the full error message
            Log.responseTime = data.responseTime;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
            Log.responseStatus = data.responseStatus;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseBody' does not exist on type '{}... Remove this comment to see the full error message
            Log.responseBody = responseBody;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseHeader' does not exist on type '... Remove this comment to see the full error message
            Log.responseHeader =
                data.rawResp && data.rawResp.headers
                    ? data.rawResp.headers
                    : {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type '{}'.
            Log.cpuLoad = data.cpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type '{}'.
            Log.avgCpuLoad = data.avgCpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type '{}'.
            Log.cpuCores = data.cpuCores;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type '{}'.
            Log.memoryUsed = data.memoryUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type '{}'... Remove this comment to see the full error message
            Log.totalMemory = data.totalMemory;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type '{}'.
            Log.swapUsed = data.swapUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type '{}'... Remove this comment to see the full error message
            Log.storageUsed = data.storageUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type '{}... Remove this comment to see the full error message
            Log.totalStorage = data.totalStorage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type '{}... Remove this comment to see the full error message
            Log.storageUsage = data.storageUsage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type '{}'.
            Log.mainTemp = data.mainTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type '{}'.
            Log.maxTemp = data.maxTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
            Log.sslCertificate = data.sslCertificate;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type '{... Remove this comment to see the full error message
            Log.kubernetesLog = data.kubernetesData || {};

            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            Log.createdAt = new Date(moment().format());

            // script log details
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'scriptMetadata' does not exist on type '... Remove this comment to see the full error message
            Log.scriptMetadata = data.scriptMetadata;

            const result = await monitorLogCollection.insertOne(Log);
            const savedLog = await this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(result.insertedId),
            });

            // run these in background.
            this.updateAggregateLogs(data);
            this.sendMonitorLog(savedLog);

            return savedLog;
        } catch (error) {
            ErrorService.log('monitorLogService.create', error);
            throw error;
        }
    },

    updateAggregateLogs: async function(data: $TSFixMe) {
        try {
            const now = new Date();
            const intervalHourDate = moment(now).format('MMM Do YYYY, h A');
            const intervalDayDate = moment(now).format('MMM Do YYYY');
            const intervalWeekDate = moment(now).format('wo [week of] YYYY');

            const [logByHour, logByDay, logByWeek] = await Promise.all([
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
                await MonitorLogByHourService.updateOneBy(
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
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
                await MonitorLogByHourService.create({
                    ...data,
                    intervalDate: intervalHourDate,
                });
            }
            if (logByDay) {
                await MonitorLogByDayService.updateOneBy(
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
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
                await MonitorLogByDayService.create({
                    ...data,
                    intervalDate: intervalDayDate,
                });
            }
            if (logByWeek) {
                await MonitorLogByWeekService.updateOneBy(
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
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
                await MonitorLogByWeekService.create({
                    ...data,
                    intervalDate: intervalWeekDate,
                });
            }
        } catch (error) {
            ErrorService.log('monitorLogService.updateAggregateLogs', error);
            throw error;
        }
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        try {
            if (!query) {
                query = {};
            }

            await monitorLogCollection.updateOne(query, {
                $set: data,
            });
            const monitorLog = await this.findOneBy(query);

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogService.updateOneBy', error);
            throw error;
        }
    },

    async findOneBy(query: $TSFixMe) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            let monitorLog = await monitorLogCollection
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
            monitorLog = monitorLog[0]; // we are only concerned with the first item
            if (monitorLog.probeId && Array.isArray(monitorLog.probeId)) {
                monitorLog.probeId = monitorLog.probeId[0];
            }

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogService.findOneBy', error);
            throw error;
        }
    },

    async sendMonitorLog(data: $TSFixMe) {
        try {
            const [monitor, logData] = await Promise.all([
                MonitorService.findOneBy({
                    // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                    query: { _id: ObjectId(data.monitorId) },
                    // select: 'projectId',
                    // populate: [{ path: 'projectId', select: '_id' }],
                }),
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                this.findOneBy({ _id: ObjectId(data._id) }),
            ]);

            if (monitor && monitor.projectId) {
                const project = await ProjectService.findOneBy({
                    query: {
                        // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                        _id: ObjectId(
                            monitor.projectId._id || monitor.projectId
                        ),
                    },
                });
                const parentProjectId = project
                    ? project.parentProjectId
                        ? project.parentProjectId._id || project.parentProjectId
                        : project._id
                    : monitor.projectId._id || monitor.projectId;

                // realtime update
                postApi(
                    `${realtimeBaseUrl}/update-monitor-log`,
                    {
                        data,
                        monitorId: data.monitorId,
                        logData,
                        parentProjectId,
                        projectId: monitor.projectId._id || monitor.projectId,
                    },
                    true
                ).catch((error: $TSFixMe) => {
                    ErrorService.log('monitorLogService.sendMonitorLog', error);
                });
            }
        } catch (error) {
            ErrorService.log('monitorLogService.sendMonitorLog', error);
            throw error;
        }
    },
};

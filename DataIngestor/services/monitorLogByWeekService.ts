import Query from 'CommonServer/types/db/Query';

export default {
    create: async function (data: $TSFixMe): void {
        const LogWeek: $TSFixMe = {};

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

        LogWeek.createdAt = new Date(moment().format());

        const result: $TSFixMe = await monitorLogByWeekCollection.insertOne(
            LogWeek
        );
        const savedLogWeek: $TSFixMe = this.findOneBy({
            _id: ObjectId(result.insertedId),
        });

        return savedLogWeek;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        await monitorLogByWeekCollection.updateOne(query, { $set: data });
        const monitorLogByWeek: $TSFixMe =
            await monitorLogByWeekCollection.findOne(query);

        return monitorLogByWeek;
    },

    async findOneBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const monitorLog: $TSFixMe = await monitorLogByWeekCollection.findOne(
            query
        );

        return monitorLog;
    },
};

import { ObjectId } from 'mongodb';

const monitorLogByWeekCollection: $TSFixMe =
    global.db.collection('monitorlogbyweeks');
import moment from 'moment';

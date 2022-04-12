import Query from 'CommonServer/types/db/Query';

export default {
    create: async function (data: $TSFixMe): void {
        const LogDay = {};

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

        LogDay.createdAt = new Date(moment().format());

        const result = await monitorLogByDayCollection.insertOne(LogDay);
        const savedLogDay = await this.findOneBy({
            _id: ObjectId(result.insertedId),
        });

        return savedLogDay;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        await monitorLogByDayCollection.updateOne(query, { $set: data });
        const monitorLogByDay = await monitorLogByDayCollection.findOne(query);

        return monitorLogByDay;
    },

    async findOneBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const monitorLog = await monitorLogByDayCollection.findOne(query);

        return monitorLog;
    },
};

import { ObjectId } from 'mongodb';

const monitorLogByDayCollection = global.db.collection('monitorlogbydays');
import moment from 'moment';

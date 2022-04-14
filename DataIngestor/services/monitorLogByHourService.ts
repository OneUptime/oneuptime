import Query from 'CommonServer/types/db/Query';

export default {
    create: async function (data: $TSFixMe): void {
        const LogHour = {};

        LogHour.monitorId = data.monitorId;

        LogHour.probeId = data.probeId;

        LogHour.status = data.status;

        LogHour.responseTime = data.responseTime;

        LogHour.responseStatus = data.responseStatus;

        LogHour.cpuLoad = data.cpuLoad;

        LogHour.avgCpuLoad = data.avgCpuLoad;

        LogHour.cpuCores = data.cpuCores;

        LogHour.memoryUsed = data.memoryUsed;

        LogHour.totalMemory = data.totalMemory;

        LogHour.swapUsed = data.swapUsed;

        LogHour.storageUsed = data.storageUsed;

        LogHour.totalStorage = data.totalStorage;

        LogHour.storageUsage = data.storageUsage;

        LogHour.mainTemp = data.mainTemp;

        LogHour.maxTemp = data.maxTemp;

        LogHour.maxResponseTime = data.responseTime;

        LogHour.maxCpuLoad = data.cpuLoad;

        LogHour.maxMemoryUsed = data.memoryUsed;

        LogHour.maxStorageUsed = data.storageUsed;

        LogHour.maxMainTemp = data.mainTemp;

        LogHour.intervalDate = data.intervalDate;

        LogHour.sslCertificate = data.sslCertificate;

        LogHour.kubernetesLog = data.kubernetesData || {};

        LogHour.createdAt = new Date(moment().format());

        const result = await monitorLogByHourCollection.insertOne(LogHour);
        const savedLogHour = await this.findOneBy({
            _id: ObjectId(result.insertedId),
        });

        return savedLogHour;
    },

    updateOneBy: async function (query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        await monitorLogByHourCollection.updateOne(query, { $set: data });
        const monitorLogByHour = await monitorLogByHourCollection.findOne(
            query
        );

        return monitorLogByHour;
    },

    async findOneBy(query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const monitorLog = await monitorLogByHourCollection.findOne(query);

        return monitorLog;
    },
};

import { ObjectId } from 'mongodb';

const monitorLogByHourCollection = global.db.collection('monitorlogbyhours');
import moment from 'moment';

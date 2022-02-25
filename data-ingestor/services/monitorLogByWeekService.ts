export default {
    create: async function(data) {
        try {
            const LogWeek = {};
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

            const result = await monitorLogByWeekCollection.insertOne(LogWeek);
            const savedLogWeek = await this.findOneBy({
                _id: ObjectId(result.insertedId),
            });

            return savedLogWeek;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            await monitorLogByWeekCollection.updateOne(query, { $set: data });
            const monitorLogByWeek = await monitorLogByWeekCollection.findOne(
                query
            );

            return monitorLogByWeek;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.updateOneBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const monitorLog = await monitorLogByWeekCollection.findOne(query);

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.findOneBy', error);
            throw error;
        }
    },
};

import { ObjectId } from 'mongodb'
import ErrorService from '../services/errorService'
const monitorLogByWeekCollection = global.db.collection('monitorlogbyweeks');
import moment from 'moment'

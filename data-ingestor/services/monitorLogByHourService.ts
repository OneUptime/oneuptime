export default {
    create: async function(data: $TSFixMe) {
        try {
            const LogHour = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            LogHour.monitorId = data.monitorId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
            LogHour.probeId = data.probeId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
            LogHour.status = data.status;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type '{}... Remove this comment to see the full error message
            LogHour.responseTime = data.responseTime;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
            LogHour.responseStatus = data.responseStatus;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type '{}'.
            LogHour.cpuLoad = data.cpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type '{}'.
            LogHour.avgCpuLoad = data.avgCpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type '{}'.
            LogHour.cpuCores = data.cpuCores;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type '{}'.
            LogHour.memoryUsed = data.memoryUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type '{}'... Remove this comment to see the full error message
            LogHour.totalMemory = data.totalMemory;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type '{}'.
            LogHour.swapUsed = data.swapUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type '{}'... Remove this comment to see the full error message
            LogHour.storageUsed = data.storageUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type '{}... Remove this comment to see the full error message
            LogHour.totalStorage = data.totalStorage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type '{}... Remove this comment to see the full error message
            LogHour.storageUsage = data.storageUsage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type '{}'.
            LogHour.mainTemp = data.mainTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type '{}'.
            LogHour.maxTemp = data.maxTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxResponseTime' does not exist on type ... Remove this comment to see the full error message
            LogHour.maxResponseTime = data.responseTime;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxCpuLoad' does not exist on type '{}'.
            LogHour.maxCpuLoad = data.cpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMemoryUsed' does not exist on type '{... Remove this comment to see the full error message
            LogHour.maxMemoryUsed = data.memoryUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxStorageUsed' does not exist on type '... Remove this comment to see the full error message
            LogHour.maxStorageUsed = data.storageUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMainTemp' does not exist on type '{}'... Remove this comment to see the full error message
            LogHour.maxMainTemp = data.mainTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'intervalDate' does not exist on type '{}... Remove this comment to see the full error message
            LogHour.intervalDate = data.intervalDate;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
            LogHour.sslCertificate = data.sslCertificate;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type '{... Remove this comment to see the full error message
            LogHour.kubernetesLog = data.kubernetesData || {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            LogHour.createdAt = new Date(moment().format());

            const result = await monitorLogByHourCollection.insertOne(LogHour);
            const savedLogHour = await this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(result.insertedId),
            });

            return savedLogHour;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            await monitorLogByHourCollection.updateOne(query, { $set: data });
            const monitorLogByHour = await monitorLogByHourCollection.findOne(
                query
            );

            return monitorLogByHour;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.updateOneBy', error);
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

            const monitorLog = await monitorLogByHourCollection.findOne(query);

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogByHourService.findOneBy', error);
            throw error;
        }
    },
};

import { ObjectId } from 'mongodb';
import ErrorService from '../services/errorService';
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const monitorLogByHourCollection = global.db.collection('monitorlogbyhours');
import moment from 'moment';

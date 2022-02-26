export default {
    create: async function(data: $TSFixMe) {
        try {
            const LogDay = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            LogDay.monitorId = data.monitorId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
            LogDay.probeId = data.probeId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
            LogDay.status = data.status;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type '{}... Remove this comment to see the full error message
            LogDay.responseTime = data.responseTime;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
            LogDay.responseStatus = data.responseStatus;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type '{}'.
            LogDay.cpuLoad = data.cpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type '{}'.
            LogDay.avgCpuLoad = data.avgCpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type '{}'.
            LogDay.cpuCores = data.cpuCores;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type '{}'.
            LogDay.memoryUsed = data.memoryUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type '{}'... Remove this comment to see the full error message
            LogDay.totalMemory = data.totalMemory;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type '{}'.
            LogDay.swapUsed = data.swapUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type '{}'... Remove this comment to see the full error message
            LogDay.storageUsed = data.storageUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type '{}... Remove this comment to see the full error message
            LogDay.totalStorage = data.totalStorage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type '{}... Remove this comment to see the full error message
            LogDay.storageUsage = data.storageUsage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type '{}'.
            LogDay.mainTemp = data.mainTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type '{}'.
            LogDay.maxTemp = data.maxTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxResponseTime' does not exist on type ... Remove this comment to see the full error message
            LogDay.maxResponseTime = data.responseTime;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxCpuLoad' does not exist on type '{}'.
            LogDay.maxCpuLoad = data.cpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMemoryUsed' does not exist on type '{... Remove this comment to see the full error message
            LogDay.maxMemoryUsed = data.memoryUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxStorageUsed' does not exist on type '... Remove this comment to see the full error message
            LogDay.maxStorageUsed = data.storageUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMainTemp' does not exist on type '{}'... Remove this comment to see the full error message
            LogDay.maxMainTemp = data.mainTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'intervalDate' does not exist on type '{}... Remove this comment to see the full error message
            LogDay.intervalDate = data.intervalDate;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
            LogDay.sslCertificate = data.sslCertificate;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type '{... Remove this comment to see the full error message
            LogDay.kubernetesLog = data.kubernetesData || {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            LogDay.createdAt = new Date(moment().format());

            const result = await monitorLogByDayCollection.insertOne(LogDay);
            const savedLogDay = await this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(result.insertedId),
            });

            return savedLogDay;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.create', error);
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

            await monitorLogByDayCollection.updateOne(query, { $set: data });
            const monitorLogByDay = await monitorLogByDayCollection.findOne(
                query
            );

            return monitorLogByDay;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.updateOneBy', error);
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

            const monitorLog = await monitorLogByDayCollection.findOne(query);

            return monitorLog;
        } catch (error) {
            ErrorService.log('monitorLogByDayService.findOneBy', error);
            throw error;
        }
    },
};

import { ObjectId } from 'mongodb'
import ErrorService from '../services/errorService'
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const monitorLogByDayCollection = global.db.collection('monitorlogbydays');
import moment from 'moment'

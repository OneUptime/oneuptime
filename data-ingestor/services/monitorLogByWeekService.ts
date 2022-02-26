export default {
    create: async function(data: $TSFixMe) {
        try {
            const LogWeek = {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type '{}'.
            LogWeek.monitorId = data.monitorId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type '{}'.
            LogWeek.probeId = data.probeId;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'status' does not exist on type '{}'.
            LogWeek.status = data.status;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseTime' does not exist on type '{}... Remove this comment to see the full error message
            LogWeek.responseTime = data.responseTime;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'responseStatus' does not exist on type '... Remove this comment to see the full error message
            LogWeek.responseStatus = data.responseStatus;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuLoad' does not exist on type '{}'.
            LogWeek.cpuLoad = data.cpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'avgCpuLoad' does not exist on type '{}'.
            LogWeek.avgCpuLoad = data.avgCpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'cpuCores' does not exist on type '{}'.
            LogWeek.cpuCores = data.cpuCores;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'memoryUsed' does not exist on type '{}'.
            LogWeek.memoryUsed = data.memoryUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalMemory' does not exist on type '{}'... Remove this comment to see the full error message
            LogWeek.totalMemory = data.totalMemory;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'swapUsed' does not exist on type '{}'.
            LogWeek.swapUsed = data.swapUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsed' does not exist on type '{}'... Remove this comment to see the full error message
            LogWeek.storageUsed = data.storageUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'totalStorage' does not exist on type '{}... Remove this comment to see the full error message
            LogWeek.totalStorage = data.totalStorage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'storageUsage' does not exist on type '{}... Remove this comment to see the full error message
            LogWeek.storageUsage = data.storageUsage;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'mainTemp' does not exist on type '{}'.
            LogWeek.mainTemp = data.mainTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxTemp' does not exist on type '{}'.
            LogWeek.maxTemp = data.maxTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxResponseTime' does not exist on type ... Remove this comment to see the full error message
            LogWeek.maxResponseTime = data.responseTime;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxCpuLoad' does not exist on type '{}'.
            LogWeek.maxCpuLoad = data.cpuLoad;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMemoryUsed' does not exist on type '{... Remove this comment to see the full error message
            LogWeek.maxMemoryUsed = data.memoryUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxStorageUsed' does not exist on type '... Remove this comment to see the full error message
            LogWeek.maxStorageUsed = data.storageUsed;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'maxMainTemp' does not exist on type '{}'... Remove this comment to see the full error message
            LogWeek.maxMainTemp = data.mainTemp;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'intervalDate' does not exist on type '{}... Remove this comment to see the full error message
            LogWeek.intervalDate = data.intervalDate;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'sslCertificate' does not exist on type '... Remove this comment to see the full error message
            LogWeek.sslCertificate = data.sslCertificate;
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'kubernetesLog' does not exist on type '{... Remove this comment to see the full error message
            LogWeek.kubernetesLog = data.kubernetesData || {};
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'createdAt' does not exist on type '{}'.
            LogWeek.createdAt = new Date(moment().format());

            const result = await monitorLogByWeekCollection.insertOne(LogWeek);
            const savedLogWeek = await this.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(result.insertedId),
            });

            return savedLogWeek;
        } catch (error) {
            ErrorService.log('monitorLogByWeekService.create', error);
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
// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const monitorLogByWeekCollection = global.db.collection('monitorlogbyweeks');
import moment from 'moment'

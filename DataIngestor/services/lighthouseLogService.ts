const lighthouseLogCollection: $TSFixMe =
    global.db.collection('lighthouselogs');
import probeService from './probeService';
import ErrorService from './errorService';
import { ObjectId } from 'mongodb';
import MonitorService from './monitorService';
import Query from 'CommonServer/types/db/Query';
import { post } from '../Utils/api';
import moment from 'moment';

import { realtimeUrl } from '../Config';
import ProjectService from './projectService';

const realtimeBaseUrl: string = `${realtimeUrl}/realtime`;

export default {
    create: async function (data: $TSFixMe): void {
        const result: $TSFixMe = await lighthouseLogCollection.insertOne({
            monitorId: data.monitorId,
            probeId: data.probeId,
            data: data.lighthouseData.issues,
            url: data.lighthouseData.url,
            performance: data.performance,
            accessibility: data.accessibility,
            bestPractices: data.bestPractices,
            seo: data.seo,
            pwa: data.pwa,
            scanning: data.scanning,
            createdAt: new Date(moment().format()),
        });
        const savedLog: $TSFixMe = await this.findOneBy({
            _id: ObjectId(result.insertedId),
        });

        await this.sendLighthouseLog(savedLog);

        if (data.probeId && data.monitorId) {
            await probeService.sendProbe(data.probeId, data.monitorId);
        }

        return savedLog;
    },

    findOneBy: async function (query: Query): void {
        if (!query) {
            query = {};
        }

        if (!query.deleted) {
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];
        }

        const log: $TSFixMe = await lighthouseLogCollection.findOne(query);

        return log;
    },

    async sendLighthouseLog(data: $TSFixMe): void {
        const monitor: $TSFixMe = await MonitorService.findOneBy({
            query: { _id: ObjectId(data.monitorId) },
        });

        if (monitor && monitor.projectId) {
            const project: $TSFixMe = await ProjectService.findOneBy({
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
                `${realtimeBaseUrl}/update-lighthouse-log`,
                {
                    data,
                    projectId: monitor.projectId._id || monitor.projectId,
                    monitorId: data.monitorId,
                    parentProjectId,
                },
                true
            ).catch((error: $TSFixMe) => {
                ErrorService.log(
                    'lighthouseLogService.sendLighthouseLog',
                    error
                );
            });
        }
    },

    updateManyBy: async function (query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        await lighthouseLogCollection.updateMany(query, {
            $set: data,
        });
        // Fetch updated items
        const lighthouseLog: $TSFixMe = await lighthouseLogCollection
            .find(query)
            .toArray();

        return lighthouseLog;
    },

    async updateAllLighthouseLogs(monitorId: $TSFixMe, query: Query): void {
        await this.updateManyBy({ monitorId: monitorId }, query);
    },
};

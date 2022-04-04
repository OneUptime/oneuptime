const lighthouseLogCollection = global.db.collection('lighthouselogs');
import probeService from './probeService';
import ErrorService from './errorService';
import { ObjectId } from 'mongodb';
import MonitorService from './monitorService';
import Query from 'common-server/types/db/Query';
import { post } from '../utils/api';
import moment from 'moment';

import { realtimeUrl } from '../utils/config';
import ProjectService from './projectService';

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

export default {
    create: async function (data: $TSFixMe) {
        const result = await lighthouseLogCollection.insertOne({
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
        const savedLog = await this.findOneBy({
            _id: ObjectId(result.insertedId),
        });

        await this.sendLighthouseLog(savedLog);

        if (data.probeId && data.monitorId) {
            await probeService.sendProbe(data.probeId, data.monitorId);
        }

        return savedLog;
    },

    findOneBy: async function (query: Query) {
        if (!query) {
            query = {};
        }

        if (!query.deleted)
            query.$or = [{ deleted: false }, { deleted: { $exists: false } }];

        const log = await lighthouseLogCollection.findOne(query);

        return log;
    },

    async sendLighthouseLog(data: $TSFixMe) {
        const monitor = await MonitorService.findOneBy({
            query: { _id: ObjectId(data.monitorId) },
        });

        if (monitor && monitor.projectId) {
            const project = await ProjectService.findOneBy({
                query: {
                    _id: ObjectId(monitor.projectId._id || monitor.projectId),
                },
            });
            const parentProjectId = project
                ? project.parentProjectId
                    ? project.parentProjectId._id || project.parentProjectId
                    : project._id
                : monitor.projectId._id || monitor.projectId;

            // realtime update
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

    updateManyBy: async function (query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        await lighthouseLogCollection.updateMany(query, {
            $set: data,
        });
        // fetch updated items
        const lighthouseLog = await lighthouseLogCollection
            .find(query)
            .toArray();

        return lighthouseLog;
    },

    async updateAllLighthouseLogs(monitorId: $TSFixMe, query: Query) {
        await this.updateManyBy({ monitorId: monitorId }, query);
    },
};

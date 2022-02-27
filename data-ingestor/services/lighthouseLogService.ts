// @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
const lighthouseLogCollection = global.db.collection('lighthouselogs');
import probeService from './probeService';
import ErrorService from './errorService';
import { ObjectId } from 'mongodb';
import MonitorService from './monitorService';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/api"' has no exported member 'po... Remove this comment to see the full error message
import { postApi } from '../utils/api';
import moment from 'moment';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../utils/config"' has no exported member ... Remove this comment to see the full error message
import { realtimeUrl } from '../utils/config';
import ProjectService from './projectService';

const realtimeBaseUrl = `${realtimeUrl}/realtime`;

export default {
    create: async function(data: $TSFixMe) {
        try {
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
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                _id: ObjectId(result.insertedId),
            });

            await this.sendLighthouseLog(savedLog);

            if (data.probeId && data.monitorId) {
                // @ts-expect-error ts-migrate(2339) FIXME: Property 'sendProbe' does not exist on type '{ cre... Remove this comment to see the full error message
                await probeService.sendProbe(data.probeId, data.monitorId);
            }

            return savedLog;
        } catch (error) {
            ErrorService.log('lighthouseLogService.create', error);
            throw error;
        }
    },

    findOneBy: async function(query: $TSFixMe) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted)
                query.$or = [
                    { deleted: false },
                    { deleted: { $exists: false } },
                ];

            const log = await lighthouseLogCollection.findOne(query);

            return log;
        } catch (error) {
            ErrorService.log('lighthouseLogService.findOneBy', error);
            throw error;
        }
    },

    async sendLighthouseLog(data: $TSFixMe) {
        try {
            const monitor = await MonitorService.findOneBy({
                // @ts-expect-error ts-migrate(2348) FIXME: Value of type 'typeof ObjectId' is not callable. D... Remove this comment to see the full error message
                query: { _id: ObjectId(data.monitorId) },
            });

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
        } catch (error) {
            ErrorService.log('lighthouseLogService.sendLighthouseLog', error);
            throw error;
        }
    },

    updateManyBy: async function(query: $TSFixMe, data: $TSFixMe) {
        try {
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
        } catch (error) {
            ErrorService.log('lighthouseLogService.updateManyBy', error);
            throw error;
        }
    },

    async updateAllLighthouseLogs(monitorId: $TSFixMe, query: $TSFixMe) {
        try {
            await this.updateManyBy({ monitorId: monitorId }, query);
        } catch (error) {
            ErrorService.log(
                'lighthouseLogService.updateAllLighthouseLog',
                error
            );
            throw error;
        }
    },
};

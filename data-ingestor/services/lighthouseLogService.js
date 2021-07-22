const lighthouseLogCollection = global.db.collection('lighthouselogs');
const probeService = require('./probeService');
const ErrorService = require('./errorService');
const { ObjectId } = require('mongodb');
const MonitorService = require('./monitorService');
const { postApi } = require('../utils/api');
const moment = require('moment');

module.exports = {
    create: async function(data) {
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
            const savedLog = await lighthouseLogCollection.findOne({
                _id: ObjectId(result.insertedId),
            });

            await this.sendLighthouseLog(savedLog);

            if (data.probeId && data.monitorId) {
                await probeService.sendProbe(data.probeId, data.monitorId);
            }

            return savedLog;
        } catch (error) {
            ErrorService.log('lighthouseLogService.create', error);
            throw error;
        }
    },

    async sendLighthouseLog(data) {
        try {
            const monitor = await MonitorService.findOneBy({
                query: { _id: ObjectId(data.monitorId) },
                // select: 'projectId',
                // populate: [{ path: 'projectId', select: '_id' }],
            });
            // if (monitor && monitor.projectId && monitor.projectId._id) {
            //     // run in the background
            //     // RealTimeService.updateLighthouseLog(
            //     //     data,
            //     //     monitor.projectId._id
            //     // );
            // }
            if (monitor && monitor.projectId) {
                postApi(
                    'api/lighthouse/data-ingestor/realtime/update-lighthouse-log',
                    {
                        data,
                        projectId: monitor.projectId._id || monitor.projectId,
                    }
                );
            }
        } catch (error) {
            ErrorService.log('lighthouseLogService.sendLighthouseLog', error);
            throw error;
        }
    },

    updateManyBy: async function(query, data) {
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

    async updateAllLighthouseLogs(monitorId, query) {
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

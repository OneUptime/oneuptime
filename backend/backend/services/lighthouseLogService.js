module.exports = {
    create: async function(data) {
        try {
            const Log = new LighthouseLogModel();

            Log.monitorId = data.monitorId;
            Log.probeId = data.probeId;
            Log.data = data.lighthouseData.issues;
            Log.url = data.lighthouseData.url;
            Log.performance = data.performance;
            Log.accessibility = data.accessibility;
            Log.bestPractices = data.bestPractices;
            Log.seo = data.seo;
            Log.pwa = data.pwa;

            const savedLog = await Log.save();

            await this.sendLighthouseLog(savedLog);

            if (data.probeId && data.monitorId)
                await probeService.sendProbe(data.probeId, data.monitorId);

            return savedLog;
        } catch (error) {
            ErrorService.log('lighthouseLogService.create', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            const lighthouseLog = await LighthouseLogModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            return lighthouseLog;
        } catch (error) {
            ErrorService.log('lighthouseLogService.updateOneBy', error);
            throw error;
        }
    },

    async findBy(query, limit, skip) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') {
                skip = parseInt(skip);
            }

            if (typeof limit === 'string') {
                limit = parseInt(limit);
            }

            if (!query) {
                query = {};
            }

            const lighthouseLogs = await LighthouseLogModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip)
                .populate('probeId');

            return lighthouseLogs;
        } catch (error) {
            ErrorService.log('lighthouseLogService.findBy', error);
            throw error;
        }
    },

    async findOneBy(query) {
        try {
            if (!query) {
                query = {};
            }

            const lighthouseLog = await LighthouseLogModel.findOne(
                query
            ).populate('probeId');

            return lighthouseLog;
        } catch (error) {
            ErrorService.log('lighthouseLogService.findOneBy', error);
            throw error;
        }
    },

    async countBy(query) {
        try {
            if (!query) {
                query = {};
            }

            const count = await LighthouseLogModel.countDocuments(query);

            return count;
        } catch (error) {
            ErrorService.log('lighthouseLogService.countBy', error);
            throw error;
        }
    },

    async sendLighthouseLog(data) {
        try {
            const monitor = await MonitorService.findOneBy({
                _id: data.monitorId,
            });
            if (monitor && monitor.projectId && monitor.projectId._id) {
                await RealTimeService.updateLighthouseLog(
                    data,
                    monitor.projectId._id
                );
            }
        } catch (error) {
            ErrorService.log('lighthouseLogService.sendLighthouseLog', error);
            throw error;
        }
    },
};

const LighthouseLogModel = require('../models/lighthouseLog');
const MonitorService = require('./monitorService');
const RealTimeService = require('./realTimeService');
const probeService = require('./probeService');
const ErrorService = require('./errorService');

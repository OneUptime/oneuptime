export default {
    create: async function (data: $TSFixMe) {
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

        Log.scanning = data.scanning;

        const savedLog = await Log.save();

        await this.sendLighthouseLog(savedLog);

        if (data.probeId && data.monitorId)
            await probeService.sendProbe(data.probeId, data.monitorId);

        return savedLog;
    },

    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
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
    },
    updateManyBy: async function (query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const lighthouseLog = await LighthouseLogModel.updateMany(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        return lighthouseLog;
    },

    async findBy({ query, limit, skip, select, populate }: $TSFixMe) {
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

        let lighthouseLogsQuery = LighthouseLogModel.find(query)
            .lean()
            .sort([['createdAt', -1]])
            .limit(limit)
            .skip(skip);

        lighthouseLogsQuery = handleSelect(select, lighthouseLogsQuery);
        lighthouseLogsQuery = handlePopulate(populate, lighthouseLogsQuery);

        const lighthouseLogs = await lighthouseLogsQuery;

        return lighthouseLogs;
    },

    async findOneBy({ query, populate, select }: $TSFixMe) {
        if (!query) {
            query = {};
        }

        let lighthouseLogQuery = LighthouseLogModel.findOne(query)
            .lean()
            .populate('probeId');

        lighthouseLogQuery = handleSelect(select, lighthouseLogQuery);
        lighthouseLogQuery = handlePopulate(populate, lighthouseLogQuery);

        const lighthouseLog = await lighthouseLogQuery;

        return lighthouseLog;
    },

    async findLastestScan({ monitorId, url, skip, limit }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        let lighthouseLogs: $TSFixMe = [];
        let siteUrls;

        const monitor = await MonitorService.findOneBy({
            query: { _id: monitorId },
            select: 'siteUrls',
        });

        const selectLighthouseLogs =
            'monitorId probeId data url performance accessibility bestPractices seo pwa createdAt scanning';

        const populateLighthouseLogs = [
            {
                path: 'probeId',
                select: 'probeName probeKey version lastAlive deleted probeImage',
            },
        ];
        if (url) {
            if (monitor && monitor.siteUrls && monitor.siteUrls.includes(url)) {
                siteUrls = [url];

                let log = await this.findBy({
                    query: { monitorId, url },
                    limit: 1,
                    skip: 0,
                    select: selectLighthouseLogs,
                    populate: populateLighthouseLogs,
                });
                if (!log || (log && log.length === 0)) {
                    log = [{ url }];
                }
                lighthouseLogs = log;
            }
        } else {
            siteUrls = monitor ? monitor.siteUrls || [] : [];
            if (siteUrls.length > 0) {
                for (const url of siteUrls.slice(
                    skip,
                    limit < siteUrls.length - skip ? limit : siteUrls.length
                )) {
                    let log = await this.findBy({
                        query: { monitorId, url },
                        limit: 1,
                        skip: 0,
                        select: selectLighthouseLogs,
                        populate: populateLighthouseLogs,
                    });
                    if (!log || (log && log.length === 0)) {
                        log = [{ url }];
                    }
                    lighthouseLogs = [...lighthouseLogs, ...log];
                }
            }
        }

        return {
            lighthouseLogs,
            count: siteUrls && siteUrls.length ? siteUrls.length : 0,
        };
    },

    async countBy(query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        const count = await LighthouseLogModel.countDocuments(query);

        return count;
    },

    async sendLighthouseLog(data: $TSFixMe) {
        const monitor = await MonitorService.findOneBy({
            query: { _id: data.monitorId },
            select: 'projectId',
            populate: [{ path: 'projectId', select: '_id' }],
        });
        if (monitor && monitor.projectId && monitor.projectId._id) {
            // run in the background
            RealTimeService.updateLighthouseLog(data, monitor.projectId._id);
        }
    },
    async updateAllLighthouseLogs(
        projectId: $TSFixMe,
        monitorId: $TSFixMe,
        query: $TSFixMe
    ) {
        await this.updateManyBy({ monitorId: monitorId }, query);
        const logs = await this.findLastestScan({
            monitorId,
            url: null,
            limit: 5,
            skip: 0,
        });
        RealTimeService.updateAllLighthouseLog(projectId, {
            monitorId,
            logs,
        });
    },
};

import LighthouseLogModel from '../models/lighthouseLog';
import MonitorService from './monitorService';
import RealTimeService from './realTimeService';
import probeService from './probeService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

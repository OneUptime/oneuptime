export default {
    create: async function(data: $TSFixMe) {
        const Log = new LighthouseLogModel();

        // @ts-expect-error ts-migrate(2339) FIXME: Property 'monitorId' does not exist on type 'Docum... Remove this comment to see the full error message
        Log.monitorId = data.monitorId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'probeId' does not exist on type 'Documen... Remove this comment to see the full error message
        Log.probeId = data.probeId;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'data' does not exist on type 'Document<a... Remove this comment to see the full error message
        Log.data = data.lighthouseData.issues;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'url' does not exist on type 'Document<an... Remove this comment to see the full error message
        Log.url = data.lighthouseData.url;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'performance' does not exist on type 'Doc... Remove this comment to see the full error message
        Log.performance = data.performance;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accessibility' does not exist on type 'D... Remove this comment to see the full error message
        Log.accessibility = data.accessibility;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'bestPractices' does not exist on type 'D... Remove this comment to see the full error message
        Log.bestPractices = data.bestPractices;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'seo' does not exist on type 'Document<an... Remove this comment to see the full error message
        Log.seo = data.seo;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'pwa' does not exist on type 'Document<an... Remove this comment to see the full error message
        Log.pwa = data.pwa;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'scanning' does not exist on type 'Docume... Remove this comment to see the full error message
        Log.scanning = data.scanning;

        const savedLog = await Log.save();

        await this.sendLighthouseLog(savedLog);

        if (data.probeId && data.monitorId)
            await probeService.sendProbe(data.probeId, data.monitorId);

        return savedLog;
    },

    updateOneBy: async function(query: $TSFixMe, data: $TSFixMe) {
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
    updateManyBy: async function(query: $TSFixMe, data: $TSFixMe) {
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

    async findBy({
        query,
        limit,
        skip,
        select,
        populate
    }: $TSFixMe) {
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

    async findOneBy({
        query,
        populate,
        select
    }: $TSFixMe) {
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

    async findLastestScan({
        monitorId,
        url,
        skip,
        limit
    }: $TSFixMe) {
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
                select:
                    'probeName probeKey version lastAlive deleted probeImage',
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
    async updateAllLighthouseLogs(projectId: $TSFixMe, monitorId: $TSFixMe, query: $TSFixMe) {
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

import LighthouseLogModel from '../models/lighthouseLog'
import MonitorService from './monitorService'
import RealTimeService from './realTimeService'
import probeService from './probeService'
import handleSelect from '../utils/select'
import handlePopulate from '../utils/populate'

export default class Service {
    public async create(data: $TSFixMe): void {
        const Log: $TSFixMe = new LighthouseLogModel();

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

        const savedLog: $TSFixMe = await Log.save();

        await this.sendLighthouseLog(savedLog);

        if (data.probeId && data.monitorId) {
            await probeService.sendProbe(data.probeId, data.monitorId);
        }

        return savedLog;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        const lighthouseLog: $TSFixMe =
            await LighthouseLogModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

        return lighthouseLog;
    }

    public async updateManyBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }

        const lighthouseLog: $TSFixMe = await LighthouseLogModel.updateMany(
            query,
            { $set: data },
            {
                new: true,
            }
        );

        return lighthouseLog;
    }

    public async findBy({
        query,
        limit,
        skip,
        select,
        populate,
        sort,
    }: FindBy): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        if (!query) {
            query = {};
        }

        const lighthouseLogsQuery: $TSFixMe = LighthouseLogModel.find(query)
            .lean()
            .sort(sort)
            .limit(limit.toNumber())
            .skip(skip.toNumber());

        lighthouseLogsQuery.select(select);
        lighthouseLogsQuery.populate(populate);

        const lighthouseLogs: $TSFixMe = await lighthouseLogsQuery;

        return lighthouseLogs;
    }

    public async findOneBy({ query, populate, select, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }

        const lighthouseLogQuery: $TSFixMe = LighthouseLogModel.findOne(query)
            .sort(sort)
            .lean()
            .populate('probeId');

        lighthouseLogQuery.select(select);
        lighthouseLogQuery.populate(populate);

        const lighthouseLog: $TSFixMe = await lighthouseLogQuery;

        return lighthouseLog;
    }

    public async findLastestScan({
        monitorId,
        url,
        skip,
        limit,
    }: $TSFixMe): void {
        if (!skip) {
            skip = 0;
        }

        if (!limit) {
            limit = 0;
        }

        if (typeof skip === 'string') {
            skip = parseInt(skip);
        }

        if (typeof limit === 'string') {
            limit = parseInt(limit);
        }

        let lighthouseLogs: $TSFixMe = [];
        let siteUrls: $TSFixMe;

        const monitor: $TSFixMe = await MonitorService.findOneBy({
            query: { _id: monitorId },
            select: 'siteUrls',
        });

        const selectLighthouseLogs: $TSFixMe =
            'monitorId probeId data url performance accessibility bestPractices seo pwa createdAt scanning';

        const populateLighthouseLogs: $TSFixMe = [
            {
                path: 'probeId',
                select: 'probeName probeKey version lastAlive deleted probeImage',
            },
        ];
        if (url) {
            if (monitor && monitor.siteUrls && monitor.siteUrls.includes(url)) {
                siteUrls = [url];

                let log: $TSFixMe = await this.findBy({
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
                    let log: $TSFixMe = await this.findBy({
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
    }

    public async countBy(query: Query): void {
        if (!query) {
            query = {};
        }

        const count: $TSFixMe = await LighthouseLogModel.countDocuments(query);

        return count;
    }

    public async sendLighthouseLog(data: $TSFixMe): void {
        const monitor: $TSFixMe = await MonitorService.findOneBy({
            query: { _id: data.monitorId },
            select: 'projectId',
            populate: [{ path: 'projectId', select: '_id' }],
        });
        if (monitor && monitor.projectId && monitor.projectId._id) {
            // Run in the background
            RealTimeService.updateLighthouseLog(data, monitor.projectId._id);
        }
    }
    public async updateAllLighthouseLogs(
        projectId: ObjectID,
        monitorId: $TSFixMe,
        query: Query
    ): void {
        await this.updateManyBy({ monitorId: monitorId }, query);
        const logs: $TSFixMe = await this.findLastestScan({
            monitorId,
            url: null,
            limit: 5,
            skip: 0,
        });
        RealTimeService.updateAllLighthouseLog(projectId, {
            monitorId,
            logs,
        });
    }
}

import LighthouseLogModel from '../Models/lighthouseLog';
import ObjectID from 'Common/Types/ObjectID';
import MonitorService from './MonitorService.ts.temp';
import RealTimeService from './realTimeService';
import probeService from './ProbeService.ts.temp';

import FindOneBy from '../Types/DB/FindOneBy';
import FindBy from '../Types/DB/FindBy';
import Query from '../Types/DB/Query';

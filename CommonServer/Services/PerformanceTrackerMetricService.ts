import PerformanceTrackerMetricModel from '../Models/performanceTrackerMetric';
import moment from 'moment';
import RealTimeService from './realTimeService';

import FindOneBy from '../Types/DB/FindOneBy';
import Query from '../Types/DB/Query';

export default class Service {
    public async create(data: $TSFixMe): void {
        const performanceTrackerMetric: $TSFixMe =
            await PerformanceTrackerMetricModel.create(data);
        return performanceTrackerMetric;
    }

    public async createMany(allData: $TSFixMe): void {
        const allMetrics: $TSFixMe =
            await PerformanceTrackerMetricModel.insertMany(allData);
        return allMetrics;
    }
    //Description: Gets all performance metrics by component.
    public async findBy({
        query,
        limit,
        skip,
        sortCriteria = 'createdAt',
        sort = -1,
        select,
        populate,
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

        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const performanceTrackerMetricQuery: $TSFixMe =
            PerformanceTrackerMetricModel.find(query)
                .lean()
                .sort([[sortCriteria, sort]])
                .limit(limit.toNumber())
                .skip(skip.toNumber());
        performanceTrackerMetricQuery.select(select);
        performanceTrackerMetricQuery.populate(populate);

        const performanceTrackerMetrics: $TSFixMe =
            await performanceTrackerMetricQuery;
        return performanceTrackerMetrics;
    }

    public async mergeMetrics({
        query,

        // limit,
        // skip,
        sortCriteria = 'createdAt',

        sort = -1,
        select,
        populate,
    }: $TSFixMe): string {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const performanceTrackerMetricQuery: $TSFixMe =
            PerformanceTrackerMetricModel.find(query)
                .lean()
                .sort([[sortCriteria, sort]]);
        performanceTrackerMetricQuery.select(select);
        performanceTrackerMetricQuery.populate(populate);

        const performanceTrackerMetrics: $TSFixMe =
            await performanceTrackerMetricQuery;

        // restructure performance metrics
        // same path and method should be merged together
        const ptm: $TSFixMe = {};
        for (const metric of performanceTrackerMetrics) {
            const key: string = `${metric.callIdentifier}__${metric.method}`;
            if (!(key in ptm)) {
                ptm[key] = [metric];
            } else {
                ptm[key] = ptm[key].concat(metric);
            }
        }

        const trackerMetrics: $TSFixMe = [];
        for (const [, value] of Object.entries(ptm)) {
            const valueLength: $TSFixMe = value.length;
            if (valueLength > 0) {
                const {
                    type,
                    callIdentifier,
                    performanceTrackerId,
                    method,
                }: $TSFixMe = value[0];
                const result: $TSFixMe = {
                    type,
                    callIdentifier,
                    performanceTrackerId,
                    method,
                };

                let avgTime: $TSFixMe = 0,
                    maxTime: $TSFixMe = 0,
                    throughput: $TSFixMe = 0,
                    errorCount: $TSFixMe = 0;

                value.forEach((eachValue: $TSFixMe) => {
                    avgTime += eachValue.metrics.avgTime;
                    maxTime += eachValue.metrics.maxTime;
                    throughput += eachValue.metrics.throughput;
                    errorCount += eachValue.metrics.errorCount;
                });

                avgTime = numDecimal(avgTime / valueLength);

                maxTime = numDecimal(maxTime / valueLength);

                throughput = numDecimal(throughput / valueLength, 0);

                errorCount = numDecimal(errorCount / valueLength, 0);

                result.metrics = {
                    avgTime,
                    maxTime,
                    throughput,
                    errorCount,
                };
                trackerMetrics.push(result);
            }
        }

        return trackerMetrics;
    }

    public async findOneBy({ query, select, populate, sort }: FindOneBy): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const performanceTrackerMetricQuery: $TSFixMe =
            PerformanceTrackerMetricModel.findOne(query).sort(sort).lean();
        performanceTrackerMetricQuery.select(select);
        performanceTrackerMetricQuery.populate(populate);

        const performanceTrackerMetric: $TSFixMe =
            await performanceTrackerMetricQuery;
        return performanceTrackerMetric;
    }

    public async deleteBy(query: Query): void {
        if (!query) {
            query = {};
        }
        query['deleted'] = false;

        const performanceTrackerMetric: $TSFixMe =
            await PerformanceTrackerMetricModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedAt: Date.now(),
                    },
                },
                { new: true }
            );

        return performanceTrackerMetric;
    }

    public async updateOneBy(query: Query, data: $TSFixMe): void {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) {
            query['deleted'] = false;
        }

        const performanceTrackerMetric: $TSFixMe =
            await PerformanceTrackerMetricModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

        return performanceTrackerMetric;
    }

    public async createMetricsData(
        appId: $TSFixMe,
        type: $TSFixMe,
        data: $TSFixMe,
        receivedAt: $TSFixMe
    ): string {
        receivedAt = moment(receivedAt).format();
        // handle incoming/outgoing request
        const allData: $TSFixMe = [];
        for (const [key, value] of Object.entries(data)) {
            allData.push({
                type,
                callIdentifier: key,
                performanceTrackerId: appId,

                method: value.method,
                metrics: {
                    avgTime: value.avgTime,

                    maxTime: value.maxTime,

                    throughput: value.requests,

                    errorCount: value.errorCount,
                },
                createdAt: receivedAt,
            });
        }
        await this.createMany(allData);

        // fetch the stored data in that time frame
        // get the total avg time, and probably the total avg max time
        // send realtime update to frontend and store
        const [time, count, error]: $TSFixMe = await Promise.all([
            this.structureMetricsTime(appId, receivedAt, receivedAt),
            this.structureMetricsCount(appId, receivedAt, receivedAt),
            this.structureMetricsError(appId, receivedAt, receivedAt),
        ]);
        // send realtime update to frontend
        // handle this in the background, so we don't delay api calls
        RealTimeService.sendTimeMetrics(appId, time);
        RealTimeService.sendThroughputMetrics(appId, count);
        RealTimeService.sendErrorMetrics(appId, error);
    }

    public async structureMetricsTime(
        appId: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe
    ): void {
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();

        const select: string = 'metrics createdAt';
        // store the metrics according to createdAt
        // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
        const dataBank: $TSFixMe = {};
        const timeMetrics: $TSFixMe = await this.findBy({
            query: {
                performanceTrackerId: appId,
                createdAt: { $gte: startDate, $lte: endDate },
            },
            limit: 0,
            skip: 0,
            sortCriteria: null,
            sort: 1,
            select,
        });
        timeMetrics.forEach((metric: $TSFixMe) => {
            const date: $TSFixMe = moment(metric.createdAt).format();
            if (!(date in dataBank)) {
                dataBank[date] = [metric];
            } else {
                dataBank[date] = dataBank[date].concat(metric);
            }
        });

        // finally calculate the avg per data per time
        // finalOutput should have the structure:
        // [{createdAt: '2021-04-21T17:15:00+01:00', avgTime: 2134.34, avgMaxTime: 5674.11}]
        const finalOutput: $TSFixMe = [];
        for (const [key, value] of Object.entries(dataBank)) {
            const result: $TSFixMe = { createdAt: key };
            const { avgTime, avgMaxTime }: $TSFixMe = calcAvgTime(value);

            result.avgTime = avgTime;

            result.avgMaxTime = avgMaxTime;

            result.value = avgTime;
            finalOutput.push(result);
        }

        // send result back to api
        return finalOutput;
    }

    // setup the throughput data for frontend
    public async structureMetricsCount(
        appId: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe
    ): void {
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();
        // store the metrics according to createdAt
        // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
        const dataBank: $TSFixMe = {};
        const select: string = 'createdAt metrics';
        const timeMetrics: $TSFixMe = await this.findBy({
            query: {
                performanceTrackerId: appId,
                createdAt: { $gte: startDate, $lte: endDate },
            },
            limit: 0,
            skip: 0,
            sortCriteria: null,
            sort: 1,
            select,
        });

        timeMetrics.forEach((metric: $TSFixMe) => {
            const date: $TSFixMe = moment(metric.createdAt).format();
            if (!(date in dataBank)) {
                dataBank[date] = [metric];
            } else {
                dataBank[date] = dataBank[date].concat(metric);
            }
        });

        // finally calculate the avg per data per time
        // finalOutput should have the structure:
        // [{createdAt: '2021-04-21T17:15:00+01:00', avgThroughput: 20}]
        const finalOutput: $TSFixMe = [];
        for (const [key, value] of Object.entries(dataBank)) {
            const result: $TSFixMe = { createdAt: key };
            const { avgThroughput }: $TSFixMe = calcAvgThroughput(value);

            result.avgThroughput = avgThroughput;

            result.value = avgThroughput;
            finalOutput.push(result);
        }

        // send result back to api
        return finalOutput;
    }

    public async structureMetricsError(
        appId: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe
    ): void {
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();
        // store the metrics according to createdAt
        // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
        const dataBank: $TSFixMe = {};
        const select: string = 'createdAt metrics';
        const timeMetrics: $TSFixMe = await this.findBy({
            query: {
                performanceTrackerId: appId,
                createdAt: { $gte: startDate, $lte: endDate },
            },
            limit: 0,
            skip: 0,
            sortCriteria: null,
            sort: 1,
            select,
        });

        timeMetrics.forEach((metric: $TSFixMe) => {
            const date: $TSFixMe = moment(metric.createdAt).format();
            if (!(date in dataBank)) {
                dataBank[date] = [metric];
            } else {
                dataBank[date] = dataBank[date].concat(metric);
            }
        });

        // finally calculate the avg per data per time
        // finalOutput should have the structure:
        // [{createdAt: '2021-04-21T17:15:00+01:00', errorCount: 20, value: errorCount}]
        const finalOutput: $TSFixMe = [];
        for (const [key, value] of Object.entries(dataBank)) {
            const result: $TSFixMe = { createdAt: key };
            const { avgErrorCount }: $TSFixMe = calcAvgError(value);

            result.avgErrorCount = avgErrorCount;

            result.value = avgErrorCount;
            finalOutput.push(result);
        }

        // send result back to api
        return finalOutput;
    }
}

function calcAvgTime(metric: $TSFixMe): void {
    const length: $TSFixMe = metric.length;

    let avgTimeCount: $TSFixMe = 0,
        avgMaxTimeCount: $TSFixMe = 0;
    metric.forEach((data: $TSFixMe) => {
        avgTimeCount += data.metrics.avgTime;
        avgMaxTimeCount += data.metrics.maxTime;
    });

    return {
        avgTime: numDecimal(avgTimeCount / length),
        avgMaxTime: numDecimal(avgMaxTimeCount / length),
    };
}

function calcAvgThroughput(metric: $TSFixMe): void {
    const length: $TSFixMe = metric.length;

    let sum: $TSFixMe = 0;
    metric.forEach((data: $TSFixMe) => {
        sum += data.metrics.throughput;
    });

    return {
        avgThroughput: numDecimal(sum / length, 0), // we rounded off value here
    };
}

function calcAvgError(metric: $TSFixMe): void {
    const length: $TSFixMe = metric.length;

    let cumulative: $TSFixMe = 0;
    metric.forEach((data: $TSFixMe) => {
        cumulative += data.metrics.errorCount;
    });

    return {
        avgErrorCount: numDecimal(cumulative / length, 0), // round-off the value
    };
}

function numDecimal(num: $TSFixMe, decimalPlace = 2): void {
    decimalPlace = Number(decimalPlace);
    return Number.parseFloat(num).toFixed(decimalPlace);
}

import PerformanceTrackerMetricModel from '../models/performanceTrackerMetric';
import moment from 'moment';
import RealTimeService from './realTimeService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';

export default {
    create: async function (data: $TSFixMe) {
        const performanceTrackerMetric =
            await PerformanceTrackerMetricModel.create(data);
        return performanceTrackerMetric;
    },
    createMany: async function (allData: $TSFixMe) {
        const allMetrics = await PerformanceTrackerMetricModel.insertMany(
            allData
        );
        return allMetrics;
    },
    //Description: Gets all performance metrics by component.
    findBy: async function ({
        query,
        limit,
        skip,
        sortCriteria = 'createdAt',
        sort = -1,
        select,
        populate,
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
        if (!query.deleted) query.deleted = false;

        let performanceTrackerMetricQuery = PerformanceTrackerMetricModel.find(
            query
        )
            .lean()
            .sort([[sortCriteria, sort]])
            .limit(limit)
            .skip(skip);
        performanceTrackerMetricQuery = handleSelect(
            select,
            performanceTrackerMetricQuery
        );
        performanceTrackerMetricQuery = handlePopulate(
            populate,
            performanceTrackerMetricQuery
        );

        const performanceTrackerMetrics = await performanceTrackerMetricQuery;
        return performanceTrackerMetrics;
    },

    mergeMetrics: async function ({
        query,

        // limit,
        // skip,
        sortCriteria = 'createdAt',

        sort = -1,
        select,
        populate,
    }: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        let performanceTrackerMetricQuery = PerformanceTrackerMetricModel.find(
            query
        )
            .lean()
            .sort([[sortCriteria, sort]]);
        performanceTrackerMetricQuery = handleSelect(
            select,
            performanceTrackerMetricQuery
        );
        performanceTrackerMetricQuery = handlePopulate(
            populate,
            performanceTrackerMetricQuery
        );

        const performanceTrackerMetrics = await performanceTrackerMetricQuery;

        // restructure performance metrics
        // same path and method should be merged together
        const ptm = {};
        for (const metric of performanceTrackerMetrics) {
            const key = `${metric.callIdentifier}__${metric.method}`;
            if (!(key in ptm)) {
                ptm[key] = [metric];
            } else {
                ptm[key] = ptm[key].concat(metric);
            }
        }

        const trackerMetrics = [];
        for (const [, value] of Object.entries(ptm)) {
            const valueLength = value.length;
            if (valueLength > 0) {
                const { type, callIdentifier, performanceTrackerId, method } =
                    value[0];
                const result = {
                    type,
                    callIdentifier,
                    performanceTrackerId,
                    method,
                };

                let avgTime = 0,
                    maxTime = 0,
                    throughput = 0,
                    errorCount = 0;

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
    },

    findOneBy: async function ({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        let performanceTrackerMetricQuery =
            PerformanceTrackerMetricModel.findOne(query).lean();
        performanceTrackerMetricQuery = handleSelect(
            select,
            performanceTrackerMetricQuery
        );
        performanceTrackerMetricQuery = handlePopulate(
            populate,
            performanceTrackerMetricQuery
        );

        const performanceTrackerMetric = await performanceTrackerMetricQuery;
        return performanceTrackerMetric;
    },

    deleteBy: async function (query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        query.deleted = false;

        const performanceTrackerMetric =
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
    },

    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        const performanceTrackerMetric =
            await PerformanceTrackerMetricModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

        return performanceTrackerMetric;
    },

    hardDeleteBy: async function (query: $TSFixMe) {
        await PerformanceTrackerMetricModel.deleteMany(query);
        return 'Performance tracker metric(s) removed successfully!';
    },

    countBy: async function (query: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;

        const count = await PerformanceTrackerMetricModel.countDocuments(query);
        return count;
    },

    createMetricsData: async function (
        appId: $TSFixMe,
        type: $TSFixMe,
        data: $TSFixMe,
        receivedAt: $TSFixMe
    ) {
        const _this = this;
        receivedAt = moment(receivedAt).format();
        // handle incoming/outgoing request
        const allData = [];
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
        await _this.createMany(allData);

        // fetch the stored data in that time frame
        // get the total avg time, and probably the total avg max time
        // send realtime update to frontend and store
        const [time, count, error] = await Promise.all([
            _this.structureMetricsTime(appId, receivedAt, receivedAt),
            _this.structureMetricsCount(appId, receivedAt, receivedAt),
            _this.structureMetricsError(appId, receivedAt, receivedAt),
        ]);
        // send realtime update to frontend
        // handle this in the background, so we don't delay api calls
        RealTimeService.sendTimeMetrics(appId, time);
        RealTimeService.sendThroughputMetrics(appId, count);
        RealTimeService.sendErrorMetrics(appId, error);
    },

    structureMetricsTime: async function (
        appId: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe
    ) {
        const _this = this;
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();

        const select = 'metrics createdAt';
        // store the metrics according to createdAt
        // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
        const dataBank = {};
        const timeMetrics = await _this.findBy({
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
            const date = moment(metric.createdAt).format();
            if (!(date in dataBank)) {
                dataBank[date] = [metric];
            } else {
                dataBank[date] = dataBank[date].concat(metric);
            }
        });

        // finally calculate the avg per data per time
        // finalOutput should have the structure:
        // [{createdAt: '2021-04-21T17:15:00+01:00', avgTime: 2134.34, avgMaxTime: 5674.11}]
        const finalOutput = [];
        for (const [key, value] of Object.entries(dataBank)) {
            const result = { createdAt: key };
            const { avgTime, avgMaxTime } = calcAvgTime(value);

            result.avgTime = avgTime;

            result.avgMaxTime = avgMaxTime;

            result.value = avgTime;
            finalOutput.push(result);
        }

        // send result back to api
        return finalOutput;
    },

    // setup the throughput data for frontend
    structureMetricsCount: async function (
        appId: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe
    ) {
        const _this = this;
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();
        // store the metrics according to createdAt
        // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
        const dataBank = {};
        const select = 'createdAt metrics';
        const timeMetrics = await _this.findBy({
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
            const date = moment(metric.createdAt).format();
            if (!(date in dataBank)) {
                dataBank[date] = [metric];
            } else {
                dataBank[date] = dataBank[date].concat(metric);
            }
        });

        // finally calculate the avg per data per time
        // finalOutput should have the structure:
        // [{createdAt: '2021-04-21T17:15:00+01:00', avgThroughput: 20}]
        const finalOutput = [];
        for (const [key, value] of Object.entries(dataBank)) {
            const result = { createdAt: key };
            const { avgThroughput } = calcAvgThroughput(value);

            result.avgThroughput = avgThroughput;

            result.value = avgThroughput;
            finalOutput.push(result);
        }

        // send result back to api
        return finalOutput;
    },

    structureMetricsError: async function (
        appId: $TSFixMe,
        startDate: $TSFixMe,
        endDate: $TSFixMe
    ) {
        const _this = this;
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();
        // store the metrics according to createdAt
        // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
        const dataBank = {};
        const select = 'createdAt metrics';
        const timeMetrics = await _this.findBy({
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
            const date = moment(metric.createdAt).format();
            if (!(date in dataBank)) {
                dataBank[date] = [metric];
            } else {
                dataBank[date] = dataBank[date].concat(metric);
            }
        });

        // finally calculate the avg per data per time
        // finalOutput should have the structure:
        // [{createdAt: '2021-04-21T17:15:00+01:00', errorCount: 20, value: errorCount}]
        const finalOutput = [];
        for (const [key, value] of Object.entries(dataBank)) {
            const result = { createdAt: key };
            const { avgErrorCount } = calcAvgError(value);

            result.avgErrorCount = avgErrorCount;

            result.value = avgErrorCount;
            finalOutput.push(result);
        }

        // send result back to api
        return finalOutput;
    },
};

function calcAvgTime(metric: $TSFixMe) {
    const length = metric.length;

    let avgTimeCount = 0,
        avgMaxTimeCount = 0;
    metric.forEach((data: $TSFixMe) => {
        avgTimeCount += data.metrics.avgTime;
        avgMaxTimeCount += data.metrics.maxTime;
    });

    return {
        avgTime: numDecimal(avgTimeCount / length),
        avgMaxTime: numDecimal(avgMaxTimeCount / length),
    };
}

function calcAvgThroughput(metric: $TSFixMe) {
    const length = metric.length;

    let sum = 0;
    metric.forEach((data: $TSFixMe) => {
        sum += data.metrics.throughput;
    });

    return {
        avgThroughput: numDecimal(sum / length, 0), // we rounded off value here
    };
}

function calcAvgError(metric: $TSFixMe) {
    const length = metric.length;

    let cumulative = 0;
    metric.forEach((data: $TSFixMe) => {
        cumulative += data.metrics.errorCount;
    });

    return {
        avgErrorCount: numDecimal(cumulative / length, 0), // round-off the value
    };
}

function numDecimal(num: $TSFixMe, decimalPlace = 2) {
    decimalPlace = Number(decimalPlace);
    return Number.parseFloat(num).toFixed(decimalPlace);
}

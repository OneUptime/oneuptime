const PerformanceTrackerMetricModel = require('../models/performanceTrackerMetric');
const ErrorService = require('./errorService');
const moment = require('moment');
const RealTimeService = require('./realTimeService');

module.exports = {
    create: async function(data) {
        try {
            const performanceTrackerMetric = await PerformanceTrackerMetricModel.create(
                data
            );
            return performanceTrackerMetric;
        } catch (error) {
            ErrorService.log('performanceTrackerMetricService.create', error);
            throw error;
        }
    },
    //Description: Gets all performance metrics by component.
    findBy: async function(
        query,
        limit,
        skip,
        sortCriteria = 'createdAt',
        sort = -1
    ) {
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
            if (!query.deleted) query.deleted = false;

            const performanceTrackerMetrics = await PerformanceTrackerMetricModel.find(
                query
            )
                .sort([[sortCriteria, sort]])
                .limit(limit)
                .skip(skip)
                .populate({
                    path: 'performanceTrackerId',
                    populate: {
                        path: 'componentId',
                    },
                });
            return performanceTrackerMetrics;
        } catch (error) {
            ErrorService.log('performanceTrackerMetricService.findBy', error);
            throw error;
        }
    },

    mergeMetrics: async function(
        query,
        limit,
        skip,
        sortCriteria = 'createdAt',
        sort = -1
    ) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            const performanceTrackerMetrics = await PerformanceTrackerMetricModel.find(
                query
            )
                .sort([[sortCriteria, sort]])
                .populate({
                    path: 'performanceTrackerId',
                    populate: {
                        path: 'componentId',
                    },
                });

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
                    const {
                        type,
                        callIdentifier,
                        performanceTrackerId,
                        method,
                    } = value[0];
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
                    value.forEach(eachValue => {
                        avgTime += eachValue.metrics.avgTime;
                        maxTime += eachValue.metrics.maxTime;
                        throughput += eachValue.throughput;
                        errorCount += eachValue.errorCount;
                    });

                    avgTime = numDecimal(avgTime / valueLength);
                    maxTime = numDecimal(maxTime / valueLength);
                    throughput = numDecimal(throughput / valueLength, 0);
                    errorCount = numDecimal(errorCount / valueLength, 0);

                    result.throughput = throughput;
                    result.errorCount = errorCount;
                    result.metrics = {
                        avgTime,
                        maxTime,
                    };
                    trackerMetrics.push(result);
                }
            }

            return trackerMetrics;
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.mergeMetrics',
                error
            );
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            const performanceTrackerMetric = await PerformanceTrackerMetricModel.findOne(
                query
            );
            return performanceTrackerMetric;
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.findOneBy',
                error
            );
            throw error;
        }
    },

    deleteBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            query.deleted = false;

            const performanceTrackerMetric = await PerformanceTrackerMetricModel.findOneAndUpdate(
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
        } catch (error) {
            ErrorService.log('performanceTrackerMetricService.deleteBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            const performanceTrackerMetric = await PerformanceTrackerMetricModel.findOneAndUpdate(
                query,
                { $set: data },
                {
                    new: true,
                }
            );

            return performanceTrackerMetric;
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.updateOneBy',
                error
            );
            throw error;
        }
    },

    hardDeleteBy: async function(query) {
        try {
            await PerformanceTrackerMetricModel.deleteMany(query);
            return 'Performance tracker metric(s) removed successfully!';
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.hardDeleteBy',
                error
            );
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;

            const count = await PerformanceTrackerMetricModel.countDocuments(
                query
            );
            return count;
        } catch (error) {
            ErrorService.log('performanceTrackerMetricService.countBy', error);
            throw error;
        }
    },

    createMetricsData: async function(appId, type, data, receivedAt) {
        const _this = this;
        receivedAt = moment(receivedAt).format();
        try {
            // handle incoming/outgoing request
            for (const [key, value] of Object.entries(data)) {
                await _this.create({
                    type,
                    callIdentifier: key,
                    performanceTrackerId: appId,
                    method: value.method,
                    metrics: {
                        avgTime: value.avgTime,
                        maxTime: value.maxTime,
                    },
                    createdAt: receivedAt,
                    throughput: value.requests,
                    errorCount: value.errorCount,
                });
            }

            // fetch the stored data in that time frame
            // get the total avg time, and probably the total avg max time
            // send realtime update to frontend and store
            await Promise.all([
                _this.structureMetricsTime(appId, receivedAt, receivedAt),
                _this.structureMetricsCount(appId, receivedAt, receivedAt),
                _this.structureMetricsError(appId, receivedAt, receivedAt),
            ]);
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.createMetricsData',
                error
            );
            throw error;
        }
    },

    structureMetricsTime: async function(appId, startDate, endDate) {
        const _this = this;
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();
        try {
            // store the metrics according to createdAt
            // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
            const dataBank = {};
            const timeMetrics = await _this.findBy(
                {
                    performanceTrackerId: appId,
                    createdAt: { $gte: startDate, $lte: endDate },
                },
                0,
                0,
                null,
                1
            );
            timeMetrics.forEach(metric => {
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

            // send realtime update to frontend
            // handle this in the backend, so we don't delay api calls
            RealTimeService.sendTimeMetrics(appId, finalOutput);
            // send result back to api
            return finalOutput;
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.structureMetricsTime',
                error
            );
            throw error;
        }
    },

    // setup the throughput data for frontend
    structureMetricsCount: async function(appId, startDate, endDate) {
        const _this = this;
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();
        try {
            // store the metrics according to createdAt
            // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
            const dataBank = {};
            const timeMetrics = await _this.findBy(
                {
                    performanceTrackerId: appId,
                    createdAt: { $gte: startDate, $lte: endDate },
                },
                0,
                0,
                null,
                1
            );

            timeMetrics.forEach(metric => {
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

            // send realtime update to frontend
            // handle this in the backend, so we don't delay api calls
            RealTimeService.sendThroughputMetrics(appId, finalOutput);

            // send result back to api
            return finalOutput;
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.structureMetricsCount',
                error
            );
            throw error;
        }
    },

    structureMetricsError: async function(appId, startDate, endDate) {
        const _this = this;
        startDate = moment(startDate).format();
        endDate = moment(endDate).format();
        try {
            // store the metrics according to createdAt
            // eg {'2021-04-21T17:15:00+01:00': [{ type, metrics, callIdentifier, ... }]}
            const dataBank = {};
            const timeMetrics = await _this.findBy(
                {
                    performanceTrackerId: appId,
                    createdAt: { $gte: startDate, $lte: endDate },
                },
                0,
                0,
                null,
                1
            );

            timeMetrics.forEach(metric => {
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

            // send realtime update to frontend
            // handle this in the backend, so we don't delay api calls
            RealTimeService.sendErrorMetrics(appId, finalOutput);

            // send result back to api
            return finalOutput;
        } catch (error) {
            ErrorService.log(
                'performanceTrackerMetricService.structureMetricsError',
                error
            );
            throw error;
        }
    },
};

function calcAvgTime(metric) {
    const length = metric.length;

    let avgTimeCount = 0,
        avgMaxTimeCount = 0;
    metric.forEach(data => {
        avgTimeCount += data.metrics.avgTime;
        avgMaxTimeCount += data.metrics.maxTime;
    });

    return {
        avgTime: numDecimal(avgTimeCount / length),
        avgMaxTime: numDecimal(avgMaxTimeCount / length),
    };
}

function calcAvgThroughput(metric) {
    const length = metric.length;

    let sum = 0;
    metric.forEach(data => {
        sum += data.throughput;
    });

    return {
        avgThroughput: numDecimal(sum / length, 0), // we rounded off value here
    };
}

function calcAvgError(metric) {
    const length = metric.length;

    let cumulative = 0;
    metric.forEach(data => {
        cumulative += data.errorCount;
    });

    return {
        avgErrorCount: numDecimal(cumulative / length, 0), // round-off the value
    };
}

function numDecimal(num, decimalPlace = 2) {
    decimalPlace = Number(decimalPlace);
    return Number.parseFloat(num).toFixed(decimalPlace);
}

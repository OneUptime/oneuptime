/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();
const PerformanceTrackerMetricService = require('../services/performanceTrackerMetricService');
const moment = require('moment');

const {
    sendErrorResponse,
    sendItemResponse,
    sendListResponse,
} = require('../middlewares/response');
const { isValidAPIKey } = require('../middlewares/performanceTracker');

// Route
// Description: Receiving Performance metric data from sdk.
// Returns: response status, error message
router.post('/:appId/key/:key', isValidAPIKey, async function(req, res) {
    try {
        const { appId } = req.params;
        const { incoming, outgoing, sentAt } = req.body;

        Promise.all([
            PerformanceTrackerMetricService.createMetricsData(
                appId,
                'incoming',
                incoming,
                sentAt
            ),
            PerformanceTrackerMetricService.createMetricsData(
                appId,
                'outgoing',
                outgoing,
                sentAt
            ),
        ]);

        return sendItemResponse(req, res, { message: 'Success' });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch transaction time for performance metrics
router.get('/:appId/key/:key/time', isValidAPIKey, async function(req, res) {
    try {
        const { appId } = req.params;
        let { startDate, endDate } = req.query;
        if (!startDate) {
            const error = new Error(
                'Please specify startDate in the query parameter'
            );
            error.code = 400;
            throw error;
        }
        if (!moment(startDate).isValid()) {
            const error = new Error(
                'Please specify startDate as utc time or millisecond time'
            );
            error.code = 400;
            throw error;
        }
        if (!endDate) {
            const error = new Error(
                'Please specify endDate in the query parameter'
            );
            error.code = 400;
            throw error;
        }
        if (!moment(endDate).isValid()) {
            const error = new Error(
                'Please specify endDate as utc time or millisecond time'
            );
            error.code = 400;
            throw error;
        }
        if (!isNaN(startDate)) {
            startDate = Number(startDate);
        }
        if (!isNaN(endDate)) {
            endDate = Number(endDate);
        }

        const metrics = await PerformanceTrackerMetricService.structureMetricsTime(
            appId,
            startDate,
            endDate
        );

        return sendItemResponse(req, res, metrics);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch throughput for performance metrics
router.get('/:appId/key/:key/throughput', isValidAPIKey, async function(
    req,
    res
) {
    try {
        const { appId } = req.params;
        let { startDate, endDate } = req.query;
        if (!startDate) {
            const error = new Error(
                'Please specify startDate in the query parameter'
            );
            error.code = 400;
            throw error;
        }
        if (!moment(startDate).isValid()) {
            const error = new Error(
                'Please specify startDate as utc time or millisecond time'
            );
            error.code = 400;
            throw error;
        }
        if (!endDate) {
            const error = new Error(
                'Please specify endDate in the query parameter'
            );
            error.code = 400;
            throw error;
        }
        if (!moment(endDate).isValid()) {
            const error = new Error(
                'Please specify endDate as utc time or millisecond time'
            );
            error.code = 400;
            throw error;
        }
        if (!isNaN(startDate)) {
            startDate = Number(startDate);
        }
        if (!isNaN(endDate)) {
            endDate = Number(endDate);
        }

        const metrics = await PerformanceTrackerMetricService.structureMetricsCount(
            appId,
            startDate,
            endDate
        );

        return sendItemResponse(req, res, metrics);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Fetch all the Performance metrics for a particular identifier
router.get('/:appId/key/:key', isValidAPIKey, async function(req, res) {
    try {
        const { appId } = req.params;
        const { type, skip, limit } = req.query;
        let { startDate, endDate } = req.query;
        if (!type) {
            const error = new Error(
                'Please specify the type in the query parameter'
            );
            error.code = 400;
            throw error;
        }
        if (!startDate) {
            const error = new Error(
                'Please specify startDate in the query parameter'
            );
            error.code = 400;
            throw error;
        }
        if (!moment(startDate).isValid()) {
            const error = new Error(
                'Please specify startDate as utc time or millisecond time'
            );
            error.code = 400;
            throw error;
        }
        if (!endDate) {
            const error = new Error(
                'Please specify endDate in the query parameter'
            );
            error.code = 400;
            throw error;
        }
        if (!moment(endDate).isValid()) {
            const error = new Error(
                'Please specify endDate as utc time or millisecond time'
            );
            error.code = 400;
            throw error;
        }
        if (!isNaN(startDate)) {
            startDate = Number(startDate);
        }
        if (!isNaN(endDate)) {
            endDate = Number(endDate);
        }

        const query = {
            performanceTrackerId: appId,
            type,
            createdAt: { $gte: startDate, $lte: endDate },
        };
        const performanceTrackerMetrics = await PerformanceTrackerMetricService.findBy(
            query,
            limit,
            skip
        );
        const count = await PerformanceTrackerMetricService.countBy(query);
        return sendListResponse(req, res, performanceTrackerMetrics, count);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Delete a performance metric
router.delete('/:appId/key/:key/:metricId', isValidAPIKey, async function(
    req,
    res
) {
    try {
        const { metricId } = req.params;
        const deletedMetric = await PerformanceTrackerMetricService.deleteBy({
            _id: metricId,
        });
        return sendItemResponse(req, res, deletedMetric);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;

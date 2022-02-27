import express from 'express';
const router = express.Router();
import PerformanceTrackerMetricService from '../services/performanceTrackerMetricService';
import moment from 'moment';
import { decode } from 'js-base64';

const {
    sendErrorResponse,
    sendItemResponse,
} = require('../middlewares/response');
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../middlewares/performanceTracker"' has n... Remove this comment to see the full error message
import { isValidAPIKey } from '../middlewares/performanceTracker';

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
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        startDate = decode(startDate);
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        endDate = decode(endDate);

        if (!startDate) {
            const error = new Error(
                'Please specify startDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(startDate).isValid()) {
            const error = new Error(
                'Please specify startDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!endDate) {
            const error = new Error(
                'Please specify endDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(endDate).isValid()) {
            const error = new Error(
                'Please specify endDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(startDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
            startDate = Number(startDate);
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(endDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
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
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        startDate = decode(startDate);
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        endDate = decode(endDate);

        if (!startDate) {
            const error = new Error(
                'Please specify startDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(startDate).isValid()) {
            const error = new Error(
                'Please specify startDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!endDate) {
            const error = new Error(
                'Please specify endDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(endDate).isValid()) {
            const error = new Error(
                'Please specify endDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(startDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
            startDate = Number(startDate);
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(endDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
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

router.get('/:appId/key/:key/error', isValidAPIKey, async function(req, res) {
    try {
        const { appId } = req.params;
        let { startDate, endDate } = req.query;
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        startDate = decode(startDate);
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        endDate = decode(endDate);

        if (!startDate) {
            const error = new Error(
                'Please specify startDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(startDate).isValid()) {
            const error = new Error(
                'Please specify startDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!endDate) {
            const error = new Error(
                'Please specify endDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(endDate).isValid()) {
            const error = new Error(
                'Please specify endDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(startDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
            startDate = Number(startDate);
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(endDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
            endDate = Number(endDate);
        }

        const metrics = await PerformanceTrackerMetricService.structureMetricsError(
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
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        startDate = decode(startDate);
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | ParsedQs | string[] | P... Remove this comment to see the full error message
        endDate = decode(endDate);

        if (!type) {
            const error = new Error(
                'Please specify the type in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!startDate) {
            const error = new Error(
                'Please specify startDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(startDate).isValid()) {
            const error = new Error(
                'Please specify startDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!endDate) {
            const error = new Error(
                'Please specify endDate in the query parameter'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        if (!moment(endDate).isValid()) {
            const error = new Error(
                'Please specify endDate as utc time or millisecond time'
            );
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
            error.code = 400;
            throw error;
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(startDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
            startDate = Number(startDate);
        }
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string' is not assignable to par... Remove this comment to see the full error message
        if (!isNaN(endDate)) {
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type 'string | ... Remove this comment to see the full error message
            endDate = Number(endDate);
        }

        const query = {
            performanceTrackerId: appId,
            type,
            createdAt: { $gte: startDate, $lte: endDate },
        };
        const populate = [
            {
                path: 'performanceTrackerId',
                select: 'componentId name slug key',
                populate: { path: 'componentId', select: 'name slug _id' },
            },
        ];
        const select =
            '_id type metrics callIdentifier method performanceTrackerId createdAt updatedAt';
        const performanceTrackerMetrics = await PerformanceTrackerMetricService.mergeMetrics(
            {
                query,
                limit,
                skip,
                sortCriteria: 'metrics.avgTime',
                populate,
                select,
            }
        );

        return sendItemResponse(req, res, performanceTrackerMetrics);
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

export default router;
